// Shared types for library components

// Config persistence key
export const CONFIG_KEY = "editai_library_config";

// Helper to load config from localStorage
export const loadConfig = () => {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

// Helper to save config to localStorage
export const saveConfig = (config: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  try {
    const existing = loadConfig() || {};
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...existing, ...config }));
  } catch {
    // Ignore errors
  }
};

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  target_duration: number;
  context_text?: string;
  variants_count: number;
  selected_count: number;
  exported_count: number;
  created_at: string;
}

export interface Clip {
  id: string;
  project_id: string;
  variant_index: number;
  variant_name?: string;
  raw_video_path: string;
  thumbnail_path?: string;
  duration?: number;
  is_selected: boolean;
  is_deleted: boolean;
  final_video_path?: string;
  final_status: string;
  created_at: string;
  // Postiz publishing status
  postiz_status?: "not_sent" | "scheduled" | "sent";
  postiz_post_id?: string;
  postiz_scheduled_at?: string;
}

export interface ClipContent {
  id?: string;
  clip_id: string;
  tts_text?: string;
  srt_content?: string;
  subtitle_settings?: SubtitleSettings;
}

export interface SubtitleSettings {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
  positionY: number;

  // Shadow effects (Phase 11 - SUB-01)
  shadowDepth?: number;
  shadowColor?: string;
  borderStyle?: number;

  // Glow effects (Phase 11 - SUB-02)
  enableGlow?: boolean;
  glowBlur?: number;

  // Adaptive sizing (Phase 11 - SUB-03)
  adaptiveSizing?: boolean;
}

export interface ExportPreset {
  id: string;
  name: string;
  display_name: string;
  width: number;
  height: number;
  fps: number;
  video_bitrate: string;
  crf: number;
  audio_bitrate: string;
  is_default: boolean;
}

// Segment types
export interface SourceVideo {
  id: string;
  name: string;
  description?: string;
  file_path: string;
  thumbnail_path?: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  segments_count: number;
  created_at: string;
}

export interface Segment {
  id: string;
  source_video_id: string;
  start_time: number;
  end_time: number;
  duration: number;
  keywords: string[];
  extracted_video_path?: string;
  thumbnail_path?: string;
  usage_count: number;
  is_favorite: boolean;
  notes?: string;
  created_at: string;
  source_video_name?: string;
}

export interface PostizIntegration {
  id: string;
  name: string;
  type: string;
  identifier?: string;
  picture?: string;
  disabled: boolean;
}
