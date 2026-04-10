"""
Shared rate limiter instance for Edit Factory.

Extracted from app/main.py to allow route files to import the limiter
without creating circular imports (route files are imported by main.py).
"""
import ipaddress
import logging

from fastapi import Request
from slowapi import Limiter

from app.config import get_settings

logger = logging.getLogger(__name__)


def _is_trusted_proxy(client_host: str | None) -> bool:
    if not client_host:
        return False

    trusted_entries = [
        entry.strip()
        for entry in get_settings().trusted_proxy_ips.split(",")
        if entry.strip()
    ]
    if not trusted_entries:
        return False

    try:
        client_ip = ipaddress.ip_address(client_host)
    except ValueError:
        return client_host in trusted_entries

    for entry in trusted_entries:
        try:
            if "/" in entry:
                if client_ip in ipaddress.ip_network(entry, strict=False):
                    return True
            elif client_ip == ipaddress.ip_address(entry):
                return True
        except ValueError:
            if client_host == entry:
                return True
    return False


def _get_client_ip(request: Request) -> str:
    client_host = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded and _is_trusted_proxy(client_host):
        forwarded_ip = forwarded.split(",")[0].strip()
        if forwarded_ip:
            return forwarded_ip
    elif forwarded:
        logger.warning("Ignoring X-Forwarded-For from untrusted client host %s", client_host)
    return client_host


limiter = Limiter(key_func=_get_client_ip, default_limits=["200/minute"])
