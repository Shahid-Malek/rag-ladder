"""Hosted request boundaries; no retrieval or model code."""
from collections import OrderedDict
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
import ipaddress
import json
import math
import os
import tempfile
import threading
import time
from urllib.parse import urlsplit

import config

_deadline = ContextVar("request_deadline", default=None)
_rate_lock = threading.Lock()
_budget_lock = threading.Lock()
_ip_windows = OrderedDict()


class ProtectionError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 503):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


@contextmanager
def deadline(seconds: float):
    end = time.monotonic() + seconds
    outer = _deadline.get()
    token = _deadline.set(min(end, outer) if outer is not None else end)
    try:
        check_deadline()
        yield
        check_deadline()
    finally:
        _deadline.reset(token)


def remaining() -> float:
    end = _deadline.get()
    left = end - time.monotonic() if end is not None else config.REQUEST_TIMEOUT_SECONDS
    if left <= 0:
        raise ProtectionError("deadline_exceeded", "Processing deadline exceeded")
    return left


def check_deadline() -> None:
    remaining()


def sleep(seconds: float) -> None:
    if seconds >= remaining():
        raise ProtectionError("deadline_exceeded", "Processing deadline exceeded")
    time.sleep(max(0, seconds))
    check_deadline()


def validate_hosted_config() -> None:
    if not config.HOSTED_MODE:
        return
    origin = urlsplit(config.PUBLIC_ORIGIN)
    if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
            or origin.path or origin.query or origin.fragment or origin.port not in (None, 443)
            or config.PUBLIC_ORIGIN != "https://" + origin.hostname
            or config.CORS_ORIGINS != (config.PUBLIC_ORIGIN,)
            or config.TURNSTILE_HOSTNAME != origin.hostname or not config.TURNSTILE_ACTION
            or not config.TURNSTILE_ENABLED or not config.TURNSTILE_SECRET or not config.TURNSTILE_SITE_KEY):
        raise ProtectionError("configuration_invalid", "Hosted security settings are incomplete")
    if (config.SESSION_MAX_DOCS > 2 or config.SESSION_MAX_QUESTIONS > 10
            or config.MAX_ACTIVE_SESSIONS > 4 or config.MAX_CONCURRENT_INGESTS != 1
            or not 1 <= config.MAX_CONCURRENT_QUESTIONS <= 2):
        raise ProtectionError("configuration_invalid", "Hosted capacity exceeds the supported budget")
    try:
        peers = config.TRUSTED_PROXY_IPS.split(",")
        if not peers or any(not peer.strip() for peer in peers):
            raise ValueError()
        for peer in peers:
            ipaddress.ip_address(peer.strip())
    except ValueError:
        raise ProtectionError("configuration_invalid", "Configure exact tunnel peer IP addresses") from None


def client_ip(request) -> str:
    peer = request.client.host if request.client else ""
    if not config.HOSTED_MODE:
        return peer or "unknown"
    validate_hosted_config()
    if peer not in {value.strip() for value in config.TRUSTED_PROXY_IPS.split(",")}:
        raise ProtectionError("untrusted_peer", "Request must arrive through the tunnel", 403)
    host = request.headers.getlist("host")
    proto = request.headers.getlist("x-forwarded-proto")
    values = request.headers.getlist("cf-connecting-ip")
    if host not in ([config.TURNSTILE_HOSTNAME], [config.TURNSTILE_HOSTNAME + ":443"]):
        raise ProtectionError("invalid_host", "Invalid request host", 400)
    if proto != ["https"]:
        raise ProtectionError("https_required", "HTTPS is required", 403)
    if request.headers.get("origin") not in (None, config.PUBLIC_ORIGIN):
        raise ProtectionError("invalid_origin", "Origin is not allowed", 403)
    try:
        if len(values) != 1:
            raise ValueError()
        return str(ipaddress.ip_address(values[0]))
    except ValueError:
        raise ProtectionError("invalid_client_ip", "Invalid tunnel client address", 403) from None


