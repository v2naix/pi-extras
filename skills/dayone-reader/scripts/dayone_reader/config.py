from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import ConfigError

DEFAULT_CONFIG = Path.home() / "Library" / "Application Support" / "dayone-reader" / "config.json"
DEFAULT_DATABASE_CANDIDATES = (
    Path.home() / "Library" / "Group Containers" / "5U8NS4GX82.dayoneapp2" / "Data" / "Documents" / "DayOne.sqlite",
)


@dataclass(frozen=True)
class OutputConfig:
    default_limit: int = 5
    max_limit: int = 20
    preview_chars: int = 400
    max_total_chars: int = 12_000
    max_full_entry_chars: int = 30_000


@dataclass(frozen=True)
class Config:
    journal_include: tuple[str, ...] = ()
    journal_exclude: tuple[str, ...] = ()
    tag_exclude: tuple[str, ...] = ()
    output: OutputConfig = field(default_factory=OutputConfig)
    database: Path | None = None


def _strings(value: Any, key: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise ConfigError(f"{key} must be an array of non-empty strings")
    return tuple(item.strip() for item in value)


def _positive_int(value: Any, key: str, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ConfigError(f"{key} must be a positive integer")
    return value


def load_config(path: Path | None = None) -> Config:
    path = path or Path(os.environ.get("DAYONE_READER_CONFIG", DEFAULT_CONFIG)).expanduser()
    if not path.exists():
        return Config()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError("could not read the configuration file") from exc
    if not isinstance(raw, dict):
        raise ConfigError("configuration root must be an object")
    journals = raw.get("journals", {})
    tags = raw.get("tags", {})
    output = raw.get("output", {})
    if not all(isinstance(x, dict) for x in (journals, tags, output)):
        raise ConfigError("journals, tags, and output must be objects")
    limits = OutputConfig(
        default_limit=_positive_int(output.get("default_limit"), "output.default_limit", 5),
        max_limit=_positive_int(output.get("max_limit"), "output.max_limit", 20),
        preview_chars=_positive_int(output.get("preview_chars"), "output.preview_chars", 400),
        max_total_chars=_positive_int(output.get("max_total_chars"), "output.max_total_chars", 12_000),
        max_full_entry_chars=_positive_int(output.get("max_full_entry_chars"), "output.max_full_entry_chars", 30_000),
    )
    if limits.default_limit > limits.max_limit:
        raise ConfigError("output.default_limit cannot exceed output.max_limit")
    db = raw.get("database")
    if db is not None and not isinstance(db, str):
        raise ConfigError("database must be a path string")
    return Config(
        journal_include=_strings(journals.get("include"), "journals.include"),
        journal_exclude=_strings(journals.get("exclude"), "journals.exclude"),
        tag_exclude=_strings(tags.get("exclude"), "tags.exclude"),
        output=limits,
        database=Path(db).expanduser() if db else None,
    )


def resolve_database(config: Config, override: str | None = None) -> Path:
    explicit = override or os.environ.get("DAYONE_READER_DATABASE")
    if explicit:
        candidate = Path(explicit).expanduser()
    elif config.database:
        candidate = config.database
    else:
        candidate = next((path for path in DEFAULT_DATABASE_CANDIDATES if path.is_file()), DEFAULT_DATABASE_CANDIDATES[0])
    if not candidate.is_file():
        raise ConfigError("Day One database not found; configure database or DAYONE_READER_DATABASE", code="DATABASE_NOT_FOUND")
    return candidate
