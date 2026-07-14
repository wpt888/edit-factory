"""Application-level tenant isolation for a shared ElevenLabs subscription.

ElevenLabs sees the backend API key as one caller. This service adds the two
boundaries the provider cannot infer from that key: which custom voices a
profile may use, and how many subscription credits the profile may consume.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional, TypeVar

from app.config import get_settings
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters


VOICE_ACCESS_TABLE = "editai_elevenlabs_voice_access"
PUBLIC_VOICE_CATEGORIES = frozenset({"premade", "default"})


class ElevenLabsGovernanceError(Exception):
    """Base error carrying an HTTP-safe code and structured detail."""

    status_code = 503
    error_code = "elevenlabs_governance_unavailable"

    def as_detail(self) -> Dict[str, Any]:
        return {"error": self.error_code, "message": str(self)}


class ElevenLabsCreditExceeded(ElevenLabsGovernanceError):
    status_code = 402
    error_code = "elevenlabs_credit_limit_exceeded"

    def __init__(self, balance: Dict[str, Any], requested: int):
        self.balance = balance
        self.requested = requested
        remaining = balance.get("credits_remaining", 0)
        super().__init__(
            f"Monthly ElevenLabs credit allowance exceeded. "
            f"Requested {requested:,}; {remaining:,} available."
        )

    def as_detail(self) -> Dict[str, Any]:
        return {
            **super().as_detail(),
            "requested_credits": self.requested,
            "credit_limit": self.balance.get("credit_limit", 0),
            "credits_used": self.balance.get("credits_used", 0),
            "credits_reserved": self.balance.get("credits_reserved", 0),
            "credits_remaining": self.balance.get("credits_remaining", 0),
        }


class ElevenLabsVoiceAccessDenied(ElevenLabsGovernanceError):
    status_code = 403
    error_code = "elevenlabs_voice_access_denied"

    def __init__(self, voice_id: str):
        self.voice_id = voice_id
        super().__init__("This ElevenLabs voice is not assigned to the active profile.")

    def as_detail(self) -> Dict[str, Any]:
        return {**super().as_detail(), "voice_id": self.voice_id}


@dataclass(frozen=True)
class CreditReservation:
    id: str
    estimated_credits: int


TVoice = TypeVar("TVoice")


def _default_limit() -> int:
    return int(getattr(get_settings(), "elevenlabs_default_user_credit_limit", 10000))


def estimate_tts_credits(text: str, model_id: str) -> int:
    """Estimate the reservation before ElevenLabs returns its exact cost header."""
    normalized = (model_id or "").lower()
    rate = 0.5 if "flash" in normalized or "turbo" in normalized else 1.0
    return max(1, math.ceil(len(text) * rate)) if text else 0


def _with_remaining(balance: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(balance or {})
    limit = int(result.get("credit_limit", 0) or 0)
    used = int(result.get("credits_used", 0) or 0)
    reserved = int(result.get("credits_reserved", 0) or 0)
    result["credit_limit"] = limit
    result["credits_used"] = used
    result["credits_reserved"] = reserved
    result["credits_remaining"] = (
        -1 if limit < 0 else max(0, limit - used - reserved)
    )
    return result


def get_credit_balance(profile_id: str) -> Dict[str, Any]:
    repo = get_repository()
    method = getattr(repo, "get_elevenlabs_credit_balance", None)
    if not callable(method):
        raise ElevenLabsGovernanceError("Credit ledger repository support is unavailable.")
    try:
        return _with_remaining(method(profile_id, _default_limit()))
    except ElevenLabsGovernanceError:
        raise
    except Exception as exc:
        raise ElevenLabsGovernanceError(
            "ElevenLabs credit ledger is unavailable; generation was not started."
        ) from exc


def reserve_credits(
    profile_id: Optional[str], text: str, model_id: str, voice_id: str
) -> Optional[CreditReservation]:
    """Atomically reserve a profile's estimated credits before provider usage."""
    if not profile_id:
        return None
    repo = get_repository()
    method = getattr(repo, "reserve_elevenlabs_credits", None)
    if not callable(method):
        raise ElevenLabsGovernanceError("Credit reservation support is unavailable.")
    estimated = estimate_tts_credits(text, model_id)
    reservation_id = str(uuid.uuid4())
    try:
        result = _with_remaining(method(
            profile_id,
            reservation_id,
            estimated,
            len(text),
            model_id,
            voice_id,
            _default_limit(),
        ))
    except Exception as exc:
        raise ElevenLabsGovernanceError(
            "ElevenLabs credits could not be reserved; generation was not started."
        ) from exc
    if not bool(result.get("allowed")):
        raise ElevenLabsCreditExceeded(result, estimated)
    return CreditReservation(reservation_id, estimated)


