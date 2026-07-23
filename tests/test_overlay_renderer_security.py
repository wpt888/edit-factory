import asyncio

import pytest

from app.services.video_effects import overlay_renderer


def test_downloader_rejects_file_urls(tmp_path):
    with pytest.raises(overlay_renderer.OverlaySourceError, match="file://"):
        asyncio.run(overlay_renderer._download_image("file:///etc/passwd", str(tmp_path)))


def test_downloader_rejects_absolute_path_outside_allowed_roots(tmp_path, monkeypatch):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside" / "secret.png"
    outside.parent.mkdir()
    outside.write_bytes(b"secret")
    monkeypatch.setattr(overlay_renderer, "_allowed_local_roots", lambda _temp: (allowed.resolve(),))

    with pytest.raises(overlay_renderer.OverlaySourceError, match="outside"):
        asyncio.run(overlay_renderer._download_image(str(outside), str(allowed)))


def test_downloader_accepts_file_inside_allowed_root(tmp_path, monkeypatch):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    asset = allowed / "asset.png"
    asset.write_bytes(b"image")
    monkeypatch.setattr(overlay_renderer, "_allowed_local_roots", lambda _temp: (allowed.resolve(),))

    resolved = asyncio.run(overlay_renderer._download_image(str(asset), str(tmp_path)))

    assert resolved == str(asset.resolve())


def test_downloader_resolves_base_dir_relative_attention_asset(tmp_path, monkeypatch):
    media_dir = tmp_path / "media" / "attention" / "profile"
    media_dir.mkdir(parents=True)
    asset = media_dir / "asset.png"
    asset.write_bytes(b"image")
    monkeypatch.setattr(
        overlay_renderer,
        "get_settings",
        lambda: type("Settings", (), {"base_dir": tmp_path})(),
    )
    monkeypatch.setattr(
        overlay_renderer,
        "_allowed_local_roots",
        lambda _temp: ((tmp_path / "media").resolve(),),
    )

    resolved = asyncio.run(
        overlay_renderer._download_image(
            "media/attention/profile/asset.png",
            str(tmp_path / "temp"),
        )
    )

    assert resolved == str(asset.resolve())


def test_downloader_rejects_non_allowlisted_host(tmp_path, monkeypatch):
    monkeypatch.setattr(overlay_renderer, "_allowed_remote_hosts", lambda: {"storage.example.test"})

    with pytest.raises(overlay_renderer.OverlaySourceError, match="allowlisted"):
        asyncio.run(
            overlay_renderer._download_image(
                "https://attacker.example.test/payload.png",
                str(tmp_path),
            )
        )


def test_downloader_rejects_oversized_allowlisted_response(tmp_path, monkeypatch):
    import httpx

    class _Response:
        headers = {"content-length": str(overlay_renderer.MAX_OVERLAY_DOWNLOAD_BYTES + 1)}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        def raise_for_status(self):
            return None

        async def aiter_bytes(self):
            yield b"unused"

    class _Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        def stream(self, *_args, **_kwargs):
            return _Response()

    monkeypatch.setattr(overlay_renderer, "_allowed_remote_hosts", lambda: {"storage.example.test"})
    monkeypatch.setattr(httpx, "AsyncClient", _Client)

    with pytest.raises(overlay_renderer.OverlaySourceError, match="size limit"):
        asyncio.run(
            overlay_renderer._download_image(
                "https://storage.example.test/oversized.png",
                str(tmp_path),
            )
        )


def test_pip_render_propagates_source_failure(tmp_path, monkeypatch):
    async def _fail_source(*_args, **_kwargs):
        raise overlay_renderer.OverlaySourceError("unsafe source")

    monkeypatch.setattr(overlay_renderer, "_download_image", _fail_source)

    with pytest.raises(overlay_renderer.OverlaySourceError, match="unsafe source"):
        asyncio.run(
            overlay_renderer.apply_pip_overlay(
                str(tmp_path / "input.mp4"),
                "https://attacker.test/image.png",
                str(tmp_path / "output.mp4"),
            )
        )
