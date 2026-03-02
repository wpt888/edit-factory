"""Shared Supabase client singleton."""
import logging
import threading
import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)
_supabase_client = None
_httpx_client = None
_supabase_lock = threading.Lock()

def get_supabase():
    global _supabase_client, _httpx_client
    if _supabase_client is None:
        with _supabase_lock:
            if _supabase_client is None:
                try:
                    from supabase import create_client
                    from supabase.lib.client_options import SyncClientOptions
                    settings = get_settings()
                    if settings.supabase_url and settings.supabase_key:
                        key = settings.supabase_service_role_key or settings.supabase_key
                        _httpx_client = httpx.Client()
                        options = SyncClientOptions(
                            httpx_client=_httpx_client,
                        )
                        _supabase_client = create_client(settings.supabase_url, key, options)
                        if settings.supabase_service_role_key:
                            logger.info("Shared Supabase client initialized (service_role key)")
                        else:
                            logger.warning(
                                "SUPABASE_SERVICE_ROLE_KEY not set — RLS may block backend operations. "
                                "Set it in .env for production."
                            )
                            logger.info("Shared Supabase client initialized (anon key — RLS bypass inactive)")
                    else:
                        logger.warning("Supabase credentials not configured")
                except Exception as e:
                    logger.error(f"Failed to initialize Supabase: {e}")
    return _supabase_client


def close_supabase():
    """Close the httpx client and reset the Supabase singleton."""
    global _httpx_client, _supabase_client
    if _httpx_client:
        try:
            _httpx_client.close()
        except Exception:
            pass
        _httpx_client = None
    _supabase_client = None
    logger.info("Supabase client closed")
