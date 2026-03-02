"""
Shared rate limiter instance for Edit Factory.

Extracted from app/main.py to allow route files to import the limiter
without creating circular imports (route files are imported by main.py).

Usage in route files:
    from app.rate_limit import limiter
    from fastapi import Request

    @router.post("/my-endpoint")
    @limiter.limit("10/minute")
    async def my_endpoint(request: Request, ...):
        ...
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

# Global rate limiter — 60 requests/minute per IP (default for all routes)
# Per-route limits are applied via @limiter.limit() decorators in each router
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
