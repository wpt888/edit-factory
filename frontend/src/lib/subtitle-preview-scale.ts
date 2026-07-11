import { useLayoutEffect, useRef, useState } from "react";

// Keep this aligned with the backend subtitle PlayResY/original_size reference.
export const SUBTITLE_REFERENCE_HEIGHT = 1920;

export function scaleSubtitlePx(
  px: number,
  containerHeightPx: number,
  referenceHeightPx = SUBTITLE_REFERENCE_HEIGHT
): number {
  return px * (containerHeightPx / referenceHeightPx);
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

export function useSubtitlePreviewHeight<T extends HTMLElement>(
  enabled = true,
  layoutKey?: unknown
) {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    return observeSubtitlePreviewHeight(ref.current, (nextHeight) => {
      setHeight((current) =>
        Math.abs(current - nextHeight) < 0.1 ? current : nextHeight
      );
    });
  }, [enabled, layoutKey]);

  return { ref, height };
}
