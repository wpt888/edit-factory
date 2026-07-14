import { useCallback, useRef, useState } from "react";

// Keep this aligned with the backend subtitle PlayResY/original_size reference.
export const SUBTITLE_REFERENCE_HEIGHT = 1920;

// CSS `font-size: Npx` renders glyphs ~1.44x larger than libass `FontSize=N`
// (different em mapping). Measured empirically: libass cap-height 26px at
// FontSize=107 in a 960px frame vs ~37.5px for the equivalent CSS overlay.
// Applies to font size only — outline/shadow px are plain proportional.
export const CSS_TO_LIBASS_FONT_RATIO = 0.695;

export function scaleSubtitlePx(
  px: number,
  containerHeightPx: number,
  min = 8
): number {
  return Math.max(min, px * (containerHeightPx / SUBTITLE_REFERENCE_HEIGHT));
}

export function scaleSubtitleFontPx(
  px: number,
  containerHeightPx: number,
  min = 8
): number {
  return scaleSubtitlePx(px * CSS_TO_LIBASS_FONT_RATIO, containerHeightPx, min);
}

export function observeSubtitlePreviewHeight(
  element: HTMLElement,
  onHeight: (height: number) => void
): () => void {
  const update = (height = element.getBoundingClientRect().height) => {
    if (Number.isFinite(height) && height > 0) onHeight(height);
  };

  update();
  const animationFrame = requestAnimationFrame(() => update());
  const observer = new ResizeObserver(([entry]) => {
    if (entry) update(entry.contentRect.height);
  });
  observer.observe(element);

  return () => {
    cancelAnimationFrame(animationFrame);
    observer.disconnect();
  };
}

export function useSubtitlePreviewHeight<T extends HTMLElement>() {
  const [height, setHeight] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Callback ref: observes whenever the element actually mounts (portal,
  // dialog, conditional render), independent of effect timing.
  const ref = useCallback((element: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!element) return;
    cleanupRef.current = observeSubtitlePreviewHeight(element, (nextHeight) => {
      setHeight((current) =>
        Math.abs(current - nextHeight) < 0.1 ? current : nextHeight
      );
    });
  }, []);

  return { ref, height };
}
