export const TIMELINE_SNAP_DISTANCE_PX = 10;

export type TimelineSnapResult = {
  value: number;
  snappedTo: number | null;
};

export type TimelineRangeSnapResult = {
  start: number;
  end: number;
  snappedTo: number | null;
  edge: "start" | "end" | null;
};

/**
 * Snap a timeline time to the nearest media edge using a constant on-screen
 * attraction distance. Keeping the threshold in pixels makes the interaction
 * feel the same at every timeline duration and zoom level.
 */
export function snapTimelineTime(
  value: number,
  candidates: readonly number[],
  options: {
    duration: number;
    axisWidth: number;
    disabled?: boolean;
    distancePx?: number;
  },
): TimelineSnapResult {
  if (options.disabled || candidates.length === 0) {
    return { value, snappedTo: null };
  }

  const duration = Math.max(0, options.duration);
  const axisWidth = Math.max(1, options.axisWidth);
  const threshold = duration * ((options.distancePx ?? TIMELINE_SNAP_DISTANCE_PX) / axisWidth);
  let nearest: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    const distance = Math.abs(candidate - value);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest !== null && nearestDistance <= threshold
    ? { value: nearest, snappedTo: nearest }
    : { value, snappedTo: null };
}

/**
 * Move a whole range without changing its duration, snapping whichever edge
 * is visually closest to a candidate. This lets a clip's trailing edge align
 * just as naturally as its leading edge.
 */
export function snapTimelineRange(
  start: number,
  end: number,
  candidates: readonly number[],
  options: {
    duration: number;
    axisWidth: number;
    disabled?: boolean;
    distancePx?: number;
  },
): TimelineRangeSnapResult {
  const startResult = snapTimelineTime(start, candidates, options);
  const endResult = snapTimelineTime(end, candidates, options);
  const startDelta = startResult.snappedTo === null
    ? Number.POSITIVE_INFINITY
    : startResult.value - start;
  const endDelta = endResult.snappedTo === null
    ? Number.POSITIVE_INFINITY
    : endResult.value - end;

  if (!Number.isFinite(startDelta) && !Number.isFinite(endDelta)) {
    return { start, end, snappedTo: null, edge: null };
  }

  const useStart = Math.abs(startDelta) <= Math.abs(endDelta);
  const delta = useStart ? startDelta : endDelta;
  const snappedTo = useStart ? startResult.snappedTo : endResult.snappedTo;
  return {
    start: start + delta,
    end: end + delta,
    snappedTo,
    edge: useStart ? "start" : "end",
  };
}

/**
 * Return the candidate currently shared by either edge of a positioned range.
 * Call this after collision/bounds clamping so a guide is only shown when the
 * final on-screen clip really is aligned.
 */
export function alignedTimelineRangeEdge(
  start: number,
  end: number,
  candidates: readonly number[],
  epsilon = 0.0001,
): number | null {
  let nearest: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    const distance = Math.min(Math.abs(candidate - start), Math.abs(candidate - end));
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest !== null && nearestDistance <= epsilon ? nearest : null;
}

export function timelineRangeEdges<T>(
  items: readonly T[],
  getRange: (item: T) => { start: number; end: number },
): number[] {
  return items.flatMap((item) => {
    const range = getRange(item);
    return [range.start, range.end];
  });
}