def settle_credits(
    reservation: Optional[CreditReservation], actual_credits: int,
    provider_request_id: Optional[str] = None,
) -> Dict[str, Any]:
    if reservation is None:
        return {}
    repo = get_repository()
    method = getattr(repo, "settle_elevenlabs_credits", None)
    if not callable(method):
        raise ElevenLabsGovernanceError("Credit settlement support is unavailable.")
    return _with_remaining(method(
        reservation.id, max(0, int(actual_credits)), provider_request_id
    ))


def release_credits(reservation: Optional[CreditReservation]) -> None:
    if reservation is None:
        return
    repo = get_repository()
    method = getattr(repo, "release_elevenlabs_credits", None)
    if callable(method):
        method(reservation.id)


def set_credit_limit(profile_id: str, credit_limit: int) -> Dict[str, Any]:
    if credit_limit < -1:
        raise ValueError("Credit limit must be -1 (unlimited) or greater.")
    repo = get_repository()
    method = getattr(repo, "set_elevenlabs_credit_limit", None)
    if not callable(method):
        raise ElevenLabsGovernanceError("Credit limit management is unavailable.")
    return _with_remaining(method(profile_id, credit_limit, _default_limit()))


def list_voice_assignments(profile_id: str) -> list[Dict[str, Any]]:
    repo = get_repository()
    try:
        result = repo.table_query(
            VOICE_ACCESS_TABLE,
            "select",
            filters=QueryFilters(
                eq={"profile_id": profile_id, "is_active": True},
                order_by="created_at",
            ),
        )
        return result.data or []
    except Exception:
        # A missing migration must never expose private workspace voices. Public
        # premade voices remain usable; custom voice access fails closed.
        return []


def assigned_voice_ids(profile_id: str) -> set[str]:
    return {
        str(row.get("voice_id"))
        for row in list_voice_assignments(profile_id)
        if row.get("voice_id")
    }


def is_voice_allowed(profile_id: Optional[str], voice_id: str, category: str) -> bool:
    if (category or "").lower() in PUBLIC_VOICE_CATEGORIES:
        return True
    if not profile_id:
        return False
    return voice_id in assigned_voice_ids(profile_id)


def filter_voices(profile_id: Optional[str], voices: Iterable[TVoice]) -> list[TVoice]:
    if not profile_id:
        return [
            voice for voice in voices
            if str(getattr(voice, "category", "unknown") or "unknown").lower()
            in PUBLIC_VOICE_CATEGORIES
        ]
    assigned = assigned_voice_ids(profile_id)
    return [
        voice for voice in voices
        if str(getattr(voice, "category", "unknown") or "unknown").lower()
        in PUBLIC_VOICE_CATEGORIES
        or str(getattr(voice, "id", "")) in assigned
    ]


def assign_voice(
    profile_id: str,
    voice_id: str,
    *,
    voice_name: Optional[str] = None,
    category: Optional[str] = None,
    language: Optional[str] = None,
    preview_url: Optional[str] = None,
    assigned_by: str = "admin",
) -> Dict[str, Any]:
    repo = get_repository()
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "id": str(uuid.uuid4()),
        "profile_id": profile_id,
        "voice_id": voice_id,
        "voice_name": voice_name,
        "category": category,
        "language": language,
        "preview_url": preview_url,
        "is_active": True,
        "assigned_by": assigned_by,
        "created_at": now,
        "updated_at": now,
    }
    result = repo.table_query(
        VOICE_ACCESS_TABLE,
        "upsert",
        data=data,
        filters=QueryFilters(on_conflict="profile_id,voice_id"),
    )
    return (result.data or [data])[0]


def remove_voice_assignment(profile_id: str, voice_id: str) -> None:
    get_repository().table_query(
        VOICE_ACCESS_TABLE,
        "delete",
        filters=QueryFilters(eq={"profile_id": profile_id, "voice_id": voice_id}),
    )
