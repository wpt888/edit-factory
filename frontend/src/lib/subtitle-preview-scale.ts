import { useCallback, useRef, useState } from "react";

// Keep this aligned with the backend subtitle PlayResY/original_size reference.
export const SUBTITLE_REFERENCE_HEIGHT = 1920;

export function scaleSubtitlePx(
  px: number,
  containerHeightPx: number,
  min = 8
): number {
  return Math.max(min, px * (containerHeightPx / SUBTITLE_REFERENCE_HEIGHT));
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
