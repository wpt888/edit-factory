"""Fair per-user render queue scheduling tests."""
import asyncio

from app.services.render_queue import FairRenderQueue, RenderQueueCancelled


class _NoopSlot:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


async def _noop_slot_factory():
    return _NoopSlot()


def test_round_robin_between_users_and_fifo_within_each_user():
    """Two users x N renders alternate without changing either user's FIFO."""

    async def scenario():
        queue = FairRenderQueue(
            capacity=1,
            slot_factory=_noop_slot_factory,
            default_duration_seconds=60,
        )
        blocker_release = asyncio.Event()
        blocker_started = asyncio.Event()
        execution_order: list[str] = []

        blocker = await queue.enqueue(user_id="blocker", job_id="blocker-1")

        async def run_blocker():
            async with blocker:
                blocker_started.set()
                await blocker_release.wait()

        blocker_task = asyncio.create_task(run_blocker())
        await blocker_started.wait()

        tickets = []
        for number in range(1, 4):
            tickets.append(
                (f"alice-{number}", await queue.enqueue(user_id="alice", job_id=f"alice-{number}"))
            )
        for number in range(1, 4):
            tickets.append(
                (f"bob-{number}", await queue.enqueue(user_id="bob", job_id=f"bob-{number}"))
            )

        async def run_job(label, ticket):
            async with ticket:
                execution_order.append(label)
                await asyncio.sleep(0)

        tasks = [asyncio.create_task(run_job(label, ticket)) for label, ticket in tickets]
        blocker_release.set()
        await asyncio.gather(blocker_task, *tasks)

        assert execution_order == [
            "alice-1",
            "bob-1",
            "alice-2",
            "bob-2",
            "alice-3",
            "bob-3",
        ]

    asyncio.run(scenario())


def test_queue_snapshot_reports_round_robin_position_and_eta():
    async def scenario():
        queue = FairRenderQueue(
            capacity=1,
            slot_factory=_noop_slot_factory,
            default_duration_seconds=90,
        )
        blocker = await queue.enqueue(user_id="blocker", job_id="blocker")
        blocker_release = asyncio.Event()
        blocker_started = asyncio.Event()

        async def run_blocker():
            async with blocker:
                blocker_started.set()
                await blocker_release.wait()

        task = asyncio.create_task(run_blocker())
        await blocker_started.wait()

        alice_1 = await queue.enqueue(user_id="alice", job_id="alice-1")
        alice_2 = await queue.enqueue(user_id="alice", job_id="alice-2")
        bob_1 = await queue.enqueue(user_id="bob", job_id="bob-1")

        snapshots = await queue.snapshots(["alice-1", "alice-2", "bob-1"])
        assert snapshots["alice-1"].position == 1
        assert snapshots["bob-1"].position == 2
        assert snapshots["alice-2"].position == 3
        assert snapshots["alice-1"].eta_seconds == 90
        assert snapshots["bob-1"].eta_seconds == 180

        await queue.cancel("alice-1")
        await queue.cancel("alice-2")
        await queue.cancel("bob-1")
        for ticket in (alice_1, alice_2, bob_1):
            try:
                async with ticket:
                    raise AssertionError("cancelled queued render started")
            except RenderQueueCancelled:
                pass
        blocker_release.set()
        await task

    asyncio.run(scenario())


def test_eta_uses_average_duration_from_recent_renders():
    async def scenario():
        now = [0.0]
        queue = FairRenderQueue(
            capacity=1,
            slot_factory=_noop_slot_factory,
            default_duration_seconds=30,
            clock=lambda: now[0],
        )

        sample = await queue.enqueue(user_id="alice", job_id="sample")
        async with sample:
            now[0] += 120

        blocker = await queue.enqueue(user_id="alice", job_id="blocker")
        blocker_release = asyncio.Event()
        blocker_started = asyncio.Event()

        async def run_blocker():
            async with blocker:
                blocker_started.set()
                await blocker_release.wait()

        task = asyncio.create_task(run_blocker())
        await blocker_started.wait()
        queued = await queue.enqueue(user_id="bob", job_id="queued")

        snapshot = await queue.snapshot("queued")
        assert snapshot is not None
        assert snapshot.average_duration_seconds == 120
        assert snapshot.eta_seconds == 120

        await queue.cancel("queued")
        try:
            async with queued:
                raise AssertionError("cancelled queued render started")
        except RenderQueueCancelled:
            pass
        blocker_release.set()
        await task

    asyncio.run(scenario())


def test_cancel_removes_queued_item_immediately():
    async def scenario():
        queue = FairRenderQueue(capacity=1, slot_factory=_noop_slot_factory)
        blocker = await queue.enqueue(user_id="alice", job_id="active")
        blocker_release = asyncio.Event()
        blocker_started = asyncio.Event()

        async def run_blocker():
            async with blocker:
                blocker_started.set()
                await blocker_release.wait()

        task = asyncio.create_task(run_blocker())
        await blocker_started.wait()
        queued = await queue.enqueue(user_id="bob", job_id="queued")

        assert await queue.cancel("queued") is True
        assert await queue.snapshot("queued") is None
        try:
            async with queued:
                raise AssertionError("cancelled queued render started")
        except RenderQueueCancelled:
            pass

        blocker_release.set()
        await task

    asyncio.run(scenario())


def test_dependency_gate_does_not_block_other_users():
    async def scenario():
        queue = FairRenderQueue(capacity=1, slot_factory=_noop_slot_factory)
        gate = asyncio.Event()
        blocked = await queue.enqueue(user_id="alice", job_id="alice-b", ready_event=gate)
        ready = await queue.enqueue(user_id="bob", job_id="bob-a")
        execution_order: list[str] = []

        async def run(label, ticket):
            async with ticket:
                execution_order.append(label)

        ready_task = asyncio.create_task(run("bob-a", ready))
        blocked_task = asyncio.create_task(run("alice-b", blocked))
        await ready_task
        assert execution_order == ["bob-a"]

        gate.set()
        await queue.notify_ready()
        await blocked_task
        assert execution_order == ["bob-a", "alice-b"]

    asyncio.run(scenario())
