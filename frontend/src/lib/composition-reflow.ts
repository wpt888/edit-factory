import type { CompositionClip } from "@/types/composition-timeline";
import type { MatchPreview, IntroSegment, SegmentOption } from "@/components/timeline-editor";

// Pure composition-timeline helpers. Extracted verbatim from timeline-editor.tsx
// so the reflow math can be reused (and unit-reasoned about) without pulling in
// the ~5000-line editor component. No behavior change.

export const reflowComposition = (clips: CompositionClip[]): CompositionClip[] => {
  let cursor = 0;
  return clips.map((clip) => {
    const next = {
      ...clip,
      timeline_start: cursor,
      timeline_duration: Math.max(0.05, clip.timeline_duration),
    };
    cursor += next.timeline_duration;
    return next;
  });
};

export const fitCompositionToDuration = (
  clips: CompositionClip[],
  duration: number,
): CompositionClip[] => {
  if (clips.length === 0 || duration <= 0) return reflowComposition(clips);
  const fitted: CompositionClip[] = [];
  let cursor = 0;
  for (const clip of reflowComposition(clips)) {
    if (cursor >= duration - 0.001) break;
    const visibleDuration = Math.min(clip.timeline_duration, duration - cursor);
    if (visibleDuration < 0.05 && fitted.length > 0) {
      fitted[fitted.length - 1].timeline_duration += visibleDuration;
      cursor += visibleDuration;
      break;
    }
    fitted.push({ ...clip, timeline_start: cursor, timeline_duration: visibleDuration });
    cursor += visibleDuration;
  }
  if (fitted.length > 0 && cursor < duration - 0.001) {
    fitted[fitted.length - 1].timeline_duration += duration - cursor;
  }
  return reflowComposition(fitted);
};

export const buildLegacyComposition = (
  matches: MatchPreview[],
  introSegments: IntroSegment[],
  availableSegments: SegmentOption[],
  audioDuration: number,
): CompositionClip[] => {
  const clips: CompositionClip[] = [];
  const findLibrarySegment = (
    sourceVideoId: string | undefined,
    sourceStart: number,
  ) => availableSegments
    .filter((segment) => !sourceVideoId || segment.source_video_id === sourceVideoId)
    .sort((a, b) => Math.abs((a.start_time ?? 0) - sourceStart) - Math.abs((b.start_time ?? 0) - sourceStart))[0];

  for (const [index, intro] of [...introSegments]
    .sort((a, b) => a.timeline_start - b.timeline_start)
    .entries()) {
    const librarySegment = findLibrarySegment(intro.source_video_id, intro.start_time);
    clips.push({
      id: `legacy-intro-${index}-${intro.start_time.toFixed(3)}`,
      kind: "intro",
      segment_id: librarySegment?.id ?? null,
      segment_keywords: librarySegment?.keywords ?? [],
      source_video_id: intro.source_video_id ?? librarySegment?.source_video_id ?? null,
      thumbnail_path: librarySegment?.thumbnail_path,
      product_group: librarySegment?.product_group,
      start_time: intro.start_time,
      end_time: intro.end_time,
      timeline_start: 0,
      timeline_duration: intro.timeline_duration,
      transforms: librarySegment?.transforms,
    });
  }

  const introDuration = clips.reduce((sum, clip) => sum + clip.timeline_duration, 0);
  const grouped = new Map<string, MatchPreview[]>();
  matches.forEach((match, index) => {
    const key = match.merge_group != null ? `group-${match.merge_group}` : `match-${index}`;
    const group = grouped.get(key) ?? [];
    group.push(match);
    grouped.set(key, group);
  });

  let bodyTimeToSkip = introDuration;
  for (const [key, group] of grouped.entries()) {
    const representative = group.find((match) => match.pinned) ?? group[0];
    if (!representative) continue;
    const groupDuration = representative.merge_group_duration
      ?? Math.max(0.05, group[group.length - 1].srt_end - group[0].srt_start);
    if (bodyTimeToSkip >= groupDuration - 0.001) {
      bodyTimeToSkip = Math.max(0, bodyTimeToSkip - groupDuration);
      continue;
    }
    const visibleDuration = groupDuration - bodyTimeToSkip;
    bodyTimeToSkip = 0;
    const librarySegment = availableSegments.find((segment) => segment.id === representative.segment_id)
      ?? findLibrarySegment(representative.source_video_id, representative.segment_start_time ?? 0);
    if (!librarySegment && !representative.source_video_id) continue;
    const sourceStart = representative.segment_start_time ?? librarySegment?.start_time ?? 0;
    const sourceEnd = representative.segment_end_time
      ?? librarySegment?.end_time
      ?? sourceStart + visibleDuration;
    clips.push({
      id: `legacy-${key}-${representative.segment_id ?? representative.source_video_id ?? "clip"}`,
      kind: "body",
      segment_id: representative.segment_id ?? librarySegment?.id ?? null,
      segment_keywords: representative.segment_keywords ?? librarySegment?.keywords ?? [],
      source_video_id: representative.source_video_id ?? librarySegment?.source_video_id ?? null,
      thumbnail_path: representative.thumbnail_path ?? librarySegment?.thumbnail_path,
      product_group: representative.product_group ?? librarySegment?.product_group,
      start_time: sourceStart,
      end_time: Math.max(sourceStart + 0.05, sourceEnd),
      timeline_start: 0,
      timeline_duration: visibleDuration,
      transforms: representative.transforms ?? librarySegment?.transforms,
      pinned: representative.pinned,
    });
  }

  return fitCompositionToDuration(clips, audioDuration);
};

// Roll the boundary between clips[leftIndex] and clips[leftIndex+1] by
// `requestedDelta` seconds (clamped to keep both sides >= 0.1s and within each
// library segment's source range). `availableSegments` was a closure capture in
// the component; it is now an explicit argument so the helper stays pure.
export const rollCompositionBoundary = (
  clips: CompositionClip[],
  leftIndex: number,
  requestedDelta: number,
  availableSegments: SegmentOption[],
): CompositionClip[] => {
  const left = clips[leftIndex];
  const right = clips[leftIndex + 1];
  if (!left || !right) return clips;
  const minimumDuration = 0.1;
  const delta = Math.max(
    minimumDuration - left.timeline_duration,
    Math.min(right.timeline_duration - minimumDuration, requestedDelta),
  );
  if (Math.abs(delta) < 0.0001) return clips;

  const leftLibrary = availableSegments.find((segment) => segment.id === left.segment_id);
  const rightLibrary = availableSegments.find((segment) => segment.id === right.segment_id);
  const leftMaximumEnd = leftLibrary?.end_time ?? Math.max(left.end_time, left.end_time + Math.max(0, delta));
  const rightMinimumStart = rightLibrary?.start_time ?? Math.min(right.start_time, right.start_time + Math.min(0, delta));

  const updated = clips.map((clip) => ({ ...clip }));
  updated[leftIndex] = {
    ...left,
    timeline_duration: left.timeline_duration + delta,
    end_time: Math.max(
      left.start_time + 0.05,
      Math.min(leftMaximumEnd, left.end_time + delta),
    ),
    pinned: true,
  };
  updated[leftIndex + 1] = {
    ...right,
    timeline_duration: right.timeline_duration - delta,
    start_time: Math.min(
      right.end_time - 0.05,
      Math.max(rightMinimumStart, right.start_time + delta),
    ),
    pinned: true,
  };
  return reflowComposition(updated);
};
