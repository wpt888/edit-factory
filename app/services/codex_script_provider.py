"""Local Codex subscription provider for structured script generation."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

DEFAULT_CODEX_MODEL = "gpt-5.4-mini"
DEFAULT_CODEX_TIMEOUT_SECONDS = 180
_MODEL_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$")


class CodexProviderError(ValueError):
    """Safe, user-facing failure raised by the local Codex provider."""


def _codex_candidates(explicit_path: Optional[str] = None) -> list[Path]:
    candidates: list[Path] = []
    if explicit_path:
        candidates.append(Path(explicit_path).expanduser())

    discovered = shutil.which("codex")
    if discovered:
        candidates.append(Path(discovered))

    if sys.platform == "win32":
        local_app_data = os.getenv("LOCALAPPDATA")
        app_data = os.getenv("APPDATA")
        if local_app_data:
            candidates.extend(
                [
                    Path(local_app_data) / "Programs" / "OpenAI" / "Codex" / "bin" / "codex.exe",
                    Path(local_app_data) / "Programs" / "OpenAI" / "Codex" / "bin" / "codex.cmd",
                ]
            )
        if app_data:
            candidates.append(Path(app_data) / "npm" / "codex.cmd")

    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = os.path.normcase(str(candidate))
        if key not in seen:
            unique.append(candidate)
            seen.add(key)
    return unique


def find_codex_cli(explicit_path: Optional[str] = None) -> Path:
    """Resolve a usable Codex CLI path without invoking a shell."""
    for candidate in _codex_candidates(explicit_path):
        if candidate.is_file():
            return candidate
    raise CodexProviderError(
        "Codex CLI was not found on this computer. Install Codex, then run "
        "`codex login` with your ChatGPT account before using this provider."
    )


def _structured_output_schema(variant_count: int) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "scripts": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
                "minItems": variant_count,
                "maxItems": variant_count,
            }
        },
        "required": ["scripts"],
        "additionalProperties": False,
    }


def _friendly_cli_error(stderr: str, model: str) -> str:
    normalized = stderr.casefold()
    if any(
        marker in normalized
        for marker in (
            "not logged in",
            "login required",
            "authentication",
            "unauthorized",
            "access token",
            "refresh token",
            "401",
        )
    ):
        return (
            "The local Codex session is unavailable or expired. Open a terminal, "
            "run `codex login`, sign in with ChatGPT, then try again."
        )
    if "model" in normalized and any(
        marker in normalized
        for marker in ("not found", "unsupported", "unavailable", "does not exist", "unknown")
    ):
        return (
            f"The Codex model `{model}` is not available for this ChatGPT account. "
            "Choose another model and try again."
        )
    if "rate limit" in normalized or "too many requests" in normalized or "429" in normalized:
        return "The ChatGPT Codex usage limit was reached. Wait a moment and try again."
    return "Codex could not generate the scripts. Check the local Codex login and try again."


class CodexScriptProvider:
    """Runs one isolated, ephemeral Codex CLI turn and returns strict JSON."""

    def __init__(
        self,
        *,
        cli_path: Optional[str] = None,
        timeout_seconds: int = DEFAULT_CODEX_TIMEOUT_SECONDS,
    ) -> None:
        self.cli_path = cli_path
        self.timeout_seconds = max(30, min(int(timeout_seconds), 600))

    def generate_scripts(
        self,
        *,
        prompt: str,
        variant_count: int,
        model: str = DEFAULT_CODEX_MODEL,
    ) -> list[str]:
        model = (model or DEFAULT_CODEX_MODEL).strip()
        if not _MODEL_SLUG_RE.fullmatch(model):
            raise CodexProviderError(
                "Invalid Codex model name. Use a model slug such as `gpt-5.4-mini`."
            )

        codex_cli = find_codex_cli(self.cli_path)
        schema = _structured_output_schema(variant_count)
        codex_prompt = (
            f"{prompt}\n\n"
            "Return only the JSON object required by the output schema. "
            f"The `scripts` array must contain exactly {variant_count} complete scripts. "
            "Do not inspect files, use tools, run commands, or modify anything."
        )
        env = os.environ.copy()
        # CODEX_API_KEY forces separately billed API-key auth for codex exec.
        # This provider must use the persisted ChatGPT subscription login.
        env.pop("CODEX_API_KEY", None)
        env.pop("OPENAI_API_KEY", None)
        env["NO_COLOR"] = "1"
        creation_flags = (
            subprocess.CREATE_NO_WINDOW
            if sys.platform == "win32" and hasattr(subprocess, "CREATE_NO_WINDOW")
            else 0
        )

        with tempfile.TemporaryDirectory(prefix="blipstudio-codex-") as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            schema_path = temp_dir / "script-output.schema.json"
            output_path = temp_dir / "script-output.json"
            schema_path.write_text(
                json.dumps(schema, ensure_ascii=True),
                encoding="utf-8",
            )

            try:
                login_status = subprocess.run(
                    [str(codex_cli), "login", "status"],
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    capture_output=True,
                    cwd=temp_dir,
                    env=env,
                    timeout=15,
                    check=False,
                    creationflags=creation_flags,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise CodexProviderError(
                    "The local Codex login could not be verified. Run `codex login` "
                    "with your ChatGPT account, then try again."
                ) from exc

            login_diagnostic = "\n".join(
                part for part in (login_status.stdout, login_status.stderr) if part
            )
            normalized_login = login_diagnostic.casefold()
            if login_status.returncode != 0 or "logged in using chatgpt" not in normalized_login:
                if "api key" in normalized_login:
                    raise CodexProviderError(
                        "Codex is signed in with an API key, which is billed separately. "
                        "Sign in to Codex with ChatGPT before using this provider."
                    )
                raise CodexProviderError(
                    "The local Codex session is unavailable or expired. Open a terminal, "
                    "run `codex login`, sign in with ChatGPT, then try again."
                )

            command = [
                str(codex_cli),
                "exec",
                "--ephemeral",
                "--skip-git-repo-check",
                "--ignore-user-config",
                "--ignore-rules",
                "--sandbox",
                "read-only",
                "--model",
                model,
                "--output-schema",
                str(schema_path),
                "--output-last-message",
                str(output_path),
                "--color",
                "never",
                "-C",
                str(temp_dir),
                "-",
            ]

            try:
                completed = subprocess.run(
                    command,
                    input=codex_prompt,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    capture_output=True,
                    cwd=temp_dir,
                    env=env,
                    timeout=self.timeout_seconds,
                    check=False,
                    creationflags=creation_flags,
                )
            except subprocess.TimeoutExpired as exc:
                raise CodexProviderError(
                    f"Codex generation timed out after {self.timeout_seconds} seconds. "
                    "Try again or choose a faster model."
                ) from exc
            except OSError as exc:
                logger.warning("Could not start Codex CLI at %s: %s", codex_cli, exc)
                raise CodexProviderError(
                    "Codex CLI could not be started. Reinstall Codex or configure "
                    "`CODEX_CLI_PATH`, then try again."
                ) from exc

            if completed.returncode != 0:
                diagnostic = "\n".join(
                    part for part in (completed.stderr, completed.stdout) if part
                )
                logger.warning(
                    "Codex CLI failed (exit=%s, model=%s): %s",
                    completed.returncode,
                    model,
                    diagnostic[-2000:],
                )
                raise CodexProviderError(_friendly_cli_error(diagnostic, model))

            raw_output = (
                output_path.read_text(encoding="utf-8")
                if output_path.exists()
                else completed.stdout
            )
            try:
                payload = json.loads(raw_output)
            except json.JSONDecodeError as exc:
                logger.warning("Codex returned invalid JSON: %s", raw_output[:1000])
                raise CodexProviderError(
                    "Codex returned an invalid structured response. Try generating again."
                ) from exc

        scripts = payload.get("scripts") if isinstance(payload, dict) else None
        if (
            not isinstance(scripts, list)
            or len(scripts) != variant_count
            or any(not isinstance(script, str) or not script.strip() for script in scripts)
        ):
            raise CodexProviderError(
                f"Codex returned an incomplete response. Expected exactly {variant_count} scripts."
            )

        return [script.strip() for script in scripts]
