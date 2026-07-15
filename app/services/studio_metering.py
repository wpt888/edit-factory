"""BlipStudio -> Blipost credit metering bridge.

The web product is fail-closed: an operation may start only after the Blipost
metering API has durably reserved its credits.  Electron desktop builds are
early-access and deliberately do not enforce credits; they emit the same
structured lifecycle events to the local log instead.

The canonical wire contract lives in the web repository at
``docs/wiki/integrations/blipstudio-metering-api.md``.  Keep this client thin:
the web app owns prices and ledger semantics, while Studio owns durable job
state and provider lifecycle reconciliation.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Mapping, Optional

import httpx

from app import config

logger = logging.getLogger(__name__)

METERING_API_PREFIX = "/api/internal/studio/metering"
BILLING_URL = "https://blipost.com/billing"
METERING_OPERATIONS = frozenset(
    {
        "studio.script_pipeline",
        "studio.tts_variant",
        "studio.seedance_clip",
        "studio.render_output_minute",
    }
)

_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
_TRANSIENT_ATTEMPTS = 3
_TRANSIENT_BACKOFF_SECONDS = (0.0, 0.2, 0.5)


@dataclass(frozen=True)
class MeteringIdentity:
    """Canonical Studio identity sent to the server-to-server API."""

    supabase_user_id: str
    email: Optional[str] = None

    def as_payload(self) -> dict[str, str]:
        payload = {"supabase_user_id": self.supabase_user_id}
        if self.email:
            payload["email"] = self.email.strip().lower()
        return payload


class StudioMeteringBlocked(Exception):
    """A fail-closed metering decision suitable for a local HTTP 402."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        available_credits: Optional[int] = None,
        upstream_status: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.available_credits = available_credits
        self.upstream_status = upstream_status

    def as_http_detail(self) -> dict[str, Any]:
        if self.code == "insufficient_credits":
            friendly = (
                "You do not have enough Blipost credits for this operation. "
                "Add credits to continue."
            )
        else:
            friendly = (
                "We could not verify your Blipost credits, so the operation was "
                "not started. Try again shortly."
            )
        detail: dict[str, Any] = {
            "code": self.code,
            "message": friendly,
            "billing_url": BILLING_URL,
        }
        if self.available_credits is not None:
            detail["available_credits"] = self.available_credits
        return detail


def new_metering_record(operation: str, units: int, idempotency_key: str) -> dict[str, Any]:
    """Create the durable record callers persist before attempting reserve."""

    if operation not in METERING_OPERATIONS:
        raise ValueError(f"Unsupported Studio metering operation: {operation}")
    if not isinstance(units, int) or isinstance(units, bool) or not 1 <= units <= 10_000:
        raise ValueError("Metering units must be an integer between 1 and 10000")
    if not idempotency_key or len(idempotency_key) > 200:
        raise ValueError("Metering idempotency key must contain 1-200 characters")
    try:
        encoded = idempotency_key.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ValueError("Metering idempotency key must be ASCII") from exc
    if any(byte < 0x21 or byte > 0x7E for byte in encoded):
        raise ValueError("Metering idempotency key must use visible ASCII without spaces")

    return {
        "operation": operation,
        "units": units,
        "idempotency_key": idempotency_key,
        "state": "pending",
        "reservation_id": None,
        "credits": None,
        "provider_started": False,
        "result_metadata": {},
        "last_error": None,
    }


