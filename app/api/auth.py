"""
Authentication utilities for Edit Factory API.
Handles JWT verification and user extraction from Supabase tokens.
"""
import logging
import time as _time
import threading as _threading
from typing import Optional, Dict
from dataclasses import dataclass
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt.exceptions import PyJWTError

from app.config import get_settings

logger = logging.getLogger(__name__)

# Profile context cache: (user_id, profile_id_or_default) -> (ProfileContext, timestamp)
_profile_cache: Dict[tuple, tuple] = {}
_profile_cache_lock = _threading.Lock()
_PROFILE_CACHE_TTL = 60  # seconds

# Security scheme for Swagger UI
security = HTTPBearer(auto_error=False)


class AuthUser:
    """Represents an authenticated user."""
    def __init__(self, user_id: str, email: Optional[str] = None, role: str = "authenticated"):
        self.id = user_id
        self.email = email
        self.role = role


@dataclass
class ProfileContext:
    """Profile context for request."""
    profile_id: str
    user_id: str


def verify_jwt_token(token: str) -> dict:
    """
    Verify a Supabase JWT token and return the payload.

    Args:
        token: JWT token string

    Returns:
        Decoded token payload

    Raises:
        HTTPException: If token is invalid or expired
    """
    settings = get_settings()

    if not settings.supabase_jwt_secret:
        logger.error("SUPABASE_JWT_SECRET not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication not configured"
        )

    try:
        # Decode and verify the token
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated"
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"}
        )
    except jwt.InvalidAudienceError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token audience",
            headers={"WWW-Authenticate": "Bearer"}
        )
    except PyJWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"}
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    authorization: Optional[str] = Header(None)
) -> AuthUser:
    """
    FastAPI dependency to get the current authenticated user.

    Extracts and verifies JWT from Authorization header.

    Args:
        credentials: Bearer token from HTTPBearer security
        authorization: Raw Authorization header (fallback)

    Returns:
        AuthUser object with user details

    Raises:
        HTTPException: If no token provided or token is invalid
    """
    settings = get_settings()

    # Development mode bypass - WARNING: Only use for local development!
    if settings.auth_disabled or settings.desktop_mode:
        logger.warning("Auth bypassed — %s", "desktop mode" if settings.desktop_mode else "AUTH_DISABLED=true")
        return AuthUser(
            user_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            email="desktop@local" if settings.desktop_mode else "dev@localhost",
            role="authenticated"
        )

    # Try to get token from credentials (HTTPBearer) first
    token = None
    if credentials:
        token = credentials.credentials
    elif authorization:
        # Fallback to raw header
        if authorization.startswith("Bearer "):
            token = authorization[7:]
        else:
            token = authorization

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # Verify token and extract user info
    payload = verify_jwt_token(token)

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: no user ID",
            headers={"WWW-Authenticate": "Bearer"}
        )

    return AuthUser(
        user_id=user_id,
        email=payload.get("email"),
        role=payload.get("role", "authenticated")
    )


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    authorization: Optional[str] = Header(None)
) -> Optional[AuthUser]:
    """
    FastAPI dependency for optional authentication.

    Returns user if authenticated, None otherwise.
    Does not raise exceptions for missing/invalid tokens.
    """
    try:
        return await get_current_user(credentials, authorization)
    except HTTPException:
        return None


def require_role(required_role: str):
    """
    Dependency factory for role-based access control.

    Usage:
        @router.get("/admin")
        async def admin_endpoint(user: AuthUser = Depends(require_role("admin"))):
            ...
    """
    async def role_checker(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.role != required_role and user.role != "service_role":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{required_role}' required"
            )
        return user
    return role_checker


from app.db import get_supabase as _get_supabase


def _cache_get_profile(user_id: str, profile_key: str) -> "Optional[ProfileContext]":
    """Return cached ProfileContext if TTL not expired, else None."""
    with _profile_cache_lock:
        entry = _profile_cache.get((user_id, profile_key))
        if entry is None:
            return None
        ctx, ts = entry
        if _time.monotonic() - ts > _PROFILE_CACHE_TTL:
            del _profile_cache[(user_id, profile_key)]
            return None
        return ctx


