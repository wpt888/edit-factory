import type { OutputId, PreviewKey, ScriptId } from "./pipeline-types";

const PREVIEW_KEY = /^(\d+)(?:_([A-J]))?$/;
const SCRIPT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;

export function createScriptId(): ScriptId {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `script_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  return `script_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export function ensureScriptIds(
  values: readonly string[] | undefined,
  count: number,
): ScriptId[] {
  const used = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const candidate = values?.[index] ?? "";
    if (SCRIPT_ID.test(candidate) && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    let generated = createScriptId();
    while (used.has(generated)) generated = createScriptId();
    used.add(generated);
    return generated;
  });
}

export function buildOutputId(
  scriptId: ScriptId,
  visualVersion?: string,
): OutputId {
  return `${scriptId}:${visualVersion || "default"}`;
}

export function outputBelongsToScript(
  outputId: OutputId,
  scriptId: ScriptId,
): boolean {
  return outputId.startsWith(`${scriptId}:`);
}

export function parseOutputId(outputId: OutputId): {
  scriptId: ScriptId;
  visualVersion?: string;
} | null {
  const separator = outputId.lastIndexOf(":");
  if (separator <= 0) return null;
  const scriptId = outputId.slice(0, separator);
  const version = outputId.slice(separator + 1);
  if (!SCRIPT_ID.test(scriptId) || !/^(?:default|[A-J])$/.test(version)) return null;
  return {
    scriptId,
    visualVersion: version === "default" ? undefined : version,
  };
}

export function remapPreviewRecord<T>(
  record: Partial<Record<PreviewKey, T>>,
  oldScriptIds: readonly ScriptId[],
  newScriptIds: readonly ScriptId[],
): Partial<Record<PreviewKey, T>> {
  const newIndexById = new Map(
    newScriptIds.map((scriptId, index) => [scriptId, index]),
  );
  const next: Partial<Record<PreviewKey, T>> = {};
  for (const [rawKey, value] of Object.entries(record)) {
    const match = rawKey.match(PREVIEW_KEY);
    if (!match) {
      next[rawKey] = value;
      continue;
    }
    const oldIndex = Number(match[1]);
    const scriptId = oldScriptIds[oldIndex];
    if (!scriptId) {
      next[rawKey] = value;
      continue;
    }
    const newIndex = newIndexById.get(scriptId);
    if (newIndex === undefined) continue;
    const suffix = match[2] ? `_${match[2]}` : "";
    next[`${newIndex}${suffix}`] = value;
  }
  return next;
}
