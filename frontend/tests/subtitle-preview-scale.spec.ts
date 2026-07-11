import { expect, test } from "@playwright/test";

import {
  scaleSubtitlePx,
  SUBTITLE_REFERENCE_HEIGHT,
} from "../src/lib/subtitle-preview-scale";

test.describe("subtitle preview scaling", () => {
  test("scales subtitle measurements proportionally to container height", () => {
    const compactHeight = SUBTITLE_REFERENCE_HEIGHT / 6;

    expect(scaleSubtitlePx(108, compactHeight)).toBe(18);
    expect(scaleSubtitlePx(9, compactHeight)).toBe(1.5);
    expect(scaleSubtitlePx(12, compactHeight)).toBe(2);
    expect(scaleSubtitlePx(24, compactHeight)).toBe(4);
  });

  test("supports an explicit reference height", () => {
    expect(scaleSubtitlePx(50, 500, 1000)).toBe(25);
  });
});