class StudioMeteringClient:
    """Async client for reserve/capture/refund with bounded idempotent retries."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        desktop_mode: Optional[bool] = None,
        transport: Optional[httpx.AsyncBaseTransport] = None,
        timeout: httpx.Timeout = _TIMEOUT,
    ) -> None:
        settings = config.get_settings()
        self.base_url = (base_url if base_url is not None else settings.blipost_platform_base_url).rstrip("/")
        self._token = token if token is not None else settings.studio_service_token
        self.desktop_mode = settings.desktop_mode if desktop_mode is None else desktop_mode
        self._transport = transport
        self._timeout = timeout

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _desktop_reservation_id(identity: MeteringIdentity, idempotency_key: str) -> str:
        stable = uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"blipstudio-desktop-metering:{identity.supabase_user_id}:{idempotency_key}",
        )
        return f"desktop:{stable}"

    @staticmethod
    def _log_desktop_usage(
        event: str,
        identity: MeteringIdentity,
        record: Mapping[str, Any],
    ) -> None:
        logger.info(
            "studio_usage mode=desktop event=%s user_id=%s operation=%s units=%s "
            "idempotency_key=%s reservation_id=%s",
            event,
            identity.supabase_user_id,
            record.get("operation"),
            record.get("units"),
            record.get("idempotency_key"),
            record.get("reservation_id"),
        )

    @staticmethod
    def _error_from_response(response: httpx.Response) -> StudioMeteringBlocked:
        code = "metering_unavailable"
        message = f"Metering API returned HTTP {response.status_code}"
        available: Optional[int] = None
        try:
            body = response.json()
            error = body.get("error") if isinstance(body, dict) else None
            if isinstance(error, dict):
                code = str(error.get("code") or code)
                message = str(error.get("message") or message)
                raw_available = error.get("available_credits")
                if isinstance(raw_available, int) and not isinstance(raw_available, bool):
                    available = raw_available
        except Exception:
            pass
        return StudioMeteringBlocked(
            code,
            message,
            available_credits=available,
            upstream_status=response.status_code,
        )

    async def _post(self, path: str, payload: Mapping[str, Any]) -> tuple[int, dict[str, Any]]:
        if not self.base_url or not self._token:
            raise StudioMeteringBlocked(
                "metering_not_configured",
                "Studio metering bridge is not configured",
            )

        url = f"{self.base_url}{METERING_API_PREFIX}/{path}"
        last_transport_error: Optional[Exception] = None

        for attempt in range(_TRANSIENT_ATTEMPTS):
            if _TRANSIENT_BACKOFF_SECONDS[attempt]:
                await asyncio.sleep(_TRANSIENT_BACKOFF_SECONDS[attempt])
            try:
                async with httpx.AsyncClient(
                    timeout=self._timeout,
                    transport=self._transport,
                ) as client:
                    response = await client.post(url, headers=self._headers, json=dict(payload))
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_transport_error = exc
                logger.warning(
                    "Studio metering transport failure on %s (attempt %d/%d): %s",
                    path,
                    attempt + 1,
                    _TRANSIENT_ATTEMPTS,
                    type(exc).__name__,
                )
                continue

            if response.status_code >= 500 and attempt < _TRANSIENT_ATTEMPTS - 1:
                logger.warning(
                    "Studio metering HTTP %d on %s (attempt %d/%d)",
                    response.status_code,
                    path,
                    attempt + 1,
                    _TRANSIENT_ATTEMPTS,
                )
                continue
            if not response.is_success:
                raise self._error_from_response(response)

            try:
                body = response.json()
            except Exception as exc:
                raise StudioMeteringBlocked(
                    "invalid_metering_response",
                    "Metering API returned invalid JSON",
                    upstream_status=response.status_code,
                ) from exc
            if not isinstance(body, dict):
                raise StudioMeteringBlocked(
                    "invalid_metering_response",
                    "Metering API returned an invalid response",
                    upstream_status=response.status_code,
                )
            return response.status_code, body

        raise StudioMeteringBlocked(
            "metering_unavailable",
            f"Metering bridge unavailable ({type(last_transport_error).__name__ if last_transport_error else 'transport error'})",
        )

    async def reserve(
        self,
        identity: MeteringIdentity,
        record: Mapping[str, Any],
        *,
        provider_not_started: bool,
    ) -> dict[str, Any]:
        """Reserve credits and return an updated durable record.

        A reserve response lost in transit can replay as HTTP 200 with
        ``executable=false``.  The caller may continue only after proving from
        its durable job record that the provider has not started.
        """

        pending = dict(record)
        if self.desktop_mode:
            pending.update(
                {
                    "reservation_id": self._desktop_reservation_id(
                        identity, str(record["idempotency_key"])
                    ),
                    "state": "reserved",
                    "mode": "desktop",
                    "replayed": False,
                    "last_error": None,
                }
            )
            self._log_desktop_usage("reserve", identity, pending)
            return pending

        payload = {
            **identity.as_payload(),
            "operation": record["operation"],
            "units": record["units"],
            "idempotency_key": record["idempotency_key"],
        }
        status_code, body = await self._post("reserve", payload)
        reservation_id = body.get("reservation_id")
        status = body.get("status")
        replayed = bool(body.get("replayed"))
        executable = body.get("executable") is True

        valid_new = status_code == 201 and status == "reserved" and executable and not replayed
        valid_replay = (
            status_code == 200
            and status == "reserved"
            and replayed
            and not executable
            and provider_not_started
        )
        if not isinstance(reservation_id, str) or not reservation_id or not (valid_new or valid_replay):
            raise StudioMeteringBlocked(
                "reservation_not_executable",
                "Metering reservation cannot safely start this operation",
                upstream_status=status_code,
            )

        pending.update(
            {
                "reservation_id": reservation_id,
                "state": "reserved",
                "mode": "web",
                "credits": body.get("credits"),
                "remaining_credits": body.get("remaining_credits"),
                "replayed": replayed,
                "last_error": None,
            }
        )
        return pending

    async def capture(
        self,
        identity: MeteringIdentity,
        record: Mapping[str, Any],
        *,
        result_metadata: Optional[Mapping[str, Any]] = None,
    ) -> dict[str, Any]:
        settled = dict(record)
        if self.desktop_mode or record.get("mode") == "desktop":
            settled.update(
                {
                    "state": "captured",
                    "result_metadata": dict(result_metadata or {}),
                    "last_error": None,
                }
            )
            self._log_desktop_usage("capture", identity, settled)
            return settled

        reservation_id = record.get("reservation_id")
        if not isinstance(reservation_id, str) or not reservation_id:
            raise StudioMeteringBlocked(
                "invalid_local_reservation",
                "Studio has no reservation to capture",
            )
        _, body = await self._post(
            "capture",
            {
                **identity.as_payload(),
                "reservation_id": reservation_id,
                "result_metadata": dict(result_metadata or {}),
            },
        )
        if body.get("reservation_id") != reservation_id or body.get("status") != "captured":
            raise StudioMeteringBlocked(
                "invalid_metering_response",
                "Metering capture returned an invalid state",
            )
        settled.update(
            {
                "state": "captured",
                "remaining_credits": body.get("remaining_credits"),
                "result_metadata": body.get("result_metadata") or {},
                "last_error": None,
            }
        )
        return settled

    async def refund(
        self,
        identity: MeteringIdentity,
        record: Mapping[str, Any],
    ) -> dict[str, Any]:
        settled = dict(record)
        if self.desktop_mode or record.get("mode") == "desktop":
            settled.update({"state": "released", "last_error": None})
            self._log_desktop_usage("refund", identity, settled)
            return settled

        reservation_id = record.get("reservation_id")
        if not isinstance(reservation_id, str) or not reservation_id:
            raise StudioMeteringBlocked(
                "invalid_local_reservation",
                "Studio has no reservation to refund",
            )
        _, body = await self._post(
            "refund",
            {**identity.as_payload(), "reservation_id": reservation_id},
        )
        status = body.get("status")
        if body.get("reservation_id") != reservation_id or status not in {"released", "refunded"}:
            raise StudioMeteringBlocked(
                "invalid_metering_response",
                "Metering refund returned an invalid state",
            )
        settled.update(
            {
                "state": status,
                "remaining_credits": body.get("remaining_credits"),
                "result_metadata": body.get("result_metadata") or {},
                "last_error": None,
            }
        )
        return settled


async def reserve_metering_record(
    identity: MeteringIdentity,
    record: Mapping[str, Any],
    *,
    client: Optional[StudioMeteringClient] = None,
) -> dict[str, Any]:
    """Reserve a pending record after the caller has durably persisted it."""

    service = client or StudioMeteringClient()
    return await service.reserve(
        identity,
        record,
        provider_not_started=not bool(record.get("provider_started")),
    )


async def settle_metering_record(
    identity: MeteringIdentity,
    record: Mapping[str, Any],
    *,
    delivered: bool,
    result_metadata: Optional[Mapping[str, Any]] = None,
    client: Optional[StudioMeteringClient] = None,
) -> dict[str, Any]:
    """Capture or refund a durable record, preserving a retryable pending state.

    Settlement failures are deliberately returned in the record rather than
    raised: once provider output exists, a transient capture failure must never
    be mistaken for permission to refund or re-run the provider.  Callers persist
    the returned ``capture_pending``/``refund_pending`` state and reconcile it on
    subsequent status polls or cancellation requests.
    """

    current = dict(record)
    terminal = {"captured"} if delivered else {"released", "refunded"}
    if current.get("state") in terminal:
        return current
    if not current.get("reservation_id"):
        return current

    service = client or StudioMeteringClient()
    try:
        if delivered:
            return await service.capture(
                identity,
                current,
                result_metadata=result_metadata,
            )
        return await service.refund(identity, current)
    except StudioMeteringBlocked as exc:
        current.update(
            {
                "state": "capture_pending" if delivered else "refund_pending",
                "last_error": exc.as_http_detail(),
            }
        )
        logger.error(
            "Studio metering settlement pending: action=%s operation=%s reservation_id=%s code=%s",
            "capture" if delivered else "refund",
            current.get("operation"),
            current.get("reservation_id"),
            exc.code,
        )
        return current
