import json
import subprocess
from pathlib import Path

import pytest

from app.services.codex_script_provider import (
    CodexProviderError,
    CodexScriptProvider,
)
from app.services.script_generator import ScriptGenerator


def test_codex_provider_runs_ephemeral_read_only_with_structured_output(
    monkeypatch,
    tmp_path,
):
    captured = {}
    fake_cli = tmp_path / "codex.cmd"
    fake_cli.write_text("@echo off", encoding="utf-8")

    def fake_run(command, **kwargs):
        if command[1:3] == ["login", "status"]:
            return subprocess.CompletedProcess(
                command,
                0,
                stdout="Logged in using ChatGPT",
                stderr="",
            )
        captured["command"] = command
        captured["kwargs"] = kwargs
        output_path = Path(command[command.index("--output-last-message") + 1])
        output_path.write_text(
            json.dumps({"scripts": ["First script.", "Second script."]}),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setenv("CODEX_API_KEY", "must-not-be-used")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-be-used")
    monkeypatch.setattr(subprocess, "run", fake_run)

    provider = CodexScriptProvider(cli_path=str(fake_cli), timeout_seconds=90)
    scripts = provider.generate_scripts(
        prompt="Generate two scripts.",
        variant_count=2,
        model="gpt-5.4-mini",
    )

    assert scripts == ["First script.", "Second script."]
    command = captured["command"]
    assert command[:2] == [str(fake_cli), "exec"]
    assert "--ephemeral" in command
    assert command[command.index("--sandbox") + 1] == "read-only"
    assert command[command.index("--model") + 1] == "gpt-5.4-mini"
    assert "--ignore-user-config" in command
    assert "--ignore-rules" in command
    assert captured["kwargs"]["input"].endswith(
        "Do not inspect files, use tools, run commands, or modify anything."
    )
    assert "CODEX_API_KEY" not in captured["kwargs"]["env"]
    assert "OPENAI_API_KEY" not in captured["kwargs"]["env"]


def test_codex_provider_reports_expired_chatgpt_session(monkeypatch, tmp_path):
    fake_cli = tmp_path / "codex.cmd"
    fake_cli.write_text("@echo off", encoding="utf-8")

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0],
            1,
            stdout="",
            stderr="Error: not logged in. Run codex login.",
        ),
    )

    provider = CodexScriptProvider(cli_path=str(fake_cli))
    with pytest.raises(CodexProviderError, match="codex login"):
        provider.generate_scripts(
            prompt="Generate one script.",
            variant_count=1,
            model="gpt-5.4-mini",
        )


def test_codex_provider_reports_timeout(monkeypatch, tmp_path):
    fake_cli = tmp_path / "codex.cmd"
    fake_cli.write_text("@echo off", encoding="utf-8")

    def fake_timeout(command, **kwargs):
        if command[1:3] == ["login", "status"]:
            return subprocess.CompletedProcess(
                command,
                0,
                stdout="Logged in using ChatGPT",
                stderr="",
            )
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])

    monkeypatch.setattr(subprocess, "run", fake_timeout)

    provider = CodexScriptProvider(cli_path=str(fake_cli), timeout_seconds=30)
    with pytest.raises(CodexProviderError, match="timed out after 30 seconds"):
        provider.generate_scripts(
            prompt="Generate one script.",
            variant_count=1,
            model="gpt-5.4-mini",
        )


def test_codex_provider_rejects_separately_billed_api_key_login(monkeypatch, tmp_path):
    fake_cli = tmp_path / "codex.cmd"
    fake_cli.write_text("@echo off", encoding="utf-8")

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0],
            0,
            stdout="Logged in using API key",
            stderr="",
        ),
    )

    provider = CodexScriptProvider(cli_path=str(fake_cli))
    with pytest.raises(CodexProviderError, match="billed separately"):
        provider.generate_scripts(
            prompt="Generate one script.",
            variant_count=1,
            model="gpt-5.4-mini",
        )


def test_script_generator_uses_codex_without_provider_api_keys(monkeypatch):
    generator = ScriptGenerator(codex_enabled=True)
    captured = {}

    def fake_generate_scripts(*, prompt, variant_count, model):
        captured["prompt"] = prompt
        captured["variant_count"] = variant_count
        captured["model"] = model
        return ["Salut! #promo", "A doua varianta."]

    monkeypatch.setattr(
        generator._codex_provider,
        "generate_scripts",
        fake_generate_scripts,
    )

    scripts = generator.generate_scripts(
        idea="Un clip scurt",
        context="Brand local",
        keywords=["produs"],
        variant_count=2,
        provider="codex",
        codex_model="gpt-5.4-mini",
    )

    assert captured["variant_count"] == 2
    assert captured["model"] == "gpt-5.4-mini"
    assert "Un clip scurt" in captured["prompt"]
    assert scripts == ["Salut!", "A doua varianta."]


def test_script_generator_rejects_codex_outside_desktop():
    generator = ScriptGenerator(codex_enabled=False)

    with pytest.raises(ValueError, match="desktop app"):
        generator.generate_scripts(
            idea="Test",
            context="",
            keywords=[],
            variant_count=1,
            provider="codex",
        )
