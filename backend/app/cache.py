import json
import logging
import time
from typing import Any

import redis
from prometheus_client import Counter

from app.config import REDIS_URL

logger = logging.getLogger(__name__)

RETRY_AFTER_SECONDS = 5.0

CACHE_LOOKUPS = Counter(
    "photo_cache_lookups_total",
    "Lectures dans le cache Redis, par cache et par résultat",
    ["cache", "result"],
)

client: redis.Redis | None = (
    redis.Redis.from_url(REDIS_URL, socket_timeout=0.25, socket_connect_timeout=0.25)
    if REDIS_URL
    else None
)
unavailable_until = 0.0


def available() -> bool:
    return client is not None and time.monotonic() >= unavailable_until


def mark_unavailable(error: Exception) -> None:
    global unavailable_until
    unavailable_until = time.monotonic() + RETRY_AFTER_SECONDS
    logger.warning("Redis indisponible, cache ignoré pendant %.0f s : %s", RETRY_AFTER_SECONDS, error)


def get_bytes(cache: str, key: str) -> bytes | None:
    if not available():
        return None
    try:
        value = client.get(key)
    except redis.RedisError as error:
        mark_unavailable(error)
        CACHE_LOOKUPS.labels(cache, "error").inc()
        return None
    CACHE_LOOKUPS.labels(cache, "miss" if value is None else "hit").inc()
    return value


def set_bytes(key: str, value: bytes, ttl_seconds: int) -> None:
    if ttl_seconds < 1 or not available():
        return
    try:
        client.set(key, value, ex=ttl_seconds)
    except redis.RedisError as error:
        mark_unavailable(error)


def get_json(cache: str, key: str) -> Any | None:
    raw = get_bytes(cache, key)
    return None if raw is None else json.loads(raw)


def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    set_bytes(key, json.dumps(value).encode(), ttl_seconds)


def delete(*keys: str) -> None:
    if not keys or not available():
        return
    try:
        client.delete(*keys)
    except redis.RedisError as error:
        mark_unavailable(error)


def status() -> str:
    if client is None:
        return "disabled"
    try:
        client.ping()
    except redis.RedisError:
        return "unavailable"
    return "ok"
