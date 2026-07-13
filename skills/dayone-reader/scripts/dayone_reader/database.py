from __future__ import annotations

import re
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator
from urllib.parse import quote

from .errors import DatabaseError, SchemaError

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def ident(value: str) -> str:
    """Quote a metadata-discovered identifier after strict validation."""
    if not _IDENTIFIER.fullmatch(value):
        raise SchemaError("database contains an unsafe SQL identifier")
    return f'"{value}"'


@contextmanager
def readonly_connection(path: Path) -> Iterator[sqlite3.Connection]:
    uri = f"file:{quote(str(path), safe='/')}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only = ON")
        connection.execute("PRAGMA trusted_schema = OFF")
        yield connection
    except sqlite3.Error as exc:
        raise DatabaseError("could not read the Day One database") from exc
    finally:
        if "connection" in locals():
            connection.close()


@dataclass(frozen=True)
class Schema:
    entry_table: str
    journal_table: str
    tag_table: str
    attachment_table: str | None
    tag_join_table: str
    tag_join_entry_column: str
    tag_join_tag_column: str
    journal_uuid_columns: tuple[str, ...]

    @property
    def journal_uuid_sql(self) -> str:
        columns = [f"j.{ident(column)}" for column in self.journal_uuid_columns]
        return columns[0] if len(columns) == 1 else f"COALESCE({', '.join(columns)})"


def _tables(connection: sqlite3.Connection) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    rows = connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    for row in rows:
        name = row[0]
        ident(name)
        result[name] = {column[1] for column in connection.execute(f"PRAGMA table_info({ident(name)})")}
        for column in result[name]:
            ident(column)
    return result


def _require_columns(tables: dict[str, set[str]], table: str, required: set[str]) -> None:
    if table not in tables or not required.issubset(tables[table]):
        raise SchemaError(f"Day One schema is missing required {table} fields")


def _relation_score(
    connection: sqlite3.Connection, table: str, entry_col: str, tag_col: str
) -> tuple[int, int, int]:
    sql = f"""
        SELECT COUNT(*),
               SUM(CASE WHEN e.Z_PK IS NOT NULL THEN 1 ELSE 0 END),
               SUM(CASE WHEN t.Z_PK IS NOT NULL THEN 1 ELSE 0 END)
        FROM {ident(table)} r
        LEFT JOIN ZENTRY e ON e.Z_PK = r.{ident(entry_col)}
        LEFT JOIN ZTAG t ON t.Z_PK = r.{ident(tag_col)}
        WHERE r.{ident(entry_col)} IS NOT NULL OR r.{ident(tag_col)} IS NOT NULL
    """
    row = connection.execute(sql).fetchone()
    return int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)


def _discover_tag_relation(
    connection: sqlite3.Connection, tables: dict[str, set[str]]
) -> tuple[str, str, str]:
    candidates: list[tuple[float, str, str, str]] = []
    entity_tables = {"ZENTRY", "ZTAG", "ZJOURNAL", "ZATTACHMENT"}
    for table, columns in tables.items():
        if table in entity_tables or not table.startswith("Z_") or len(columns) < 2 or len(columns) > 4:
            continue
        usable = [column for column in columns if column not in {"Z_FOK_"}]
        for entry_col in usable:
            for tag_col in usable:
                if entry_col == tag_col:
                    continue
                total, entry_hits, tag_hits = _relation_score(connection, table, entry_col, tag_col)
                if total and entry_hits == total and tag_hits == total:
                    name_hint = int("TAG" in table.upper()) + int("ENTR" in entry_col.upper()) + int("TAG" in tag_col.upper())
                    candidates.append((name_hint + min(total, 1000) / 10000, table, entry_col, tag_col))
    if not candidates:
        raise SchemaError("could not discover the Day One entry/tag relationship")
    candidates.sort(reverse=True)
    best = candidates[0]
    if len(candidates) > 1 and candidates[1][0] == best[0]:
        raise SchemaError("Day One entry/tag relationship is ambiguous")
    return best[1], best[2], best[3]


def discover_schema(connection: sqlite3.Connection) -> Schema:
    tables = _tables(connection)
    _require_columns(tables, "ZENTRY", {"Z_PK", "ZUUID", "ZJOURNAL", "ZMARKDOWNTEXT", "ZCREATIONDATE", "ZMODIFIEDDATE"})
    _require_columns(tables, "ZJOURNAL", {"Z_PK", "ZNAME"})
    _require_columns(tables, "ZTAG", {"Z_PK", "ZNAME"})
    uuid_columns = tuple(column for column in ("ZSYNCJOURNALID", "ZUUIDFORAUXILIARYSYNC", "ZUUID") if column in tables["ZJOURNAL"])
    if not uuid_columns:
        raise SchemaError("Day One journal UUID field was not found")
    relation = _discover_tag_relation(connection, tables)
    attachment = "ZATTACHMENT" if {"Z_PK", "ZENTRY"}.issubset(tables.get("ZATTACHMENT", set())) else None
    return Schema("ZENTRY", "ZJOURNAL", "ZTAG", attachment, *relation, uuid_columns)
