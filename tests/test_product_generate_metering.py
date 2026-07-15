"""Product video bundle metering and fair-queue coverage."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api import product_generate_routes, routes
from app.api.auth import AuthUser, ProfileContext
from app.repositories.models import QueryResult
from app.services.studio_metering import StudioMeteringBlocked


class _Repo:
    def __init__(self, image_path=None):
        self.image_path = str(image_path) if image_path else None
        self.projects = []
        self.clips = []

    def table_query(self, table, operation, *, data=None, filters=None):
        assert operation == "select"
        if table == "products":
            product_ids = filters.in_.get("id") if filters and filters.in_ else None
            if product_ids:
                return QueryResult(
                    [{"id": product_id, "title": f"Product {product_id}"} for product_id in product_ids]
                )
            product_id = filters.eq.get("id")
            return QueryResult(
                [
                    {
                        "id": product_id,
                        "title": "Test product",
                        "description": "A useful test product",
                        "brand": "Blip",
                        "price": "99",
                        "local_image_path": self.image_path,
                        "image_link": None,
                        "feed_id": "feed-1",
                    }
                ]
            )
        if table == "profiles":
            return QueryResult([{"video_template_settings": {}}])
        if table == "segment_product_associations":
            return QueryResult([])
        if table in {"v_catalog_products", "editai_segments"}:
            return QueryResult([])
        raise AssertionError(f"Unexpected table query: {table}")

    def create_project(self, payload):
        created = {**deepcopy(payload), "id": f"project-{len(self.projects) + 1}"}
        self.projects.append(created)
        return created

    def create_clip(self, payload):
        created = {**deepcopy(payload), "id": f"clip-{len(self.clips) + 1}"}
        self.clips.append(created)
        return created


class _Ticket:
    def __init__(self, events):
        self.events = events
        self.entered = False

    async def __aenter__(self):
        self.entered = True
        self.events.append("queue_enter")
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        self.entered = False
        self.events.append("queue_exit")
        return False


class _Queue:
    def __init__(self, events):
        self.events = events
        self.ticket = _Ticket(events)
        self.enqueued = []

    async def enqueue(self, *, user_id, job_id, ready_event=None):
        self.events.append("queue_enqueue")
        self.enqueued.append((user_id, job_id))
        return self.ticket

    async def cancel(self, _job_id):
        return True


def _context() -> ProfileContext:
    return ProfileContext(profile_id="profile-1", user_id="user-1")


def _install_route_fakes(monkeypatch, memory_job_storage, repo):
    monkeypatch.setattr(product_generate_routes, "get_job_storage", lambda: memory_job_storage)
    monkeypatch.setattr(product_generate_routes, "get_repository", lambda: repo)


def _reserved_bundle(job_id, request, user_id="user-1"):
    bundle = product_generate_routes._new_product_metering_bundle(job_id, request, user_id)
    return {
        component: {
            **record,
            "state": "reserved",
            "reservation_id": f"reservation-{component}",
        }
        for component, record in bundle.items()
    }


def test_product_bundle_matches_rate_card_components():
    quick = product_generate_routes._new_product_metering_bundle(
        "quick-job",
        product_generate_routes.ProductGenerateRequest(
            voiceover_mode="quick", duration_s=60
        ),
        "user-1",
    )
    elaborate = product_generate_routes._new_product_metering_bundle(
        "elaborate-job",
        product_generate_routes.ProductGenerateRequest(
            voiceover_mode="elaborate", duration_s=61
        ),
        "user-1",
    )

    assert list(quick) == ["tts", "render"]
    assert quick["tts"]["operation"] == "studio.tts_variant"
    assert quick["render"]["units"] == 1
    assert list(elaborate) == ["script", "tts", "render"]
    assert elaborate["script"]["operation"] == "studio.script_pipeline"
    assert elaborate["render"]["units"] == 2


def test_single_product_partial_reservation_failure_rolls_back_and_returns_402(
    monkeypatch, memory_job_storage
):
    async def scenario():
        repo = _Repo()
        _install_route_fakes(monkeypatch, memory_job_storage, repo)
        calls = []

        async def reserve(_identity, record):
            calls.append(record["operation"])
            if record["operation"] == "studio.tts_variant":
                raise StudioMeteringBlocked(
                    "insufficient_credits",
                    "Not enough credits",
                    available_credits=1,
                )
            return {
                **record,
                "state": "reserved",
                "reservation_id": "script-reservation",
            }

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            return {**record, "state": "released"}

        monkeypatch.setattr(product_generate_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(product_generate_routes, "settle_metering_record", settle)
        background = BackgroundTasks()

        with pytest.raises(HTTPException) as error:
            await product_generate_routes.generate_product_video(
                "product-1",
                product_generate_routes.ProductGenerateRequest(
                    voiceover_mode="elaborate"
                ),
                background,
                _context(),
                AuthUser("user-1", "person@example.com"),
            )

        assert error.value.status_code == 402
        assert error.value.detail["billing_url"] == "https://blipost.com/billing"
        assert calls == ["studio.script_pipeline", "studio.tts_variant"]
        assert background.tasks == []
        job = next(iter(memory_job_storage.memory_store.values()))
        assert job["status"] == "failed"
        assert job["metering"]["script"]["state"] == "released"
        assert job["metering"]["tts"]["state"] == "denied"
        assert job["metering"]["render"]["state"] == "denied"

    asyncio.run(scenario())


def test_batch_reservation_failure_refunds_prior_children_before_dispatch(
    monkeypatch, memory_job_storage
):
    async def scenario():
        repo = _Repo()
        _install_route_fakes(monkeypatch, memory_job_storage, repo)
        reserve_count = 0

        async def reserve(_identity, record):
            nonlocal reserve_count
            reserve_count += 1
            if reserve_count == 3:
                raise StudioMeteringBlocked(
                    "insufficient_credits",
                    "Not enough credits",
                    available_credits=0,
                )
            return {
                **record,
                "state": "reserved",
                "reservation_id": f"reservation-{reserve_count}",
            }

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            return {**record, "state": "released"}

        monkeypatch.setattr(product_generate_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(product_generate_routes, "settle_metering_record", settle)
        background = BackgroundTasks()

        with pytest.raises(HTTPException) as error:
            await product_generate_routes.batch_generate_products(
                product_generate_routes.BatchGenerateRequest(
                    product_ids=["product-1", "product-2"]
                ),
                background,
                _context(),
                AuthUser("user-1", "person@example.com"),
            )

        assert error.value.status_code == 402
        assert background.tasks == []
        batch = next(
            job
            for job in memory_job_storage.memory_store.values()
            if job.get("job_type") == "batch_product_video"
        )
        children = [memory_job_storage.get_job(item["job_id"]) for item in batch["product_jobs"]]
        assert batch["status"] == "failed"
        assert all(record["state"] == "released" for record in children[0]["metering"].values())
        assert all(record["state"] == "denied" for record in children[1]["metering"].values())

    asyncio.run(scenario())


def test_product_worker_queues_after_tts_and_captures_after_library_persistence(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        image_path = tmp_path / "product.jpg"
        image_path.write_bytes(b"image")
        output_dir = tmp_path / "output"
        output_dir.mkdir()
        repo = _Repo(image_path)
        _install_route_fakes(monkeypatch, memory_job_storage, repo)
        settings = SimpleNamespace(
            base_dir=tmp_path,
            output_dir=output_dir,
            gemini_api_key="",
            anthropic_api_key="",
        )
        monkeypatch.setattr(product_generate_routes, "get_settings", lambda: settings)
        monkeypatch.setattr(product_generate_routes, "_resolve_product_footage", lambda *_args: None)
        monkeypatch.setattr(product_generate_routes, "_build_preset_dict", lambda _name: {})
        events = []
        queue = _Queue(events)
        monkeypatch.setattr(product_generate_routes, "get_render_queue", lambda: queue)
        monkeypatch.setattr("app.services.ffmpeg_semaphore.check_disk_space", lambda *_args: None)

        class _EdgeTTS:
            def __init__(self, **_kwargs):
                pass

            async def generate_audio(self, *, text, voice_id, output_path):
                events.append("tts")
                output_path.write_bytes(b"audio")
                return SimpleNamespace(audio_path=output_path, duration_seconds=30.0)

        monkeypatch.setattr("app.services.tts.edge.EdgeTTSService", _EdgeTTS)

        def compose(*, output_path, **_kwargs):
            assert queue.ticket.entered is True
            events.append("compose")
            output_path.write_bytes(b"composed")

        async def render(*, output_path, **_kwargs):
            assert queue.ticket.entered is True
            events.append("render")
            output_path.write_bytes(b"final")

        monkeypatch.setattr("app.services.product_video_compositor.compose_product_video", compose)
        monkeypatch.setattr(
            "app.services.product_video_compositor.compose_product_video_from_footage",
            compose,
        )
        monkeypatch.setattr("app.api.library_routes._render_with_preset", render)

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is True
            assert repo.clips
            events.append(f"capture:{result_metadata['component']}")
            return {**record, "state": "captured", "result_metadata": result_metadata}

        monkeypatch.setattr(product_generate_routes, "settle_metering_record", settle)
        request = product_generate_routes.ProductGenerateRequest()
        job_id = "product-success"
        memory_job_storage.create_job(
            {
                "job_id": job_id,
                "job_type": "product_video",
                "status": "queued",
                "progress": "0",
                "product_id": "product-1",
                "user_id": "user-1",
                "metering": _reserved_bundle(job_id, request),
            },
            profile_id="profile-1",
        )

        await product_generate_routes._generate_product_video_task(
            job_id,
            "product-1",
            "profile-1",
            request,
            user_id="user-1",
        )

        job = memory_job_storage.get_job(job_id)
        assert events == [
            "tts",
            "queue_enqueue",
            "queue_enter",
            "compose",
            "render",
            "queue_exit",
            "capture:tts",
            "capture:render",
        ]
        assert queue.enqueued == [("user-1", "product:product-success")]
        assert job["status"] == "completed"
        assert job["result"]["clip_id"] == "clip-1"
        assert all(record["provider_started"] for record in job["metering"].values())
        assert all(record["output_persisted"] for record in job["metering"].values())
        assert all(record["state"] == "captured" for record in job["metering"].values())

    asyncio.run(scenario())


def test_product_worker_failure_refunds_every_reserved_component(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        image_path = tmp_path / "product.jpg"
        image_path.write_bytes(b"image")
        output_dir = tmp_path / "output"
        output_dir.mkdir()
        repo = _Repo(image_path)
        _install_route_fakes(monkeypatch, memory_job_storage, repo)
        monkeypatch.setattr(
            product_generate_routes,
            "get_settings",
            lambda: SimpleNamespace(
                base_dir=tmp_path,
                output_dir=output_dir,
                gemini_api_key="",
                anthropic_api_key="",
            ),
        )

        class _FailingEdgeTTS:
            def __init__(self, **_kwargs):
                pass

            async def generate_audio(self, **_kwargs):
                raise RuntimeError("TTS failed")

        monkeypatch.setattr("app.services.tts.edge.EdgeTTSService", _FailingEdgeTTS)

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            return {**record, "state": "released"}

        monkeypatch.setattr(product_generate_routes, "settle_metering_record", settle)
        request = product_generate_routes.ProductGenerateRequest()
        job_id = "product-failure"
        memory_job_storage.create_job(
            {
                "job_id": job_id,
                "job_type": "product_video",
                "status": "queued",
                "progress": "0",
                "user_id": "user-1",
                "metering": _reserved_bundle(job_id, request),
            },
            profile_id="profile-1",
        )

        await product_generate_routes._generate_product_video_task(
            job_id,
            "product-1",
            "profile-1",
            request,
            user_id="user-1",
        )

        job = memory_job_storage.get_job(job_id)
        assert job["status"] == "failed"
        assert all(record["state"] == "released" for record in job["metering"].values())

    asyncio.run(scenario())


def test_product_worker_cancel_before_provider_refunds_without_starting_tts(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        repo = _Repo()
        _install_route_fakes(monkeypatch, memory_job_storage, repo)
        monkeypatch.setattr(
            product_generate_routes,
            "get_settings",
            lambda: SimpleNamespace(base_dir=tmp_path, output_dir=tmp_path),
        )
        request = product_generate_routes.ProductGenerateRequest()
        job_id = "product-cancelled"
        memory_job_storage.create_job(
            {
                "job_id": job_id,
                "job_type": "product_video",
                "status": "queued",
                "progress": "0",
                "user_id": "user-1",
                "metering": _reserved_bundle(job_id, request),
            },
            profile_id="profile-1",
        )
        memory_job_storage.cancel_job(job_id)

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            return {**record, "state": "released"}

        monkeypatch.setattr(product_generate_routes, "settle_metering_record", settle)

        await product_generate_routes._generate_product_video_task(
            job_id,
            "product-1",
            "profile-1",
            request,
            user_id="user-1",
        )

        job = memory_job_storage.get_job(job_id)
        assert job["status"] == "cancelled"
        assert all(record["provider_started"] is False for record in job["metering"].values())
        assert all(record["state"] == "released" for record in job["metering"].values())

    asyncio.run(scenario())


def test_generic_job_status_retries_product_capture(monkeypatch, memory_job_storage):
    async def scenario():
        _install_route_fakes(monkeypatch, memory_job_storage, _Repo())
        monkeypatch.setattr(routes, "get_job_storage", lambda: memory_job_storage)
        request = product_generate_routes.ProductGenerateRequest()
        job_id = "product-capture-retry"
        pending_bundle = {
            component: {
                **record,
                "state": "capture_pending",
                "reservation_id": f"reservation-{component}",
                "provider_started": True,
                "output_persisted": True,
            }
            for component, record in product_generate_routes._new_product_metering_bundle(
                job_id, request, "user-1"
            ).items()
        }
        memory_job_storage.create_job(
            {
                "job_id": job_id,
                "job_type": "product_video",
                "status": "completed",
                "progress": "100",
                "user_id": "user-1",
                "metering": pending_bundle,
                "result": {"clip_id": "clip-retry"},
            },
            profile_id="profile-1",
        )

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is True
            assert result_metadata["output_id"] == "clip-retry"
            return {**record, "state": "captured"}

        monkeypatch.setattr(product_generate_routes, "settle_metering_record", settle)

        response = await routes.get_job(job_id, _context())

        assert response.status == "completed"
        job = memory_job_storage.get_job(job_id)
        assert all(record["state"] == "captured" for record in job["metering"].values())

    asyncio.run(scenario())


def test_generic_cancel_removes_product_from_queue_and_refunds(
    monkeypatch, memory_job_storage
):
    async def scenario():
        _install_route_fakes(monkeypatch, memory_job_storage, _Repo())
        monkeypatch.setattr(routes, "get_job_storage", lambda: memory_job_storage)
        events = []
        queue = _Queue(events)
        monkeypatch.setattr("app.services.render_queue.get_render_queue", lambda: queue)
        request = product_generate_routes.ProductGenerateRequest()
        job_id = "product-generic-cancel"
        memory_job_storage.create_job(
            {
                "job_id": job_id,
                "job_type": "product_video",
                "status": "processing",
                "progress": "Queued for render",
                "user_id": "user-1",
                "metering": _reserved_bundle(job_id, request),
            },
            profile_id="profile-1",
        )

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            return {**record, "state": "released"}

        monkeypatch.setattr(product_generate_routes, "settle_metering_record", settle)

        response = await routes.cancel_job(job_id, _context())

        assert response["status"] == "cancelled"
        job = memory_job_storage.get_job(job_id)
        assert job["status"] == "cancelled"
        assert all(record["state"] == "released" for record in job["metering"].values())

    asyncio.run(scenario())
