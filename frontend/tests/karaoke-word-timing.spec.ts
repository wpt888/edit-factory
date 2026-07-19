import { expect, test } from "@playwright/test";

import {
  activeKaraokeWordIndex,
  computeKaraokeWordTimings,
  stripAssTags,
} from "../src/lib/karaoke-word-timing";

test.describe("karaoke word timing", () => {
  test("strips ASS override blocks", () => {
    expect(stripAssTags("{\\k50}Hello {\\k30}world")).toBe("Hello world");
    expect(stripAssTags("{\\an8}Top text")).toBe("Top text");
    expect(stripAssTags("No tags here")).toBe("No tags here");
  });

  test("allocates word duration proportionally to length, not evenly", () => {
    const timings = computeKaraokeWordTimings("a bb ccc", 0, 6);
    expect(timings).toHaveLength(3);
    expect(timings[0].start).toBe(0);
    // weights: "a"+1=2, "bb"+1=3, "ccc"+1=4 -> total 9, duration 6
    expect(timings[0].end).toBeCloseTo((2 / 9) * 6);
    expect(timings[1].start).toBeCloseTo((2 / 9) * 6);
    expect(timings[1].end).toBeCloseTo((5 / 9) * 6);
    expect(timings[2].start).toBeCloseTo((5 / 9) * 6);
    // last word always closes exactly on the phrase end (no drift)
    expect(timings[2].end).toBe(6);
  });

  test("strips tags before splitting into words", () => {
    const timings = computeKaraokeWordTimings("{\\k50}Hi {\\k40}there", 0, 2);
    expect(timings.map((t) => t.word)).toEqual(["Hi", "there"]);
  });

  test("returns no timings for an empty or zero-duration phrase", () => {
    expect(computeKaraokeWordTimings("   ", 0, 5)).toEqual([]);
    expect(computeKaraokeWordTimings("word", 3, 3)).toEqual([]);
  });

  test("finds the active word index for a given time", () => {
    const timings = computeKaraokeWordTimings("one two three", 0, 3);
    expect(activeKaraokeWordIndex(timings, -1)).toBe(-1);
    expect(activeKaraokeWordIndex(timings, 0)).toBe(0);
    expect(activeKaraokeWordIndex(timings, 2.99)).toBe(2);
    expect(activeKaraokeWordIndex([], 1)).toBe(-1);
  });
});
