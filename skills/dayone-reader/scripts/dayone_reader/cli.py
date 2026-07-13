from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from .config import Config, load_config, resolve_database
from .database import discover_schema, readonly_connection
from .errors import DayOneReaderError, UsageError
from .repository import Repository


def _csv(value: str | None) -> tuple[str, ...]:
    return tuple(part.strip() for part in (value or "").split(",") if part.strip())


def _limit(value: int | None, config: Config) -> int:
    result = config.output.default_limit if value is None else value
    if result < 1 or result > config.output.max_limit:
        raise UsageError(f"limit must be between 1 and {config.output.max_limit}")
    return result


def _json_size(payload: Any) -> int:
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def _bound(payload: Any, maximum: int) -> Any:
    if _json_size(payload) <= maximum:
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("items"), list):
        payload = dict(payload)
        payload["items"] = list(payload["items"])
        while payload["items"] and _json_size(payload) > maximum:
            payload["items"].pop()
        payload["output_truncated"] = True
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("text"), str):
        payload = dict(payload)
        overshoot = _json_size(payload) - maximum
        keep = max(0, len(payload["text"]) - overshoot - 16)
        payload["text"] = payload["text"][:keep].rstrip() + ("…" if keep else "")
        payload["truncated"] = True
        payload["output_truncated"] = True
        return payload
    return {"output_truncated": True, "items": []}


def _render_text(payload: Any) -> str:
    if isinstance(payload, dict) and "items" in payload:
        lines = []
        for item in payload["items"]:
            if "journal" in item:
                lines.append(f"{item.get('created_at', '')}  {item['journal'].get('name', '')}  {item.get('uuid', '')}")
                lines.append(item.get("text", ""))
                lines.append("")
            elif "name" in item:
                count = item.get("entry_count", "")
                lines.append(f"{item['name']}\t{count}\t{item.get('uuid', '')}".rstrip())
            else:
                lines.append(json.dumps(item, ensure_ascii=False))
        if payload.get("output_truncated"):
            lines.append("[output truncated; narrow the query]")
        return "\n".join(lines).rstrip()
    if isinstance(payload, dict) and "uuid" in payload:
        metadata = [f"UUID: {payload['uuid']}", f"Journal: {payload.get('journal', {}).get('name', '')}", f"Created: {payload.get('created_at', '')}", f"Tags: {', '.join(payload.get('tags', []))}", f"URL: {payload.get('dayone_url', '')}"]
        return "\n".join(metadata) + "\n\n" + payload.get("text", "")
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _emit(payload: Any, json_output: bool, maximum: int) -> None:
    payload = _bound(payload, maximum)
    if json_output:
        # Compact encoding makes the configured character ceiling match actual stdout.
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    else:
        print(_render_text(payload))


def _common_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--config", type=Path, help="configuration file")
    parser.add_argument("--database", help=argparse.SUPPRESS)
    return parser


def build_parser() -> argparse.ArgumentParser:
    common = _common_parser()
    parser = argparse.ArgumentParser(prog="dayone-reader", description="Read Day One locally with enforced privacy limits", parents=[common])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("journals", parents=[common], help="list accessible journals")
    tags = sub.add_parser("tags", parents=[common], help="list accessible tags")
    tags.add_argument("--journal")

    def entry_filters(target: argparse.ArgumentParser, keyword: bool = False) -> None:
        if keyword:
            target.add_argument("query", nargs="?")
        target.add_argument("--journal")
        target.add_argument("--tag", action="append", default=[])
        target.add_argument("--tags")
        target.add_argument("--tag-match", choices=("all", "any"), default="all")
        target.add_argument("--starred", action="store_true")
        target.add_argument("--from", dest="from_date")
        target.add_argument("--to", dest="to_date")
        target.add_argument("--modified-from")
        target.add_argument("--modified-to")
        target.add_argument("--has-location", action="store_true")
        target.add_argument("--has-weather", action="store_true")
        target.add_argument("--has-attachments", action="store_true")
        target.add_argument("--device-type")
        target.add_argument("--limit", type=int)

    recent = sub.add_parser("recent", parents=[common], help="show recent entry previews")
    entry_filters(recent)
    search = sub.add_parser("search", parents=[common], help="search entry previews")
    entry_filters(search, keyword=True)
    otd = sub.add_parser("on-this-day", parents=[common], help="show entries from this date in prior years")
    otd.add_argument("date", help="MM-DD")
    otd.add_argument("--exclude-journal", action="append", default=[])
    otd.add_argument("--exclude-tag", action="append", default=[])
    otd.add_argument("--limit", type=int)
    get = sub.add_parser("get", parents=[common], help="read one entry by UUID")
    get.add_argument("uuid")
    get.add_argument("--full", action="store_true")
    get.add_argument("--include-attachments", action="store_true")
    op = sub.add_parser("open", parents=[common], help="open an entry in Day One")
    op.add_argument("uuid")
    new = sub.add_parser("new", parents=[common], help="create through the official Day One CLI")
    new.add_argument("text", nargs="?")
    new.add_argument("--journal")
    new.add_argument("--tags")
    new.add_argument("--date")
    new.add_argument("--time-zone")
    new.add_argument("--starred", action="store_true")
    new.add_argument("--all-day", action="store_true")
    new.add_argument("--coordinate", nargs=2, type=float, metavar=("LAT", "LON"))
    new.add_argument("--attachment", action="append", default=[], type=Path)
    return parser


