export type ScriptAiProvider = "gemini" | "claude" | "codex";

export const DEFAULT_CODEX_MODEL = "gpt-5.4-mini";
export const DESKTOP_CODEX_AVAILABLE =
  process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";
export const DEFAULT_SCRIPT_AI_PROVIDER: ScriptAiProvider =
  DESKTOP_CODEX_AVAILABLE ? "codex" : "gemini";

export function normalizeScriptAiProvider(value: unknown): ScriptAiProvider {
  if (value === "claude") return "claude";
  if (value === "codex" && DESKTOP_CODEX_AVAILABLE) return "codex";
  return "gemini";
}
