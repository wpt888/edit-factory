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
import type {
  CompositionClip,
  MusicSettings,
  TransitionSpec,
} from "@/types/composition-timeline";
import type { SubtitleSettings } from "@/types/video-processing";
import type { SubtitleTemplateRotation } from "./subtitle-template-rotation";
import type { ContextProduct, MatchPreview, OutputId, PreviewKey, ScriptId, StyleKey } from "./pipeline-types";

export const PIPELINE_TEMPLATE_FORMAT = "edit-factory.pipeline-template" as const;
export const PIPELINE_TEMPLATE_SCHEMA_VERSION = 1 as const;

export interface PipelineTemplateSettings {
  snapshot?: {
    revision: number;
    savedAt: string;
  };
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
    scripts: Array<{ id?: ScriptId; name: string; text: string }>;
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
    selectedOutputIds?: OutputId[];
    activeOutputId?: OutputId | null;
    matches: Record<PreviewKey, MatchPreview[]>;
    compositions: Record<PreviewKey, CompositionClip[]>;
    defaultTransitions: Record<PreviewKey, TransitionSpec | null>;
    music: Record<PreviewKey, MusicSettings | null>;
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
    variantTemplates?: Partial<Record<PreviewKey, string>>;
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
  script_ids?: ScriptId[];
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

const asRecord = <T>(value: unknown): Record<string, T> => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, T>
    : {}
);

/**
 * Upgrade schema-v1 snapshots written before all timeline/output maps existed.
 * The format version stayed at 1 while these fields were added, so section-only
 * guards are insufficient for safe restore.
 */
export function normalizePipelineTemplateSettings(
  value: unknown,
): PipelineTemplateSettings | null {
  if (!isPipelineTemplateSettings(value)) return null;
  const timeline = value.timeline as Partial<PipelineTemplateSettings["timeline"]>;
  const subtitles = value.subtitles as Partial<PipelineTemplateSettings["subtitles"]>;
  return {
    ...value,
    timeline: {
      ...timeline,
      selectedVariantIndices: Array.isArray(timeline.selectedVariantIndices)
        ? timeline.selectedVariantIndices
        : [],
      selectedOutputIds: Array.isArray(timeline.selectedOutputIds)
        ? timeline.selectedOutputIds
        : [],
      activeOutputId: timeline.activeOutputId ?? null,
      matches: asRecord<MatchPreview[]>(timeline.matches),
      compositions: asRecord<CompositionClip[]>(timeline.compositions),
      defaultTransitions: asRecord<TransitionSpec | null>(
        timeline.defaultTransitions,
      ),
      music: asRecord<MusicSettings | null>(timeline.music),
      interstitialSlides: asRecord<InterstitialSlide[]>(
        timeline.interstitialSlides,
      ),
      attentionSelection: timeline.attentionSelection ?? {},
      attentionTimelines: asRecord<AttentionTimeline>(
        timeline.attentionTimelines,
      ),
      variantThumbnails: asRecord<ThumbnailSelection>(
        timeline.variantThumbnails,
      ),
      pipOverlays: asRecord<{
        image_url: string;
        position: string;
        size: string;
        animation: string;
      }>(timeline.pipOverlays),
    },
    subtitles: {
      ...subtitles,
      default: subtitles.default ?? {} as SubtitleSettings,
      overrides: asRecord<SubtitleSettings>(subtitles.overrides),
      variantOverrides: asRecord<Partial<SubtitleSettings>>(
        subtitles.variantOverrides,
      ),
      rotation: subtitles.rotation ?? {
        enabled: false,
        presetIds: [],
      },
      variantTemplates: asRecord<string>(subtitles.variantTemplates),
    },
  } as PipelineTemplateSettings;
}

export function pipelineTemplateFilename(name: string): string {
  const safe = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "pipeline";
  return `${safe}.pipeline-template.json`;
}
