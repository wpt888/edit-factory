import { expect, test } from "@playwright/test";

import {
  observeSubtitlePreviewHeight,
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

  test("measures first-paint layout and reacts to resizing", () => {
    const callbacks: ResizeObserverCallback[] = [];
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;

    try {
      const heights: number[] = [];
      const element = { getBoundingClientRect: () => ({ height: 320 }) } as HTMLElement;
      const cleanup = observeSubtitlePreviewHeight(element, (height) => heights.push(height));
      expect(heights).toEqual([320]);
      callbacks[0]([{ contentRect: { height: 480 } } as ResizeObserverEntry], {} as ResizeObserver);
      expect(heights).toEqual([320, 480]);
      cleanup();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
});
