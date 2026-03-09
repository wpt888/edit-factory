import { toast } from "sonner"

interface ApiResponse {
  tts_fallback?: string | null
  tts_fallback_reason?: string
  analysis_fallback?: string | null
  analysis_fallback_reason?: string
}

/**
 * Check an API response for fallback indicators and show info toasts.
 * Call this after any TTS or video processing API response.
 * Uses a dedup mechanism so the same fallback toast is only shown once per session.
 */
const _shownFallbacks = new Set<string>()

export function checkFallbacks(data: ApiResponse): void {
  if (data.tts_fallback === "edge_tts" && !_shownFallbacks.has("tts")) {
    _shownFallbacks.add("tts")
    toast.info("Using free Edge TTS", {
      description: data.tts_fallback_reason || "ElevenLabs API key not configured. Add one in Settings for premium voices.",
      duration: 6000,
    })
  }
  if (data.analysis_fallback === "local_scoring" && !_shownFallbacks.has("analysis")) {
    _shownFallbacks.add("analysis")
    toast.info("Using local video analysis", {
      description: data.analysis_fallback_reason || "Gemini API key not configured. Add one in Settings for AI-powered segment selection.",
      duration: 6000,
    })
  }
}

export function resetFallbackToasts(): void {
  _shownFallbacks.clear()
}
