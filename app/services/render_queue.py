"""Fair, in-process scheduling for final pipeline renders.

The queue deliberately stays process-local, just like the FFmpeg semaphore it
sits above. It provides round-robin scheduling between users and FIFO ordering
within each user's queue while leaving the existing semaphore as the authority
for the number of simultaneous render slots.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import deque
from dataclasses import dataclass
from statistics import fmean
from typing import Any, AsyncContextManager, Awaitable, Callable, Deque, Dict, Literal, Optional

from app.services.ffmpeg_semaphore import acquire_render_slot, get_render_concurrency

logger = logging.getLogger(__name__)

QueueState = Literal["queued", "granted", "running"]
SlotFactory = Callable[[], Awaitable[AsyncContextManager[Any]]]
CapacityProvider = Callable[[], Awaitable[int]]


class RenderQueueCancelled(Exception):
    """Raised in a queued task when it is cancelled before it starts."""


@dataclass(frozen=True)
class RenderQueueSnapshot:
    """Public scheduling state for one render job."""

    state: QueueState
    position: Optional[int]
    eta_seconds: Optional[int]
    average_duration_seconds: int
    active_count: int
    capacity: int


@dataclass
class _QueueEntry:
    job_id: str
    user_id: str
    granted: asyncio.Future[None]
    ready_event: Optional[asyncio.Event]
    enqueued_at: float
    state: str = "queued"
    started_at: Optional[float] = None

    @property
    def ready(self) -> bool:
        return self.ready_event is None or self.ready_event.is_set()


async def _default_slot_factory() -> AsyncContextManager[Any]:
    return await acquire_render_slot()


class RenderQueueTicket:
    """A queue reservation consumed as an async context manager."""

    def __init__(self, queue: "FairRenderQueue", entry: _QueueEntry):
        self._queue = queue
        self._entry = entry
        self._slot_context: Optional[AsyncContextManager[Any]] = None
        self._entered = False

    @property
    def job_id(self) -> str:
        return self._entry.job_id

    async def __aenter__(self) -> "RenderQueueTicket":
        try:
            await self._entry.granted
        except RenderQueueCancelled:
            raise

        await self._queue._assert_not_cancelled(self._entry)
        slot_context = await self._queue._slot_factory()
        self._slot_context = slot_context
        try:
            await slot_context.__aenter__()
            await self._queue._mark_running(self._entry)
        except BaseException as exc:
            try:
                await slot_context.__aexit__(type(exc), exc, exc.__traceback__)
            finally:
                await self._queue._release(self._entry, record_duration=False)
            raise

        self._entered = True
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        suppress = False
        try:
            if self._slot_context is not None and self._entered:
                suppress = bool(
                    await self._slot_context.__aexit__(exc_type, exc_value, traceback)
                )
        finally:
            await self._queue._release(self._entry, record_duration=True)
        return suppress


class FairRenderQueue:
    """Round-robin user scheduler layered over the FFmpeg render semaphore."""

    def __init__(
        self,
        *,
        capacity: Optional[int] = None,
        capacity_provider: CapacityProvider = get_render_concurrency,
        slot_factory: SlotFactory = _default_slot_factory,
        default_duration_seconds: Optional[float] = None,
        recent_duration_limit: int = 20,
        clock: Callable[[], float] = time.monotonic,
    ):
        configured_default = os.environ.get("RENDER_QUEUE_DEFAULT_DURATION_SECONDS", "300")
        if default_duration_seconds is None:
            try:
                default_duration_seconds = max(1.0, float(configured_default))
            except ValueError:
                default_duration_seconds = 300.0

        self._capacity = max(1, capacity) if capacity is not None else None
        self._capacity_provider = capacity_provider
        self._slot_factory = slot_factory
        self._default_duration_seconds = default_duration_seconds
        self._recent_durations: Deque[float] = deque(maxlen=max(1, recent_duration_limit))
        self._clock = clock

        self._lock = asyncio.Lock()
        self._entries: Dict[str, _QueueEntry] = {}
        self._queues: Dict[str, Deque[_QueueEntry]] = {}
        self._users: list[str] = []
        self._last_scheduled_user: Optional[str] = None
        self._active_count = 0
        self._active_by_user: Dict[str, int] = {}

    async def _ensure_capacity(self) -> int:
        if self._capacity is None:
            self._capacity = max(1, int(await self._capacity_provider()))
        return self._capacity

    async def enqueue(
        self,
        *,
        user_id: str,
        job_id: str,
        ready_event: Optional[asyncio.Event] = None,
    ) -> RenderQueueTicket:
        """Append one render to a user's FIFO and return its reservation ticket."""
        await self._ensure_capacity()
        loop = asyncio.get_running_loop()
        entry = _QueueEntry(
            job_id=job_id,
            user_id=user_id,
            granted=loop.create_future(),
            ready_event=ready_event,
            enqueued_at=self._clock(),
        )

        async with self._lock:
            if job_id in self._entries:
                raise ValueError(f"Render job is already queued: {job_id}")
            self._entries[job_id] = entry
            if user_id not in self._queues:
                self._queues[user_id] = deque()
            self._queues[user_id].append(entry)
            if user_id not in self._users:
                self._users.append(user_id)
            self._dispatch_locked()

        return RenderQueueTicket(self, entry)

    async def notify_ready(self) -> None:
        """Re-run dispatch after a dependency gate becomes ready."""
        await self._ensure_capacity()
        async with self._lock:
            self._dispatch_locked()

    async def cancel(self, job_id: str) -> bool:
        """Remove a job that has not started; return False once it is running."""
        await self._ensure_capacity()
        async with self._lock:
            entry = self._entries.get(job_id)
            if entry is None:
                return False
            if entry.state == "running":
                return False

            if entry.state == "queued":
                user_queue = self._queues.get(entry.user_id)
                if user_queue is not None:
                    try:
                        user_queue.remove(entry)
                    except ValueError:
                        pass
            elif entry.state == "granted":
                self._active_count = max(0, self._active_count - 1)
                self._decrement_active_user_locked(entry.user_id)

            entry.state = "cancelled"
            self._entries.pop(job_id, None)
            if not entry.granted.done():
                entry.granted.set_exception(RenderQueueCancelled(job_id))
            self._cleanup_user_locked(entry.user_id)
            self._dispatch_locked()
            return True

    async def snapshot(self, job_id: str) -> Optional[RenderQueueSnapshot]:
        """Return queue position and a simple recent-duration ETA for one job."""
        snapshots = await self.snapshots([job_id])
        return snapshots.get(job_id)

    async def snapshots(self, job_ids: list[str]) -> Dict[str, RenderQueueSnapshot]:
        capacity = await self._ensure_capacity()
        async with self._lock:
            pending_order = self._projected_pending_order_locked()
            positions = {entry.job_id: index + 1 for index, entry in enumerate(pending_order)}
            average = self._average_duration_locked()
            result: Dict[str, RenderQueueSnapshot] = {}
            for job_id in job_ids:
                entry = self._entries.get(job_id)
                if entry is None:
                    continue
                position = positions.get(job_id) if entry.state == "queued" else None
                eta_seconds = None
                if position is not None:
                    wait_waves = (self._active_count + position - 1) // capacity
                    eta_seconds = int(round(wait_waves * average))
                result[job_id] = RenderQueueSnapshot(
                    state=entry.state,  # type: ignore[arg-type]
                    position=position,
                    eta_seconds=eta_seconds,
                    average_duration_seconds=int(round(average)),
                    active_count=self._active_count,
                    capacity=capacity,
                )
            return result

    async def _assert_not_cancelled(self, entry: _QueueEntry) -> None:
        async with self._lock:
            if entry.state == "cancelled":
                raise RenderQueueCancelled(entry.job_id)

    async def _mark_running(self, entry: _QueueEntry) -> None:
        async with self._lock:
            if entry.state == "cancelled":
                raise RenderQueueCancelled(entry.job_id)
            if entry.state != "granted":
                raise RuntimeError(f"Invalid queue transition for {entry.job_id}: {entry.state}")
            entry.state = "running"
            entry.started_at = self._clock()

    async def _release(self, entry: _QueueEntry, *, record_duration: bool) -> None:
        async with self._lock:
            if entry.state not in ("granted", "running"):
                return
            if record_duration and entry.started_at is not None:
                self._recent_durations.append(max(1.0, self._clock() - entry.started_at))
            self._active_count = max(0, self._active_count - 1)
            self._decrement_active_user_locked(entry.user_id)
            self._entries.pop(entry.job_id, None)
            entry.state = "completed"
            self._cleanup_user_locked(entry.user_id)
            self._dispatch_locked()

    def _dispatch_locked(self) -> None:
        if self._capacity is None:
            return
        while self._active_count < self._capacity:
            entry = self._next_ready_entry_locked()
            if entry is None:
                break
            entry.state = "granted"
            self._active_count += 1
            self._active_by_user[entry.user_id] = self._active_by_user.get(entry.user_id, 0) + 1
            if not entry.granted.done():
                entry.granted.set_result(None)
            logger.info(
                "Render queue granted job=%s user=%s active=%d/%d",
                entry.job_id,
                entry.user_id,
                self._active_count,
                self._capacity,
            )

    def _next_ready_entry_locked(self) -> Optional[_QueueEntry]:
        if not self._users:
            return None
        if self._last_scheduled_user in self._users:
            start = (self._users.index(self._last_scheduled_user) + 1) % len(self._users)
        else:
            start = 0

        for offset in range(len(self._users)):
            user_id = self._users[(start + offset) % len(self._users)]
            user_queue = self._queues.get(user_id)
            if user_queue and user_queue[0].ready:
                entry = user_queue.popleft()
                self._last_scheduled_user = user_id
                return entry
        return None

    def _projected_pending_order_locked(self) -> list[_QueueEntry]:
        queues = {user_id: deque(entries) for user_id, entries in self._queues.items()}
        users = list(self._users)
        last_user = self._last_scheduled_user
        projected: list[_QueueEntry] = []
        pending_count = sum(len(entries) for entries in queues.values())

        while len(projected) < pending_count and users:
            if last_user in users:
                start = (users.index(last_user) + 1) % len(users)
            else:
                start = 0
            selected_user = None
            for offset in range(len(users)):
                candidate = users[(start + offset) % len(users)]
                if queues.get(candidate):
                    selected_user = candidate
                    break
            if selected_user is None:
                break
            projected.append(queues[selected_user].popleft())
            last_user = selected_user

        return projected

    def _average_duration_locked(self) -> float:
        if self._recent_durations:
            return fmean(self._recent_durations)
        return self._default_duration_seconds

    def _decrement_active_user_locked(self, user_id: str) -> None:
        active = self._active_by_user.get(user_id, 0) - 1
        if active > 0:
            self._active_by_user[user_id] = active
        else:
            self._active_by_user.pop(user_id, None)

    def _cleanup_user_locked(self, user_id: str) -> None:
        if self._queues.get(user_id) or self._active_by_user.get(user_id, 0) > 0:
            return
        self._queues.pop(user_id, None)
        if user_id not in self._users:
            return

        removed_index = self._users.index(user_id)
        self._users.remove(user_id)
        if self._last_scheduled_user == user_id:
            if self._users:
                predecessor_index = (removed_index - 1) % len(self._users)
                self._last_scheduled_user = self._users[predecessor_index]
            else:
                self._last_scheduled_user = None


_render_queue = FairRenderQueue()


def get_render_queue() -> FairRenderQueue:
    """Return the single fair render queue for this process/container."""
    return _render_queue
