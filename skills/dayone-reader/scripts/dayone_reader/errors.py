from __future__ import annotations


class DayOneReaderError(Exception):
    code = "DAYONE_READER_ERROR"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code


class ConfigError(DayOneReaderError):
    code = "CONFIG_ERROR"


class DatabaseError(DayOneReaderError):
    code = "DATABASE_ERROR"


class SchemaError(DayOneReaderError):
    code = "UNSUPPORTED_SCHEMA"


class AccessDeniedError(DayOneReaderError):
    code = "ACCESS_DENIED"


class NotFoundError(DayOneReaderError):
    code = "NOT_FOUND"


class UsageError(DayOneReaderError):
    code = "INVALID_ARGUMENT"