def _cache_set_profile(user_id: str, profile_key: str, ctx: "ProfileContext") -> None:
    """Store ProfileContext in cache with current timestamp. DB-12: Evicts oldest 10% if cache exceeds 1000."""
    with _profile_cache_lock:
        if len(_profile_cache) > 1000:
            # Snapshot + sort outside mutation, then evict oldest 10%
            snapshot = list(_profile_cache.items())
            snapshot.sort(key=lambda item: item[1][1])
            evict_count = max(1, len(snapshot) // 10)
            for key, _ in snapshot[:evict_count]:
                _profile_cache.pop(key, None)
        _profile_cache[(user_id, profile_key)] = (ctx, _time.monotonic())


async def get_profile_context(
    current_user: AuthUser = Depends(get_current_user),
    x_profile_id: Optional[str] = Header(None, alias="X-Profile-Id")
) -> ProfileContext:
    """
    Extract and validate profile context from request.

    - Missing X-Profile-Id: Auto-select user's default profile
    - Invalid profile_id: 404 Not Found
    - Profile belongs to different user: 403 Forbidden
    """
    settings = get_settings()

    # Development mode bypass
    if settings.auth_disabled or settings.desktop_mode:
        profile_key = x_profile_id or "default"

        if x_profile_id:
            # Check cache first for explicit dev profile
            cached = _cache_get_profile(current_user.id, profile_key)
            if cached:
                logger.debug(f"Profile cache HIT (dev, explicit): {profile_key}")
                return cached
            logger.warning(f"⚠️ Using explicit dev profile: {x_profile_id} (AUTH_DISABLED=true)")
            ctx = ProfileContext(profile_id=x_profile_id, user_id=current_user.id)
            _cache_set_profile(current_user.id, profile_key, ctx)
            return ctx

        # Check cache for dev default profile
        cached = _cache_get_profile(current_user.id, "default")
        if cached:
            logger.debug(f"Profile cache HIT (dev, default): {cached.profile_id}")
            return cached

        # Try to find a real profile in the DB to avoid FK violations
        # NOTE: In dev mode, current_user.id is a hardcoded UUID. We filter by user_id
        # first, falling back to any default profile if the dev user has no rows.
        supabase = _get_supabase()
        if supabase:
            try:
                # First try scoped to the dev user_id
                result = supabase.table("profiles").select("id").eq("user_id", current_user.id).eq("is_default", True).limit(1).execute()
                if not result.data:
                    # Fallback: pick any default profile (only safe because auth_disabled=True)
                    result = supabase.table("profiles").select("id").eq("is_default", True).limit(1).execute()
                if result.data:
                    profile_id = result.data[0]["id"]
                    logger.warning(f"⚠️ Dev mode: using DB profile {profile_id}")
                    ctx = ProfileContext(profile_id=profile_id, user_id=current_user.id)
                    _cache_set_profile(current_user.id, "default", ctx)
                    return ctx
            except Exception as e:
                logger.warning(f"Dev mode: could not query profiles table: {e}")

        # DB-11: Return HTTP 503 instead of picking an arbitrary placeholder profile
        # that would fail on FK-constrained inserts anyway
        logger.error("Dev mode: no profiles found in DB — cannot proceed without a valid profile")
        raise HTTPException(
            status_code=503,
            detail="No profiles found in database. Please create a profile first (run account setup or insert a row into the profiles table)."
        )

    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    if not x_profile_id:
        # Check cache for default profile
        cached = _cache_get_profile(current_user.id, "default")
        if cached:
            logger.debug(f"Profile cache HIT (default): {cached.profile_id}")
            return cached

        # Auto-select default profile
        result = supabase.table("profiles")\
            .select("id")\
            .eq("user_id", current_user.id)\
            .eq("is_default", True)\
            .limit(1)\
            .execute()

        if not result.data:
            raise HTTPException(
                status_code=503,
                detail="Account misconfigured: no default profile exists. Please contact support or re-run account setup."
            )

        profile_id = result.data[0]["id"]
        logger.info(f"[Profile {profile_id}] Auto-selected default for user {current_user.id}")
        ctx = ProfileContext(profile_id=profile_id, user_id=current_user.id)
        _cache_set_profile(current_user.id, "default", ctx)
        return ctx
    else:
        profile_id = x_profile_id

        # Check cache for explicit profile
        cached = _cache_get_profile(current_user.id, profile_id)
        if cached:
            logger.debug(f"Profile cache HIT (explicit): {profile_id}")
            return cached

        # Validate profile exists
        result = supabase.table("profiles")\
            .select("id, user_id")\
            .eq("id", profile_id)\
            .limit(1)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        # Check ownership
        if result.data[0]["user_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied to this profile")

        ctx = ProfileContext(profile_id=profile_id, user_id=current_user.id)
        _cache_set_profile(current_user.id, profile_id, ctx)
        return ctx
