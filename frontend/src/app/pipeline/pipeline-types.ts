import { SegmentOption } from "@/components/timeline-editor";
import { SubtitleSettings } from "@/types/video-processing";
import type { CompositionClip, MusicSettings, TransitionSpec } from "@/types/composition-timeline";

// TypeScript interfaces
export interface MatchPreview {
  srt_index: number;
  srt_text: string;
  srt_start: number;
  srt_end: number;
  segment_id: string | null;
  segment_keywords: string[];
  matched_keyword: string | null;
  confidence: number;
  duration_override?: number;
  is_auto_filled?: boolean;
  product_group?: string | null;
  source_video_id?: string;
  segment_start_time?: number;
  segment_end_time?: number;
  thumbnail_path?: string;
  merge_group?: number;
  merge_group_duration?: number;
  transforms?: Record<string, unknown> | null;
  explanation?: string;  // Human-readable reason this segment was assigned
  pinned?: boolean;  // User manually locked this assignment — assembly won't reassign it
}

export interface PreviewData {
  audio_duration: number;
  srt_content: string;
  matches: MatchPreview[];
  total_phrases: number;
  matched_count: number;
  unmatched_count: number;
  available_segments?: SegmentOption[];
  intro_offset_sec?: number;
  intro_segments?: Array<{ source_video_path?: string; source_video_id?: string; start_time: number; end_time: number; timeline_start: number; timeline_duration: number }>;
  video_timeline?: CompositionClip[];
  // P0 item 4: per-variant default transition (null/absent = hard cuts, the default).
  // Populated by the P1 Assembly Settings UI; resolved to concrete per-boundary
  // values via resolveCompositionTransitions() before any request is built.
  defaultTransition?: TransitionSpec | null;
  // A2 background music (null/absent = none). Persisted via the composition save.
  music?: MusicSettings | null;
  variety_warning?: {
    level: "low_variety";
    unique_clusters: number;
    slots: number;
    message: string;
  } | null;
}

export type PreviewKey = string;

export type AsyncJobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface AsyncJobState {
  status: AsyncJobStatus;
  progress: number;
  current_step: string;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  result?: Record<string, unknown>;
}

/**
 * StyleKey — discriminator for per-Meta-version subtitle style overrides.
 *
 * Subtitle style is now shared across all script variants under the same
 * Meta version (instead of being per-(script × version)). With Meta
 * Multiplication ON there are exactly two styles to pick: "A" (Instagram)
 * and "B" (Facebook). With Meta OFF there is just "default" — one style
 * shared by every variant. The backend PUT endpoint accepts only these
 * three values as override keys; anything else is rejected.
 */
export type StyleKey = "A" | "B" | "default";

export interface PreviewCard {
  key: PreviewKey;
  baseIndex: number;
  label: string;
  visualVersion?: string;
  metaPlatform?: string;
  script: string;
}

/**
 * Map a PreviewCard to the StyleKey that holds its subtitle override.
 * Cards with visualVersion "A" or "B" map to that letter; cards without a
 * visualVersion (Meta OFF path) map to "default".
 */
export const toStyleKey = (card: Pick<PreviewCard, "visualVersion">): StyleKey => {
  if (card.visualVersion === "A") return "A";
  if (card.visualVersion === "B") return "B";
  return "default";
};

export interface PipelineListItem {
  pipeline_id: string;
  name: string;
  idea: string;
  provider: string;
  variant_count: number;
  keyword_count: number;
  created_at: string;
  target_script_duration?: number | null;
  generation_job?: Partial<AsyncJobState>;
}

export interface VariantStatus {
  variant_index: number;
  status: "not_started" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  current_step: string;
  final_video_path?: string;
  thumbnail_path?: string;
  clip_id?: string;
  error?: string;
  library_saved?: boolean;
  library_error?: string;
  render_fingerprint?: string;
  visual_version?: string;
  meta_platform?: string;
  queue_position?: number;
  eta_seconds?: number;
}

export interface VariantPreviewInfo {
  has_audio: boolean;
  audio_duration: number;
  has_srt: boolean;
}

export interface PipelineScriptsResponse {
  pipeline_id: string;
  scripts: string[];
  script_names?: string[];
  context_products?: ContextProduct[];
  preview_info?: Record<string, { has_audio: boolean; audio_duration: number; has_srt?: boolean }>;
  tts_info?: Record<string, {
    has_audio: boolean;
    audio_duration: number;
    approved?: boolean;
    srt_content?: string;
    script_word_count?: number;
    srt_word_count?: number;
  }>;
  captions?: Record<string, string[]>;
  selected_captions?: Record<string, string>;
  name?: string;
  idea?: string;
  context?: string;
  provider?: string;
  codex_model?: string | null;
  variant_count?: number;
  meta_multiplication?: boolean;
  attention_selection?: { templateId?: string; assetUrls?: string[]; staggerSeconds?: number; maxVariants?: number };
  template_settings?: import("./pipeline-template").PipelineTemplateSettings | Record<string, never>;
  library_project_id?: string | null;
  generation_job?: Partial<AsyncJobState>;
  tts_jobs?: Record<string, Partial<AsyncJobState>>;
}

export interface CatalogProduct {
  id: string;
  title: string;
  description: string;
  brand: string;
  sku: string;
  image_link: string;
  category: string;
  price: number;
  sale_price: number;
  is_on_sale: boolean;
  image_urls?: string[];
  product_url?: string;
  extra_fields?: Record<string, unknown>;
}

export interface CatalogPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface Voice {
  voice_id: string;
  name: string;
  language?: string;
  category?: string;
  preview_url?: string | null;
}

export interface ContextProduct {
  product_id?: string;
  title: string;
  description: string;
  images?: string[];
  brand?: string;
  category?: string;
  sku?: string;
  price?: string;
  sale_price?: string;
  product_url?: string;
  extra_fields?: Record<string, unknown>;
}

export const META_SUBTITLE_STYLE_BY_VERSION: Record<string, Partial<SubtitleSettings>> = {
  A: {
    textColor: "#FF0000",
    outlineColor: "#FFFFFF",
    outlineWidth: 3,
    shadowDepth: 2,
    enableGlow: false,
    glowBlur: 0,
    opacity: 100,
  },
  B: {
    textColor: "#FFFFFF",
    outlineColor: "#FF0000",
    outlineWidth: 4,
    shadowDepth: 0,
    enableGlow: true,
    glowBlur: 3,
    opacity: 100,
  },
};
