# Desktop startup and subtitle preview reliability

## Desktop startup

Electron must launch from an existing standalone frontend bundle. Development startup must not silently rebuild that bundle: production builds may require network access for `next/font`, and a failed prestart build prevents Electron from opening at all. Build the frontend explicitly with `npm run build` when the standalone bundle needs refreshing.

The development cache remains separated as `.next-dev`, while production standalone output remains under `.next/standalone` for Electron.

## Subtitle preview scaling

Subtitle values use a 1920-pixel reference height. Preview scaling must use the rendered container height, not an assumed or one-shot pre-layout value. `useSubtitlePreviewHeight` performs an immediate layout measurement, repeats it on the next animation frame, and subscribes with `ResizeObserver`. Both the subtitle style editor and timeline editor use this shared hook.

Regression coverage lives in `frontend/tests/subtitle-preview-scale.spec.ts` and verifies the first measurement and resize update.