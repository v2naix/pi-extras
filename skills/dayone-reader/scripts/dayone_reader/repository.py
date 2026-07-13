from __future__ import annotations

import sqlite3
from datetime import UTC, date, datetime, timedelta
from typing import Any, Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import Config
from .database import Schema, ident
from .errors import AccessDeniedError, NotFoundError, UsageError

APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=UTC)


def _placeholders(values: Iterable[object]) -> str:
    return ",".join("?" for _ in values)


def _apple_timestamp(value: datetime) -> float:
    return (value.astimezone(UTC) - APPLE_EPOCH).total_seconds()


def parse_date_boundary(value: str, *, end: bool = False) -> float:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise UsageError(f"invalid ISO date: {value}") from exc
    date_only = "T" not in value and " " not in value
    if date_only and end:
        parsed += timedelta(days=1)
    if parsed.tzinfo is None:
        parsed = parsed.astimezone()
    return _apple_timestamp(parsed)


def format_core_date(value: float | None, timezone_name: str | None = None) -> str | None:
    if value is None:
        return None
    result = APPLE_EPOCH + timedelta(seconds=float(value))
    if isinstance(timezone_name, str) and timezone_name:
        try:
            result = result.astimezone(ZoneInfo(timezone_name))
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return result.isoformat()


def _truncate(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit].rstrip() + "…", True


