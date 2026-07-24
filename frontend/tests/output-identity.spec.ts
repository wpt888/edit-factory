import { expect, test } from "@playwright/test";

import {
  buildOutputId,
  ensureScriptIds,
  outputBelongsToScript,
  parseOutputId,
  remapPreviewRecord,
} from "../src/app/pipeline/output-identity";
import type { ScriptId } from "../src/app/pipeline/pipeline-types";
import {
  normalizePipelineTemplateSettings,
} from "../src/app/pipeline/pipeline-template";


test("output identity survives index changes and keeps A/B distinct", () => {
  const first = "script_11111111" as ScriptId;
  const removed = "script_22222222" as ScriptId;
  const last = "script_33333333" as ScriptId;

  expect(remapPreviewRecord(
    {
      "0_A": "first-a",
      "1_B": "removed-b",
      "2_A": "last-a",
      "2_B": "last-b",
    },
    [first, removed, last],
    [first, last],
  )).toEqual({
    "0_A": "first-a",
    "1_A": "last-a",
    "1_B": "last-b",
  });

  const outputA = buildOutputId(last, "A");
  const outputB = buildOutputId(last, "B");
  expect(outputA).not.toBe(outputB);
  expect(outputBelongsToScript(outputA, last)).toBe(true);
  expect(parseOutputId(outputB)).toEqual({ scriptId: last, visualVersion: "B" });
});


test("invalid, duplicate, and missing script IDs are replaced", () => {
  const values = ensureScriptIds(
    ["script_11111111", "script_11111111", "bad"],
    3,
  );

  expect(values[0]).toBe("script_11111111");
  expect(new Set(values).size).toBe(3);
  expect(values.every((value) => value.startsWith("script_"))).toBe(true);
});


test("legacy snapshots receive every timeline map before restore", () => {
  const normalized = normalizePipelineTemplateSettings({
    generation: {},
    content: {},
    voice: {},
    assembly: {},
    timeline: {
      selectedVariantIndices: [0],
    },
    subtitles: {},
    render: {},
  });

  expect(normalized).not.toBeNull();
  expect(normalized?.timeline.matches).toEqual({});
  expect(normalized?.timeline.compositions).toEqual({});
  expect(normalized?.timeline.defaultTransitions).toEqual({});
  expect(normalized?.timeline.music).toEqual({});
  expect(normalized?.subtitles.rotation).toEqual({
    enabled: false,
    presetIds: [],
  });
});
