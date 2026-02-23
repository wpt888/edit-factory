"""Shared Supabase client singleton."""
import logging
import threading
from app.config import get_settings

logger = logging.getLogger(__name__)
_supabase_client = None
_supabase_lock = threading.Lock()

def get_supabase():
    global _supabase_client
    if _supabase_client is None:
        with _supabase_lock:
            if _supabase_client is None:
                try:
                    from supabase import create_client
                    settings = get_settings()
                    if settings.supabase_url and settings.supabase_key:
                        key = settings.supabase_service_role_key or settings.supabase_key
                        _supabase_client = create_client(settings.supabase_url, key)
                        logger.info("Shared Supabase client initialized")
                    else:
                        logger.warning("Supabase credentials not configured")
                except Exception as e:
                    logger.error(f"Failed to initialize Supabase: {e}")
    return _supabase_client