class Repository:
    def __init__(self, connection: sqlite3.Connection, schema: Schema, config: Config) -> None:
        self.connection = connection
        self.schema = schema
        self.config = config
        self.entry_columns = {row[1] for row in connection.execute("PRAGMA table_info(ZENTRY)")}
        self.journal_columns = {row[1] for row in connection.execute("PRAGMA table_info(ZJOURNAL)")}
        self.attachment_columns = (
            {row[1] for row in connection.execute("PRAGMA table_info(ZATTACHMENT)")}
            if schema.attachment_table else set()
        )

    def _column(self, alias: str, name: str, default: str = "NULL") -> str:
        columns = self.entry_columns if alias == "e" else self.journal_columns
        return f"{alias}.{ident(name)}" if name in columns else default

    def _access_sql(self, *, entry_alias: str = "e", journal_alias: str = "j") -> tuple[list[str], list[Any]]:
        where: list[str] = []
        params: list[Any] = []
        uuid = self.schema.journal_uuid_sql.replace("j.", f"{journal_alias}.")
        name = f"{journal_alias}.ZNAME"
        if self.config.journal_include:
            values = self.config.journal_include
            marks = _placeholders(values)
            where.append(f"({name} IN ({marks}) OR {uuid} IN ({marks}))")
            params.extend(values)
            params.extend(values)
        if self.config.journal_exclude:
            values = self.config.journal_exclude
            marks = _placeholders(values)
            where.append(f"NOT ({name} IN ({marks}) OR {uuid} IN ({marks}))")
            params.extend(values)
            params.extend(values)
        if "ZISTRASHJOURNAL" in self.journal_columns:
            where.append(f"COALESCE({journal_alias}.ZISTRASHJOURNAL, 0) = 0")
        if "ZISDRAFT" in self.entry_columns:
            where.append(f"COALESCE({entry_alias}.ZISDRAFT, 0) = 0")
        if self.config.tag_exclude:
            values = self.config.tag_exclude
            marks = _placeholders(values)
            where.append(
                f"NOT EXISTS (SELECT 1 FROM {ident(self.schema.tag_join_table)} acl_r "
                f"JOIN ZTAG acl_t ON acl_t.Z_PK = acl_r.{ident(self.schema.tag_join_tag_column)} "
                f"WHERE acl_r.{ident(self.schema.tag_join_entry_column)} = {entry_alias}.Z_PK "
                f"AND acl_t.ZNAME IN ({marks}))"
            )
            params.extend(values)
        return where, params

    def journals(self) -> list[dict[str, Any]]:
        access, params = self._access_sql()
        where = " AND ".join(access) if access else "1=1"
        uuid = self.schema.journal_uuid_sql
        rows = self.connection.execute(
            f"""SELECT j.ZNAME name, {uuid} uuid, COUNT(e.Z_PK) entry_count,
                       MAX(e.ZCREATIONDATE) latest,
                       {self._column('j', 'ZISTRASHJOURNAL', '0')} is_trash
                FROM ZJOURNAL j LEFT JOIN ZENTRY e ON e.ZJOURNAL = j.Z_PK AND {where}
                GROUP BY j.Z_PK ORDER BY j.ZNAME COLLATE NOCASE""",
            params,
        ).fetchall()
        # A LEFT JOIN can retain disallowed journals; apply journal ACL without an entry.
        allowed = []
        for row in rows:
            if not row["is_trash"] and self._journal_allowed(row["name"], row["uuid"]):
                allowed.append({"name": row["name"], "uuid": row["uuid"], "entry_count": row["entry_count"], "latest_entry_at": format_core_date(row["latest"])})
        return allowed

    def _journal_allowed(self, name: str | None, uuid: str | None) -> bool:
        include = self.config.journal_include
        exclude = self.config.journal_exclude
        identity = {value for value in (name, uuid) if value}
        return (not include or bool(identity.intersection(include))) and not bool(identity.intersection(exclude))

    def tags(self, journal: str | None = None) -> list[dict[str, Any]]:
        access, params = self._access_sql()
        if journal:
            uuid = self.schema.journal_uuid_sql
            access.append(f"(j.ZNAME = ? OR {uuid} = ?)")
            params.extend([journal, journal])
        where = " AND ".join(access) if access else "1=1"
        r, ec, tc = map(ident, (self.schema.tag_join_table, self.schema.tag_join_entry_column, self.schema.tag_join_tag_column))
        rows = self.connection.execute(
            f"""SELECT t.ZNAME name, COUNT(DISTINCT e.Z_PK) entry_count
                FROM ZTAG t JOIN {r} rel ON rel.{tc} = t.Z_PK
                JOIN ZENTRY e ON e.Z_PK = rel.{ec} JOIN ZJOURNAL j ON j.Z_PK = e.ZJOURNAL
                WHERE {where} GROUP BY t.Z_PK ORDER BY entry_count DESC, t.ZNAME COLLATE NOCASE""",
            params,
        ).fetchall()
        excluded = set(self.config.tag_exclude)
        return [dict(row) for row in rows if row["name"] not in excluded]

    def entries(
        self, *, keyword: str | None = None, journal: str | None = None,
        tags: tuple[str, ...] = (), tag_match: str = "all", starred: bool = False,
        from_date: str | None = None, to_date: str | None = None,
        modified_from: str | None = None, modified_to: str | None = None,
        has_location: bool = False, has_weather: bool = False, has_attachments: bool = False,
        device_type: str | None = None, month_day: str | None = None,
        on_this_day_rules: bool = False, limit: int = 5,
    ) -> list[dict[str, Any]]:
        where, params = self._access_sql()
        uuid = self.schema.journal_uuid_sql
        if keyword:
            where.append("e.ZMARKDOWNTEXT LIKE ? ESCAPE '\\'")
            escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            params.append(f"%{escaped}%")
        if journal:
            where.append(f"(j.ZNAME = ? OR {uuid} = ?)")
            params.extend([journal, journal])
        self._add_tag_filter(where, params, tags, tag_match)
        if starred:
            if "ZSTARRED" not in self.entry_columns:
                raise UsageError("this Day One schema does not expose starred state")
            where.append("COALESCE(e.ZSTARRED, 0) = 1")
        for column, value, is_end, operator in (
            ("ZCREATIONDATE", from_date, False, ">="), ("ZCREATIONDATE", to_date, True, "<"),
            ("ZMODIFIEDDATE", modified_from, False, ">="), ("ZMODIFIEDDATE", modified_to, True, "<"),
        ):
            if value:
                where.append(f"e.{column} {operator} ?")
                params.append(parse_date_boundary(value, end=is_end))
        if has_location:
            if "ZLOCATION" not in self.entry_columns:
                raise UsageError("this Day One schema does not expose entry locations")
            where.append("e.ZLOCATION IS NOT NULL")
        if has_weather:
            if "ZWEATHER" not in self.entry_columns:
                raise UsageError("this Day One schema does not expose entry weather")
            where.append("e.ZWEATHER IS NOT NULL")
        if has_attachments:
            if not self.schema.attachment_table:
                return []
            where.append("EXISTS (SELECT 1 FROM ZATTACHMENT af WHERE af.ZENTRY = e.Z_PK)")
        if device_type:
            if "ZCREATIONDEVICETYPE" not in self.entry_columns:
                raise UsageError("this Day One schema does not expose creation device type")
            where.append("e.ZCREATIONDEVICETYPE = ?")
            params.append(device_type)
        if month_day:
            try:
                parts = month_day.split("-")
                if len(parts) != 2 or any(len(part) != 2 or not part.isdigit() for part in parts):
                    raise ValueError
                parsed = date(2000, int(parts[0]), int(parts[1]))  # leap year validates 02-29
            except ValueError as exc:
                raise UsageError("on-this-day date must use MM-DD") from exc
            if {"ZGREGORIANMONTH", "ZGREGORIANDAY"}.issubset(self.entry_columns):
                where.extend(["e.ZGREGORIANMONTH = ?", "e.ZGREGORIANDAY = ?"])
                params.extend([parsed.month, parsed.day])
            else:
                where.append("strftime('%m-%d', e.ZCREATIONDATE + 978307200, 'unixepoch') = ?")
                params.append(month_day)
            if on_this_day_rules and "ZSHOULDBEINCLUDEDINONTHISDAY" in self.journal_columns:
                where.append("COALESCE(j.ZSHOULDBEINCLUDEDINONTHISDAY, 1) = 1")
        sql = self._entry_select() + " WHERE " + " AND ".join(where or ["1=1"]) + " ORDER BY e.ZCREATIONDATE DESC LIMIT ?"
        params.append(limit)
        rows = self.connection.execute(sql, params).fetchall()
        return [self._entry_summary(row) for row in rows]

    def _add_tag_filter(self, where: list[str], params: list[Any], tags: tuple[str, ...], match: str) -> None:
        if not tags:
            return
        r, ec, tc = map(ident, (self.schema.tag_join_table, self.schema.tag_join_entry_column, self.schema.tag_join_tag_column))
        if match == "any":
            where.append(f"EXISTS (SELECT 1 FROM {r} fr JOIN ZTAG ft ON ft.Z_PK=fr.{tc} WHERE fr.{ec}=e.Z_PK AND ft.ZNAME IN ({_placeholders(tags)}))")
            params.extend(tags)
        else:
            for tag in tags:
                where.append(f"EXISTS (SELECT 1 FROM {r} fr JOIN ZTAG ft ON ft.Z_PK=fr.{tc} WHERE fr.{ec}=e.Z_PK AND ft.ZNAME=?)")
                params.append(tag)

    def _entry_select(self) -> str:
        uuid = self.schema.journal_uuid_sql
        return f"""SELECT e.Z_PK internal_pk, e.ZUUID uuid, e.ZMARKDOWNTEXT text,
            e.ZCREATIONDATE created, e.ZMODIFIEDDATE modified, {self._column('e', 'ZTIMEZONE')} timezone,
            {self._column('e', 'ZSTARRED', '0')} starred, {self._column('e', 'ZLOCATION')} location_id,
            {self._column('e', 'ZWEATHER')} weather_id, j.ZNAME journal_name, {uuid} journal_uuid,
            {self._column('e', 'ZCREATIONDEVICETYPE')} device_type
            FROM ZENTRY e JOIN ZJOURNAL j ON j.Z_PK=e.ZJOURNAL"""

    def _tags_for_entry(self, pk: int) -> list[str]:
        r, ec, tc = map(ident, (self.schema.tag_join_table, self.schema.tag_join_entry_column, self.schema.tag_join_tag_column))
        return [row[0] for row in self.connection.execute(f"SELECT t.ZNAME FROM ZTAG t JOIN {r} rel ON rel.{tc}=t.Z_PK WHERE rel.{ec}=? ORDER BY t.ZNAME COLLATE NOCASE", (pk,)) if row[0] not in self.config.tag_exclude]

    def _attachment_summary(self, pk: int) -> dict[str, Any]:
        if not self.schema.attachment_table:
            return {"count": 0, "types": []}
        type_sql = "ZTYPE" if "ZTYPE" in self.attachment_columns else "NULL"
        rows = self.connection.execute(f"SELECT {type_sql} FROM ZATTACHMENT WHERE ZENTRY=?", (pk,)).fetchall()
        return {"count": len(rows), "types": sorted({row[0] for row in rows if row[0]})}

    def _entry_summary(self, row: sqlite3.Row) -> dict[str, Any]:
        text, truncated = _truncate(row["text"] or "", self.config.output.preview_chars)
        result: dict[str, Any] = {
            "uuid": row["uuid"], "journal": {"name": row["journal_name"], "uuid": row["journal_uuid"]},
            "created_at": format_core_date(row["created"], row["timezone"]),
            "modified_at": format_core_date(row["modified"], row["timezone"]),
            "tags": self._tags_for_entry(row["internal_pk"]), "starred": bool(row["starred"]),
            "location": {"present": row["location_id"] is not None}, "weather": {"present": row["weather_id"] is not None},
            "attachments": self._attachment_summary(row["internal_pk"]), "text": text, "truncated": truncated,
            "dayone_url": f"dayone://view?entryId={row['uuid']}",
        }
        if row["device_type"]:
            result["creation_device_type"] = row["device_type"]
        return result

    def assert_accessible(self, uuid: str) -> None:
        where, params = self._access_sql()
        where.append("e.ZUUID = ?")
        params.append(uuid)
        row = self.connection.execute(
            "SELECT 1 FROM ZENTRY e JOIN ZJOURNAL j ON j.Z_PK=e.ZJOURNAL WHERE " + " AND ".join(where) + " LIMIT 1",
            params,
        ).fetchone()
        if row is not None:
            return
        if self.connection.execute("SELECT 1 FROM ZENTRY WHERE ZUUID=?", (uuid,)).fetchone():
            raise AccessDeniedError("entry is outside the configured access policy")
        raise NotFoundError("entry was not found")

    def get(self, uuid: str, *, full: bool = False, include_attachments: bool = False) -> dict[str, Any]:
        where, params = self._access_sql()
        where.append("e.ZUUID = ?")
        params.append(uuid)
        row = self.connection.execute(self._entry_select() + " WHERE " + " AND ".join(where) + " LIMIT 1", params).fetchone()
        if row is None:
            raw = self.connection.execute("SELECT 1 FROM ZENTRY WHERE ZUUID=?", (uuid,)).fetchone()
            if raw:
                raise AccessDeniedError("entry is outside the configured access policy")
            raise NotFoundError("entry was not found")
        result = self._entry_summary(row)
        limit = self.config.output.max_full_entry_chars if full else self.config.output.preview_chars
        result["text"], result["truncated"] = _truncate(row["text"] or "", limit)
        if include_attachments:
            result["attachments"] = self._attachment_details(row["internal_pk"])
        return result

    def _attachment_details(self, pk: int) -> dict[str, Any]:
        if not self.schema.attachment_table:
            return {"count": 0, "types": [], "items": []}
        safe = [name for name in ("ZTYPE", "ZFILENAME", "ZTITLE", "ZCAPTION", "ZFILESIZE", "ZDURATION") if name in self.attachment_columns]
        order = "ZORDERINENTRY" if "ZORDERINENTRY" in self.attachment_columns else "Z_PK"
        rows = self.connection.execute(f"SELECT {', '.join(map(ident, safe))} FROM ZATTACHMENT WHERE ZENTRY=? ORDER BY {ident(order)}", (pk,)).fetchall()
        keymap = {"ZTYPE": "type", "ZFILENAME": "filename", "ZTITLE": "title", "ZCAPTION": "caption", "ZFILESIZE": "size", "ZDURATION": "duration"}
        items = [{keymap[key]: row[key] for key in safe if row[key] is not None} for row in rows]
        return {"count": len(items), "types": sorted({item["type"] for item in items if item.get("type")}), "items": items}
