// Keep this aligned with the backend subtitle PlayResY/original_size reference.
export const SUBTITLE_REFERENCE_HEIGHT = 1920;

export function scaleSubtitlePx(
  px: number,
  containerHeightPx: number,
  referenceHeightPx = SUBTITLE_REFERENCE_HEIGHT
): number {
  return px * (containerHeightPx / referenceHeightPx);
}
