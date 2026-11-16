"""Structured (one JSON object per line) logging."""
import json
import logging

from . import config

logging.basicConfig(level=config.LOG_LEVEL, format="%(message)s")
_logger = logging.getLogger("callzo")


def log(event: str, level: int = logging.INFO, **fields) -> None:
    _logger.log(level, json.dumps({"event": event, **fields}))
