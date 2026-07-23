import { expect, test } from "@playwright/test";

import {
  beginImportedTemplateTimelineBatch,
  shouldRestoreImportedTemplateTimeline,
} from "../src/app/pipeline/pipeline-template-timeline";

test("stored previews do not re-arm imported timeline bindings", () => {
  expect(shouldRestoreImportedTemplateTimeline({
    "0": { has_audio: true, audio_duration: 4 },
  })).toBe(false);
  expect(shouldRestoreImportedTemplateTimeline({})).toBe(true);
  expect(shouldRestoreImportedTemplateTimeline(undefined)).toBe(true);
});

test("template timeline bindings are consumed after one successful preview batch", () => {
  const imported = { compositions: { "0": ["template-clip"] } };
  const ref: { current: typeof imported | null } = { current: imported };
  const batch = beginImportedTemplateTimelineBatch(ref);

  expect(batch.timeline).toBe(imported);
  expect(batch.timeline?.compositions["0"]).toEqual(["template-clip"]);
  expect(ref.current).toBe(imported);

  batch.commit();
  expect(ref.current).toBeNull();
});

test("finishing an older batch preserves a newer template import", () => {
  const first = { id: "first" };
  const second = { id: "second" };
  const ref: { current: typeof first | null } = { current: first };
  const batch = beginImportedTemplateTimelineBatch(ref);

  ref.current = second;
  batch.commit();

  expect(ref.current).toBe(second);
});
