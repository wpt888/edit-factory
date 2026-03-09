/**
 * Pipeline Simple Mode — Style Presets & Types
 *
 * Data contracts for the simplified 3-step pipeline mode.
 * Style presets map user-friendly names to backend processing parameters.
 * Preset IDs MUST match the backend definitions in app/services/pipeline_presets.py.
 */

export type PipelineMode = "simple" | "advanced";

export interface StylePresetParams {
  variant_count: number;
  voice_speed: number;
  voice_stability: number;
  voice_similarity: number;
  words_per_subtitle: number;
  min_segment_duration: number;
  ultra_rapid_intro: boolean;
  elevenlabs_model: string;
  preset_name: string;
}

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  params: StylePresetParams;
}

export interface SimpleModeState {
  mode: PipelineMode;
  selectedPreset: string | null;
  uploadedFile: File | null;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "energetic_short",
    name: "Energetic Short",
    description: "Fast-paced, high-energy clips perfect for TikTok and Reels",
    icon: "zap",
    params: {
      variant_count: 3,
      voice_speed: 1.2,
      voice_stability: 0.4,
      voice_similarity: 0.75,
      words_per_subtitle: 2,
      min_segment_duration: 2,
      ultra_rapid_intro: true,
      elevenlabs_model: "eleven_multilingual_v2",
      preset_name: "TikTok",
    },
  },
  {
    id: "product_showcase",
    name: "Product Showcase",
    description: "Steady, professional presentation for product highlights",
    icon: "package",
    params: {
      variant_count: 2,
      voice_speed: 1.0,
      voice_stability: 0.6,
      voice_similarity: 0.8,
      words_per_subtitle: 3,
      min_segment_duration: 4,
      ultra_rapid_intro: false,
      elevenlabs_model: "eleven_multilingual_v2",
      preset_name: "YouTube_Shorts",
    },
  },
  {
    id: "calm_narration",
    name: "Calm Narration",
    description: "Slow, warm voice with relaxed pacing for storytelling",
    icon: "mic",
    params: {
      variant_count: 2,
      voice_speed: 0.9,
      voice_stability: 0.7,
      voice_similarity: 0.85,
      words_per_subtitle: 4,
      min_segment_duration: 5,
      ultra_rapid_intro: false,
      elevenlabs_model: "eleven_multilingual_v2",
      preset_name: "YouTube_Shorts",
    },
  },
  {
    id: "quick_demo",
    name: "Quick Demo",
    description: "Punchy, tutorial-style clips that get to the point fast",
    icon: "film",
    params: {
      variant_count: 2,
      voice_speed: 1.1,
      voice_stability: 0.5,
      voice_similarity: 0.75,
      words_per_subtitle: 2,
      min_segment_duration: 3,
      ultra_rapid_intro: true,
      elevenlabs_model: "eleven_multilingual_v2",
      preset_name: "TikTok",
    },
  },
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Dramatic, slow-build sequences with polished delivery",
    icon: "sparkles",
    params: {
      variant_count: 2,
      voice_speed: 0.85,
      voice_stability: 0.8,
      voice_similarity: 0.9,
      words_per_subtitle: 3,
      min_segment_duration: 6,
      ultra_rapid_intro: false,
      elevenlabs_model: "eleven_multilingual_v2",
      preset_name: "YouTube_Shorts",
    },
  },
];
