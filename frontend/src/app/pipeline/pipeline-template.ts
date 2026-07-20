/**
 * Complete pipeline-template contract.
 *
 * MAINTENANCE RULE: every new user-configurable pipeline setting must be added
 * here and to the capture/apply functions in page.tsx. Keeping the contract in
 * one place makes omissions visible in TypeScript review and preserves unknown
 * future fields in the backend JSON envelope.
 */
import type { InterstitialSlide } from "@/components/timeline-editor";
import type { ThumbnailSelection } from "@/components/thumbnail-picker";
import type { RenderAdjustments, RenderSettings } from "@/components/render-settings-panel";
import type { AttentionSelection } from "@/components/attention-template-picker";
import type { AttentionTimeline } from "@/types/attention-timeline";
import type { CompositionClip } from "@/types/composition-timeline";
import type { SubtitleSettings } from "@/types/video-processing";
import type { SubtitleTemplateRotation } from "./subtitle-template-rotation";
import type { ContextProduct, MatchPreview, PreviewKey, StyleKey } from "./pipeline-types";

export const PIPELINE_TEMPLATE_FORMAT = "edit-factory.pipeline-template" as const;
export const PIPELINE_TEMPLATE_SCHEMA_VERSION = 1 as const;

export interface PipelineTemplateSettings {
  generation: {
    name: string;
    idea: string;
    context: string;
    contextProducts: ContextProduct[];
    variantCount: number;
    targetScriptDuration: number;
    provider: string;
    codexModel: string;
    aiInstructions: string;
  };
  content: {
    scripts: Array<{ name: string; text: string }>;
    approvedScriptIndices: number[];
    generatedCaptions: Record<string, string>;
    generatedYoutubeTitles: Record<string, string>;
  };
  voice: {
    model: string;
    voice: { id: string; name: string };
    stability: number;
    similarity: number;
    style: number;
    speed: number;
    speakerBoost: boolean;
    wordsPerSubtitle: number;
  };
  assembly: {
    minSegmentDuration: number;
    ultraRapidIntro: boolean;
    preset: "keyword_strict" | "balanced" | "max_variety" | "shuffle" | "ai_smart";
    segmentProximity: "separate" | "merge";
    sourceVideos: Array<{ id: string; name: string }>;
    unresolvedSourceVideos?: Array<{ id: string; name: string }>;
  };
  timeline: {
    selectedVariantIndices: number[];
    matches: Record<PreviewKey, MatchPreview[]>;
    compositions: Record<PreviewKey, CompositionClip[]>;
    interstitialSlides: Record<PreviewKey, InterstitialSlide[]>;
    attentionSelection: AttentionSelection;
    attentionTimelines: Record<PreviewKey, AttentionTimeline>;
    variantThumbnails: Record<PreviewKey, ThumbnailSelection>;
    pipOverlays: Record<string, {
      image_url: string;
      position: string;
      size: string;
      animation: string;
    }>;
  };
  subtitles: {
    default: SubtitleSettings;
    overrides: Partial<Record<StyleKey, SubtitleSettings>>;
    variantOverrides?: Partial<Record<PreviewKey, Partial<SubtitleSettings>>>;
    rotation: SubtitleTemplateRotation;
  };
  render: {
    presetName: string;
    encoding: RenderSettings;
    adjustments: RenderAdjustments;
    metaMultiplication: boolean;
  };
}

export interface PipelineTemplateDocument {
  format: typeof PIPELINE_TEMPLATE_FORMAT;
  schemaVersion: typeof PIPELINE_TEMPLATE_SCHEMA_VERSION;
  exportedAt: string;
  application: { name: string; version: string };
  source: { pipelineId: string; name: string };
  settings: PipelineTemplateSettings;
  checksum: { algorithm: "sha256"; value: string };
}

export interface PipelineTemplateImportResponse {
  pipeline_id: string;
  settings: PipelineTemplateSettings;
  scripts: string[];
  script_names: string[];
  warnings: string[];
}

const REQUIRED_SECTIONS: Array<keyof PipelineTemplateSettings> = [
  "generation",
  "content",
  "voice",
  "assembly",
  "timeline",
  "subtitles",
  "render",
];

export function isPipelineTemplateSettings(value: unknown): value is PipelineTemplateSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return REQUIRED_SECTIONS.every((section) => {
    const candidate = record[section];
    return !!candidate && typeof candidate === "object" && !Array.isArray(candidate);
  });
}

export function pipelineTemplateFilename(name: string): string {
  const safe = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "pipeline";
  return `${safe}.pipeline-template.json`;
}
