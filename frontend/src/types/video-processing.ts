// Shared types for video processing across Home and Library pages

export interface SubtitleSettings {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
  positionY: number;
  position?: "top" | "center" | "bottom";
  marginV?: number;

  // Shadow effects (Phase 11 - SUB-01)
  shadowDepth?: number;        // 0-4, default 0 (disabled)
  shadowColor?: string;         // Hex color, default "#000000"
  borderStyle?: number;         // 1=outline+shadow, 3=box, default 1

  // Glow effects (Phase 11 - SUB-02)
  enableGlow?: boolean;         // Default false
  glowBlur?: number;            // 0-10, default 0 (disabled)

  // Adaptive sizing (Phase 11 - SUB-03)
  adaptiveSizing?: boolean;     // Default false
}

export interface SubtitleLine {
  id: number;
  start: string;
  end: string;
  text: string;
}

export interface Variant {
  variant_index: number;
  variant_name: string;
  final_video: string;
  selected: boolean;
  thumbnail?: string;
}

export interface SecondaryVideo {
  file: File | null;
  keywords: string;
}

export interface JobProgress {
  percentage: number;
  current_step: string;
  estimated_remaining: number;
}

export interface Job {
  job_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: string;
  error?: string;
  result?: {
    final_video?: string;
    variants?: Variant[];
    processed_videos?: ProcessedVideo[];
  };
}

export interface ProcessedVideo {
  status: string;
  output_path: string;
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  fps: number;
  aspect_ratio: string;
  is_vertical: boolean;
}

export interface ExportPreset {
  id: string;
  name: string;
  display_name: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  is_default: boolean;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: "draft" | "generating" | "ready_for_triage" | "processing_finals" | "completed" | "failed";
  target_duration: number;
  context_text?: string;
  created_at: string;
}

export interface Clip {
  id: string;
  project_id: string;
  variant_index: number;
  raw_video_path: string;
  thumbnail_path?: string;
  duration?: number;
  is_selected: boolean;
  final_video_path?: string;
  final_status?: "pending" | "processing" | "completed" | "failed";
  tts_text?: string;
  srt_content?: string;
  subtitle_settings?: SubtitleSettings;
}

export interface ClipContent {
  tts_text: string;
  srt_content: string;
  subtitle_settings: SubtitleSettings;
}

// Default values
export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  fontSize: 48,
  fontFamily: "var(--font-montserrat), Montserrat, sans-serif",
  textColor: "#FFFFFF",
  outlineColor: "#000000",
  outlineWidth: 3,
  positionY: 85,
  position: "bottom",
  marginV: 30,

  // Phase 11 defaults
  shadowDepth: 0,
  shadowColor: "#000000",
  borderStyle: 1,
  enableGlow: false,
  glowBlur: 0,
  adaptiveSizing: false,
};

export const FONT_OPTIONS = [
  { value: "var(--font-montserrat), Montserrat, sans-serif", label: "Montserrat" },
  { value: "var(--font-roboto), Roboto, sans-serif", label: "Roboto" },
  { value: "var(--font-oswald), Oswald, sans-serif", label: "Oswald" },
  { value: "var(--font-poppins), Poppins, sans-serif", label: "Poppins" },
  { value: "var(--font-bebas), 'Bebas Neue', sans-serif", label: "Bebas Neue" },
  { value: "var(--font-anton), Anton, sans-serif", label: "Anton" },
  { value: "var(--font-rubik), Rubik, sans-serif", label: "Rubik" },
  { value: "var(--font-nunito), Nunito, sans-serif", label: "Nunito" },
  { value: "var(--font-lato), Lato, sans-serif", label: "Lato" },
  { value: "var(--font-inter), Inter, sans-serif", label: "Inter" },
];

export const COLOR_PRESETS = [
  "#FFFFFF", // White
  "#000000", // Black
  "#FF0000", // Red
  "#00FF00", // Green
  "#0000FF", // Blue
  "#FFFF00", // Yellow
  "#FF00FF", // Magenta
  "#00FFFF", // Cyan
  "#FFA500", // Orange
  "#800080", // Purple
];
