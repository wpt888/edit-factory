"""
Authentication utilities for Edit Factory API.
Handles JWT verification and user extraction from Supabase tokens.
"""
import logging
from typing import Optional
from dataclasses import dataclass
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt.exceptions import PyJWTError

from app.config import get_settings

logger = logging.getLogger(__name__)

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
    if settings.auth_disabled:
        logger.warning("⚠️ Authentication is DISABLED - development mode only!")
        return AuthUser(
            user_id="dev-user-local",
            email="dev@localhost",
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


# Supabase client for profile context queries
_supabase_client = None

def _get_supabase():
    """Get Supabase client for auth queries."""
    global _supabase_client
    if _supabase_client is None:
        try:
            from supabase import create_client
            settings = get_settings()
            if settings.supabase_url and settings.supabase_key:
                _supabase_client = create_client(settings.supabase_url, settings.supabase_key)
        except Exception as e:
            logger.error(f"Failed to init Supabase in auth: {e}")
    return _supabase_client


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
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    if not x_profile_id:
        # Auto-select default profile
        result = supabase.table("profiles")\
            .select("id")\
            .eq("user_id", current_user.id)\
            .eq("is_default", True)\
            .single()\
            .execute()

        if not result.data:
            # This indicates a data inconsistency - user should always have a default profile
            # Return 503 Service Unavailable with actionable message
            raise HTTPException(
                status_code=503,
                detail="Account misconfigured: no default profile exists. Please contact support or re-run account setup."
            )

        profile_id = result.data["id"]
        logger.info(f"[Profile {profile_id}] Auto-selected default for user {current_user.id}")
    else:
        profile_id = x_profile_id

        # Validate profile exists
        result = supabase.table("profiles")\
            .select("id, user_id")\
            .eq("id", profile_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        # Check ownership
        if result.data["user_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied to this profile")

    return ProfileContext(profile_id=profile_id, user_id=current_user.id)
