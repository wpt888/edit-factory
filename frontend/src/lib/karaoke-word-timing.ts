// Client-side karaoke word-timing approximation for the inline Step-3 preview
// player. The backend owns exact per-word timing (ElevenLabs-derived ASS
// {\k} tags) for the burned-in render; this is only for visual sync in the
// browser preview, where we only have phrase-level srt_start/srt_end.

/** Strips ASS override blocks (e.g. "{\k50}", "{\an8}") from subtitle text. */
export function stripAssTags(text: string): string {
  return text.replace(/\{\\[^}]*\}/g, "");
}

export interface KaraokeWordTiming {
  word: string;
  start: number;
  end: number;
}

/**
 * Splits a cleaned phrase into words and allocates the phrase's
 * [start, end) window across them proportionally to word length (+1 for the
 * trailing space) rather than evenly — longer words hold the highlight
 * longer, closer to natural speech pacing.
 * ponytail: length-proportional heuristic, not real phoneme/audio timing —
 * upgrade to backend per-word timestamps if precision ever matters here.
 */
export function computeKaraokeWordTimings(
  text: string,
  start: number,
  end: number
): KaraokeWordTiming[] {
  const words = stripAssTags(text).trim().split(/\s+/).filter(Boolean);
  const duration = Math.max(0, end - start);
  if (words.length === 0 || duration <= 0) return [];

  const weights = words.map((word) => word.length + 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = start;
  return words.map((word, index) => {
    const wordStart = cursor;
    const wordEnd = index === words.length - 1
      ? end
      : wordStart + (weights[index] / totalWeight) * duration;
    cursor = wordEnd;
    return { word, start: wordStart, end: wordEnd };
  });
}

/** Index of the word active at `time`, or -1 if before the first word / no words. */
export function activeKaraokeWordIndex(timings: KaraokeWordTiming[], time: number): number {
  if (timings.length === 0 || time < timings[0].start) return -1;
  for (let i = timings.length - 1; i >= 0; i--) {
    if (time >= timings[i].start) return i;
  }
  return -1;
}