def admit_ip(ip: str) -> None:
    now = time.monotonic()
    with _rate_lock:
        while _ip_windows and next(iter(_ip_windows.values()))[0] <= now:
            _ip_windows.popitem(last=False)
        end, count = _ip_windows.get(ip, (now + 60, 0))
        if count >= config.IP_REQUESTS_PER_MINUTE or (ip not in _ip_windows and len(_ip_windows) >= config.MAX_RATE_IPS):
            raise ProtectionError("rate_limited", "Request rate limit exceeded", 429)
        _ip_windows[ip] = (end, count + 1)


def security_headers() -> dict[str, str]:
    return {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "Strict-Transport-Security": "max-age=31536000",
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}


def post(url: str, maximum: int, timeout: float, **kwargs):
    """Cancel and close upstream IO at the shared deadline, with bounded buffering."""
    import asyncio
    import httpx

    async def send():
        async with asyncio.timeout(min(timeout, remaining())):
            async with httpx.AsyncClient(timeout=min(timeout, remaining()), trust_env=False,
                                         headers={"Accept-Encoding": "identity"}) as client:
                async with client.stream("POST", url, **kwargs) as response:
                    length = response.headers.get("content-length", "")
                    if (length.isdigit() and int(length) > maximum) or response.headers.get("content-encoding", "identity") != "identity":
                        raise ProtectionError("provider_response_too_large", "Upstream response exceeds limit")
                    body = bytearray()
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        check_deadline()
                        if len(body) + len(chunk) > maximum:
                            raise ProtectionError("provider_response_too_large", "Upstream response exceeds limit")
                        body.extend(chunk)
                    check_deadline()
                    return httpx.Response(response.status_code, content=bytes(body),
                                          headers=response.headers, request=response.request)
    try:
        return asyncio.run(send())
    except TimeoutError:
        raise ProtectionError("deadline_exceeded", "Upstream deadline exceeded") from None


def validate_turnstile(data: dict) -> None:
    try:
        stamp = datetime.fromisoformat(data["challenge_ts"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - stamp).total_seconds()
        valid = (data.get("success") is True and data.get("hostname") == config.TURNSTILE_HOSTNAME
                 and data.get("action") == config.TURNSTILE_ACTION and 0 <= age <= 300)
    except (KeyError, ValueError, TypeError, AttributeError):
        valid = False
    if not valid:
        raise ProtectionError("turnstile_rejected", "Turnstile verification failed", 422)


def runtime_bytes() -> int:
    total = 0
    for path in config.DATA.rglob("*"):
        try:
            if not path.is_symlink() and path.is_file():
                total += path.stat().st_size
        except FileNotFoundError:
            pass
    return total


def reserve_database_activity() -> None:
    """Reserve a conservative activity window; metadata only, durable across restarts."""
    now = time.time()
    day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
    path = config.DATA / "capacity.json"
    with _budget_lock:
        try:
            state = json.loads(path.read_text()) if path.exists() else None
            if state is not None:
                if (not isinstance(state, dict) or not isinstance(state["day"], str)
                        or not all(isinstance(state[key], (int, float)) and math.isfinite(state[key]) and state[key] >= 0
                                   for key in ("last", "seconds")) or state["last"] > now):
                    raise ValueError()
            if state is None or state["day"] != day:
                state = dict(day=day, last=now, seconds=0)
                charge = config.DB_ACTIVITY_WINDOW_SECONDS
            else:
                charge = min(now - state["last"], config.DB_ACTIVITY_WINDOW_SECONDS)
            used = state["seconds"] + charge
            if used > config.MAX_DB_ACTIVE_SECONDS_PER_DAY:
                raise ProtectionError("demo_capacity_reached", "Daily database activity budget reached")
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix=".capacity-", dir=path.parent)
            try:
                with os.fdopen(fd, "w") as stream:
                    json.dump(dict(day=day, last=now, seconds=used), stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        except (OSError, ValueError, KeyError, TypeError):
            raise ProtectionError("capacity_unavailable", "Capacity accounting is unavailable") from None
