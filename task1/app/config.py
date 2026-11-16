"""Runtime configuration, read once from environment variables.

Secrets have no defaults here: the app refuses to start without them.
docker-compose.yml supplies clearly-labelled development values.
"""
import os


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Environment variable {name} must be set")
    return value


DATABASE_URL = _require("DATABASE_URL")
WEBHOOK_SECRET = _require("WEBHOOK_SECRET")
ADMIN_API_TOKEN = _require("ADMIN_API_TOKEN")

DEFAULT_MONTHLY_MINUTES_CAP = int(os.getenv("MONTHLY_MINUTES_CAP", "1000"))
RETRY_INTERVAL_SECONDS = int(os.getenv("RETRY_INTERVAL_SECONDS", "30"))
RETRY_MAX_ATTEMPTS = int(os.getenv("RETRY_MAX_ATTEMPTS", "5"))
RETRY_WORKER_ENABLED = os.getenv("RETRY_WORKER_ENABLED", "true").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