def _entry_kwargs(args: argparse.Namespace, config: Config) -> dict[str, Any]:
    tags = tuple(args.tag) + _csv(args.tags)
    return {
        "journal": args.journal, "tags": tags, "tag_match": args.tag_match, "starred": args.starred,
        "from_date": args.from_date, "to_date": args.to_date, "modified_from": args.modified_from,
        "modified_to": args.modified_to, "has_location": args.has_location, "has_weather": args.has_weather,
        "has_attachments": args.has_attachments, "device_type": args.device_type, "limit": _limit(args.limit, config),
    }


def _new_entry(args: argparse.Namespace) -> int:
    text = args.text
    if text is None:
        if sys.stdin.isatty():
            raise UsageError("entry text is required as an argument or on stdin")
        text = sys.stdin.read()
    if not text.strip():
        raise UsageError("entry text cannot be empty")
    command = ["dayone"]
    if args.journal:
        command += ["--journal", args.journal]
    tags = _csv(args.tags)
    if args.date:
        command += ["--date", args.date]
    if args.time_zone:
        command += ["--time-zone", args.time_zone]
    if args.starred:
        command.append("--starred")
    if args.all_day:
        command.append("--all-day")
    if args.coordinate:
        command += ["--coordinate", str(args.coordinate[0]), str(args.coordinate[1])]
    attachments = _validate_attachments(args.attachment)
    if tags:
        command += ["--tags", *tags]
    if attachments:
        command += ["--attachments", *map(str, attachments)]
    if tags or attachments:
        command.append("--")
    command.append("new")
    try:
        completed = subprocess.run(command, input=text, text=True, shell=False, capture_output=True, check=False)
    except FileNotFoundError as exc:
        raise UsageError("official Day One CLI was not found") from exc
    if completed.returncode:
        raise DayOneReaderError("official Day One CLI could not create the entry", code="DAYONE_CLI_ERROR")
    print(completed.stdout.strip() or "Entry created.")
    return 0


def _validate_attachments(paths: list[Path]) -> list[Path]:
    if len(paths) > 10:
        raise UsageError("at most 10 attachments are allowed")
    allowed = {".jpg", ".jpeg", ".png", ".gif", ".heic", ".heif", ".mov", ".mp4", ".m4v", ".mp3", ".m4a", ".wav", ".pdf"}
    result = []
    for path in paths:
        expanded = path.expanduser()
        if expanded.is_symlink() or not expanded.is_file() or expanded.suffix.lower() not in allowed:
            raise UsageError("attachment must be a regular, non-symlink supported media file")
        if expanded.stat().st_size > 500 * 1024 * 1024:
            raise UsageError("attachment exceeds the 500 MiB safety limit")
        result.append(expanded.resolve())
    return result


def run(args: argparse.Namespace) -> int:
    if args.command == "new":
        return _new_entry(args)
    if args.command == "open" and (not args.uuid.strip() or any(char in args.uuid for char in "\r\n&?")):
        raise UsageError("invalid entry UUID")
    config = load_config(args.config)
    database = resolve_database(config, args.database)
    with readonly_connection(database) as connection:
        repository = Repository(connection, discover_schema(connection), config)
        if args.command == "open":
            repository.assert_accessible(args.uuid)
            payload = None
        elif args.command == "journals":
            payload = {"items": repository.journals()}
        elif args.command == "tags":
            payload = {"items": repository.tags(args.journal)}
        elif args.command in {"recent", "search"}:
            kwargs = _entry_kwargs(args, config)
            if args.command == "search":
                kwargs["keyword"] = args.query
            payload = {"items": repository.entries(**kwargs)}
        elif args.command == "on-this-day":
            # Command-line exclusions may only narrow the configured policy.
            narrowed = Config(config.journal_include, config.journal_exclude + tuple(args.exclude_journal), config.tag_exclude + tuple(args.exclude_tag), config.output, config.database)
            repository = Repository(connection, repository.schema, narrowed)
            payload = {"items": repository.entries(month_day=args.date, on_this_day_rules=True, limit=_limit(args.limit, config))}
        elif args.command == "get":
            payload = repository.get(args.uuid, full=args.full, include_attachments=args.include_attachments)
        else:
            raise UsageError("unknown command")
    if args.command == "open":
        subprocess.run(["open", f"dayone://view?entryId={args.uuid}"], shell=False, check=True)
        return 0
    maximum = config.output.max_full_entry_chars if args.command == "get" and args.full else config.output.max_total_chars
    _emit(payload, args.json, maximum)
    return 0


def main() -> None:
    try:
        raise SystemExit(run(build_parser().parse_args()))
    except DayOneReaderError as exc:
        print(json.dumps({"error": {"code": exc.code, "message": str(exc)}}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
    except (OSError, subprocess.SubprocessError) as exc:
        print(json.dumps({"error": {"code": "SYSTEM_ERROR", "message": "the requested local operation failed"}}), file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
