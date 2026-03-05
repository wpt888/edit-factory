"""
License validation service — Lemon Squeezy License API integration.
Persists license state to license.json in settings.base_dir.
"""
import json
import httpx
import socket
import uuid
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

LS_BASE_URL = "https://api.lemonsqueezy.com"
GRACE_PERIOD_DAYS = 7


class LicenseService:
    def __init__(self, base_dir: Path):
        self._license_file = base_dir / "license.json"

    def _read(self) -> dict:
        if not self._license_file.exists():
            return {}
        try:
            return json.loads(self._license_file.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _write(self, data: dict) -> None:
        self._license_file.write_text(
            json.dumps(data, indent=2, default=str),
            encoding="utf-8"
        )

    def is_activated(self) -> bool:
        data = self._read()
        return bool(data.get("license_key") and data.get("instance_id"))

    async def activate(self, license_key: str) -> dict:
        """Call Lemon Squeezy activate endpoint. Persist instance_id on success."""
        try:
            hostname = socket.gethostname()
        except Exception:
            hostname = uuid.uuid4().hex[:8]
        instance_name = f"EditFactory-{hostname}"

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{LS_BASE_URL}/v1/licenses/activate",
                data={"license_key": license_key, "instance_name": instance_name},
                headers={"Accept": "application/json"},
            )
        try:
            body = resp.json()
        except Exception:
            return {"success": False, "error": f"Invalid response from license server (HTTP {resp.status_code})"}
        if not body.get("activated"):
            return {"success": False, "error": body.get("error", "Activation failed")}

        now = datetime.now(timezone.utc).isoformat()
        self._write({
            "license_key": license_key,
            "instance_id": body["instance"]["id"],
            "activated_at": now,
            "last_validated_at": now,
            "status": body["license_key"]["status"],
        })
        return {"success": True, "instance_id": body["instance"]["id"]}

    async def validate(self) -> dict:
        """
        Validate license. Implements offline grace period.
        Returns {"valid": bool, "grace_period": bool, "error": str|None}
        """
        data = self._read()
        if not data.get("license_key") or not data.get("instance_id"):
            return {"valid": False, "grace_period": False, "error": "Not activated"}

        # Check grace period eligibility
        last_validated_str = data.get("last_validated_at")
        within_grace = False
        if last_validated_str:
            try:
                last_validated = datetime.fromisoformat(last_validated_str)
                within_grace = (datetime.now(timezone.utc) - last_validated) < timedelta(days=GRACE_PERIOD_DAYS)
            except ValueError:
                pass

        # Try online validation
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{LS_BASE_URL}/v1/licenses/validate",
                    data={
                        "license_key": data["license_key"],
                        "instance_id": data["instance_id"],
                    },
                    headers={"Accept": "application/json"},
                )
            try:
                body = resp.json()
            except Exception:
                raise httpx.HTTPError(f"Invalid JSON response (HTTP {resp.status_code})")
            if body.get("valid"):
                data["last_validated_at"] = datetime.now(timezone.utc).isoformat()
                data["status"] = body["license_key"]["status"]
                self._write(data)
                return {"valid": True, "grace_period": False, "error": None}
            else:
                status = body.get("license_key", {}).get("status", "unknown")
                error = body.get("error") or f"License status: {status}"
                return {"valid": False, "grace_period": False, "error": error}

        except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as e:
            logger.warning(f"License validation network error: {e}")
            if within_grace:
                return {"valid": True, "grace_period": True, "error": None}
            return {
                "valid": False,
                "grace_period": False,
                "error": "Cannot reach license server and grace period expired",
            }
