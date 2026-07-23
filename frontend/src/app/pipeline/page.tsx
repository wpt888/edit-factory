"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { apiGet, apiGetWithRetry, apiPost, apiPut, apiPatch, apiDelete, API_URL, handleApiError, ApiError } from "@/lib/api";
import {
  Loader2,
} from "lucide-react";
import { usePolling } from "@/hooks";
import { useLocalStorageConfig } from "@/hooks/use-local-storage-config";
import { useProfile } from "@/contexts/profile-context";
import { useUndo } from "@/contexts/undo-context";
import { toast } from "sonner";
import { getCachedSourceVideos } from "@/lib/source-video-cache";
import {
  DEFAULT_PIPELINE_LAYOUT,
  PIPELINE_LAYOUT_STORAGE_KEY,
  type PipelineLayoutMode,
} from "@/lib/pipeline-layout";
import {
  readWorkspaceStorage,
  removeWorkspaceStorage,
  writeWorkspaceStorage,
} from "@/lib/workspace-session";
import { PublishDialog } from "@/components/dialogs/publish-dialog";
import { WorkspaceSplit } from "./components/workspace-split";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { ProductPickerDialog } from "@/components/dialogs/product-picker-dialog";
import { ImagePickerDialog } from "@/components/dialogs/image-picker-dialog";
import type { AssociationResponse } from "@/components/dialogs/product-picker-dialog";
import {
  SubtitleSettings,
  DEFAULT_SUBTITLE_SETTINGS,
  UserSubtitlePreset,
  type UserSubtitleTemplate,
} from "@/types/video-processing";
import { SegmentOption, InterstitialSlide } from "@/components/timeline-editor";
import { ThumbnailSelection } from "@/components/thumbnail-picker";
import { DEFAULT_RENDER_SETTINGS } from "@/components/render-settings-panel";
import { RenderCheckResult } from "@/components/dialogs/skip-render-dialog";
import type { RenderAdjustments, RenderSettings } from "@/components/render-settings-panel";
import type { AttentionTimeline } from "@/types/attention-timeline";
import { EMPTY_ATTENTION_SELECTION, normalizeAttentionSelection, type AttentionSelection } from "@/components/attention-template-picker";
import type { CompositionClip, MusicSettings, TransitionSpec } from "@/types/composition-timeline";
import { resolveCompositionTransitions } from "@/types/composition-timeline";
import {
  MatchPreview,
  PreviewData,
  PreviewKey,
  StyleKey,
  toStyleKey,
  PreviewCard,
  PipelineListItem,
  VariantStatus,
  VariantPreviewInfo,
  PipelineScriptsResponse,
  CatalogProduct,
  CatalogPagination,
  Voice,
  ContextProduct,
  AsyncJobState,
  META_SUBTITLE_STYLE_BY_VERSION,
} from "./pipeline-types";
import {
  isPipelineTemplateSettings,
  pipelineTemplateFilename,
  type PipelineTemplateDocument,
  type PipelineTemplateImportResponse,
  type PipelineTemplateSettings,
} from "./pipeline-template";
import {
  beginImportedTemplateTimelineBatch,
  shouldRestoreImportedTemplateTimeline,
} from "./pipeline-template-timeline";
import {
  EMPTY_SUBTITLE_TEMPLATE_ROTATION,
  resolveRotatedSubtitleSettings,
  subtitleSettingsDiff,
  wordsPerSubtitleForVariant,
  type SubtitleTemplateRotation,
  type VariantTemplateSelections,
} from "./subtitle-template-rotation";
import { PipelineErrorBoundary } from "./components/pipeline-error-boundary";
import { Step1Script } from "./components/step1-script";
import { Step2TTS } from "./components/step2-tts";
import { Step3Preview } from "./components/step3-preview";
import { Step3Export } from "./components/step3-export";
import { Step4Render } from "./components/step4-render";
import { PipelineStepper } from "./components/pipeline-stepper";
import { PipelineHistorySidebar } from "./components/pipeline-history-sidebar";
import {
  buildAttentionTemplateApplyPayload,
  type AttentionTemplateApplyResult,
} from "./attention-template-apply";
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_SCRIPT_AI_PROVIDER,
  DESKTOP_CODEX_AVAILABLE,
  normalizeScriptAiProvider,
  type ScriptAiProvider,
} from "@/lib/script-ai";

// D1: the segment↔product association picker is keyed on Gomag catalog product
// IDs. With the Gomag catalog gated off (default) it has no products to show, so
// gate its entry behind the same flag as /products. Migrating associations to the
// local library is a separate feature (still OUT).
const CATALOG_ENABLED = process.env.NEXT_PUBLIC_CATALOG_GOMAG === "true";

// Persist enough to survive route unmount (clicking away in the left nav).
// The pointer lets us reuse the existing backend restore path (?id=); the draft
// covers Step-1 text typed before a pipeline id exists yet.
const PIPELINE_SESSION_KEY = "pipeline.session"; // { pipelineId, step }
const PIPELINE_DRAFT_KEY = "pipeline.draft"; // { pipelineName, idea, context, variantCount, provider, codexModel, targetScriptDuration }
const LEGACY_PIPELINE_SESSION_KEY = "ef_pipeline_session";
const LEGACY_PIPELINE_DRAFT_KEY = "ef_pipeline_draft";

const defaultScriptNames = (count: number) =>
  Array.from({ length: count }, (_, index) => `Script ${index + 1}`);

const createScriptSetName = (idea: string): string => {
  const firstWords = idea.trim().split(/\s+/).filter(Boolean).slice(0, 7).join(" ");
  return firstWords.replace(/[.,;:!?]+$/, "").slice(0, 80) || "Untitled script set";
};

type TtsResult = {
  audio_duration: number;
  generating: boolean;
  stale: boolean;
  status?: AsyncJobState["status"];
  progress?: number;
  current_step?: string;
  error?: string | null;
  srt_content?: string;
  script_word_count?: number;
  srt_word_count?: number;
};

const isActiveAsyncJob = (job?: Partial<AsyncJobState> | null) =>
  job?.status === "queued" || job?.status === "processing";

export default function PipelinePageWrapper() {
  return (
    <PipelineErrorBoundary>
      <Suspense fallback={<div className="flex items-center justify-center min-h-full"><Loader2 className="size-8 animate-spin" /></div>}>
        <PipelinePage />
      </Suspense>
    </PipelineErrorBoundary>
  );
}

function PipelinePage() {
  const [pipelineLayout] = useLocalStorageConfig<PipelineLayoutMode>(
    PIPELINE_LAYOUT_STORAGE_KEY,
    DEFAULT_PIPELINE_LAYOUT,
  );
  const { currentProfile } = useProfile();
  const { pushAction, clearHistory } = useUndo();
  // Ref to avoid stale closure in debounced setTimeout callbacks
  const currentProfileIdRef = useRef(currentProfile?.id);
  currentProfileIdRef.current = currentProfile?.id;

  // Stable callback for VariantPreviewPlayer close
  const handlePreviewPlayerClose = useCallback((open: boolean) => {
    if (!open) setPreviewVariant(null);
  }, []);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Step tracking — synced with URL ?step=N
  const [step, setStepRaw] = useState(() => {
    const param = searchParams.get("step");
    const n = param ? parseInt(param, 10) : NaN;
    return n >= 1 && n <= 4 ? n : 1;
  });
  const [step3Mode, setStep3Mode] = useState<"edit" | "export">("edit");

  // Pipeline ID from URL — used for restoring session on page load
  const urlPipelineId = searchParams.get("id");

  // Helper: update URL params (step + pipeline id) without full navigation
  const updateUrlParams = useCallback((stepNum: number, pid: string | null) => {
    const params = new URLSearchParams();
    params.set("step", String(stepNum));
    if (pid) params.set("id", pid);
    const nextQuery = params.toString();

    // Avoid navigating to the URL that is already active. In the desktop
    // standalone build, a same-URL replace remounts this page, which runs the
    // pipelineId sync effect again and creates an endless navigation loop.
    if (searchParams.toString() === nextQuery) return;

    router.replace(`${pathname}?${nextQuery}`, { scroll: false });
  }, [router, pathname, searchParams]);

  // BUG-FE-33: searchParams in deps ensures URL stays in sync; stale closure risk is
  // mitigated because searchParams is read synchronously within the callback.
  const setStep = useCallback((n: number) => {
    setStepRaw(n);
    updateUrlParams(n, pipelineIdRef.current);
  }, [updateUrlParams]);

  // Step 1: Input
  const [pipelineName, setPipelineName] = useState("");
  const [idea, setIdea] = useState("");
  const [context, setContext] = useState("");
  const [contextProducts, setContextProducts] = useState<ContextProduct[]>([]);
  const [variantCount, setVariantCount] = useState(3);
  const [targetScriptDuration, setTargetScriptDuration] = useState(30);
  const [provider, setProviderState] = useState<ScriptAiProvider>(
    DEFAULT_SCRIPT_AI_PROVIDER,
  );
  const setProvider = useCallback((value: string) => {
    setProviderState(normalizeScriptAiProvider(value));
  }, []);
  const [codexModel, setCodexModel] = useState(DEFAULT_CODEX_MODEL);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationJob, setGenerationJob] = useState<Partial<AsyncJobState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiRulesExpanded, setAiRulesExpanded] = useState(false);
  const [aiRulesSaved, setAiRulesSaved] = useState(false);
  const [aiRulesDirty, setAiRulesDirty] = useState(false);
  const aiInstructionsSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const aiRulesSavedResetTimer = useRef<NodeJS.Timeout | null>(null);

  // Step 2: Scripts
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  useEffect(() => {
    // Query-string navigation can swap pipelines without changing pathname.
    // Never let an undo action from the previous pipeline mutate the new one.
    clearHistory();
  }, [pipelineId, clearHistory]);
  const [scripts, setScripts] = useState<string[]>([]);
  const [scriptNames, setScriptNames] = useState<string[]>([]);
  const [approvedScripts, setApprovedScripts] = useState<Set<number>>(new Set());
  const [totalSegmentDuration, setTotalSegmentDuration] = useState<number>(0);

  // Per-profile ElevenLabs allowance (the shared provider pool stays private)
  type ElevenCredits = {
    label: string;
    tier: string;
    credits_used: number;
    credits_reserved: number;
    credit_limit: number;
    credits_remaining: number;
    usage_percent: number;
    last_error: string | null;
    period_start?: string | null;
    period_end?: string | null;
  };
  const [elevenCredits, setElevenCredits] = useState<ElevenCredits | null>(null);
  const [elevenCreditsLoading, setElevenCreditsLoading] = useState(false);
  const [elevenCreditsError, setElevenCreditsError] = useState<string | null>(null);

  const fetchElevenCredits = useCallback(async () => {
    setElevenCreditsLoading(true);
    setElevenCreditsError(null);
    try {
      const res = await apiGet("/elevenlabs-accounts/credits");
      const data = await res.json();
      if (data.account) {
        setElevenCredits(data.account);
      } else {
        setElevenCredits(null);
        setElevenCreditsError(data.error || "No ElevenLabs allowance configured");
      }
    } catch (err) {
      setElevenCredits(null);
      setElevenCreditsError(err instanceof Error ? err.message : "Failed to load credits");
    } finally {
      setElevenCreditsLoading(false);
    }
  }, []);

  // Auto-fetch ElevenLabs credits when the TTS step becomes active
  useEffect(() => {
    if (step === 2) fetchElevenCredits();
  }, [step, fetchElevenCredits]);


  // Step 3: Preview
  const [previewVariant, setPreviewVariant] = useState<PreviewKey | null>(null);
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Record<PreviewKey, PreviewData>>({});
  // Always-current mirror for stable per-key handlers (composition/default saves).
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Scroll target: after voice-over generation, bring user back to top of Step 2 for review
  const step2HeaderRef = useRef<HTMLHeadingElement>(null);
  const [elevenlabsModel, setElevenlabsModel] = useState("eleven_flash_v2_5");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [defaultVoiceId, setDefaultVoiceId] = useState("");
  const [savingDefault, setSavingDefault] = useState(false);
  // ElevenLabs voice settings (persisted to localStorage, loaded after hydration)
  const [voiceStability, setVoiceStability] = useState(0.5);
  const [voiceSimilarity, setVoiceSimilarity] = useState(0.75);
  const [voiceStyle, setVoiceStyle] = useState(0.0);
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [voiceSpeakerBoost, setVoiceSpeakerBoost] = useState(true);
  const [wordsPerSubtitle, setWordsPerSubtitle] = useState(2);
  const [minSegmentDuration, setMinSegmentDuration] = useState(3.0);
  const [ultraRapidIntro, setUltraRapidIntro] = useState(true);
  // Assembly preset — how library segments get auto-assigned to phrases.
  // Distinct from `presetName` (export aspect ratio preset, e.g. TikTok).
  const [assemblyPreset, setAssemblyPreset] = useState<
    "keyword_strict" | "balanced" | "max_variety" | "shuffle" | "ai_smart"
  >("balanced");
  // Segment proximity — near-adjacent same-source clips: keep them apart
  // (default, avoids a visible jump-cut) or merge them into one continuous shot.
  const [segmentProximity, setSegmentProximity] = useState<"separate" | "merge">("separate");
  // Render-time picture & audio adjustments configured in the Export workspace.
  // Applied by the render engine (eq / volume / afade), not by segment matching.
  const [renderAdjust, setRenderAdjust] = useState({
    enableColor: false,
    brightness: 0.0,
    contrast: 1.0,
    saturation: 1.0,
    voiceVolume: 1.0,
    audioFadeIn: 0.0,
    audioFadeOut: 0.0,
  });
  const [voiceSettingsLoaded, setVoiceSettingsLoaded] = useState(false);
  // BUG-FE-25: Initialize as empty to avoid stale defaults; the sync useEffect below populates it
  const voiceSettingsValuesRef = useRef<Record<string, unknown>>({});

  // Step 4: Render
  const [selectedVariants, setSelectedVariants] = useState<Set<number>>(new Set());
  const [isRendering, setIsRendering] = useState(false);
  const [isResettingUsage, setIsResettingUsage] = useState(false);
  const [variantStatuses, setVariantStatuses] = useState<VariantStatus[]>([]);
  const [showSkipDialog, setShowSkipDialog] = useState(false);
  const [skipCheckResults, setSkipCheckResults] = useState<RenderCheckResult[] | null>(null);
  const [isCheckingRender, setIsCheckingRender] = useState(false);
  const [existingRenderCount, setExistingRenderCount] = useState(0);
  const [presetName, setPresetName] = useState("TikTok");
  const [renderSettings, setRenderSettings] = useState<RenderSettings>({ ...DEFAULT_RENDER_SETTINGS });
  const [metaMultiplication, setMetaMultiplication] = useState(true);
  const [publishVariant, setPublishVariant] = useState<VariantStatus | null>(null);
  const [generatedCaptions, setGeneratedCaptions] = useState<Record<string, string>>({});
  const [generatedYoutubeTitles, setGeneratedYoutubeTitles] = useState<Record<string, string>>({});
  const [libraryProjectId, setLibraryProjectId] = useState<string | null>(null);

  // History sidebar
  const [historyPipelines, setHistoryPipelines] = useState<PipelineListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Script History is an on-demand workspace panel. Keeping one visibility
  // state across steps prevents a load from turning it into a permanent column.
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyScripts, setHistoryScripts] = useState<string[]>([]);
  const [historyScriptNames, setHistoryScriptNames] = useState<string[]>([]);
  const [historyScriptsLoading, setHistoryScriptsLoading] = useState(false);
  const [historySelectedScripts, setHistorySelectedScripts] = useState<Set<number>>(new Set());
  const [historyImporting, setHistoryImporting] = useState(false);
  const [historyPreviewInfo, setHistoryPreviewInfo] = useState<Record<string, VariantPreviewInfo>>({});
  const [historyTtsInfo, setHistoryTtsInfo] = useState<NonNullable<PipelineScriptsResponse["tts_info"]>>({});
  const [historyTtsJobs, setHistoryTtsJobs] = useState<Record<string, Partial<AsyncJobState>>>({});
  const [historyContextProducts, setHistoryContextProducts] = useState<ContextProduct[]>([]);
  const [historyAttentionSelection, setHistoryAttentionSelection] = useState<AttentionSelection | null>(null);
  const [historyTemplateSettings, setHistoryTemplateSettings] = useState<PipelineTemplateSettings | null>(null);
  const [expandedIdeas, setExpandedIdeas] = useState<Set<string>>(new Set());
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [playingAudio, setPlayingAudio] = useState<string | null>(null); // "pipelineId-variantIndex"
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // TTS Library sidebar
  const [ttsLibraryAssets, setTtsLibraryAssets] = useState<Array<{ id: string; tts_text: string; audio_duration: number; created_at: string; status: string }>>([]);
  const [ttsLibraryLoading, setTtsLibraryLoading] = useState(false);
  const [ttsLibraryExpanded, setTtsLibraryExpanded] = useState(false);
  const [ttsLibrarySelected, setTtsLibrarySelected] = useState<Set<string>>(new Set());
  const [ttsLibraryImporting, setTtsLibraryImporting] = useState(false);

  // Confirm dialog state (shared)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: "destructive" | "default";
    onConfirm: () => void;
    loading?: boolean;
  }>({ open: false, title: "", description: "", confirmLabel: "", variant: "default", onConfirm: () => {} });

  // Context collapse state
  const [contextExpanded, setContextExpanded] = useState(true);

  // Catalog picker state
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogPagination, setCatalogPagination] = useState<CatalogPagination>({ page: 1, page_size: 20, total: 0, total_pages: 1 });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogBrand, setCatalogBrand] = useState("all");
  const [catalogCategory, setCatalogCategory] = useState("all");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogFilters, setCatalogFilters] = useState<{ brands: string[]; categories: string[] }>({ brands: [], categories: [] });
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const catalogSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Product association state for matched segments
  const [associations, setAssociations] = useState<Record<string, AssociationResponse>>({});
  const [pickerSegmentId, setPickerSegmentId] = useState<string | null>(null);
  const [imagePickerAssoc, setImagePickerAssoc] = useState<AssociationResponse | null>(null);

  // Step 2: Per-script TTS previews
  const [ttsResults, setTtsResults] = useState<Record<number, TtsResult>>({});
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [regeneratingAllIndex, setRegeneratingAllIndex] = useState<number | null>(null);
  const [regeneratingVariantAudio, setRegeneratingVariantAudio] = useState<Record<number, boolean>>({});
  const [regeneratingScript, setRegeneratingScript] = useState<Record<number, boolean>>({});
  const [regeneratingAllScripts, setRegeneratingAllScripts] = useState(false);
  const [regeneratingAllScriptsIndex, setRegeneratingAllScriptsIndex] = useState<number | null>(null);
  const regenerateScriptsAbortRef = useRef<AbortController | null>(null);
  const [playingTtsVariant, setPlayingTtsVariant] = useState<number | null>(null);
  const [ttsAudioProgress, setTtsAudioProgress] = useState(0);
  const [ttsAudioDuration, setTtsAudioDuration] = useState(0);
  const ttsSeekingRef = useRef(false);
  const [srtPreviewOpen, setSrtPreviewOpen] = useState<Record<number, boolean>>({});
  const isMountedRef = useRef(true);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const scriptAbortRef = useRef<AbortController | null>(null);
  const pendingBlobUrl = useRef<string | null>(null);
  const ttsPlayAbortRef = useRef<AbortController | null>(null);
  const audioPlayAbortRef = useRef<AbortController | null>(null);

  // TTS Library duplicate detection
  const [libraryMatches, setLibraryMatches] = useState<Record<number, { asset_id: string; audio_duration: number }>>({});
  const ttsResultsRef = useRef(ttsResults);
  ttsResultsRef.current = ttsResults;

  // Script auto-save timer
  const scriptSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptNameSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TTS library duplicate check debounce timer
  const ttsLibraryCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Source video selection
  const [sourceVideos, setSourceVideos] = useState<Array<{
    id: string;
    name: string;
    thumbnail_path: string | null;
    duration: number | null;
    segments_count: number;
  }>>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const selectedSourceIdsRef = useRef(selectedSourceIds); // Bug #120: ref for async callbacks
  selectedSourceIdsRef.current = selectedSourceIds;
  const [sourceVideosLoading, setSourceVideosLoading] = useState(false);
  const [sourceVideoSearch, setSourceVideoSearch] = useState("");
  const [sourceVideoViewMode, setSourceVideoViewMode] = useState<"list" | "grid">("grid");
  // FE-16: This is a single shared search string for all variants' group tag dropdowns.
  // Ideally this would be Record<number, string> (per-variant) to prevent search state leaking
  // across variants when multiple group tag dropdowns are open. Left as-is for now because
  // only one dropdown can be open at a time in the current UI, making the leak harmless.
  const [groupTagSearch, setGroupTagSearch] = useState("");
  const sourceSelectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineIdRef = useRef<string | null>(null);
  // Always-current ref to handlePreviewAll, so the debounced assembly-settings
  // re-fetch (scheduleReassemblePreviews) never closes over stale state.
  const handlePreviewAllRef = useRef<(() => Promise<void>) | null>(null);
  // initialSourceSelectionDone ref removed — no longer auto-selecting source videos

  // Product groups for tag insertion (fetched when source videos are selected)
  const [productGroups, setProductGroups] = useState<Array<{
    id: string;
    label: string;
    color: string | null;
    source_video_id: string;
    segments_count: number;
  }>>([]);

  // Available segments for timeline editor (collected from preview response)
  const [availableSegments, setAvailableSegments] = useState<SegmentOption[]>([]);

  // Interstitial slides: keyed by variant index
  const [interstitialSlides, setInterstitialSlides] = useState<Record<PreviewKey, InterstitialSlide[]>>({});
  const [attentionTimelines, setAttentionTimelines] = useState<Record<PreviewKey, AttentionTimeline>>({});
  // Timeline bindings imported from a template are merged into freshly
  // generated previews, after audio/SRT data exists for the recipient.
  const importedTemplateTimelineRef = useRef<PipelineTemplateSettings["timeline"] | null>(null);
  const activeTemplatePipelineIdRef = useRef<string | null>(null);
  const [templatePipOverlays, setTemplatePipOverlays] = useState<PipelineTemplateSettings["timeline"]["pipOverlays"]>({});

  // Step 1 attention-template pick; auto-applied per variant once previews exist.
  const [attentionSelection, setAttentionSelection] = useState<AttentionSelection>(EMPTY_ATTENTION_SELECTION);
  const attentionSelectionRef = useRef<AttentionSelection>(EMPTY_ATTENTION_SELECTION);

  // Per-variant thumbnail selection (becomes first frame of rendered video)
  const [variantThumbnails, setVariantThumbnails] = useState<Record<PreviewKey, ThumbnailSelection>>({});
  const [thumbnailPickerKey, setThumbnailPickerKey] = useState<PreviewKey | null>(null);

  // ── Subtitle settings state ───────────────────────────────────────────────
  // `subtitleSettings` is the DEFAULT style for this pipeline (loaded from the
  // user's profile, used as fallback for any variant that doesn't have an
  // explicit override).
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>({ ...DEFAULT_SUBTITLE_SETTINGS });
  const [subtitleSettingsLoaded, setSubtitleSettingsLoaded] = useState(false);
  const [subtitleSaveState, setSubtitleSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const subtitleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subtitleSavedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceSettingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-Meta-version subtitle style overrides. Keyed by StyleKey ("A", "B",
  // "default"). Style is shared across ALL script variants under the same
  // Meta version — one style for Instagram (A), one for Facebook (B), and
  // one "default" for non-Meta renders. The backend's PUT endpoint regex
  // accepts only these three keys; legacy per-script keys ("0_A", "1_B")
  // from older pipelines are normalized to this shape on load.
  const [subtitleOverrides, setSubtitleOverrides] = useState<Partial<Record<StyleKey, SubtitleSettings>>>({});

  // Which Meta version is currently being edited in the SubtitleEditor.
  // Defaults to "default" (Meta OFF) or "A" (Meta ON). Never null — the
  // user always has exactly one active style selected.
  const [activeStyleKey, setActiveStyleKey] = useState<StyleKey>("default");

  // User-saved named presets loaded from the profile (distinct from the
  // hardcoded CAPTION_PRESETS built into SubtitleEditor).
  const [userSubtitlePresets, setUserSubtitlePresets] = useState<UserSubtitlePreset[]>([]);
  const [subtitleRotation, setSubtitleRotation] = useState<SubtitleTemplateRotation>(
    EMPTY_SUBTITLE_TEMPLATE_ROTATION,
  );
  const [variantSubtitleOverrides, setVariantSubtitleOverrides] = useState<
    Partial<Record<PreviewKey, Partial<SubtitleSettings>>>
  >({});
  // Explicit manual per-variant template picks (presetId keyed by PreviewKey).
  // Layered on top of rotation: a selection wins even when rotation is off.
  const [variantTemplateSelections, setVariantTemplateSelections] = useState<
    VariantTemplateSelections
  >({});

  // Debounced-save timer for per-variant overrides → PUT /pipeline/{id}/subtitle-overrides
  const overridesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Save as preset" dialog state
  const [savePresetDialogOpen, setSavePresetDialogOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [savePresetSubmitting, setSavePresetSubmitting] = useState(false);
  const [savePresetError, setSavePresetError] = useState<string | null>(null);
  const [templateTransferBusy, setTemplateTransferBusy] = useState<"export" | "import" | null>(null);

  const applyPipelineTemplateSettings = useCallback((
    settings: PipelineTemplateSettings,
    targetPipelineId?: string,
    restoreTimelineBindings = true,
  ) => {
    const { generation, content, voice, assembly, timeline, subtitles, render } = settings;
    activeTemplatePipelineIdRef.current = targetPipelineId || pipelineIdRef.current;
    setPipelineName(generation.name || "Imported template");
    setIdea(generation.idea || "");
    setContext(generation.context || "");
    setContextProducts(generation.contextProducts || []);
    setVariantCount(Math.max(1, Math.min(10, generation.variantCount || content.scripts.length || 1)));
    setTargetScriptDuration(generation.targetScriptDuration || 30);
    setProvider(generation.provider || DEFAULT_SCRIPT_AI_PROVIDER);
    setCodexModel(generation.codexModel || DEFAULT_CODEX_MODEL);
    setAiInstructions(generation.aiInstructions || "");

    setScripts((content.scripts || []).map((script) => script.text));
    setScriptNames((content.scripts || []).map((script, index) => script.name || `Script ${index + 1}`));
    setApprovedScripts(new Set(content.approvedScriptIndices || []));
    setGeneratedCaptions(content.generatedCaptions || {});
    setGeneratedYoutubeTitles(content.generatedYoutubeTitles || {});

    setElevenlabsModel(voice.model || "eleven_flash_v2_5");
    setVoiceId(voice.voice?.id || "");
    setVoiceStability(voice.stability ?? 0.5);
    setVoiceSimilarity(voice.similarity ?? 0.75);
    setVoiceStyle(voice.style ?? 0);
    setVoiceSpeed(voice.speed ?? 1);
    setVoiceSpeakerBoost(voice.speakerBoost ?? true);
    setWordsPerSubtitle(voice.wordsPerSubtitle ?? 2);

    setMinSegmentDuration(assembly.minSegmentDuration ?? 3);
    setUltraRapidIntro(assembly.ultraRapidIntro ?? true);
    setAssemblyPreset(assembly.preset || "balanced");
    setSegmentProximity(assembly.segmentProximity || "separate");
    setSelectedSourceIds(new Set((assembly.sourceVideos || []).map((source) => source.id).filter(Boolean)));

    // A fresh import needs its saved timeline applied to the first generated
    // preview. A restored pipeline already has that timeline in its persisted
    // previews, so arming it again would overwrite later Pacing/Proximity
    // reassemblies with the old template composition.
    importedTemplateTimelineRef.current = restoreTimelineBindings ? timeline : null;
    setSelectedVariants(new Set(timeline.selectedVariantIndices || []));
    setInterstitialSlides(timeline.interstitialSlides || {});
    const selection = timeline.attentionSelection
      ? normalizeAttentionSelection(timeline.attentionSelection)
      : EMPTY_ATTENTION_SELECTION;
    setAttentionSelection(selection);
    attentionSelectionRef.current = selection;
    setAttentionTimelines(timeline.attentionTimelines || {});
    setVariantThumbnails(timeline.variantThumbnails || {});
    setTemplatePipOverlays(timeline.pipOverlays || {});

    setSubtitleSettings(subtitles.default || { ...DEFAULT_SUBTITLE_SETTINGS });
    setSubtitleOverrides(subtitles.overrides || {});
    setVariantSubtitleOverrides(subtitles.variantOverrides || {});
    setSubtitleRotation(subtitles.rotation || EMPTY_SUBTITLE_TEMPLATE_ROTATION);
    setVariantTemplateSelections(subtitles.variantTemplates || {});
    setPresetName(render.presetName || "TikTok");
    setRenderSettings({ ...DEFAULT_RENDER_SETTINGS, ...(render.encoding || {}) });
    setRenderAdjust(render.adjustments || {
      enableColor: false,
      brightness: 0,
      contrast: 1,
      saturation: 1,
      voiceVolume: 1,
      audioFadeIn: 0,
      audioFadeOut: 0,
    });
    setMetaMultiplication(render.metaMultiplication ?? true);
  }, [setProvider]);

  const markSubtitleSaveSuccess = useCallback(() => {
    setSubtitleSaveState("saved");
    if (subtitleSavedResetTimer.current) clearTimeout(subtitleSavedResetTimer.current);
    subtitleSavedResetTimer.current = setTimeout(() => {
      setSubtitleSaveState("idle");
    }, 2000);
  }, []);

  const scheduleProfileSubtitleSave = useCallback((newSettings: SubtitleSettings) => {
    if (!currentProfileIdRef.current) return;
    setSubtitleSaveState("saving");
    if (subtitleSaveTimer.current) clearTimeout(subtitleSaveTimer.current);
    subtitleSaveTimer.current = setTimeout(async () => {
      try {
        const profileId = currentProfileIdRef.current;
        if (!profileId) return;
        await apiPut(`/profiles/${profileId}/subtitle-settings`, newSettings);
        markSubtitleSaveSuccess();
      } catch {
        setSubtitleSaveState("error");
      }
    }, 1000);
  }, [markSubtitleSaveSuccess]);

  // ── getSubtitleSettingsFor ─────────────────────────────────────────────────
  // SINGLE SOURCE OF TRUTH for "what style does this Meta version use?".
  // Called by the SubtitleEditor (for the active tab), by every TimelineEditor
  // card (to render the per-variant preview), and by VariantPreviewPlayer.
  //
  // Precedence rule:
  //   1. If `subtitleOverrides[styleKey]` exists and is non-empty → return a
  //      shallow merge (default ⊕ override) so override fields win but any
  //      missing fields fall through to the default.
  //   2. Otherwise → return the default (`subtitleSettings`).
  //
  // Meta profile overlay (Instagram red / Facebook white) is NOT applied
  // here. It's handled by `getPreviewSubtitleSettingsFor` below and
  // backend-side at render time — only when there is NO user override for
  // the key (matching the backend rule in pipeline_routes.py).
  const getSubtitleSettingsFor = useCallback(
    (styleKey: StyleKey): SubtitleSettings => {
      const override = subtitleOverrides[styleKey];
      if (!override || Object.keys(override).length === 0) {
        return subtitleSettings;
      }
      return { ...subtitleSettings, ...override };
    },
    [subtitleSettings, subtitleOverrides]
  );

  // Resolve the subtitle style to use for a specific PreviewCard, layering the
  // Meta profile overlay on top only when no explicit user override exists
  // for that card's Meta version. Used by TimelineEditor cards and
  // VariantPreviewPlayer, which always reason in terms of PreviewCards.
  const getPreviewSubtitleSettingsFor = useCallback(
    (card: Pick<PreviewCard, "key" | "baseIndex" | "visualVersion">): SubtitleSettings => {
      // A template baseline applies when rotation is on OR this card has an
      // explicit manual selection.
      if (subtitleRotation.enabled || variantTemplateSelections[card.key]) {
        return resolveRotatedSubtitleSettings({
          card,
          rotation: subtitleRotation,
          selections: variantTemplateSelections,
          presets: userSubtitlePresets,
          defaultSettings: subtitleSettings,
          metaOverrides: subtitleOverrides,
          variantOverrides: variantSubtitleOverrides,
          metaFallback: META_SUBTITLE_STYLE_BY_VERSION,
        });
      }
      const styleKey = toStyleKey(card);
      const effective = getSubtitleSettingsFor(styleKey);

      // No Meta version → no overlay to apply.
      if (!card.visualVersion) {
        return effective;
      }

      // Explicit override suppresses the Meta overlay (mirrors render-time).
      const explicitOverride = subtitleOverrides[styleKey];
      const hasExplicitOverride =
        !!explicitOverride && Object.keys(explicitOverride).length > 0;
      if (hasExplicitOverride) {
        return effective;
      }

      const metaStyle = META_SUBTITLE_STYLE_BY_VERSION[card.visualVersion];
      return metaStyle ? { ...effective, ...metaStyle } : effective;
    },
    [
      getSubtitleSettingsFor,
      subtitleOverrides,
      subtitleRotation,
      subtitleSettings,
      userSubtitlePresets,
      variantSubtitleOverrides,
      variantTemplateSelections,
    ]
  );

  const getPreviewSubtitleTemplateSettingsFor = useCallback(
    (card: Pick<PreviewCard, "key" | "baseIndex" | "visualVersion">): SubtitleSettings => (
      resolveRotatedSubtitleSettings({
        card,
        rotation: subtitleRotation,
        selections: variantTemplateSelections,
        presets: userSubtitlePresets,
        defaultSettings: subtitleSettings,
        metaOverrides: subtitleOverrides,
        variantOverrides: {},
        metaFallback: META_SUBTITLE_STYLE_BY_VERSION,
      })
    ),
    [subtitleOverrides, subtitleRotation, subtitleSettings, userSubtitlePresets, variantTemplateSelections],
  );

  const getWordsPerSubtitleForVariant = useCallback(
    (variantIndex: number, previewKey?: PreviewKey) => wordsPerSubtitleForVariant(
      subtitleRotation,
      userSubtitlePresets,
      variantIndex,
      wordsPerSubtitle,
      variantTemplateSelections,
      previewKey,
    ),
    [subtitleRotation, userSubtitlePresets, wordsPerSubtitle, variantTemplateSelections],
  );

  // Stable empty slides constant to avoid new array reference on every render
  const EMPTY_SLIDES: InterstitialSlide[] = useMemo(() => [], []);

  // Stable per-index callback refs for TimelineEditor props
  const matchesChangeHandlers = useRef<Record<string, (matches: MatchPreview[]) => void>>({});
  // F3: debounce timers for persisting timeline edits per preview key
  const matchesSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const applyMatchesChange = useCallback((previewKey: string, updatedMatches: MatchPreview[]) => {
    setPreviews(prev => {
      const current = prev[previewKey] || {} as PreviewData;
      return {
        ...prev,
        [previewKey]: {
          ...current,
          matches: updatedMatches,
          matched_count: updatedMatches.filter(m => m.segment_id !== null).length,
          unmatched_count: updatedMatches.filter(m => m.segment_id === null).length,
        }
      };
    });

    const pid = pipelineIdRef.current;
    if (!pid) return;
    if (matchesSaveTimers.current[previewKey]) {
      clearTimeout(matchesSaveTimers.current[previewKey]);
    }
    matchesSaveTimers.current[previewKey] = setTimeout(() => {
      delete matchesSaveTimers.current[previewKey];
      const baseVariant = parseInt(previewKey, 10);
      if (!Number.isFinite(baseVariant)) return;
      const underscoreIdx = previewKey.indexOf("_");
      const visualVersion = underscoreIdx > 0 ? previewKey.slice(underscoreIdx + 1) : undefined;
      apiPut(`/pipeline/${pid}/matches/${baseVariant}`, {
        matches: updatedMatches,
        visual_version: visualVersion,
      }).catch(() => {
        // Best-effort persistence; edits remain in local state and are still
        // sent as match_overrides at render time.
      });
    }, 800);
  }, []);
  const getMatchesChangeHandler = useCallback((previewKey: string) => {
    if (!matchesChangeHandlers.current[previewKey]) {
      matchesChangeHandlers.current[previewKey] = (updatedMatches: MatchPreview[]) => {
        const previousMatches = previewsRef.current[previewKey]?.matches;
        if (previousMatches && previousMatches !== updatedMatches) {
          pushAction({
            label: "variant match edit",
            undo: () => applyMatchesChange(previewKey, previousMatches),
            redo: () => applyMatchesChange(previewKey, updatedMatches),
          });
        }
        applyMatchesChange(previewKey, updatedMatches);
      };
    }
    return matchesChangeHandlers.current[previewKey];
  }, [applyMatchesChange, pushAction]);

  const videoTimelineChangeHandlers = useRef<Record<string, (timeline: CompositionClip[]) => void>>({});
  const videoTimelineSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const applyVideoTimelineChange = useCallback((previewKey: string, videoTimeline: CompositionClip[]) => {
    setPreviews((previous) => {
      const current = previous[previewKey] || {} as PreviewData;
      return {
        ...previous,
        [previewKey]: {
          ...current,
          video_timeline: videoTimeline,
          intro_offset_sec: videoTimeline
            .filter((clip) => clip.kind === "intro")
            .reduce((sum, clip) => sum + clip.timeline_duration, 0),
        },
      };
    });

    const pid = pipelineIdRef.current;
    if (!pid) return;
    if (videoTimelineSaveTimers.current[previewKey]) {
      clearTimeout(videoTimelineSaveTimers.current[previewKey]);
    }
    videoTimelineSaveTimers.current[previewKey] = setTimeout(() => {
      delete videoTimelineSaveTimers.current[previewKey];
      const baseVariant = parseInt(previewKey, 10);
      if (!Number.isFinite(baseVariant)) return;
      const underscoreIndex = previewKey.indexOf("_");
      const visualVersion = underscoreIndex > 0
        ? previewKey.slice(underscoreIndex + 1)
        : undefined;
      apiPut(`/pipeline/${pid}/composition/${baseVariant}`, {
        video_timeline: videoTimeline,
        visual_version: visualVersion,
        default_transition: previewsRef.current[previewKey]?.defaultTransition ?? null,
        music: previewsRef.current[previewKey]?.music ?? null,
      }).catch((error) => {
        console.warn(`[Timeline] Could not persist composition ${previewKey}`, error);
      });
    }, 500);
  }, []);
  const getVideoTimelineChangeHandler = useCallback((previewKey: string) => {
    if (!videoTimelineChangeHandlers.current[previewKey]) {
      videoTimelineChangeHandlers.current[previewKey] = (videoTimeline: CompositionClip[]) => {
        const previousTimeline = previewsRef.current[previewKey]?.video_timeline;
        if (previousTimeline && previousTimeline !== videoTimeline) {
          pushAction({
            label: "variant timeline edit",
            undo: () => applyVideoTimelineChange(previewKey, previousTimeline),
            redo: () => applyVideoTimelineChange(previewKey, videoTimeline),
          });
        }
        applyVideoTimelineChange(previewKey, videoTimeline);
      };
    }
    return videoTimelineChangeHandlers.current[previewKey];
  }, [applyVideoTimelineChange, pushAction]);

  // A2 background music — updates PreviewData and persists via the same
  // debounced composition save (which now carries `music`), mirroring the
  // default-transition handler exactly.
  const musicChangeHandlers = useRef<Record<string, (music: MusicSettings | null) => void>>({});
  const getMusicChangeHandler = useCallback((previewKey: string) => {
    if (!musicChangeHandlers.current[previewKey]) {
      musicChangeHandlers.current[previewKey] = (music: MusicSettings | null) => {
        setPreviews((previous) => {
          const current = previous[previewKey];
          if (!current) return previous;
          return { ...previous, [previewKey]: { ...current, music } };
        });
        const timeline = previewsRef.current[previewKey]?.video_timeline;
        if (timeline?.length) {
          // Reuse the debounced composition save so timeline + music persist
          // together. previewsRef is updated by the state commit above.
          getVideoTimelineChangeHandler(previewKey)(timeline);
        }
      };
    }
    return musicChangeHandlers.current[previewKey];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Transitions V1: per-variant default transition. Updates the PreviewData blob
  // and persists via the same composition save (which carries default_transition).
  const defaultTransitionChangeHandlers = useRef<Record<string, (spec: TransitionSpec | null) => void>>({});
  const getDefaultTransitionChangeHandler = useCallback((previewKey: string) => {
    if (!defaultTransitionChangeHandlers.current[previewKey]) {
      defaultTransitionChangeHandlers.current[previewKey] = (spec: TransitionSpec | null) => {
        setPreviews((previous) => {
          const current = previous[previewKey];
          if (!current) return previous;
          return { ...previous, [previewKey]: { ...current, defaultTransition: spec } };
        });
        const timeline = previewsRef.current[previewKey]?.video_timeline;
        if (timeline?.length) {
          // Reuse the debounced composition save so timeline+default persist together.
          // The ref is updated by the state commit above before the 500ms timer fires.
          getVideoTimelineChangeHandler(previewKey)(timeline);
        }
      };
    }
    return defaultTransitionChangeHandlers.current[previewKey];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interstitialSlidesChangeHandlers = useRef<Record<string, (slides: InterstitialSlide[]) => void>>({});
  const getInterstitialSlidesChangeHandler = useCallback((previewKey: string) => {
    if (!interstitialSlidesChangeHandlers.current[previewKey]) {
      interstitialSlidesChangeHandlers.current[previewKey] = (slides: InterstitialSlide[]) => {
        setInterstitialSlides(prev => ({ ...prev, [previewKey]: slides }));
      };
    }
    return interstitialSlidesChangeHandlers.current[previewKey];
  }, []);

  const attentionSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const getAttentionTimelineChangeHandler = useCallback((previewKey: string) => {
    return (timeline: AttentionTimeline) => {
      setAttentionTimelines(prev => ({ ...prev, [previewKey]: timeline }));
      const pid = pipelineIdRef.current;
      if (!pid) return;
      if (attentionSaveTimers.current[previewKey]) clearTimeout(attentionSaveTimers.current[previewKey]);
      attentionSaveTimers.current[previewKey] = setTimeout(async () => {
        delete attentionSaveTimers.current[previewKey];
        try {
          const response = await apiPut(`/pipeline/${pid}/attention-timeline/${previewKey}`, timeline);
          const saved = await response.json() as AttentionTimeline;
          setAttentionTimelines(prev => {
            const current = prev[previewKey];
            return current === timeline ? { ...prev, [previewKey]: saved } : prev;
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            toast.error("Attention timeline changed in another window. Reload the pipeline before editing again.");
          } else {
            toast.error("Could not save attention timeline");
          }
        }
      }, 800);
    };
  }, []);

  const handleAttentionSelectionChange = useCallback((selection: AttentionSelection) => {
    setAttentionSelection(selection);
    attentionSelectionRef.current = selection;
    const pid = pipelineIdRef.current;
    if (pid) void apiPut(`/pipeline/${pid}/attention-selection`, selection).catch(() => {});
  }, []);

  // A template picked in Step 1 before the pipeline exists is persisted as
  // soon as script generation creates one.
  useEffect(() => {
    if (pipelineId && attentionSelectionRef.current.templateId) {
      void apiPut(`/pipeline/${pipelineId}/attention-selection`, attentionSelectionRef.current).catch(() => {});
    }
  }, [pipelineId]);

  // Keep pipelineIdRef in sync with state + URL
  useEffect(() => {
    pipelineIdRef.current = pipelineId;
    if (
      activeTemplatePipelineIdRef.current
      && activeTemplatePipelineIdRef.current !== pipelineId
    ) {
      activeTemplatePipelineIdRef.current = null;
      importedTemplateTimelineRef.current = null;
      setTemplatePipOverlays({});
    }
    // Sync pipeline ID to URL so it's always visible and shareable
    updateUrlParams(step, pipelineId);
  }, [pipelineId]); // eslint-disable-line react-hooks/exhaustive-deps -- step read intentionally from current value

  // Mark component as unmounted — must be a separate effect with [] deps
  // so the cleanup only runs on actual unmount, not on every pipelineId change.
  // BUG-FE-24 originally merged these, but that caused isMountedRef to become
  // false whenever pipelineId changed, breaking all subsequent async operations.
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Session/draft persistence — survives the component unmount that Next.js does
  // when the user navigates away via the left nav and back. Gated so saves only
  // start after the one-time rehydration below has applied (avoids clobbering).
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate for this profile/workspace. Global pre-workspace keys are
  // migrated once into the active profile so existing drafts are not lost.
  useEffect(() => {
    if (!currentProfile?.id) return;
    try {
      const draftRaw = readWorkspaceStorage(
        currentProfile.id,
        PIPELINE_DRAFT_KEY,
        LEGACY_PIPELINE_DRAFT_KEY,
      );
      if (draftRaw) {
        const d = JSON.parse(draftRaw);
        if (d && typeof d === "object") {
          // Fill-if-empty: never override the backend restore, which is source of truth
          if (!idea && d.idea) setIdea(d.idea);
          if (!context && d.context) setContext(d.context);
          if (!pipelineName && d.pipelineName) setPipelineName(d.pipelineName);
          if (typeof d.variantCount === "number") setVariantCount(d.variantCount);
          if (typeof d.provider === "string" && d.provider) setProvider(d.provider);
          if (typeof d.codexModel === "string" && d.codexModel) setCodexModel(d.codexModel);
          if (typeof d.targetScriptDuration === "number") setTargetScriptDuration(d.targetScriptDuration);
        }
      }
    } catch { /* corrupt draft — ignore */ }

    // If we returned to /pipeline without ?id=, put the last pointer back in the
    // URL so the existing restore effect (keyed on urlPipelineId) picks it up.
    try {
      if (!urlPipelineId) {
        const sessRaw = readWorkspaceStorage(
          currentProfile.id,
          PIPELINE_SESSION_KEY,
          LEGACY_PIPELINE_SESSION_KEY,
        );
        if (sessRaw) {
          const s = JSON.parse(sessRaw);
          if (s && s.pipelineId) {
            const savedStep = s.step >= 1 && s.step <= 4 ? s.step : 1;
            setStepRaw(savedStep); // set before updateUrlParams so restore sees the right step
            updateUrlParams(savedStep, s.pipelineId);
          }
        }
      }
    } catch { /* corrupt pointer — ignore */ }

    setHydrated(true);
  }, [currentProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- workspace remount owns the remaining initial values

  // Persist pointer + Step-1 draft on change. ponytail: no debounce, add if profiling shows jank
  useEffect(() => {
    if (!hydrated || !currentProfile?.id) return;
    try {
      if (pipelineId) {
        writeWorkspaceStorage(
          currentProfile.id,
          PIPELINE_SESSION_KEY,
          JSON.stringify({ pipelineId, step }),
        );
      }
      writeWorkspaceStorage(
        currentProfile.id,
        PIPELINE_DRAFT_KEY,
        JSON.stringify({
          pipelineName, idea, context, variantCount, provider, codexModel, targetScriptDuration,
        }),
      );
    } catch { /* storage full/blocked — non-fatal */ }
  }, [hydrated, pipelineId, step, pipelineName, idea, context, variantCount, provider, codexModel, targetScriptDuration, currentProfile?.id]);

  // Restore pipeline from URL ?id=<pipeline_id> on mount
  const urlRestoreAttempted = useRef(false);
  useEffect(() => {
    if (urlRestoreAttempted.current || !urlPipelineId || pipelineId) return;
    urlRestoreAttempted.current = true;

    (async () => {
      try {
        const res = await apiGet(`/pipeline/scripts/${urlPipelineId}`);
        const data = await res.json() as PipelineScriptsResponse;
        if (!isMountedRef.current) return;

        setPipelineId(data.pipeline_id);
        pipelineIdRef.current = data.pipeline_id; // Set ref immediately for URL sync
        const restoredGenerationJob = data.generation_job || null;
        setGenerationJob(restoredGenerationJob);
        setIsGenerating(isActiveAsyncJob(restoredGenerationJob));
        setScripts((data.scripts || []).map((s: string) => {
          const lines = s.trim().split('\n').filter((l: string) => l.trim());
          if (lines.length >= 3) return s;
          const sentences = s.trim().split(/([.!?])\s+/).reduce<string[]>((acc, part, i, arr) => {
            if (i % 2 === 0) acc.push(i + 1 < arr.length ? part + arr[i + 1] : part);
            return acc;
          }, []);
          return sentences.map((sent: string) => sent.trim()).filter(Boolean).join('\n');
        }));
        setScriptNames(
          data.script_names?.length === data.scripts.length
            ? data.script_names
            : defaultScriptNames(data.scripts.length),
        );
        if (data.context_products) setContextProducts(data.context_products);

        // Restore pipeline metadata so "Back to Input" shows the original form
        if (data.name) setPipelineName(data.name);
        if (data.idea) setIdea(data.idea);
        if (data.context) setContext(stripEmbeddedProductBlocks(data.context));
        if (data.provider) setProvider(data.provider);
        if (data.codex_model) setCodexModel(data.codex_model);
        if (data.variant_count) setVariantCount(data.variant_count);
        setMetaMultiplication(data.meta_multiplication !== undefined ? Boolean(data.meta_multiplication) : true);
        if (isPipelineTemplateSettings(data.template_settings)) {
          applyPipelineTemplateSettings(
            data.template_settings,
            data.pipeline_id,
            shouldRestoreImportedTemplateTimeline(data.preview_info),
          );
        }
        if (data.attention_selection?.templateId) {
          const restoredSelection = normalizeAttentionSelection(data.attention_selection);
          setAttentionSelection(restoredSelection);
          attentionSelectionRef.current = restoredSelection;
        }
        if (data.library_project_id) setLibraryProjectId(data.library_project_id);

        // Restore TTS results from history info (inline to avoid hoisting issues)
        const ttsInfo = data.tts_info || {};
        const previewInfo: Record<string, { has_audio: boolean; audio_duration: number }> = data.preview_info || {};
        const restoredTts: Record<number, TtsResult> = {};
        const restoredApproved = new Set<number>();
        // Bound restored keys to the current script count. The backend can hold
        // stale tts_info for variants deleted from the scripts array (delete-script
        // saves the shorter scripts but leaves the old tts_info row), so an orphan
        // key >= scriptCount would push ttsCount past scripts.length → "N of M, -1
        // remaining" and a jammed Continue gate. See buildRestoredTts for the twin.
        const scriptCount = (data.scripts || []).length;
        // Meta-multiplication keys like "0_A" must collapse to base variant 0.
        const toBaseVariant = (key: string): number | null => {
          const m = key.match(/^(\d+)/);
          if (!m) return null;
          const n = Number(m[1]);
          return Number.isFinite(n) ? n : null;
        };
        Object.entries(ttsInfo).forEach(([key, info]) => {
          if (!info.has_audio) return;
          const idx = toBaseVariant(key);
          if (idx === null || idx >= scriptCount) return;
          restoredTts[idx] = {
            audio_duration: info.audio_duration,
            generating: false,
            stale: false,
            status: "completed",
            srt_content: info.srt_content,
            script_word_count: info.script_word_count,
            srt_word_count: info.srt_word_count,
          };
          if (info.approved) restoredApproved.add(idx);
        });
        // Per-variant fallback: fill gaps from preview_info (Step 3 audio may
        // survive temp cleanup even when Step 2 TTS audio was deleted)
        Object.entries(previewInfo).forEach(([key, info]) => {
          if (!info.has_audio) return;
          const idx = toBaseVariant(key);
          if (idx === null || idx >= scriptCount) return;
          if (!restoredTts[idx]) {
            restoredTts[idx] = { audio_duration: info.audio_duration, generating: false, stale: false };
          }
        });
        Object.entries(data.tts_jobs || {}).forEach(([key, rawJob]) => {
          const idx = toBaseVariant(key);
          if (idx === null || idx >= scriptCount) return;
          const job = rawJob as Partial<AsyncJobState>;
          if (isActiveAsyncJob(job)) {
            restoredTts[idx] = {
              audio_duration: 0,
              generating: true,
              stale: false,
              status: job.status,
              progress: job.progress || 0,
              current_step: job.current_step || "Generating voice-over",
            };
          } else if ((job.status === "failed" || job.status === "cancelled") && !restoredTts[idx]) {
            restoredTts[idx] = {
              audio_duration: 0,
              generating: false,
              stale: false,
              status: job.status,
              progress: job.progress || 0,
              current_step: job.current_step,
              error: job.error,
            };
          }
        });
        setTtsResults(restoredTts);
        if (restoredApproved.size > 0) setApprovedScripts(restoredApproved);

        // Restore source video selection
        setSelectedSourceIds(new Set());
        try {
          const srcRes = await apiGet(`/pipeline/${data.pipeline_id}/source-selection`);
          const srcData = await srcRes.json();
          if (isMountedRef.current && srcData.source_video_ids?.length > 0) {
            setSelectedSourceIds(new Set(srcData.source_video_ids));
          }
        } catch {
          // No saved selection — user selects manually
        }

        // Restore per-Meta-version subtitle overrides for this pipeline.
        // The backend normalizes legacy per-script keys to {A,B,default} on
        // read, so the payload is always in the canonical shape.
        try {
          const ovRes = await apiGet(`/pipeline/${data.pipeline_id}/subtitle-overrides`);
          const ovData = await ovRes.json();
          if (isMountedRef.current && ovData && typeof ovData.overrides === "object" && ovData.overrides !== null) {
            const entries = Object.entries(ovData.overrides) as [string, SubtitleSettings][];
            setSubtitleOverrides(Object.fromEntries(
              entries.filter(([key]) => key === "A" || key === "B" || key === "default"),
            ) as Partial<Record<StyleKey, SubtitleSettings>>);
            setVariantSubtitleOverrides(Object.fromEntries(
              entries.filter(([key]) => /^\d+(?:_[A-J])?$/.test(key)),
            ));
          }
        } catch {
          // Old pipeline or no overrides — silent fallback
        }

        // Restore previews when landing on step 3+ (so variant cards are visible)
        if (step >= 3) {
          try {
            const previewRes = await apiGet(`/pipeline/${data.pipeline_id}/restore-previews`);
            const previewData = await previewRes.json();
            if (isMountedRef.current && previewData.previews && Object.keys(previewData.previews).length > 0) {
              const restoredPreviews: Record<string, PreviewData> = {};
              for (const [key, val] of Object.entries(previewData.previews)) {
                restoredPreviews[key] = val as PreviewData;
              }
              setPreviews(restoredPreviews);
              if (previewData.available_segments?.length > 0) {
                setAvailableSegments(previewData.available_segments);
              }
              // Auto-select all variants so user can render immediately
              setSelectedVariants(new Set((data.scripts || []).map((_: string, i: number) => i)));
            }
          } catch {
            // Previews not available — user can re-generate from step 2
          }
        }

        // Completed pipelines reopen in Step 2. Active/failed generation jobs
        // stay on Step 1, where polling and recovery controls are visible.
        if ((data.scripts || []).length > 0) {
          if (step === 1) setStep(2);
        } else {
          setStep(1);
          if (restoredGenerationJob?.status === "failed") {
            setError(restoredGenerationJob.error || "Script generation failed. Please try again.");
          }
        }
      } catch {
        // Pipeline not found or expired — clear ID from URL and drop the dead pointer
        updateUrlParams(step, null);
        try {
          if (currentProfile?.id) removeWorkspaceStorage(currentProfile.id, PIPELINE_SESSION_KEY);
        } catch { /* ignore */ }
      }
    })();
  }, [urlPipelineId]); // eslint-disable-line react-hooks/exhaustive-deps -- re-fires once when rehydrate injects ?id=

  const stripEmbeddedProductBlocks = (value: string): string => {
    if (!value) return "";
    return value
      // [ \t]* (not \s*) — a greedy \s* swallowed the newline the description
      // group needs, so description lines under a block were never stripped.
      .replace(/(?:^|\n)\[(?:Product|Context):\s*[^\]]+\][ \t]*(?:\n[^\n\[]*)*/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  // Format script: ensure each sentence starts on a new line
  const formatScript = (text: string): string => {
    // If already has multiple lines (3+), assume it's formatted
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length >= 3) return text;
    // FE-22: Split by sentence-ending punctuation followed by space (Safari-safe, no lookbehind)
    const sentences = text.trim().split(/([.!?])\s+/).reduce<string[]>((acc, part, i, arr) => {
      if (i % 2 === 0) {
        acc.push(i + 1 < arr.length ? part + arr[i + 1] : part);
      }
      return acc;
    }, []);
    return sentences.map(s => s.trim()).filter(Boolean).join('\n');
  };

  // Count products from structured array
  const contextProductCount = contextProducts.length;

  // Context products: fetched from the local Product Library (D1 — the Gomag
  // catalog is gated off). The API searches title, SKU and imported fields.
  const fetchCatalogProducts = useCallback(async (search: string, brand: string, category: string, page: number) => {
    void brand; void category; void page; // kept for call-site compatibility; library has no taxonomy/pagination
    setCatalogLoading(true);
    try {
      const params = new URLSearchParams({ search, page: String(page), page_size: "50" });
      const res = await apiGet(`/product-library?${params}`);
      const data = await res.json();
      interface LibraryProduct { id: string; title: string; description?: string; image_urls?: string[]; brand?: string; category?: string; sku?: string; price?: string; sale_price?: string; product_url?: string; extra_fields?: Record<string, unknown> }
      const all = ((data.products || []) as LibraryProduct[])
        .map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description || "",
          brand: p.brand || "",
          sku: p.sku || "",
          image_link: p.image_urls?.[0] ? (p.image_urls[0].startsWith("http") ? p.image_urls[0] : `${API_URL}${p.image_urls[0]}`) : "",
          image_urls: p.image_urls || [],
          category: p.category || "",
          price: Number(p.price) || 0,
          sale_price: Number(p.sale_price) || 0,
          product_url: p.product_url || "",
          extra_fields: p.extra_fields || {},
          is_on_sale: false,
        }));
      setCatalogProducts(all);
      setCatalogPagination(data.pagination || { page, page_size: all.length || 20, total: all.length, total_pages: 1 });
    } catch (err) {
      handleApiError(err, "Failed to load products");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  // Local library has no brand/category taxonomy — keep filter dropdowns empty.
  const fetchCatalogFilters = useCallback(async () => {
    setCatalogFilters({ brands: [], categories: [] });
  }, []);

  // Source videos: fetch list with segment counts
  const fetchSourceVideos = useCallback(async () => {
    if (!currentProfile?.id) return;

    setSourceVideosLoading(true);
    try {
      const data = await getCachedSourceVideos<typeof sourceVideos>(currentProfile.id, async () => {
        const res = await apiGet("/segments/source-videos");
        return (await res.json()) || [];
      });
      setSourceVideos(data);
    } catch (err) {
      handleApiError(err, "Failed to load source videos");
    } finally {
      setSourceVideosLoading(false);
    }
  }, [currentProfile?.id]);

  // Fetch total segment duration on profile load
  useEffect(() => {
    if (!currentProfile?.id) return;
    apiGet("/pipeline/segment-duration")
      .then(async (res) => {
        const data = await res.json();
        setTotalSegmentDuration(data.total_segment_duration || 0);
      })
      .catch((err) => {
        console.warn("Failed to fetch segment duration:", err);
      });
  }, [currentProfile?.id]);

  // Fetch AI instructions on profile load
  useEffect(() => {
    if (!currentProfile?.id) return;
    apiGet(`/profiles/${currentProfile.id}/ai-instructions`)
      .then(async (res) => {
        const data = await res.json();
        setAiInstructions(data.ai_instructions || "");
      })
      .catch((err) => {
        console.warn("Failed to load AI instructions:", err);
      });
  }, [currentProfile?.id]);

  // Save AI instructions explicitly
  const saveAiInstructions = useCallback(async (text: string, collapse?: boolean) => {
    if (!currentProfile?.id) return;
    if (aiInstructionsSaveTimer.current) clearTimeout(aiInstructionsSaveTimer.current);
    try {
      await apiPut(`/profiles/${currentProfile.id}/ai-instructions`, {
        ai_instructions: text,
      });
      setAiRulesDirty(false);
      setAiRulesSaved(true);
      if (collapse) setAiRulesExpanded(false);
      if (aiRulesSavedResetTimer.current) clearTimeout(aiRulesSavedResetTimer.current);
      aiRulesSavedResetTimer.current = setTimeout(() => { if (isMountedRef.current) setAiRulesSaved(false); }, 2000);
    } catch {
      setAiRulesSaved(false);
      setAiRulesDirty(true);
      // Re-expand panel so user sees the unsaved state
      if (collapse) setAiRulesExpanded(true);
    }
  }, [currentProfile?.id]);

  // Source videos: restore selection from a saved pipeline
  const restoreSourceSelection = useCallback(async (pid: string) => {
    try {
      const res = await apiGet(`/pipeline/${pid}/source-selection`);
      const data = await res.json();
      if (data.source_video_ids && data.source_video_ids.length > 0) {
        setSelectedSourceIds(new Set(data.source_video_ids));
      }
    } catch {
      // Ignore — fresh pipeline or column not yet migrated
    }
    // No fallback — user selects manually if no saved selection exists
  }, []);

  // Source videos: toggle a single video selection
  const handleSourceToggle = (videoId: string) => {
    setSelectedSourceIds(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      // Debounce save to DB
      if (sourceSelectionTimer.current) clearTimeout(sourceSelectionTimer.current);
      sourceSelectionTimer.current = setTimeout(() => {
        if (pipelineIdRef.current) {
          apiPut(`/pipeline/${pipelineIdRef.current}/source-selection`, {
            source_video_ids: Array.from(next)
          }).catch(() => {});
        }
      }, 500);
      return next;
    });
  };

  // Source videos: select all
  const handleSelectAllSources = () => {
    if (sourceSelectionTimer.current) clearTimeout(sourceSelectionTimer.current);
    const allIds = new Set(sourceVideos.map(v => v.id));
    setSelectedSourceIds(allIds);
    if (pipelineId) {
      apiPut(`/pipeline/${pipelineId}/source-selection`, {
        source_video_ids: Array.from(allIds)
      }).catch(() => {});
    }
  };

  // Source videos: deselect all
  const handleDeselectAllSources = () => {
    if (sourceSelectionTimer.current) clearTimeout(sourceSelectionTimer.current);
    setSelectedSourceIds(new Set());
    if (pipelineId) {
      apiPut(`/pipeline/${pipelineId}/source-selection`, {
        source_video_ids: []
      }).catch(() => {});
    }
  };

  // Source videos start unselected — user picks manually on Step 2

  // FE-14: Derive a stable string key from the Set to avoid extra API calls on every render
  const selectedSourceIdsKey = useMemo(() => [...selectedSourceIds].sort().join(","), [selectedSourceIds]);

  // FE-14: Memoize the array form of selectedSourceIds to avoid new array on every render
  const selectedSourceIdsArray = useMemo(
    () => Array.from(selectedSourceIds),
    [selectedSourceIdsKey]
  );
  const selectedSegmentCount = useMemo(
    () => sourceVideos
      .filter((video) => selectedSourceIds.has(video.id))
      .reduce((total, video) => total + video.segments_count, 0),
    [sourceVideos, selectedSourceIds]
  );

  const buildPreviewKey = useCallback((baseIndex: number, visualVersion?: string) => {
    return visualVersion ? `${baseIndex}_${visualVersion}` : String(baseIndex);
  }, []);

  const previewCards = useMemo<PreviewCard[]>(() => {
    if (!metaMultiplication) {
      return scripts.map((script, index) => ({
        key: buildPreviewKey(index),
        baseIndex: index,
        label: `Variant ${index + 1}`,
        script,
      }));
    }

    return scripts.flatMap((script, index) => ([
      {
        key: buildPreviewKey(index, "A"),
        baseIndex: index,
        label: `Variant ${index + 1} A`,
        visualVersion: "A",
        metaPlatform: "instagram",
        script,
      },
      {
        key: buildPreviewKey(index, "B"),
        baseIndex: index,
        label: `Variant ${index + 1} B`,
        visualVersion: "B",
        metaPlatform: "facebook",
        script,
      },
    ]));
  }, [buildPreviewKey, metaMultiplication, scripts]);

  const attentionLoadedForPipeline = useRef<string | null>(null);
  useEffect(() => {
    if (!pipelineId) return;
    if (attentionLoadedForPipeline.current !== pipelineId) {
      attentionLoadedForPipeline.current = pipelineId;
      setAttentionTimelines({});
    }
    for (const card of previewCards) {
      if (attentionTimelines[card.key]) continue;
      apiGet(`/pipeline/${pipelineId}/attention-timeline/${card.key}`)
        .then(async response => {
          const document = await response.json() as AttentionTimeline;
          setAttentionTimelines(prev => prev[card.key] ? prev : { ...prev, [card.key]: document });
        })
        .catch(() => {
          setAttentionTimelines(prev => prev[card.key] ? prev : {
            ...prev,
            [card.key]: { revision: 0, cues: [] },
          });
        });
    }
  }, [pipelineId, previewCards, attentionTimelines]);

  // Auto-apply the Step 1 attention-template pick: once a variant has a
  // preview (audio duration + subtitle boundaries exist) and its timeline is
  // still empty, distribute the template. Manual timeline edits in Step 3 are
  // never overwritten because non-empty timelines are skipped.
  const attentionAutoApplied = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!pipelineId || !attentionSelection.templateId || attentionSelection.assets.length === 0) return;
    for (const card of previewCards) {
      const timeline = attentionTimelines[card.key];
      const preview = previews[card.key];
      if (!timeline || timeline.cues.length > 0) continue;
      if (!preview?.matches?.length || !(preview.audio_duration > 0)) continue;
      // card.key is "<variantIndex>" or "<variantIndex>_<style>"; the variant
      // index drives the per-variant stagger offset.
      const variantIndex = parseInt(card.key, 10) || 0;
      const applyKey = `${pipelineId}:${card.key}`;
      if (attentionAutoApplied.current.has(applyKey)) continue;
      attentionAutoApplied.current.add(applyKey);
      apiPost(
        `/pipeline/${pipelineId}/attention-timeline/${card.key}/apply-template`,
        buildAttentionTemplateApplyPayload({
          selection: attentionSelection,
          preview,
          timeline,
          variantIndex,
        }),
      )
        .then(async response => {
          const document = await response.json() as AttentionTimeline;
          setAttentionTimelines(prev => ({ ...prev, [card.key]: document }));
        })
        .catch(() => {
          // Allow a retry on the next state change (e.g. after a 409 reload).
          attentionAutoApplied.current.delete(applyKey);
        });
    }
  }, [pipelineId, attentionSelection, previewCards, attentionTimelines, previews]);

  const applyAttentionTemplateToVariants = useCallback(async (
    selection: AttentionSelection,
    cardKeys: string[],
  ): Promise<AttentionTemplateApplyResult> => {
    if (!pipelineId) {
      return { appliedKeys: [], skippedKeys: [], failedKeys: cardKeys };
    }

    const requestedKeys = new Set(cardKeys);
    const targetCards = previewCards.filter((card) => requestedKeys.has(card.key));
    const outcomes = await Promise.all(targetCards.map(async (card) => {
      const preview = previews[card.key];
      if (!preview?.matches?.length || !(preview.audio_duration > 0)) {
        return { key: card.key, status: "skipped" as const };
      }

      const timeline = attentionTimelines[card.key] ?? { revision: 0, cues: [] };
      const variantIndex = parseInt(card.key, 10) || 0;
      try {
        const response = await apiPost(
          `/pipeline/${pipelineId}/attention-timeline/${card.key}/apply-template`,
          buildAttentionTemplateApplyPayload({
            selection,
            preview,
            timeline,
            variantIndex,
          }),
        );
        const document = await response.json() as AttentionTimeline;
        setAttentionTimelines((current) => ({ ...current, [card.key]: document }));
        return { key: card.key, status: "applied" as const };
      } catch {
        return { key: card.key, status: "failed" as const };
      }
    }));

    const missingKeys = cardKeys.filter((key) => !targetCards.some((card) => card.key === key));
    return {
      appliedKeys: outcomes.filter((outcome) => outcome.status === "applied").map((outcome) => outcome.key),
      skippedKeys: outcomes.filter((outcome) => outcome.status === "skipped").map((outcome) => outcome.key),
      failedKeys: [
        ...outcomes.filter((outcome) => outcome.status === "failed").map((outcome) => outcome.key),
        ...missingKeys,
      ],
    };
  }, [attentionTimelines, pipelineId, previewCards, previews]);

  // Keep activeStyleKey consistent with metaMultiplication. When Meta is ON
  // the user picks between A and B; when OFF, there's only "default". This
  // effect snaps the active key back to a legal value whenever the flag
  // toggles, preserving the *other* version's override silently.
  useEffect(() => {
    if (metaMultiplication) {
      // Meta ON — "default" is not a valid tab; default to A on entry.
      if (activeStyleKey === "default") setActiveStyleKey("A");
    } else {
      // Meta OFF — collapse to the single "default" panel.
      if (activeStyleKey !== "default") setActiveStyleKey("default");
    }
  }, [metaMultiplication, activeStyleKey]);

  const activeStyleHasOverride = useMemo(() => {
    const override = subtitleOverrides[activeStyleKey];
    return !!override && Object.keys(override).length > 0;
  }, [subtitleOverrides, activeStyleKey]);

  const getPreviewSubtitleTextFor = useCallback((
    card: Pick<PreviewCard, "key" | "baseIndex" | "visualVersion">,
  ): string | undefined => {
    const previewCard = previewCards.find((candidate) => candidate.key === card.key);
    return (
      extractPreviewSubtitleText(previews[card.key]?.srt_content)
      ?? extractPreviewSubtitleText(ttsResults[card.baseIndex]?.srt_content)
      ?? previewCard?.script?.trim()
      ?? undefined
    );
  }, [previewCards, previews, ttsResults]);

  // Auto-select a distinctive thumbnail per variant when previews change.
  // Batch rule: no frame may be reused across variants — identity is the frame
  // image URL, not the segment (A/B siblings share segments, so distinctness
  // must come from picking different frames within them).
  useEffect(() => {
    if (previewCards.length === 0) return;
    let cancelled = false;

    (async () => {
      const usedUrls = new Set<string>();
      const newThumbnails: Record<PreviewKey, ThumbnailSelection> = {};

      // Pass 1: reserve every manual selection's frame first, regardless of order.
      for (const card of previewCards) {
        const existing = variantThumbnails[card.key];
        if (existing && !existing.isAutoSelected) {
          newThumbnails[card.key] = existing;
          usedUrls.add(existing.imageUrl);
        }
      }

      // Pass 2: auto-assign a unique frame to the remaining variants.
      for (const card of previewCards) {
        if (newThumbnails[card.key]) continue;
        const preview = previews[card.key];
        if (!preview?.matches) continue;

        const segsWithThumbs = preview.matches
          .filter((m) => m.segment_id && m.thumbnail_path)
          .reduce<{ id: string; thumb: string }[]>((acc, m) => {
            if (!acc.some((s) => s.id === m.segment_id)) {
              acc.push({ id: m.segment_id!, thumb: m.thumbnail_path! });
            }
            return acc;
          }, []);
        if (segsWithThumbs.length === 0) continue;

        // Prefer a segment whose default frame is still free.
        let pick = segsWithThumbs.find((s) => !usedUrls.has(s.thumb));

        // All default frames taken (typical for A/B siblings): pull distinct
        // frames from a segment until we find one no other variant claimed.
        // ponytail: only fires on collision; /frames caches, so it's cheap.
        if (!pick) {
          for (const s of segsWithThumbs) {
            try {
              const res = await apiGet(`/segments/${s.id}/frames?count=6`);
              const frames: { frame_url: string }[] = await res.json();
              const free = frames.find((f) => !usedUrls.has(f.frame_url));
              if (free) { pick = { id: s.id, thumb: free.frame_url }; break; }
            } catch (err) {
              console.error("Failed to load frames for auto-thumbnail:", err);
            }
          }
        }

        // Last resort: accept the segment default even if it duplicates.
        if (!pick) pick = segsWithThumbs[card.baseIndex % segsWithThumbs.length];

        newThumbnails[card.key] = {
          segmentId: pick.id,
          imageUrl: pick.thumb,
          isAutoSelected: true,
        };
        usedUrls.add(pick.thumb);
      }

      if (cancelled) return;
      const changed = previewCards.some(
        (card) =>
          newThumbnails[card.key]?.segmentId !== variantThumbnails[card.key]?.segmentId ||
          newThumbnails[card.key]?.imageUrl !== variantThumbnails[card.key]?.imageUrl
      );
      if (changed) setVariantThumbnails(newThumbnails);
    })();

    return () => { cancelled = true; };
  }, [previews, previewCards]); // eslint-disable-line react-hooks/exhaustive-deps -- variantThumbnails read intentionally from current value

  // Fetch product groups when source video selection changes
  useEffect(() => {
    if (selectedSourceIds.size === 0) {
      setProductGroups([]);
      return;
    }
    const abortController = new AbortController();
    const ids = selectedSourceIdsKey;
    apiGet(`/segments/product-groups-bulk?source_video_ids=${encodeURIComponent(ids)}`, { signal: abortController.signal })
      .then(async (res) => {
        if (abortController.signal.aborted) return;
        const data = await res.json();
        setProductGroups(data);
      })
      .catch(() => {
        if (!abortController.signal.aborted) setProductGroups([]);
      });
    return () => { abortController.abort(); };
  }, [selectedSourceIdsKey]);

  // Insert a [GroupLabel] tag at cursor position in a script textarea
  const insertGroupTag = (scriptIndex: number, groupLabel: string) => {
    const tag = `[${groupLabel}]\n`;
    const textarea = document.querySelector(`#script-textarea-${scriptIndex}`) as HTMLTextAreaElement | null;
    const newScripts = [...scripts];
    if (textarea) {
      const pos = textarea.selectionStart ?? scripts[scriptIndex].length;
      const text = scripts[scriptIndex];
      newScripts[scriptIndex] = text.slice(0, pos) + tag + text.slice(pos);
    } else {
      newScripts[scriptIndex] = scripts[scriptIndex] + "\n" + tag;
    }
    setScripts(newScripts);
    // BUG-FE-30: Warn user if no pipeline exists yet instead of silently skipping save
    if (pipelineId) {
      saveScriptsToBackend(pipelineId, newScripts);
    } else {
      toast.error("Create a pipeline first before inserting tags");
    }
  };

  // Detect [GroupLabel] tags in a script
  const detectGroupTags = (text: string): string[] => {
    const matches = text.match(/\[([^\[\]]+)\]/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.slice(1, -1)))];
  };

  // Catalog: open picker
  const handleOpenCatalog = () => {
    const next = !catalogOpen;
    setCatalogOpen(next);
    if (next) {
      fetchCatalogProducts("", "all", "all", 1);
      if (catalogFilters.brands.length === 0) fetchCatalogFilters();
    } else {
      // FE-10: Clear pending debounced search when catalog closes
      if (catalogSearchTimer.current) {
        clearTimeout(catalogSearchTimer.current);
        catalogSearchTimer.current = null;
      }
    }
  };

  // Catalog: debounced search
  const handleCatalogSearchChange = (value: string) => {
    setCatalogSearch(value);
    if (catalogSearchTimer.current) clearTimeout(catalogSearchTimer.current);
    catalogSearchTimer.current = setTimeout(() => {
      setCatalogPage(1);
      fetchCatalogProducts(value, catalogBrand, catalogCategory, 1);
    }, 400);
  };

  // Catalog: filter change
  const handleCatalogFilterChange = (type: "brand" | "category", value: string) => {
    const newBrand = type === "brand" ? value : catalogBrand;
    const newCategory = type === "category" ? value : catalogCategory;
    if (type === "brand") setCatalogBrand(value);
    else setCatalogCategory(value);
    setCatalogPage(1);
    fetchCatalogProducts(catalogSearch, newBrand, newCategory, 1);
  };

  // Catalog: pagination
  const handleCatalogPageChange = (newPage: number) => {
    setCatalogPage(newPage);
    fetchCatalogProducts(catalogSearch, catalogBrand, catalogCategory, newPage);
  };

  // Catalog: toggle product selection
  const toggleCatalogProduct = (id: string) => {
    setSelectedCatalogIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Strip HTML tags and decode entities to plain text
  const stripHtml = (html: string): string => {
    // BUG-FE-34: Guard against SSR where DOMParser is unavailable
    if (typeof window === "undefined") return html;
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent?.trim() || "";
  };

  // Catalog: add selected products to context as structured data
  const handleAddToContext = () => {
    const selected = catalogProducts.filter(p => selectedCatalogIds.has(p.id));
    if (selected.length === 0) return;
    const newProducts = selected.map(p => ({
      product_id: p.id,
      title: stripHtml(p.title),
      description: stripHtml(p.description) || "No description available.",
      images: p.image_urls || (p.image_link ? [p.image_link] : []),
      brand: p.brand,
      category: p.category,
      sku: p.sku,
      price: String(p.price || ""),
      sale_price: String(p.sale_price || ""),
      product_url: p.product_url || "",
      extra_fields: p.extra_fields || {},
    }));
    setContextProducts(prev => [...prev, ...newProducts]);
    setSelectedCatalogIds(new Set());
    setCatalogOpen(false);
  };

  // Poll render status via usePolling
  const renderStatusEndpoint = useMemo(
    () => (pipelineId ? `/pipeline/status/${pipelineId}` : ""),
    [pipelineId]
  );

  // FE-15: Per-variant cache-bust timestamps stored in a ref so completing variant N
  // does NOT cause variant M's video to reload and interrupt playback.
  const videoCacheBustRef = useRef<Record<string, number>>({});
  const completedFingerprint = useMemo(
    () => variantStatuses.filter(v => v.status === "completed").map(v => `${v.variant_index}${v.visual_version ? `_${v.visual_version}` : ""}`).join(","),
    [variantStatuses]
  );
  useEffect(() => {
    variantStatuses.filter(v => v.status === "completed").forEach(v => {
      const key = v.visual_version ? `${v.variant_index}_${v.visual_version}` : String(v.variant_index);
      if (!videoCacheBustRef.current[key]) {
        videoCacheBustRef.current[key] = Date.now();
      }
    });
  }, [completedFingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  const getVideoCacheBust = useCallback((variantIndex: number, visualVersion?: string) => {
    const key = visualVersion ? `${variantIndex}_${visualVersion}` : String(variantIndex);
    return videoCacheBustRef.current[key] || Date.now();
  }, []);
  const { startPolling: startRenderPolling, stopPolling: stopRenderPolling } = usePolling<{
    variants: VariantStatus[];
    meta_variants?: VariantStatus[];
    meta_multiplication?: boolean;
    library_project_id?: string | null;
  }>({
    endpoint: renderStatusEndpoint,
    interval: 2000,
    enabled: false,
    onData: (data) => {
      const allVariants = data.variants || [];
      const metaVariants = data.meta_variants || [];
      // Only show variants that have been submitted for rendering (not "not_started")
      // When meta_variants exist, replace the base variants with meta versions
      const renderedVariants = metaVariants.length > 0
        ? metaVariants.filter((v) => v.status !== "not_started")
        : allVariants.filter((v) => v.status !== "not_started");
      setMetaMultiplication(Boolean(data.meta_multiplication || metaVariants.length > 0));
      setVariantStatuses(renderedVariants);
      if (data.library_project_id) setLibraryProjectId(data.library_project_id);
      // Stop polling only when every rendered variant is done (ignore not_started ones)
      // AND library save has resolved (true or error) for all completed variants.
      // Without this, polling stops while library_saved is still false (race condition).
      const allComplete =
        renderedVariants.length > 0 &&
        renderedVariants.every(
          (v) => v.status === "completed" || v.status === "failed" || v.status === "cancelled" || v.status === "stale"
        );
      const librarySavesPending = renderedVariants.some(
        (v) => v.status === "completed" && v.library_saved === false && !v.library_error
      );
      if (allComplete && !librarySavesPending) {
        stopRenderPolling();
        setIsRendering(false);
      }
    },
    onError: (err) => {
      handleApiError(err, "Error updating pipeline status");
    },
  });

  // Keep render polling alive while the user switches between Edit and Export.
  useEffect(() => {
    if (pipelineId && isRendering) {
      startRenderPolling();
    } else {
      stopRenderPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, isRendering]);

  // Check for existing renders when on Step 3 (show "view existing" button)
  useEffect(() => {
    if (step === 3 && pipelineId) {
      apiGet(`/pipeline/status/${pipelineId}`)
        .then(res => res.json())
        .then(data => {
          if (!data?.variants) return;
          setMetaMultiplication(Boolean(data.meta_multiplication || (data.meta_variants?.length ?? 0) > 0));
          const currentScriptCount = scripts.length;
          const allVars = (data.meta_variants?.length > 0 ? data.meta_variants : data.variants) || [];
          const completed = allVars.filter(
            (v: { status: string; variant_index: number; final_video_path?: string }) =>
              v.status === "completed" &&
              v.final_video_path &&
              v.variant_index < currentScriptCount
          );
          setExistingRenderCount(completed.length);
        })
        .catch(() => setExistingRenderCount(0));
    } else {
      setExistingRenderCount(0);
    }
  }, [step, pipelineId, scripts.length]);

  // One-time status check when entering Step 4 (detect already-complete variants)
  // FE-04: Removed isRendering guard — this check must run regardless of rendering state
  // so that returning to Step 4 (e.g. via history) shows completed variants.
  useEffect(() => {
    if (step === 4 && pipelineId) {
      // Chain status and scripts calls to avoid stale closure on variantStatuses
      const statusPromise = apiGet(`/pipeline/status/${pipelineId}`)
        .then(res => res.json())
        .then(data => {
          if (!data?.variants) return [];
          setMetaMultiplication(Boolean(data.meta_multiplication || (data.meta_variants?.length ?? 0) > 0));
          // Filter out not_started variants (same logic as polling onData)
          // When meta_variants exist, use those instead (meta multiplication renders)
          const sourceVars = (data.meta_variants?.length > 0 ? data.meta_variants : data.variants) || [];
          const rendered = sourceVars.filter(
            (v: { status: string }) => v.status !== "not_started"
          );
          setVariantStatuses(rendered);
          const allDone =
            rendered.length > 0 &&
            rendered.every(
              (v: { status: string }) => v.status === "completed" || v.status === "failed" || v.status === "cancelled" || v.status === "stale"
            );
          if (allDone) {
            setIsRendering(false);
          } else if (rendered.some((v: { status: string }) => v.status === "queued" || v.status === "processing")) {
            // Resume polling after reopening a pipeline with live queue/render work.
            setIsRendering(true);
          }
          return rendered;  // Pass fresh statuses to the next .then()
        })
        .catch(() => [] as VariantStatus[]);

      // Restore context products and saved captions from pipeline
      // (products selected in Step 1 must be visible in Step 4 for caption generation)
      // Wait for status to resolve so we have fresh variantStatuses for clip_id mapping
      Promise.all([
        statusPromise,
        apiGet(`/pipeline/scripts/${pipelineId}`).then(res => res.json()).catch(() => null),
      ]).then(([freshStatuses, data]) => {
        if (!data) return;
        setContextProducts(data?.context_products || []);
        // Restore saved captions from DB
        // Priority: selected_captions (user edits) > captions arr[0] (AI default)
        const selectedCaptions = data?.selected_captions || {};
        const aiCaptions = data?.captions || {};
        const hasSelected = Object.keys(selectedCaptions).length > 0;
        const hasAi = Object.keys(aiCaptions).length > 0;
        if ((hasSelected || hasAi) && Object.keys(generatedCaptions).length === 0) {
          const captionMap: Record<string, string> = {};
          for (const [captionKey, captionText] of Object.entries(selectedCaptions)) {
            const byClip = freshStatuses.find((v: VariantStatus) => v.clip_id === captionKey);
            if (byClip?.clip_id) {
              captionMap[byClip.clip_id] = String(captionText ?? "");
            }
          }
          // Get all legacy variant indices from either source
          const allVarIndices = new Set([
            ...Object.keys(selectedCaptions),
            ...Object.keys(aiCaptions),
          ]);
          for (const varIdx of allVarIndices) {
            if (!/^\d+$/.test(varIdx)) continue;
            const vs = freshStatuses.find((v: VariantStatus) => String(v.variant_index) === varIdx && !v.visual_version);
            if (!vs?.clip_id) continue;
            if (captionMap[vs.clip_id] !== undefined) continue;
            // If user has a saved selection (even empty = deliberately cleared), use it
            if (varIdx in selectedCaptions) {
              captionMap[vs.clip_id] = selectedCaptions[varIdx] || "";
            } else {
              // No user selection — fall back to first AI option
              const arr = aiCaptions[varIdx] as string[] | undefined;
              if (arr?.length) {
                captionMap[vs.clip_id] = arr[0];
              }
            }
          }
          if (Object.keys(captionMap).length > 0) {
            setGeneratedCaptions(captionMap);
          }
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pipelineId]);

  // Step 1: Generate scripts
  const handleGenerate = async () => {
    // BUG-FE-28: Guard against double-click while already generating
    if (isGenerating) return;
    if (!idea.trim()) return;
    if (selectedSegmentCount === 0) {
      setError("Select footage with at least one segment before generating scripts.");
      return;
    }

    const resolvedPipelineName = pipelineName.trim() || createScriptSetName(idea);
    if (!pipelineName.trim()) setPipelineName(resolvedPipelineName);

    scriptAbortRef.current?.abort();
    const abortController = new AbortController();
    scriptAbortRef.current = abortController;

    setError(null);
    setIsGenerating(true);
    setGenerationJob(null);
    let queued = false;

    try {
      const res = await apiPost("/pipeline/generate", {
        name: resolvedPipelineName,
        idea: idea.trim(),
        context: stripEmbeddedProductBlocks(context) || undefined,
        context_products: contextProducts.length > 0 ? contextProducts : undefined,
        variant_count: variantCount,
        provider,
        codex_model: codexModel.trim() || DEFAULT_CODEX_MODEL,
        target_script_duration: targetScriptDuration,
      }, { timeout: 60_000, signal: abortController.signal });

      if (abortController.signal.aborted || !isMountedRef.current) return;

      // apiPost throws on non-OK responses — no need for res.ok check (FE-01)
      const data = await res.json();
      if (!isMountedRef.current) return;
      setPipelineId(data.pipeline_id);
      pipelineIdRef.current = data.pipeline_id;
      setGenerationJob(data.job || {
        status: data.status || "queued",
        progress: 0,
        current_step: "Queued for script generation",
      });
      queued = true;
      fetchHistory();
    } catch (err) {
      if (abortController.signal.aborted) return;
      handleApiError(err, "Error generating scripts");
      if (err instanceof ApiError) {
        if (err.isTimeout) {
          setError("Script generation timed out. Please try again.");
        } else {
          setError(err.detail || err.message || "Script generation failed. Please try again.");
        }
      } else {
        setError("Network error. Please check if the backend is running.");
      }
    } finally {
      if (!queued && !abortController.signal.aborted && isMountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  const handleCancelGenerate = async () => {
    scriptAbortRef.current?.abort();
    scriptAbortRef.current = null;
    if (!pipelineId) {
      setIsGenerating(false);
      return;
    }
    try {
      const res = await apiPost(`/pipeline/generation-cancel/${pipelineId}`, {});
      const data = await res.json();
      setGenerationJob(data.job || {
        status: "cancelled",
        progress: generationJob?.progress || 0,
        current_step: "Generation cancelled",
      });
    } catch (err) {
      handleApiError(err, "Could not cancel script generation");
    } finally {
      setIsGenerating(false);
    }
  };

  // Create a pipeline with empty script slots so the user can author them by hand
  // in Step 2 (each DebouncedTextarea is already editable). Reuses /pipeline/import
  // which is the same endpoint the history sidebar uses to restore prior scripts.
  const handleCreateManual = async () => {
    if (isGenerating) return;
    setError(null);
    setIsGenerating(true);
    setGenerationJob(null);
    try {
      const emptyScripts = Array.from({ length: variantCount }, () => "");
      const resolvedPipelineName = pipelineName.trim() || createScriptSetName(idea || "Manual scripts");
      if (!pipelineName.trim()) setPipelineName(resolvedPipelineName);
      const res = await apiPost("/pipeline/import", {
        name: resolvedPipelineName,
        idea: idea.trim() || "Manual scripts",
        context: stripEmbeddedProductBlocks(context) || "",
        context_products: contextProducts,
        scripts: emptyScripts,
        provider,
      }, { timeout: 60_000 });
      const data = await res.json();
      if (!isMountedRef.current) return;
      setPipelineId(data.pipeline_id);
      setScripts(emptyScripts);
      setScriptNames(defaultScriptNames(emptyScripts.length));
      setTotalSegmentDuration(0);
      setStep(2);
      fetchHistory();
    } catch (err) {
      handleApiError(err, "Error creating manual pipeline");
      if (err instanceof ApiError) {
        setError(err.detail || err.message || "Failed to create manual pipeline.");
      } else {
        setError("Network error. Please check if the backend is running.");
      }
    } finally {
      if (isMountedRef.current) setIsGenerating(false);
    }
  };

  // Step 2: Preview all matches
  const handlePreviewAll = async () => {
    if (!pipelineId) {
      setPreviewError("No pipeline ID. Please generate or load scripts first.");
      return;
    }

    // Cancel any in-flight preview requests from a previous run
    previewAbortRef.current?.abort();
    const abortController = new AbortController();
    previewAbortRef.current = abortController;

    setPreviewError(null);
    const newPreviews: Record<PreviewKey, PreviewData> = {};
    const cardsToPreview = previewCards;
    // Snapshot the one-shot template bindings for the whole batch. They must
    // remain available to every variant, then be consumed only after the full
    // batch succeeds so later timing changes can use the fresh server result.
    const importedTimelineBatch = beginImportedTemplateTimelineBatch(importedTemplateTimelineRef);
    const importedTimelineForBatch = importedTimelineBatch.timeline;

    // Snapshot ready-count BEFORE the loop. ttsResultsRef is mutated during the loop
    // (setTtsResults triggers re-renders that update the ref), so evaluating this after
    // the loop would always be "all ready" and trigger auto-advance incorrectly.
    const initialReadyCount = scripts.filter((_, i) => { const r = ttsResultsRef.current[i]; return !!r && r.audio_duration > 0 && !r.generating && !r.stale; }).length;
    const skipReview = initialReadyCount === scripts.length && scripts.length > 0;

    // FE-05: Wrap in try/finally to guarantee setPreviewingIndex(null) is always called
    try {
      for (let i = 0; i < cardsToPreview.length; i++) {
        if (abortController.signal.aborted) { setPreviewingIndex(null); return; }
        setPreviewingIndex(i);
        const previewCard = cardsToPreview[i];
        try {
          const res = await apiPost(`/pipeline/preview/${pipelineId}/${previewCard.baseIndex}`, {
            elevenlabs_model: elevenlabsModel,
            voice_id: voiceId && voiceId !== "default" ? voiceId : undefined,
            source_video_ids: selectedSourceIdsRef.current.size > 0 ? Array.from(selectedSourceIdsRef.current) : undefined, // Bug #120: use ref
            voice_settings: {
              stability: voiceStability,
              similarity_boost: voiceSimilarity,
              style: voiceStyle,
              speed: voiceSpeed,
              use_speaker_boost: voiceSpeakerBoost,
            },
            words_per_subtitle: getWordsPerSubtitleForVariant(previewCard.baseIndex, previewCard.key),
            min_segment_duration: minSegmentDuration,
            ultra_rapid_intro: ultraRapidIntro,
            visual_version: previewCard.visualVersion,
            preset: assemblyPreset,
            segment_proximity: segmentProximity,
          }, { timeout: 300_000, signal: abortController.signal }); // 5 min — TTS generation + SRT can be slow

          if (abortController.signal.aborted || !isMountedRef.current) { setPreviewingIndex(null); return; }

          // apiPost throws on non-OK responses — no need for res.ok check (FE-01)
          const responseData = await res.json() as PreviewData;
          const importedMatches = importedTimelineForBatch?.matches?.[previewCard.key];
          const importedComposition = importedTimelineForBatch?.compositions?.[previewCard.key];
          const data: PreviewData = {
            ...responseData,
            ...(Array.isArray(importedMatches) ? {
              matches: importedMatches,
              matched_count: importedMatches.filter((match) => !!match.segment_id).length,
              unmatched_count: importedMatches.filter((match) => !match.segment_id).length,
            } : {}),
            ...(Array.isArray(importedComposition) && importedComposition.length > 0 ? {
              video_timeline: importedComposition,
              intro_offset_sec: importedComposition
                .filter((clip) => clip.kind === "intro")
                .reduce((sum, clip) => sum + clip.timeline_duration, 0),
            } : {}),
          };
          if (!isMountedRef.current) return;
          newPreviews[previewCard.key] = data;
          // Keep the variant default transition across preview regeneration —
          // the preview response rebuilds the blob and doesn't carry it.
          setPreviews(prev => ({
            ...prev,
            [previewCard.key]: {
              ...data,
              defaultTransition: prev[previewCard.key]?.defaultTransition ?? null,
            },
          }));
          if (Array.isArray(importedMatches)) {
            void apiPut(`/pipeline/${pipelineId}/matches/${previewCard.baseIndex}`, {
              matches: importedMatches,
              visual_version: previewCard.visualVersion,
            }).catch(() => {});
          }
          if (Array.isArray(importedComposition) && importedComposition.length > 0) {
            void apiPut(`/pipeline/${pipelineId}/composition/${previewCard.baseIndex}`, {
              video_timeline: importedComposition,
              visual_version: previewCard.visualVersion,
            }).catch(() => {});
          }
          // Sync ttsResults from preview response — TTS is generated as part of preview
          if (data.audio_duration > 0) {
            setTtsResults(prev => ({
              ...prev,
              [previewCard.baseIndex]: {
                audio_duration: data.audio_duration,
                generating: false,
                stale: false,
                srt_content: data.srt_content,
              }
            }));
          }
        } catch (err) {
          if (abortController.signal.aborted) { setPreviewingIndex(null); return; }
          handleApiError(err, "Error previewing variants");
          // M11: Only clear the failed variant's preview, not all previews
          setPreviews(prev => {
            const updated = { ...prev };
            delete updated[previewCard.key];
            return updated;
          });
          setPreviewingIndex(null);
          if (err instanceof ApiError) {
            if (err.isTimeout) {
              setPreviewError("Preview timed out. Please try again.");
            } else {
              setPreviewError(err.detail || err.message || `Failed to preview ${previewCard.label}.`);
            }
          } else {
            setPreviewError("Network error. Please check if the backend is running.");
          }
          return;
        }
      }

      importedTimelineBatch.commit();

      // Collect available segments from the first preview response (all previews share same segment pool)
      const firstPreview = Object.values(newPreviews)[0];
      if (firstPreview?.available_segments && firstPreview.available_segments.length > 0) {
        setAvailableSegments(firstPreview.available_segments);
      }

      // Select all variants by default
      const allIndices = new Set(scripts.map((_, i) => i));
      setSelectedVariants(allIndices);

      // Auto-advance to Step 3 only when the user clicked "Generate Previews" (TTS was
      // already ready at start). When the user clicked "Generate Voice-Overs", stay on
      // Step 2 and scroll back to the top so they can review the newly-generated audio.
      if (skipReview && Object.keys(newPreviews).length > 0) {
        setStep(3);
      } else if (Object.keys(newPreviews).length > 0) {
        step2HeaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } finally {
      if (isMountedRef.current) setPreviewingIndex(null);
    }
  };
  handlePreviewAllRef.current = handlePreviewAll;

  // Debounced re-fetch of all previews — used when assembly controls (preset,
  // min segment duration, rapid intro) change, so a slider drag doesn't fire
  // a preview request per tick.
  const reassemblePreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReassemblePreviews = useCallback(() => {
    if (reassemblePreviewTimer.current) clearTimeout(reassemblePreviewTimer.current);
    reassemblePreviewTimer.current = setTimeout(() => {
      reassemblePreviewTimer.current = null;
      handlePreviewAllRef.current?.();
    }, 500);
  }, []);

  const handleMetaMultiplicationChange = useCallback(async (checked: boolean) => {
    setMetaMultiplication(checked);
    setPreviews(prev => {
      const next = { ...prev };
      if (checked) {
        for (let i = 0; i < scripts.length; i++) {
          const baseKey = buildPreviewKey(i);
          const metaAKey = buildPreviewKey(i, "A");
          if (next[baseKey] && !next[metaAKey]) {
            next[metaAKey] = next[baseKey];
          }
        }
      } else {
        for (let i = 0; i < scripts.length; i++) {
          const baseKey = buildPreviewKey(i);
          const metaAKey = buildPreviewKey(i, "A");
          if (!next[baseKey] && next[metaAKey]) {
            next[baseKey] = next[metaAKey];
          }
        }
      }
      return next;
    });
    setInterstitialSlides(prev => {
      const next = { ...prev };
      if (checked) {
        for (let i = 0; i < scripts.length; i++) {
          const baseKey = buildPreviewKey(i);
          const metaAKey = buildPreviewKey(i, "A");
          if (next[baseKey] && !next[metaAKey]) {
            next[metaAKey] = next[baseKey];
          }
        }
      } else {
        for (let i = 0; i < scripts.length; i++) {
          const baseKey = buildPreviewKey(i);
          const metaAKey = buildPreviewKey(i, "A");
          if (!next[baseKey] && next[metaAKey]) {
            next[baseKey] = next[metaAKey];
          }
        }
      }
      return next;
    });
    if (checked) {
      setPreviewError("Meta Multiplication enabled. Run Generate Previews again to also create the B/Facebook previews.");
    } else {
      setPreviewError(null);
    }
    if (!pipelineId) return;
    try {
      await apiPut(`/pipeline/${pipelineId}/meta-multiplication`, {
        enabled: checked,
      });
    } catch (err) {
      console.warn("[Pipeline] Failed to persist meta_multiplication:", err);
    }
  }, [buildPreviewKey, pipelineId, scripts.length]);

  const buildPipOverlaysForMatches = (matches: MatchPreview[] | undefined) => {
    const pipOverlays: Record<string, { image_url: string; position: string; size: string; animation: string }> = {};
    for (const match of matches ?? []) {
      if (!match.segment_id) continue;
      const assoc = associations[match.segment_id];
      if (!assoc?.pip_config?.enabled) continue;
      const imageUrl = assoc.selected_image_urls?.[0] || assoc.product_image;
      if (!imageUrl) continue;
      pipOverlays[match.segment_id] = {
        image_url: imageUrl,
        position: assoc.pip_config.position,
        size: assoc.pip_config.size,
        animation: assoc.pip_config.animation,
      };
    }
    return pipOverlays;
  };

  const capturePipelineTemplateSettings = (): PipelineTemplateSettings => {
    const matches: PipelineTemplateSettings["timeline"]["matches"] = {};
    const compositions: PipelineTemplateSettings["timeline"]["compositions"] = {};
    const pipOverlays: PipelineTemplateSettings["timeline"]["pipOverlays"] = {
      ...templatePipOverlays,
    };
    for (const [key, preview] of Object.entries(previews)) {
      if (Array.isArray(preview.matches)) matches[key] = preview.matches;
      if (Array.isArray(preview.video_timeline)) compositions[key] = preview.video_timeline;
      Object.assign(pipOverlays, buildPipOverlaysForMatches(preview.matches));
    }
    const adjustments: RenderAdjustments = { ...renderAdjust };

    // This object is intentionally exhaustive against PipelineTemplateSettings.
    // Adding a setting to the contract without capturing it fails type-checking.
    return {
      generation: {
        name: pipelineName,
        idea,
        context: stripEmbeddedProductBlocks(context),
        contextProducts,
        variantCount,
        targetScriptDuration,
        provider,
        codexModel,
        aiInstructions,
      },
      content: {
        scripts: scripts.map((text, index) => ({
          name: scriptNames[index] || `Script ${index + 1}`,
          text,
        })),
        approvedScriptIndices: Array.from(approvedScripts).sort((a, b) => a - b),
        generatedCaptions,
        generatedYoutubeTitles,
      },
      voice: {
        model: elevenlabsModel,
        voice: {
          id: voiceId,
          name: voices.find((voice) => voice.voice_id === voiceId)?.name || "",
        },
        stability: voiceStability,
        similarity: voiceSimilarity,
        style: voiceStyle,
        speed: voiceSpeed,
        speakerBoost: voiceSpeakerBoost,
        wordsPerSubtitle,
      },
      assembly: {
        minSegmentDuration,
        ultraRapidIntro,
        preset: assemblyPreset,
        segmentProximity,
        sourceVideos: Array.from(selectedSourceIds).map((id) => ({
          id,
          name: sourceVideos.find((video) => video.id === id)?.name || "",
        })),
      },
      timeline: {
        selectedVariantIndices: Array.from(selectedVariants).sort((a, b) => a - b),
        matches,
        compositions,
        interstitialSlides,
        attentionSelection,
        attentionTimelines,
        variantThumbnails,
        pipOverlays,
      },
      subtitles: {
        default: subtitleSettings,
        overrides: subtitleOverrides,
        variantOverrides: variantSubtitleOverrides,
        rotation: subtitleRotation,
        variantTemplates: variantTemplateSelections,
      },
      render: {
        presetName,
        encoding: renderSettings,
        adjustments,
        metaMultiplication,
      },
    };
  };

  const handleExportPipelineTemplate = async () => {
    if (!pipelineId || templateTransferBusy) return;
    setTemplateTransferBusy("export");
    try {
      const settings = capturePipelineTemplateSettings();
      await apiPut(`/pipeline/${pipelineId}/template-settings`, { settings });
      const response = await apiGet(`/pipeline/${pipelineId}/template`, {
        cache: "no-store",
        memoryCache: false,
      });
      const document = await response.json() as PipelineTemplateDocument;
      const blobUrl = URL.createObjectURL(new Blob(
        [JSON.stringify(document, null, 2)],
        { type: "application/json" },
      ));
      const anchor = window.document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = pipelineTemplateFilename(pipelineName || "pipeline");
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
      toast.success("Pipeline template exported");
    } catch (exportError) {
      handleApiError(exportError, "Pipeline template export failed");
    } finally {
      setTemplateTransferBusy(null);
    }
  };

  const handleImportPipelineTemplate = async (file: File) => {
    if (templateTransferBusy) return;
    if (isRendering) {
      toast.error("Stop the active render before importing a template");
      return;
    }
    if (file.size > 2_500_000) {
      toast.error("Template file is larger than 2 MB");
      return;
    }
    setTemplateTransferBusy("import");
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const response = await apiPost("/pipeline/template/import", parsed, { timeout: 60_000 });
      const imported = await response.json() as PipelineTemplateImportResponse;

      stopRenderPolling();
      setGenerationJob(null);
      setIsGenerating(false);
      setPreviews({});
      setTtsResults({});
      setLibraryMatches({});
      setVariantStatuses([]);
      setIsRendering(false);
      setPreviewError(null);
      applyPipelineTemplateSettings(imported.settings, imported.pipeline_id);
      setScripts(imported.scripts);
      setScriptNames(imported.script_names);
      setPipelineId(imported.pipeline_id);
      pipelineIdRef.current = imported.pipeline_id;
      setStep(2);
      await fetchHistory();

      if (imported.warnings?.length) {
        toast.warning(
          `${imported.warnings.length} media binding${imported.warnings.length === 1 ? "" : "s"} could not be restored`,
          { description: imported.warnings.slice(0, 3).join("; ") },
        );
      } else {
        toast.success("Pipeline template imported");
      }
    } catch (importError) {
      if (importError instanceof SyntaxError) {
        toast.error("The selected file is not valid JSON");
      } else {
        handleApiError(importError, "Pipeline template import failed");
      }
    } finally {
      setTemplateTransferBusy(null);
    }
  };

  // Build the render payload (shared between check-render and render calls)
  const buildRenderPayload = () => {
    const matchOverrides: Record<string, MatchPreview[]> = {};
    const compositionOverrides: Record<string, CompositionClip[]> = {};
    const musicOverrides: Record<string, MusicSettings> = {};
    const selectedPreviewCards = previewCards.filter(card => selectedVariants.has(card.baseIndex));
    for (const card of selectedPreviewCards) {
      if (previews[card.key]?.music) {
        musicOverrides[card.key] = previews[card.key].music!;
      }
      if (previews[card.key]?.matches && previews[card.key].matches.length > 0) {
        matchOverrides[card.key] = previews[card.key].matches;
      } else {
        console.warn(
          `[Render] Variant ${card.key}: no match_overrides available — render will use auto-matching (may differ from preview!). ` +
          `previews[${card.key}] exists: ${!!previews[card.key]}, matches count: ${previews[card.key]?.matches?.length ?? 0}`
        );
      }
      if (previews[card.key]?.video_timeline?.length) {
        // Resolve the variant default into concrete per-boundary transitions so
        // the backend never receives indirection (no-op until the P1 UI sets it).
        compositionOverrides[card.key] = resolveCompositionTransitions(
          previews[card.key].video_timeline!,
          previews[card.key].defaultTransition,
        );
      }
    }

    // Merge user interstitial slides with thumbnail slides (thumbnail = first frame)
    const mergedInterstitialSlides: Record<string, InterstitialSlide[]> = {};
    for (const card of selectedPreviewCards) {
      const userSlides = (interstitialSlides[card.key] ?? []).filter((s) => s.imageUrl);
      const thumb = variantThumbnails[card.key];
      const thumbSlide: InterstitialSlide[] = thumb
        ? [{
            id: `thumb_${card.key}`,
            afterMatchIndex: -1,
            imageUrl: `${API_URL}/segments/files/${encodeURIComponent(thumb.imageUrl.split("/").pop() || thumb.imageUrl)}`,
            duration: 0.75,
            animation: "kenburns" as const,
            kenBurnsDirection: "zoom-in" as const,
          }]
        : [];
      const combined = [...thumbSlide, ...userSlides];
      if (combined.length > 0) {
        mergedInterstitialSlides[card.key] = combined;
      }
    }
    const filteredInterstitialSlides = Object.keys(mergedInterstitialSlides).length > 0
      ? mergedInterstitialSlides
      : undefined;

    const pipOverlays: Record<string, { image_url: string; position: string; size: string; animation: string }> = {
      ...templatePipOverlays,
    };
    for (const card of selectedPreviewCards) {
      Object.assign(pipOverlays, buildPipOverlaysForMatches(previews[card.key]?.matches));
    }

    return {
      variant_indices: Array.from(selectedVariants),
      preset_name: presetName,
      output_width: renderSettings.output_width || 1080,
      output_height: renderSettings.output_height || 1920,
      elevenlabs_model: elevenlabsModel,
      voice_id: voiceId && voiceId !== "default" ? voiceId : undefined,
      source_video_ids: selectedSourceIdsRef.current.size > 0 ? Array.from(selectedSourceIdsRef.current) : undefined,
      match_overrides: Object.keys(matchOverrides).length > 0 ? matchOverrides : undefined,
      composition_overrides: Object.keys(compositionOverrides).length > 0
        ? compositionOverrides
        : undefined,
      music_overrides: Object.keys(musicOverrides).length > 0
        ? musicOverrides
        : undefined,
      interstitial_slides: filteredInterstitialSlides,
      attention_timelines: Object.fromEntries(
        selectedPreviewCards
          .filter(card => attentionTimelines[card.key]?.cues.length)
          .map(card => [card.key, attentionTimelines[card.key]])
      ),
      pip_overlays: Object.keys(pipOverlays).length > 0 ? pipOverlays : undefined,
      encoding_mode: renderSettings.encoding_mode,
      target_bitrate_kbps: renderSettings.encoding_mode !== "crf" ? renderSettings.target_bitrate_kbps : undefined,
      audio_bitrate_kbps: renderSettings.audio_bitrate_kbps,
      video_profile: renderSettings.video_profile,
      video_level: renderSettings.video_level,
      force_cpu: renderSettings.force_cpu,
      voice_settings: {
        stability: voiceStability,
        similarity_boost: voiceSimilarity,
        style: voiceStyle,
        speed: voiceSpeed,
        use_speaker_boost: voiceSpeakerBoost,
      },
      words_per_subtitle: wordsPerSubtitle,
      words_per_subtitle_by_key: Object.fromEntries(
        selectedPreviewCards.map((card) => [
          card.key,
          getWordsPerSubtitleForVariant(card.baseIndex, card.key),
        ]),
      ),
      min_segment_duration: minSegmentDuration,
      ultra_rapid_intro: ultraRapidIntro,
      preset: assemblyPreset,
      segment_proximity: segmentProximity,
      meta_multiplication: metaMultiplication,
      // Picture & audio adjustments from the Export workspace
      enable_color: renderAdjust.enableColor,
      brightness: renderAdjust.brightness,
      contrast: renderAdjust.contrast,
      saturation: renderAdjust.saturation,
      voice_volume: renderAdjust.voiceVolume,
      audio_fade_in: renderAdjust.audioFadeIn,
      audio_fade_out: renderAdjust.audioFadeOut,
      // Flat fields = DEFAULT subtitle style. Backend uses these for any
      // variant key that has no entry in subtitle_settings_by_key.
      font_size: subtitleSettings.fontSize,
      font_family: subtitleSettings.fontFamily,
      text_color: subtitleSettings.textColor,
      outline_color: subtitleSettings.outlineColor,
      outline_width: subtitleSettings.outlineWidth,
      position_y: subtitleSettings.positionY,
      shadow_depth: subtitleSettings.shadowDepth ?? 0,
      shadow_color: subtitleSettings.shadowColor ?? "#000000",
      border_style: subtitleSettings.borderStyle ?? 1,
      enable_glow: subtitleSettings.enableGlow ?? false,
      glow_blur: subtitleSettings.glowBlur ?? 0,
      adaptive_sizing: subtitleSettings.adaptiveSizing ?? false,
      opacity: subtitleSettings.opacity ?? 100,
      horizontal_alignment: subtitleSettings.horizontalAlignment ?? "center",
      letter_spacing: subtitleSettings.letterSpacing ?? 0,
      karaoke: subtitleSettings.karaoke ?? false,
      highlight_color: subtitleSettings.highlightColor ?? "#FFFF00",
      karaoke_style: subtitleSettings.karaokeStyle ?? "color",
      highlight_bg_color: subtitleSettings.highlightBgColor ?? "#A3E635",
      // Per-Meta-version overrides. Only non-empty entries are sent — the
      // backend's PUT regex rejects `{}` entries, so we filter them out to
      // match the same contract when we POST to /render. When no overrides
      // remain after filtering, omit the field entirely so the backend
      // takes the simpler code path (flat defaults only).
      subtitle_settings_by_key: (() => {
        const filtered: Record<string, SubtitleSettings> = {};
        if (subtitleRotation.enabled || Object.keys(variantTemplateSelections).length > 0) {
          for (const card of selectedPreviewCards) {
            filtered[card.key] = getPreviewSubtitleSettingsFor(card);
          }
          return filtered;
        }
        for (const [k, v] of Object.entries(subtitleOverrides) as [StyleKey, SubtitleSettings | undefined][]) {
          if (v && Object.keys(v).length > 0) filtered[k] = v;
        }
        return Object.keys(filtered).length > 0 ? filtered : undefined;
      })(),
    };
  };

  // Step 3: Check for existing renders before starting
  const handleRenderClick = async () => {
    if (!pipelineId || selectedVariants.size === 0) return;

    // Warn if any selected variant has no preview (match_overrides will be missing)
    const unpreviewedVariants = previewCards
      .filter(card => selectedVariants.has(card.baseIndex))
      .filter(card => !previews[card.key]?.matches || previews[card.key].matches.length === 0)
      .map(card => card.label);
    if (unpreviewedVariants.length > 0) {
      const proceed = window.confirm(
        `Variant(s) ${unpreviewedVariants.join(", ")} have not been previewed. ` +
        `The render may produce different segment cuts than expected. Continue anyway?`
      );
      if (!proceed) return;
    }

    setPreviewError(null);

    // Check if any variants can skip re-rendering
    try {
      setIsCheckingRender(true);
      const payload = buildRenderPayload();
      const checkResponse = await apiPost(`/pipeline/check-render/${pipelineId}`, payload, { timeout: 10_000 });
      const checkRes = await checkResponse.json() as { results: RenderCheckResult[]; any_skippable: boolean } | null;
      if (checkRes?.any_skippable) {
        setSkipCheckResults(checkRes.results);
        setShowSkipDialog(true);
        return;
      }
    } catch (err) {
      // If check fails, proceed with normal render (non-blocking)
      console.warn("[Render] Skip check failed, proceeding with full render:", err);
    } finally {
      setIsCheckingRender(false);
    }

    // No skippable variants — render all directly
    handleRender([]);
  };

  // Execute render with optional skip list
  const handleRender = async (skipVariants: number[]) => {
    if (!pipelineId || selectedVariants.size === 0) return;

    setShowSkipDialog(false);
    setSkipCheckResults(null);

    // Stop all active audio/video playback before transitioning to render step
    stopCurrentAudio();
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    setPreviewVariant(null);

    const skipSet = new Set(skipVariants);

    // Build initial variant statuses — skipped variants show as cached/completed
    const initialStatuses: VariantStatus[] = Array.from(selectedVariants).map(idx => {
      if (skipSet.has(idx)) {
        return {
          variant_index: idx,
          status: "completed" as const,
          progress: 100,
          current_step: "Existing render used",
        };
      }
      return {
        variant_index: idx,
        status: "queued" as const,
        progress: 0,
        current_step: "Queued for render",
      };
    });

    const payload = buildRenderPayload();

    try {
      const res = await apiPost(`/pipeline/render/${pipelineId}`, {
        ...payload,
        skip_variants: skipVariants.length > 0 ? skipVariants : undefined,
      }, { timeout: renderSettings.encoding_mode === "vbr_2pass" ? 1_200_000 : 600_000 });

      if (!isMountedRef.current) return;
      setIsRendering(true);
      setVariantStatuses(initialStatuses);
      setStep(4);
    } catch (err) {
      handleApiError(err, "Error generating variants");
      if (err instanceof ApiError) {
        if (err.isTimeout) {
          setPreviewError("Render timed out. Please try again.");
        } else {
          setPreviewError(err.detail || err.message || "Failed to start render. Please try again.");
        }
      } else {
        setPreviewError("Network error. Please check if the backend is running.");
      }
      setVariantStatuses([]);
      setIsRendering(false);
    }
  };

  // Cancel render
  const handleCancelRender = async () => {
    if (!pipelineId) return;
    try {
      await apiPost(`/pipeline/${pipelineId}/cancel`, {});
      stopRenderPolling();
      setIsRendering(false);
      setVariantStatuses(prev =>
        prev.map(v =>
          v.status === "queued" || v.status === "processing"
            ? { ...v, status: "cancelled" as const, current_step: "Cancelled by user", progress: 0, queue_position: undefined, eta_seconds: undefined }
            : v
        )
      );
      toast.success("Render cancelled");
    } catch (err) {
      handleApiError(err, "Failed to cancel render");
    }
  };

  // Remake variant with different segments (same voiceover)
  const handleRemakeVariant = async (variantIndex: number, visualVersion?: string) => {
    if (!pipelineId) return;
    const statusMatches = (v: VariantStatus) =>
      v.variant_index === variantIndex &&
      (visualVersion ? v.visual_version === visualVersion : !v.visual_version);

    // Optimistic UI: the remake enters the same fair queue as new renders.
    setVariantStatuses(prev =>
      prev.map(v =>
        statusMatches(v)
          ? { ...v, status: "queued" as const, progress: 0, current_step: "Queued for remake", final_video_path: undefined, render_fingerprint: undefined, queue_position: undefined, eta_seconds: undefined }
          : v
      )
    );

    try {
      const payload = buildRenderPayload();
      // Remove match_overrides — backend will auto-match with different segments
      delete payload.match_overrides;
      delete payload.composition_overrides;
      payload.variant_indices = [variantIndex];

      const url = `/pipeline/remake/${pipelineId}/${variantIndex}` + (visualVersion ? `?visual_version=${encodeURIComponent(visualVersion)}` : "");
      await apiPost(url, payload, {
        timeout: renderSettings.encoding_mode === "vbr_2pass" ? 1_200_000 : 600_000,
      });

      // Restart polling
      setIsRendering(true);
      toast.success(`Variant ${variantIndex + 1} remake started`);
    } catch (err) {
      handleApiError(err, "Failed to remake variant");
      // Revert optimistic update
      setVariantStatuses(prev =>
        prev.map(v =>
          statusMatches(v)
            ? { ...v, status: "failed" as const, current_step: "Remake failed", progress: 0 }
            : v
        )
      );
    }
  };

  // Reset all state
  const resetPipeline = () => {
    // M10: Stop render polling before resetting state
    stopRenderPolling();
    setStep(1);
    setIdea("");
    // Keep `context` — it's reusable brand/business info (mass context) the user
    // shouldn't retype per video. Selected items (specific context) do reset.
    setContextProducts([]);
    setContextExpanded(true);
    setVariantCount(3);
    setProvider(DEFAULT_SCRIPT_AI_PROVIDER);
    setCodexModel(DEFAULT_CODEX_MODEL);
    setError(null);
    setPipelineId(null);
    setGenerationJob(null);
    setIsGenerating(false);
    setScripts([]);
    setScriptNames([]);
    setPreviews({});
    importedTemplateTimelineRef.current = null;
    activeTemplatePipelineIdRef.current = null;
    setTemplatePipOverlays({});
    setInterstitialSlides({});
    setAttentionTimelines({});
    setAttentionSelection(EMPTY_ATTENTION_SELECTION);
    attentionSelectionRef.current = EMPTY_ATTENTION_SELECTION;
    setVariantThumbnails({});
    setPreviewError(null);
    setSelectedVariants(new Set());
    setMetaMultiplication(true);
    setIsRendering(false);
    setVariantStatuses([]);
    setVoiceId("");
    setTtsResults({});
    setLibraryMatches({});
    setPlayingTtsVariant(null);
    setSelectedSourceIds(new Set());
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    // Starting fresh — drop the persisted session/draft so navigating away and
    // back doesn't resurrect the old pipeline.
    try {
      if (currentProfile?.id) {
        removeWorkspaceStorage(currentProfile.id, PIPELINE_SESSION_KEY);
        removeWorkspaceStorage(currentProfile.id, PIPELINE_DRAFT_KEY);
      }
    } catch { /* ignore */ }
  };

  // History sidebar: fetch pipeline list (Bug #54: wrapped in useCallback)
  const fetchHistory = useCallback(async () => {
    if (!currentProfile?.id) return;
    setHistoryLoading(true);
    try {
      const res = await apiGet("/pipeline/list?limit=20");
      const data = await res.json();
      setHistoryPipelines(data.pipelines || []);
    } catch (err) {
      handleApiError(err, "Failed to load pipeline history");
    } finally {
      setHistoryLoading(false);
    }
  }, [currentProfile?.id]);

  // Script generation is process-independent from the page lifecycle: the
  // persisted job can be polled again after refresh or history restore.
  const generationJobStatus = generationJob?.status;
  useEffect(() => {
    if (!pipelineId || (generationJobStatus !== "queued" && generationJobStatus !== "processing")) return;
    let disposed = false;
    let requestInFlight = false;

    const pollGeneration = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const res = await apiGet(`/pipeline/generation-status/${pipelineId}`, {
          cache: "no-store",
          memoryCache: false,
        });
        const data = await res.json();
        if (disposed || !isMountedRef.current) return;
        const job = (data.job || {}) as Partial<AsyncJobState>;
        setGenerationJob(job);

        if (job.status === "completed") {
          const generatedScripts = (data.scripts || []) as string[];
          const result = (job.result || {}) as Record<string, unknown>;
          setScripts(generatedScripts.map(formatScript));
          setScriptNames(
            data.script_names?.length === generatedScripts.length
              ? data.script_names
              : defaultScriptNames(generatedScripts.length),
          );
          setTotalSegmentDuration(Number(result.total_segment_duration) || 0);
          setIsGenerating(false);
          setStep(2);
          fetchHistory();
        } else if (job.status === "failed" || job.status === "cancelled") {
          setIsGenerating(false);
          if (job.status === "failed") {
            setError(job.error || "Script generation failed. Please try again.");
          }
          fetchHistory();
        }
      } catch (err) {
        if (!disposed) handleApiError(err, "Could not refresh script generation status");
      } finally {
        requestInFlight = false;
      }
    };

    void pollGeneration();
    const timer = window.setInterval(pollGeneration, 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [pipelineId, generationJobStatus, fetchHistory, setStep]);

  // History sidebar: fetch scripts for a specific pipeline
  const fetchHistoryScripts = async (id: string) => {
    if (selectedHistoryId === id) {
      setSelectedHistoryId(null);
      setHistoryScripts([]);
      setHistoryScriptNames([]);
      setHistorySelectedScripts(new Set());
      setHistoryPreviewInfo({});
      setHistoryTtsInfo({});
      setHistoryTtsJobs({});
      return;
    }
    setSelectedHistoryId(id);
    setHistoryScriptsLoading(true);
    setHistorySelectedScripts(new Set());
    try {
      const res = await apiGet(`/pipeline/scripts/${id}`);
      const data = await res.json();
      if (data.codex_model) setCodexModel(data.codex_model);
      const restoredJob = (data.generation_job || {}) as Partial<AsyncJobState>;
      if (isActiveAsyncJob(restoredJob)) {
        setPipelineId(id);
        pipelineIdRef.current = id;
        setGenerationJob(restoredJob);
        setIsGenerating(true);
        if (data.name) setPipelineName(data.name);
        if (data.idea) setIdea(data.idea);
        if (data.provider) setProvider(data.provider);
        if (data.variant_count) setVariantCount(data.variant_count);
        setSelectedHistoryId(null);
        setStep(1);
        return;
      }
      const scriptsArr = data.scripts || data || [];
      setHistoryScripts(scriptsArr);
      setHistoryScriptNames(
        data.script_names?.length === scriptsArr.length
          ? data.script_names
          : defaultScriptNames(scriptsArr.length),
      );
      // Select all by default
      setHistorySelectedScripts(new Set(scriptsArr.map((_: string, i: number) => i)));
      // Store preview info for audio indicators
      if (data.preview_info) {
        setHistoryPreviewInfo(data.preview_info);
      } else {
        setHistoryPreviewInfo({});
      }
      // Store TTS info (Step 2 per-script TTS)
      setHistoryTtsInfo(data.tts_info || {});
      setHistoryTtsJobs(data.tts_jobs || {});
      // Store context products for restore
      setHistoryContextProducts(data.context_products || []);
      setHistoryAttentionSelection(
        data.attention_selection?.templateId
          ? normalizeAttentionSelection(data.attention_selection)
          : null,
      );
      setHistoryTemplateSettings(
        isPipelineTemplateSettings(data.template_settings) ? data.template_settings : null,
      );
    } catch (err) {
      handleApiError(err, "Failed to load pipeline scripts");
    } finally {
      setHistoryScriptsLoading(false);
    }
  };

  // History sidebar: delete a pipeline
  const handleDeletePipeline = (id: string, e: React.SyntheticEvent) => {
    e.stopPropagation();
    setConfirmDialog({
      open: true,
      title: "Delete script set",
      description: "Are you sure you want to delete this script set?",
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }));
        try {
          await apiDelete(`/pipeline/${id}`);
          setHistoryPipelines(prev => prev.filter(p => p.pipeline_id !== id));
          if (selectedHistoryId === id) {
            setSelectedHistoryId(null);
            setHistoryScripts([]);
            setHistorySelectedScripts(new Set());
          }
          // If the deleted pipeline is currently loaded in the editor, clear it
          if (pipelineId === id) {
            setPipelineId(null);
            setScripts([]);
            setScriptNames([]);
            setPreviews({});
            setTtsResults({});
            setPreviewError(null);
            setStep(1);
            try {
              if (currentProfile?.id) removeWorkspaceStorage(currentProfile.id, PIPELINE_SESSION_KEY);
            } catch { /* ignore */ }
          }
        } catch (err) {
          handleApiError(err, "Failed to delete pipeline");
        } finally {
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
        }
      },
    });
  };

  const handleSavePipelineName = async (id: string, newName: string) => {
    const trimmed = newName.trim();
    const item = historyPipelines.find(p => p.pipeline_id === id);
    if (!item || item.name === trimmed) {
      setEditingNameId(null);
      return;
    }
    try {
      await apiPatch(`/pipeline/${id}/name`, { name: trimmed });
      setHistoryPipelines(prev => prev.map(p =>
        p.pipeline_id === id ? { ...p, name: trimmed } : p
      ));
    } catch (err) {
      handleApiError(err, "Failed to rename pipeline");
    }
    setEditingNameId(null);
  };

  // TTS Library: fetch assets for sidebar
  const fetchTtsLibrary = useCallback(async () => {
    if (!currentProfile?.id) return;
    setTtsLibraryLoading(true);
    try {
      const res = await apiGetWithRetry("/tts-library/");
      const data = await res.json();
      const ready = (data || []).filter((a: { status: string }) => a.status === "ready");
      setTtsLibraryAssets(ready);
    } catch (err) {
      console.warn("Failed to load TTS library:", err);
    } finally {
      setTtsLibraryLoading(false);
    }
  }, [currentProfile?.id]);

  // TTS Library: load assets into a new pipeline (accepts explicit list or uses selected state)
  const handleLoadFromTtsLibraryWith = async (assets: typeof ttsLibraryAssets) => {
    if (assets.length === 0) return;

    setTtsLibraryImporting(true);
    try {
      // Create a new pipeline with the TTS texts as scripts
      const scripts = assets.map(a => a.tts_text);
      const res = await apiPost("/pipeline/import", {
        scripts,
        name: "",
        idea: "Imported from TTS Library",
        provider: "imported",
      });
      const data = await res.json();
      const pid = data.pipeline_id;
      setPipelineId(pid);
      setScripts((data.scripts || []).map(formatScript));
      setScriptNames(defaultScriptNames((data.scripts || []).length));

      // Auto-adopt each TTS library asset into the pipeline
      const newTtsResults: Record<number, { audio_duration: number; generating: boolean; stale: boolean }> = {};
      for (let i = 0; i < assets.length; i++) {
        try {
          const adoptRes = await apiPost(`/pipeline/tts-from-library/${pid}/${i}`, {
            asset_id: assets[i].id,
          });
          const adoptData = await adoptRes.json();
          newTtsResults[i] = { audio_duration: adoptData.audio_duration, generating: false, stale: false };
        } catch (err) {
          console.warn(`Failed to adopt TTS asset ${assets[i].id}:`, err);
        }
      }
      setTtsResults(newTtsResults);

      // Reset state
      setPreviews({});
      setPreviewError(null);
      setSelectedSourceIds(new Set());
      fetchSourceVideos();
      setStep(2);
      setTtsLibrarySelected(new Set());

      // Refresh history
      fetchHistory();
    } catch (err) {
      handleApiError(err, "Failed to import from TTS Library");
    } finally {
      setTtsLibraryImporting(false);
    }
  };

  const handleLoadFromTtsLibrary = () => {
    const selected = ttsLibraryAssets.filter(a => ttsLibrarySelected.has(a.id));
    return handleLoadFromTtsLibraryWith(selected);
  };

  // History sidebar: auto-load on mount and when profile changes
  useEffect(() => {
    if (!currentProfile?.id) return;
    fetchHistory();
    fetchTtsLibrary();
    setSelectedHistoryId(null);
    setHistoryScripts([]);
    setHistorySelectedScripts(new Set());
    setHistoryPreviewInfo({});
    setHistoryTtsInfo({});
    setHistoryTtsJobs({});
    setHistoryTemplateSettings(null);
  }, [currentProfile?.id, fetchHistory, fetchTtsLibrary]);

  // Fetch source videos on mount
  useEffect(() => {
    fetchSourceVideos();
  }, [fetchSourceVideos]);

  // Fetch ElevenLabs voices on mount
  useEffect(() => {
    const loadVoices = async () => {
      setVoicesLoading(true);
      try {
        const res = await apiGetWithRetry("/tts/voices?provider=elevenlabs");
        const data = await res.json();
        setVoices(data.voices || []);
      } catch (err) {
        // Degrade silently: voice loading failures (e.g. no ElevenLabs key/voice
        // configured for this profile) must not blanket the app with a toast on
        // every page load. The voice picker simply stays empty until configured.
        console.warn("Failed to load ElevenLabs voices:", err);
        setVoices([]);
      } finally {
        setVoicesLoading(false);
      }
    };
    loadVoices();
  }, []);

  // Load profile's saved default voice on mount
  useEffect(() => {
    if (!currentProfile?.id) return;
    const profileId = currentProfile.id;
    const loadDefaultVoice = async () => {
      try {
        const res = await apiGetWithRetry(`/profiles/${profileId}`);
        const data = await res.json();
        const tts = data.tts_settings;
        const savedVoiceId = tts?.voice_id;
        if (savedVoiceId) {
          setDefaultVoiceId(savedVoiceId);
          // Pre-select if user hasn't manually chosen yet
          if (!activeTemplatePipelineIdRef.current) {
            setVoiceId((prev) => prev === "" ? savedVoiceId : prev);
          }
        }
        if (activeTemplatePipelineIdRef.current) return;
        // Hydrate voice settings from profile (overrides localStorage defaults)
        if (tts?.voice_stability !== undefined) setVoiceStability(tts.voice_stability);
        if (tts?.voice_similarity !== undefined) setVoiceSimilarity(tts.voice_similarity);
        if (tts?.voice_style !== undefined) setVoiceStyle(tts.voice_style);
        if (tts?.voice_speed !== undefined) setVoiceSpeed(tts.voice_speed);
        if (tts?.voice_speaker_boost !== undefined) setVoiceSpeakerBoost(tts.voice_speaker_boost);
        if (tts?.words_per_subtitle !== undefined) setWordsPerSubtitle(tts.words_per_subtitle);
        if (tts?.min_segment_duration !== undefined) setMinSegmentDuration(tts.min_segment_duration);
        if (tts?.ultra_rapid_intro !== undefined) setUltraRapidIntro(tts.ultra_rapid_intro);
        if (tts?.elevenlabs_model) setElevenlabsModel(tts.elevenlabs_model);
      } catch {
        // Silently fail — voice selector still works with default
      }
    };
    loadDefaultVoice();
  }, [currentProfile?.id]);

  // Load subtitle settings from profile
  useEffect(() => {
    if (!currentProfile?.id) return;
    const profileId = currentProfile.id;
    const loadSubtitleSettings = async () => {
      try {
        const res = await apiGetWithRetry(`/profiles/${profileId}/subtitle-settings`);
        const data = await res.json();
        if (!activeTemplatePipelineIdRef.current) {
          setSubtitleSettings({ ...DEFAULT_SUBTITLE_SETTINGS, ...data });
        }
      } catch {
        // Use defaults
      } finally {
        setSubtitleSettingsLoaded(true);
      }
    };
    loadSubtitleSettings();
  }, [currentProfile?.id]);

  // Debounced save for the DEFAULT subtitle settings (persisted on the profile
  // so they propagate to future pipelines). Per-variant overrides use a
  // different endpoint (see `handleVariantSubtitleChange` below).
  const handleDefaultSubtitleChange = useCallback((newSettings: SubtitleSettings) => {
    setSubtitleSettings(newSettings);
    if (!currentProfileIdRef.current) return;
    if (subtitleSaveTimer.current) clearTimeout(subtitleSaveTimer.current);
    subtitleSaveTimer.current = setTimeout(async () => {
      try {
        const profileId = currentProfileIdRef.current;
        if (!profileId) return;
        await apiPut(`/profiles/${profileId}/subtitle-settings`, newSettings);
      } catch {
        // Silent — settings still work locally
      }
    }, 1000);
  }, []);

  // Debounced save for per-variant overrides. Scoped to the pipeline, not
  // the profile — these are creative choices specific to this content.
  //
  // SAFETY: Capture the active pipeline id at edit time, not at timer fire
  // time. If the user switches pipelines before the 800 ms timer elapses, we
  // would otherwise PUT pipeline A's overrides into pipeline B. Mirrors the
  // savedPid pattern used by the voice-settings auto-save further down.
  const scheduleOverridesSave = useCallback((
    nextOverrides: Partial<Record<StyleKey, SubtitleSettings>>,
    nextVariantOverrides: Partial<Record<PreviewKey, Partial<SubtitleSettings>>> = variantSubtitleOverrides,
  ) => {
    const savedPid = pipelineIdRef.current;
    if (!savedPid) return;
    setSubtitleSaveState("saving");
    if (overridesSaveTimer.current) clearTimeout(overridesSaveTimer.current);
    // Snapshot the dict so concurrent state mutations after this call don't
    // alter what we end up sending. Also strip empty-object entries: the
    // backend accepts Meta keys plus PreviewKeys, and we never want to send
    // `{"A": {}}` which would look like a no-op override.
    const snapshot: Record<string, Partial<SubtitleSettings>> = {};
    for (const [k, v] of Object.entries(nextOverrides) as [StyleKey, SubtitleSettings | undefined][]) {
      if (v && Object.keys(v).length > 0) {
        snapshot[k] = v;
      }
    }
    for (const [key, value] of Object.entries(nextVariantOverrides)) {
      if (value && Object.keys(value).length > 0) snapshot[key] = value;
    }
    overridesSaveTimer.current = setTimeout(async () => {
      // Bail out if the user navigated to a different pipeline meanwhile.
      if (pipelineIdRef.current !== savedPid) return;
      try {
        await apiPut(`/pipeline/${savedPid}/subtitle-overrides`, { overrides: snapshot });
        markSubtitleSaveSuccess();
      } catch {
        setSubtitleSaveState("error");
        // Silent — overrides still work locally for this session
      }
    }, 800);
  }, [markSubtitleSaveSuccess, variantSubtitleOverrides]);

  // Cancel any pending override save when the active pipeline changes, so a
  // late-firing timer for the previous pipeline can never write into the new
  // one. The savedPid guard above is the primary defense; this is belt+braces.
  useEffect(() => {
    return () => {
      if (overridesSaveTimer.current) {
        clearTimeout(overridesSaveTimer.current);
        overridesSaveTimer.current = null;
      }
    };
  }, [pipelineId]);

  // Editor onSettingsChange when a specific Meta version tab is active.
  // Writes to the override map under that StyleKey and schedules a
  // debounced save.
  const handleVariantSubtitleChange = useCallback(
    (styleKey: StyleKey, newSettings: SubtitleSettings) => {
      if (styleKey === "default") {
        setSubtitleSettings(newSettings);
        setSubtitleOverrides(prev => {
          if (!("default" in prev)) return prev;
          const next = { ...prev };
          delete next.default;
          scheduleOverridesSave(next);
          return next;
        });
        scheduleProfileSubtitleSave(newSettings);
        return;
      }

      setSubtitleOverrides(prev => {
        const next = { ...prev };
        const delta = subtitleSettingsDiff(subtitleSettings, newSettings);
        if (Object.keys(delta).length > 0) next[styleKey] = delta as SubtitleSettings;
        else delete next[styleKey];
        scheduleOverridesSave(next);
        return next;
      });
    },
    [scheduleOverridesSave, scheduleProfileSubtitleSave, subtitleSettings]
  );

  // Remove an override for a Meta version (Reset to default).
  const handleResetVariantSubtitle = useCallback(
    (styleKey: StyleKey) => {
      setSubtitleOverrides(prev => {
        if (!(styleKey in prev)) return prev;
        const next = { ...prev };
        delete next[styleKey];
        scheduleOverridesSave(next);
        return next;
      });
    },
    [scheduleOverridesSave]
  );

  const handleVariantTemplateOverrideChange = useCallback(
    (previewKey: PreviewKey, newSettings: SubtitleSettings, templateSettings: SubtitleSettings) => {
      setVariantSubtitleOverrides((previous) => {
        const delta = subtitleSettingsDiff(templateSettings, newSettings);
        const next = { ...previous };
        if (Object.keys(delta).length > 0) next[previewKey] = delta;
        else delete next[previewKey];
        scheduleOverridesSave(subtitleOverrides, next);
        return next;
      });
    },
    [scheduleOverridesSave, subtitleOverrides],
  );

  const handleResetVariantTemplateOverride = useCallback(
    (previewKey: PreviewKey) => {
      setVariantSubtitleOverrides((previous) => {
        if (!(previewKey in previous)) return previous;
        const next = { ...previous };
        delete next[previewKey];
        scheduleOverridesSave(subtitleOverrides, next);
        return next;
      });
    },
    [scheduleOverridesSave, subtitleOverrides],
  );

  // Copy the effective style from one Meta version to another (e.g. copy A → B).
  const handleCopyVariantSubtitle = useCallback(
    (sourceKey: StyleKey, targetKey: StyleKey) => {
      if (sourceKey === targetKey) return;
      setSubtitleOverrides(prev => {
        // Resolve the source's effective style inline (mirrors getSubtitleSettingsFor)
        const sourceOverride = prev[sourceKey];
        const sourceEffective: SubtitleSettings =
          sourceOverride && Object.keys(sourceOverride).length > 0
            ? { ...subtitleSettings, ...sourceOverride }
            : { ...subtitleSettings };
        const next = { ...prev };
        const delta = subtitleSettingsDiff(subtitleSettings, sourceEffective);
        if (Object.keys(delta).length > 0) next[targetKey] = delta as SubtitleSettings;
        else delete next[targetKey];
        scheduleOverridesSave(next);
        return next;
      });
    },
    [scheduleOverridesSave, subtitleSettings]
  );

  // Submit a "Save as preset" — POSTs the shared style plus any explicit A/B
  // overrides to /profiles/{id}/subtitle-presets and refreshes the list on
  // success. A/B overrides are included only when they have real content, so
  // tabs the user never touched don't freeze the default into the preset.
  const handleSubmitSavePreset = useCallback(async () => {
    const profileId = currentProfileIdRef.current;
    if (!profileId) {
      setSavePresetError("No active profile");
      return;
    }
    const trimmedName = savePresetName.trim();
    if (!trimmedName) {
      setSavePresetError("Preset name cannot be empty");
      return;
    }

    const overrideA = subtitleOverrides["A"];
    const overrideB = subtitleOverrides["B"];
    const hasOverrideA = !!overrideA && Object.keys(overrideA).length > 0;
    const hasOverrideB = !!overrideB && Object.keys(overrideB).length > 0;

    const payload: {
      name: string;
      settings: SubtitleSettings;
      settingsA?: SubtitleSettings;
      settingsB?: SubtitleSettings;
      wordsPerSubtitle?: number;
    } = {
      name: trimmedName,
      settings: subtitleSettings,
      wordsPerSubtitle,
    };
    if (hasOverrideA) {
      payload.settingsA = { ...subtitleSettings, ...overrideA };
    }
    if (hasOverrideB) {
      payload.settingsB = { ...subtitleSettings, ...overrideB };
    }

    setSavePresetSubmitting(true);
    setSavePresetError(null);
    try {
      await apiPost(`/profiles/${profileId}/subtitle-presets`, payload);
      // Refresh the dropdown list
      const res = await apiGetWithRetry(`/profiles/${profileId}/subtitle-presets`);
      const data = await res.json();
      if (Array.isArray(data?.presets)) {
        setUserSubtitlePresets(data.presets);
      }
      setSavePresetDialogOpen(false);
      setSavePresetName("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save preset";
      setSavePresetError(msg);
    } finally {
      setSavePresetSubmitting(false);
    }
  }, [savePresetName, subtitleSettings, subtitleOverrides, wordsPerSubtitle]);

  // Load/refresh user-saved subtitle presets from the profile.
  const refreshUserSubtitlePresets = useCallback(async () => {
    const profileId = currentProfileIdRef.current;
    if (!profileId) return;
    try {
      const res = await apiGetWithRetry(`/profiles/${profileId}/subtitle-presets`);
      const data = await res.json();
      if (Array.isArray(data?.presets)) {
        setUserSubtitlePresets(data.presets);
      }
    } catch {
      // Silent — presets are optional convenience
    }
  }, []);

  useEffect(() => {
    if (!currentProfile?.id) return;
    refreshUserSubtitlePresets();
  }, [currentProfile?.id, refreshUserSubtitlePresets]);

  useEffect(() => {
    if (!pipelineId) {
      setSubtitleRotation(EMPTY_SUBTITLE_TEMPLATE_ROTATION);
      setVariantTemplateSelections({});
      return;
    }
    let cancelled = false;
    apiGet(`/pipeline/${pipelineId}/subtitle-rotation`)
      .then((response) => response.json())
      .then((rotation: SubtitleTemplateRotation & { variantTemplates?: Record<string, string> }) => {
        if (cancelled) return;
        setSubtitleRotation({
          enabled: Boolean(rotation.enabled),
          presetIds: Array.isArray(rotation.presetIds) ? rotation.presetIds : [],
        });
        setVariantTemplateSelections(
          rotation.variantTemplates && typeof rotation.variantTemplates === "object"
            ? { ...rotation.variantTemplates }
            : {},
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSubtitleRotation(EMPTY_SUBTITLE_TEMPLATE_ROTATION);
          setVariantTemplateSelections({});
        }
      });
    return () => { cancelled = true; };
  }, [pipelineId]);

  // Persist rotation + manual selections together (same endpoint/envelope).
  const persistSubtitleRotation = useCallback(async (
    rotation: SubtitleTemplateRotation,
    selections: VariantTemplateSelections,
  ): Promise<boolean> => {
    const savedPipelineId = pipelineIdRef.current;
    if (!savedPipelineId) {
      toast.error("Could not save subtitle template settings");
      return false;
    }
    try {
      await apiPut(`/pipeline/${savedPipelineId}/subtitle-rotation`, {
        ...rotation,
        variantTemplates: selections,
      });
      return true;
    } catch {
      toast.error("Could not save subtitle template settings");
      return false;
    }
  }, []);

  const handleSubtitleRotationChange = useCallback((next: SubtitleTemplateRotation) => {
    setSubtitleRotation(next);
    scheduleReassemblePreviews();
    void persistSubtitleRotation(next, variantTemplateSelections);
  }, [scheduleReassemblePreviews, persistSubtitleRotation, variantTemplateSelections]);

  // Choosing a complete saved template starts a new automatic assignment.
  // Keeping manual picks from the previous template (especially an earlier
  // "apply to all" / No subtitles choice) would silently mask the new
  // rotation in every variant preview.
  const handleSubtitleTemplateChange = useCallback((next: SubtitleTemplateRotation) => {
    const nextSelections: VariantTemplateSelections = {};
    setSubtitleRotation(next);
    setVariantTemplateSelections(nextSelections);
    setVariantSubtitleOverrides((previous) => {
      if (Object.keys(previous).length === 0) return previous;
      scheduleOverridesSave(subtitleOverrides, {});
      return {};
    });
    void persistSubtitleRotation(next, nextSelections);
    scheduleReassemblePreviews();
  }, [persistSubtitleRotation, scheduleOverridesSave, scheduleReassemblePreviews, subtitleOverrides]);

  const handleUpdateSubtitleTemplateStyles = useCallback(async (
    templateId: string,
    templateName: string,
    styles: UserSubtitlePreset[],
  ): Promise<boolean> => {
    const profileId = currentProfileIdRef.current;
    if (!profileId || !templateId || styles.length === 0) return false;

    try {
      const response = await apiPut(`/profiles/${profileId}/subtitle-templates/${templateId}`, {
        name: templateName,
        styles: styles.map((style) => ({
          id: style.id,
          name: style.name,
          settings: style.settings,
          settingsA: style.settingsA,
          settingsB: style.settingsB,
          wordsPerSubtitle: style.wordsPerSubtitle ?? 2,
        })),
      });
      const saved = (await response.json()) as UserSubtitleTemplate;
      const flattened = saved.styles.map((style) => ({
        ...style,
        templateId: saved.id,
        templateName: saved.name,
      }));
      const nextRotation: SubtitleTemplateRotation = {
        enabled: true,
        presetIds: flattened.map((style) => style.id),
      };
      const nextSelections: VariantTemplateSelections = {};

      setUserSubtitlePresets((current) => [
        ...current.filter((style) => style.templateId !== saved.id),
        ...flattened,
      ]);
      setSubtitleRotation(nextRotation);
      setVariantTemplateSelections(nextSelections);
      void persistSubtitleRotation(nextRotation, nextSelections);
      scheduleReassemblePreviews();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save subtitle template");
      return false;
    }
  }, [persistSubtitleRotation, scheduleReassemblePreviews]);

  const handleUseSubtitleTemplateForAll = useCallback(async (): Promise<void> => {
    const nextSelections: VariantTemplateSelections = {};
    const saved = await persistSubtitleRotation(subtitleRotation, nextSelections);
    if (!saved) return;
    setVariantTemplateSelections(nextSelections);
    scheduleReassemblePreviews();
  }, [persistSubtitleRotation, scheduleReassemblePreviews, subtitleRotation]);

  // Debounced auto-save scripts to backend
  const saveScriptsToBackend = useCallback((pId: string, updatedScripts: string[], updatedNames?: string[]) => {
    if (scriptSaveTimer.current) clearTimeout(scriptSaveTimer.current);
    scriptSaveTimer.current = setTimeout(async () => {
      try {
        const currentPid = pipelineIdRef.current;
        if (!currentPid) return;
        await apiPut(`/pipeline/${currentPid}/scripts`, {
          scripts: updatedScripts,
          ...(updatedNames ? { script_names: updatedNames } : {}),
        });
      } catch {
        // Silent — scripts still work locally, will retry on next edit
      }
    }, 1000);
  }, []);

  const saveScriptNamesToBackend = useCallback((pId: string, names: string[]) => {
    if (scriptNameSaveTimer.current) clearTimeout(scriptNameSaveTimer.current);
    scriptNameSaveTimer.current = setTimeout(async () => {
      try {
        await apiPatch(`/pipeline/${pId}/script-names`, { script_names: names });
      } catch {
        toast.error("Script name could not be saved");
      }
    }, 1500);
  }, []);

  const handleScriptNameChange = useCallback((index: number, value: string) => {
    setScriptNames((prev) => {
      const next = [...prev];
      next[index] = value.slice(0, 80);
      return next;
    });
  }, []);

  const handleScriptNameCommit = useCallback((index: number) => {
    setScriptNames((prev) => {
      const next = [...prev];
      next[index] = next[index]?.trim() || `Script ${index + 1}`;
      if (pipelineId) saveScriptNamesToBackend(pipelineId, next);
      return next;
    });
  }, [pipelineId, saveScriptNamesToBackend]);

  const handleScriptCommit = useCallback((index: number, nextValue: string) => {
    setScripts((prev) => {
      if (prev[index] === nextValue) return prev;
      const next = [...prev];
      next[index] = nextValue;
      if (pipelineId) saveScriptsToBackend(pipelineId, next);
      return next;
    });

    setTtsResults((prev) => {
      const current = prev[index];
      if (!current || current.generating || current.stale) return prev;
      return {
        ...prev,
        [index]: { ...current, stale: true },
      };
    });

    setApprovedScripts((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });

    setPreviewError(null);
  }, [pipelineId, saveScriptsToBackend]);

  // Check TTS library for duplicate texts when scripts load
  // Debounced 1.5s so rapid edits don't flood the API
  // Auto-adopts library audio for all matches that don't already have TTS
  useEffect(() => {
    if (step !== 2 || scripts.length === 0) {
      setLibraryMatches({});
      return;
    }

    let cancelled = false;

    const checkDuplicates = async () => {
      try {
        const res = await apiPost("/tts-library/check-duplicates", { texts: scripts });
        const data = await res.json();
        const parsed: Record<number, { asset_id: string; audio_duration: number }> = {};
        for (const [key, val] of Object.entries(data.matches || {})) {
          parsed[parseInt(key)] = val as { asset_id: string; audio_duration: number };
        }
        setLibraryMatches(parsed);

        // Auto-adopt library audio for all matches without existing TTS
        if (!cancelled && pipelineId && Object.keys(parsed).length > 0) {
          const indicesToLoad = Object.keys(parsed)
            .map(Number)
            .filter(idx => !ttsResultsRef.current[idx]);

          for (const idx of indicesToLoad) {
            if (cancelled) break;
            const match = parsed[idx];
            if (!match) continue;

            setTtsResults(prev => ({
              ...prev,
              [idx]: { audio_duration: 0, generating: true, stale: false }
            }));

            try {
              const adoptRes = await apiPost(`/pipeline/tts-from-library/${pipelineId}/${idx}`, {
                asset_id: match.asset_id,
              });
              const adoptData = await adoptRes.json();
              if (cancelled) break;
              setTtsResults(prev => ({
                ...prev,
                [idx]: { audio_duration: adoptData.audio_duration, generating: false, stale: false }
              }));
            } catch {
              if (cancelled) break;
              setTtsResults(prev => {
                const next = { ...prev };
                delete next[idx];
                return next;
              });
            }
          }
        }
      } catch (err) {
        console.warn("TTS library duplicate check failed:", err);
      }
    };

    if (ttsLibraryCheckTimer.current) clearTimeout(ttsLibraryCheckTimer.current);
    ttsLibraryCheckTimer.current = setTimeout(checkDuplicates, 1500);

    return () => {
      cancelled = true;
      if (ttsLibraryCheckTimer.current) clearTimeout(ttsLibraryCheckTimer.current);
    };
  }, [step, scripts, pipelineId]);

  // Save selected voice as default in profile
  const handleSetDefaultVoice = async () => {
    if (!currentProfile || !voiceId || voiceId === "default") return;
    setSavingDefault(true);
    try {
      const selectedVoice = voices.find(v => v.voice_id === voiceId);
      // apiGetWithRetry throws on non-OK responses (FE-01)
      const res = await apiGetWithRetry(`/profiles/${currentProfile.id}`);
      const profileData = await res.json();
      const existingTts = profileData.tts_settings || {};

      const ttsSettings = {
        ...existingTts,
        provider: "elevenlabs",
        voice_id: voiceId,
        voice_name: selectedVoice?.name || "",
      };

      await apiPatch(`/profiles/${currentProfile.id}`, { tts_settings: ttsSettings });
      setDefaultVoiceId(voiceId);
    } catch (err) {
      handleApiError(err, "Failed to save default voice");
    } finally {
      setSavingDefault(false);
    }
  };

  // FE-13: Shared helper to restore TTS results from history info maps.
  // scriptCount bounds the keys we accept: the backend can retain tts_info for
  // variant indices deleted from the scripts array (delete-script prunes local
  // state + saves scripts, but leaves the old tts_info row). Restoring those
  // orphan keys makes ttsCount exceed scripts.length → "4 of 3 scripts, -1
  // remaining" and a jammed Continue gate. Drop any key >= scriptCount.
  const buildRestoredTts = (
    ttsInfo: NonNullable<PipelineScriptsResponse["tts_info"]>,
    previewInfo: Record<string, { has_audio: boolean; audio_duration: number; has_srt?: boolean }>,
    scriptCount: number,
    ttsJobs: Record<string, Partial<AsyncJobState>> = {},
  ): { tts: Record<number, TtsResult>; approved: Set<number> } => {
    const restoredTts: Record<number, TtsResult> = {};
    const restoredApproved = new Set<number>();
    Object.entries(ttsInfo).forEach(([key, info]) => {
      const index = Number.parseInt(key, 10);
      if (info.has_audio && index < scriptCount) {
        restoredTts[index] = {
          audio_duration: info.audio_duration,
          generating: false,
          stale: false,
          status: "completed",
          srt_content: info.srt_content,
          script_word_count: info.script_word_count,
          srt_word_count: info.srt_word_count,
        };
        if (info.approved) restoredApproved.add(index);
      }
    });
    // Per-variant fallback: fill gaps from preview_info
    Object.entries(previewInfo).forEach(([key, info]) => {
      if (info.has_audio && Number(key) < scriptCount && !restoredTts[Number(key)]) {
        restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
      }
    });
    Object.entries(ttsJobs).forEach(([key, job]) => {
      const index = Number.parseInt(key, 10);
      if (!Number.isInteger(index) || index < 0 || index >= scriptCount) return;
      if (isActiveAsyncJob(job)) {
        restoredTts[index] = {
          audio_duration: 0,
          generating: true,
          stale: false,
          status: job.status,
          progress: job.progress || 0,
          current_step: job.current_step || "Generating voice-over",
        };
      } else if ((job.status === "failed" || job.status === "cancelled") && !restoredTts[index]) {
        restoredTts[index] = {
          audio_duration: 0,
          generating: false,
          stale: false,
          status: job.status,
          progress: job.progress || 0,
          current_step: job.current_step,
          error: job.error,
        };
      }
    });
    return { tts: restoredTts, approved: restoredApproved };
  };

  // History sidebar: import selected scripts
  const handleHistoryImport = async () => {
    const selected = historyScripts.filter((_, i) => historySelectedScripts.has(i));
    const selectedNames = historyScriptNames.filter((_, i) => historySelectedScripts.has(i));
    if (selected.length === 0) return;

    // If all scripts are selected, reuse the existing pipeline (no duplicate)
    if (selected.length === historyScripts.length && selectedHistoryId) {
      const pid = selectedHistoryId;
      setPipelineId(pid);
      setScripts(historyScripts.map(formatScript));
      setScriptNames(
        historyScriptNames.length === historyScripts.length
          ? historyScriptNames
          : defaultScriptNames(historyScripts.length),
      );
      // Carry over TTS results: prefer tts_info (Step 2) over preview_info (Step 3)
      const restored = buildRestoredTts(historyTtsInfo, historyPreviewInfo, historyScripts.length, historyTtsJobs);
      setTtsResults(restored.tts);
      if (restored.approved.size > 0) setApprovedScripts(restored.approved);
      // Restore context products from history
      setContextProducts(historyContextProducts);
      if (historyTemplateSettings) {
        applyPipelineTemplateSettings(historyTemplateSettings, selectedHistoryId || undefined);
      }
      const restoredSelection = historyAttentionSelection ?? EMPTY_ATTENTION_SELECTION;
      setAttentionSelection(restoredSelection);
      attentionSelectionRef.current = restoredSelection;
      // Restore pipeline metadata for "Back to Input"
      const histItem = historyPipelines.find(p => p.pipeline_id === selectedHistoryId);
      if (histItem) {
        if (histItem.name) setPipelineName(histItem.name);
        if (histItem.idea) setIdea(histItem.idea);
        if (histItem.provider) setProvider(histItem.provider);
        if (histItem.variant_count) setVariantCount(histItem.variant_count);
        if (histItem.target_script_duration) setTargetScriptDuration(histItem.target_script_duration);
      }
      apiGet(`/pipeline/${pid}/meta-multiplication`)
        .then(async (res) => {
          if (!isMountedRef.current) return;
          const data = await res.json();
          setMetaMultiplication(data.meta_multiplication !== undefined ? Boolean(data.meta_multiplication) : true);
        })
        .catch(() => {
          setMetaMultiplication(true);
        });

      // Restore per-Meta-version subtitle overrides for this pipeline.
      apiGet(`/pipeline/${pid}/subtitle-overrides`)
        .then(async (res) => {
          if (!isMountedRef.current) return;
          const data = await res.json();
          if (data && typeof data.overrides === "object" && data.overrides !== null) {
            const entries = Object.entries(data.overrides) as [string, SubtitleSettings][];
            setSubtitleOverrides(Object.fromEntries(
              entries.filter(([key]) => key === "A" || key === "B" || key === "default"),
            ) as Partial<Record<StyleKey, SubtitleSettings>>);
            setVariantSubtitleOverrides(Object.fromEntries(
              entries.filter(([key]) => /^\d+(?:_[A-J])?$/.test(key)),
            ));
          } else {
            setSubtitleOverrides({});
            setVariantSubtitleOverrides({});
          }
        })
        .catch(() => {
          setSubtitleOverrides({});
          setVariantSubtitleOverrides({});
        });
      setSelectedHistoryId(null);
      setHistoryScripts([]);
      setHistorySelectedScripts(new Set());
      setPreviews({});
      setPreviewError(null);
      // Restore source video selection from DB
      setSelectedSourceIds(new Set());
      restoreSourceSelection(pid);

      // Restore previews in background (so step 3 is ready when user navigates there)
      const allHavePreviews = historyScripts.every((_, idx) => {
        const info = historyPreviewInfo[String(idx)];
        return info && info.has_audio && info.has_srt;
      });

      if (allHavePreviews && historyScripts.length > 0) {
        apiGet(`/pipeline/${pid}/restore-previews`)
          .then(async (previewRes) => {
            if (!isMountedRef.current) return;
            const previewData = await previewRes.json();
            if (previewData.previews && Object.keys(previewData.previews).length > 0) {
              const restoredPreviews: Record<PreviewKey, PreviewData> = {};
              for (const [key, val] of Object.entries(previewData.previews)) {
                restoredPreviews[key] = val as PreviewData;
              }
              setPreviews(restoredPreviews);
              if (previewData.available_segments?.length > 0) {
                setAvailableSegments(previewData.available_segments);
              }
              setSelectedVariants(new Set(historyScripts.map((_, i) => i)));
            }
          })
          .catch((err) => {
            console.warn("Failed to restore previews:", err);
          });
      }

      // Always land on step 2 so user can review source videos & segments
      setShowHistoryPanel(false);
      setStep(2);
      return;
    }

    // Only create a new pipeline when importing a subset of scripts
    const historyItem = historyPipelines.find(p => p.pipeline_id === selectedHistoryId);

    setHistoryImporting(true);
    try {
      const res = await apiPost("/pipeline/import", {
        scripts: selected,
        name: historyItem?.name || "",
        idea: historyItem?.idea || "Imported from history",
        context_products: historyContextProducts.length > 0 ? historyContextProducts : undefined,
        provider: "imported",
      });

      // apiPost throws on non-OK responses (FE-01)
      const data = await res.json();
      const pid = data.pipeline_id;
      // Carry the attention pick into the imported pipeline; the pipelineId
      // effect persists attentionSelectionRef to the new pipeline.
      const importedSelection = historyAttentionSelection ?? EMPTY_ATTENTION_SELECTION;
      setAttentionSelection(importedSelection);
      attentionSelectionRef.current = importedSelection;
      setPipelineId(pid);
      setScripts((data.scripts || []).map(formatScript));
      const importedNames = selectedNames.length === selected.length
        ? selectedNames
        : defaultScriptNames((data.scripts || []).length);
      setScriptNames(importedNames);
      saveScriptNamesToBackend(pid, importedNames);
      setShowHistoryPanel(false);
      setStep(2);
      setSelectedHistoryId(null);
      setHistoryScripts([]);
      setHistorySelectedScripts(new Set());
      setPreviews({});
      setPreviewError(null);
      // New pipeline — re-apply source video auto-select
      setSelectedSourceIds(new Set());
      fetchSourceVideos();
      // FE-09: Refresh history sidebar so the imported pipeline appears
      fetchHistory();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      handleApiError(err, "Failed to import scripts");
    } finally {
      setHistoryImporting(false);
    }
  };

  // FE-23: Consolidated audio cleanup helper — stops playback, revokes blob, resets refs
  const stopCurrentAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (pendingBlobUrl.current) {
      URL.revokeObjectURL(pendingBlobUrl.current);
      pendingBlobUrl.current = null;
    }
    setPlayingAudio(null);
  };

  // Audio preview: play/pause toggle
  const handlePlayAudio = (pipelineId: string, variantIndex: number) => {
    const audioKey = `${pipelineId}-${variantIndex}`;

    if (playingAudio === audioKey) {
      stopCurrentAudio();
      return;
    }

    stopCurrentAudio();
    setPlayingAudio(audioKey);
    audioPlayAbortRef.current?.abort();
    const controller = new AbortController();
    audioPlayAbortRef.current = controller;

    apiGet(`/pipeline/audio/${pipelineId}/${variantIndex}?_t=${Date.now()}`, { signal: controller.signal })
      .then(res => res.blob())
      .then(blob => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        pendingBlobUrl.current = url;
        // FE-06: Single cleanup function prevents double-revocation from onended+onerror race
        let revoked = false;
        const cleanupBlob = () => {
          if (revoked) return;
          revoked = true;
          setPlayingAudio(null);
          if (pendingBlobUrl.current === url) pendingBlobUrl.current = null;
          URL.revokeObjectURL(url);
        };
        const audio = new Audio(url);
        audio.onended = cleanupBlob;
        audio.onerror = cleanupBlob;
        audio.play().catch(cleanupBlob);
        audioRef.current = audio;
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn("Audio playback failed:", err);
        stopCurrentAudio();
      });
  };

  // Cleanup audio, timers, and abort in-flight requests on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        const src = audioRef.current.src;
        audioRef.current.pause();
        audioRef.current = null;
        if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      }
      if (ttsAudioRef.current) {
        const src = ttsAudioRef.current.src;
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
        if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      }
      if (pendingBlobUrl.current) {
        URL.revokeObjectURL(pendingBlobUrl.current);
        pendingBlobUrl.current = null;
      }
      // Clear all timer refs and null them out (Bug #49, #55)
      if (aiInstructionsSaveTimer.current) { clearTimeout(aiInstructionsSaveTimer.current); aiInstructionsSaveTimer.current = null; }
      if (aiRulesSavedResetTimer.current) { clearTimeout(aiRulesSavedResetTimer.current); aiRulesSavedResetTimer.current = null; }
      if (sourceSelectionTimer.current) { clearTimeout(sourceSelectionTimer.current); sourceSelectionTimer.current = null; }
      if (ttsLibraryCheckTimer.current) { clearTimeout(ttsLibraryCheckTimer.current); ttsLibraryCheckTimer.current = null; }
      if (scriptSaveTimer.current) { clearTimeout(scriptSaveTimer.current); scriptSaveTimer.current = null; }
      if (scriptNameSaveTimer.current) { clearTimeout(scriptNameSaveTimer.current); scriptNameSaveTimer.current = null; }
      if (catalogSearchTimer.current) { clearTimeout(catalogSearchTimer.current); catalogSearchTimer.current = null; }
      if (voiceSettingsSaveTimer.current) { clearTimeout(voiceSettingsSaveTimer.current); voiceSettingsSaveTimer.current = null; }
      if (subtitleSaveTimer.current) { clearTimeout(subtitleSaveTimer.current); subtitleSaveTimer.current = null; }
      if (subtitleSavedResetTimer.current) { clearTimeout(subtitleSavedResetTimer.current); subtitleSavedResetTimer.current = null; }
      previewAbortRef.current?.abort();
      scriptAbortRef.current?.abort();
      regenerateAbortRef.current?.abort();
      ttsPlayAbortRef.current?.abort();
      audioPlayAbortRef.current?.abort();
    };
  }, []);

  // Mark existing TTS results as stale when voice settings change (user-initiated only).
  //
  // Previously this used a one-shot ref flipped after the first dep-change post-hydration,
  // which assumed localStorage was the only async hydration source. The profile-fetch effect
  // (`loadDefaultVoice`) is a SECOND async hydration that overwrites voice settings ~hundreds
  // of ms later; if its values differ from localStorage, it would re-trigger this effect and
  // mark every restored TTS entry as stale, forcing the Step 2 button back to "Generate
  // Voice-Overs" even when valid audio existed on disk.
  //
  // Fix: the only way `userChangedVoiceRef` flips to true is via the slider / checkbox
  // onChange handlers below, so any number of async hydration sources can fire without
  // triggering staleness.
  const voiceSettingsHydrated = useRef(false);
  const userChangedVoiceRef = useRef(false);
  useEffect(() => {
    if (!voiceSettingsLoaded) return;
    if (!userChangedVoiceRef.current) return;
    userChangedVoiceRef.current = false;
    setTtsResults(prev => {
      const hasAny = Object.values(prev).some(r => r.audio_duration > 0 && !r.generating);
      if (!hasAny) return prev;
      const next: typeof prev = {};
      for (const [k, v] of Object.entries(prev)) {
        next[Number(k)] = v.audio_duration > 0 && !v.generating ? { ...v, stale: true } : v;
      }
      return next;
    });
  }, [voiceSettingsLoaded, voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost]);

  // Load voice settings from localStorage after hydration
  useEffect(() => {
    if (!currentProfile?.id) return;
    if (activeTemplatePipelineIdRef.current) {
      setVoiceSettingsLoaded(true);
      return;
    }
    try {
      const stability = readWorkspaceStorage(currentProfile.id, "pipeline.voice.stability", "ef_voice_stability");
      const similarity = readWorkspaceStorage(currentProfile.id, "pipeline.voice.similarity", "ef_voice_similarity");
      const style = readWorkspaceStorage(currentProfile.id, "pipeline.voice.style", "ef_voice_style");
      const speed = readWorkspaceStorage(currentProfile.id, "pipeline.voice.speed", "ef_voice_speed");
      const boost = readWorkspaceStorage(currentProfile.id, "pipeline.voice.speaker-boost", "ef_voice_speaker_boost");
      const wps = readWorkspaceStorage(currentProfile.id, "pipeline.words-per-subtitle", "ef_words_per_subtitle");
      const elModel = readWorkspaceStorage(currentProfile.id, "pipeline.elevenlabs-model", "ef_elevenlabs_model");
      const hasVoiceValues = stability !== null || similarity !== null || style !== null || speed !== null || boost !== null;
      if (stability !== null) setVoiceStability(parseFloat(stability));
      if (similarity !== null) setVoiceSimilarity(parseFloat(similarity));
      if (style !== null) setVoiceStyle(parseFloat(style));
      if (speed !== null) setVoiceSpeed(parseFloat(speed));
      if (boost !== null) setVoiceSpeakerBoost(boost === "true");
      if (wps !== null) setWordsPerSubtitle(parseInt(wps, 10));
      if (elModel !== null) setElevenlabsModel(elModel);
      const msd = readWorkspaceStorage(currentProfile.id, "pipeline.min-segment-duration", "ef_min_segment_duration");
      if (msd !== null) setMinSegmentDuration(parseFloat(msd));
      const uri = readWorkspaceStorage(currentProfile.id, "pipeline.ultra-rapid-intro", "ef_ultra_rapid_intro");
      if (uri !== null) setUltraRapidIntro(uri === "true");
      const preset = readWorkspaceStorage(currentProfile.id, "pipeline.assembly-preset", "ef_assembly_preset");
      if (preset === "keyword_strict" || preset === "balanced" || preset === "max_variety" || preset === "shuffle" || preset === "ai_smart") {
        setAssemblyPreset(preset);
      }
      const proximity = readWorkspaceStorage(currentProfile.id, "pipeline.segment-proximity", "ef_segment_proximity");
      if (proximity === "separate" || proximity === "merge") {
        setSegmentProximity(proximity);
      }
      // If no voice values were stored, hydration won't trigger a re-render,
      // so pre-mark as hydrated to avoid skipping the first real user change
      if (!hasVoiceValues) voiceSettingsHydrated.current = true;
    } catch {
      // FE-16: SecurityError or QuotaExceededError — use defaults
    }
    setVoiceSettingsLoaded(true);
  }, [currentProfile?.id]);

  // Keep voice settings ref in sync for debounced save (Bug #87)
  useEffect(() => {
    voiceSettingsValuesRef.current = { voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost, wordsPerSubtitle, minSegmentDuration, ultraRapidIntro, elevenlabsModel };
  }, [voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost, wordsPerSubtitle, minSegmentDuration, ultraRapidIntro, elevenlabsModel]);

  // Persist voice settings to localStorage (skip initial render before load)
  useEffect(() => {
    if (!voiceSettingsLoaded || !currentProfile?.id) return;
    writeWorkspaceStorage(currentProfile.id, "pipeline.voice.stability", String(voiceStability));
    writeWorkspaceStorage(currentProfile.id, "pipeline.voice.similarity", String(voiceSimilarity));
    writeWorkspaceStorage(currentProfile.id, "pipeline.voice.style", String(voiceStyle));
    writeWorkspaceStorage(currentProfile.id, "pipeline.voice.speed", String(voiceSpeed));
    writeWorkspaceStorage(currentProfile.id, "pipeline.voice.speaker-boost", String(voiceSpeakerBoost));
    writeWorkspaceStorage(currentProfile.id, "pipeline.words-per-subtitle", String(wordsPerSubtitle));
    writeWorkspaceStorage(currentProfile.id, "pipeline.min-segment-duration", String(minSegmentDuration));
    writeWorkspaceStorage(currentProfile.id, "pipeline.ultra-rapid-intro", String(ultraRapidIntro));
    writeWorkspaceStorage(currentProfile.id, "pipeline.elevenlabs-model", elevenlabsModel);
    writeWorkspaceStorage(currentProfile.id, "pipeline.assembly-preset", assemblyPreset);
    writeWorkspaceStorage(currentProfile.id, "pipeline.segment-proximity", segmentProximity);
  }, [voiceSettingsLoaded, voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost, wordsPerSubtitle, minSegmentDuration, ultraRapidIntro, elevenlabsModel, assemblyPreset, segmentProximity, currentProfile?.id]);

  // Debounced auto-save voice settings to profile.
  // FE-07: This uses a read-then-patch pattern (GET profile -> merge tts_settings -> PATCH)
  // which appears fragile due to potential race conditions. In practice it is safe because:
  // 1. The 1500ms debounce ensures rapid slider changes coalesce into a single save.
  // 2. Only one profile is active at a time, so concurrent writes from other tabs are unlikely.
  // 3. The merge preserves unrelated tts_settings fields (voice_id, voice_name) that other
  //    save paths may have written.
  useEffect(() => {
    if (!voiceSettingsLoaded || !voiceSettingsHydrated.current) return;
    if (!currentProfileIdRef.current) return;
    const savedProfileId = currentProfileIdRef.current;
    if (voiceSettingsSaveTimer.current) clearTimeout(voiceSettingsSaveTimer.current);
    voiceSettingsSaveTimer.current = setTimeout(async () => {
      const profileId = currentProfileIdRef.current;
      if (!profileId) return;
      if (currentProfileIdRef.current !== savedProfileId) return;
      // Read from ref to avoid stale closure values (Bug #87)
      const vs = voiceSettingsValuesRef.current;
      try {
        const res = await apiGetWithRetry(`/profiles/${profileId}`);
        const profileData = await res.json();
        const existingTts = profileData.tts_settings || {};
        await apiPatch(`/profiles/${profileId}`, {
          tts_settings: {
            ...existingTts,
            voice_stability: vs.voiceStability,
            voice_similarity: vs.voiceSimilarity,
            voice_style: vs.voiceStyle,
            voice_speed: vs.voiceSpeed,
            voice_speaker_boost: vs.voiceSpeakerBoost,
            words_per_subtitle: vs.wordsPerSubtitle,
            min_segment_duration: vs.minSegmentDuration,
            ultra_rapid_intro: vs.ultraRapidIntro,
            elevenlabs_model: vs.elevenlabsModel,
          },
        });
      } catch {
        // Silent — settings still work locally via localStorage
      }
    }, 1000);
  }, [voiceSettingsLoaded, voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost, wordsPerSubtitle, minSegmentDuration, ultraRapidIntro, elevenlabsModel, currentProfile?.id]);

  // Regenerate a single script via AI
  const handleRegenerateScript = async (variantIndex: number) => {
    if (!pipelineId || regeneratingScript[variantIndex] || regeneratingAllScripts) return;

    setRegeneratingScript(prev => ({ ...prev, [variantIndex]: true }));
    try {
      const res = await apiPost(`/pipeline/regenerate-script/${pipelineId}/${variantIndex}`, {
        provider,
        codex_model: codexModel.trim() || DEFAULT_CODEX_MODEL,
      }, { timeout: provider === "codex" ? 240_000 : 120_000 });
      const data = await res.json();

      // Update script in local state
      setScripts(prev => {
        const next = [...prev];
        next[variantIndex] = data.script;
        return next;
      });

      // Mark TTS as stale since script changed
      setTtsResults(prev => {
        if (!prev[variantIndex]) return prev;
        return { ...prev, [variantIndex]: { ...prev[variantIndex], stale: true } };
      });

      toast.success(`Script ${variantIndex + 1} regenerated`);
    } catch (err) {
      handleApiError(err, "Script regeneration error");
      toast.error(
        err instanceof ApiError
          ? err.detail || err.message
          : "Failed to regenerate script. Please try again.",
      );
    } finally {
      setRegeneratingScript(prev => ({ ...prev, [variantIndex]: false }));
    }
  };

  // Regenerate all scripts sequentially
  const handleRegenerateAllScripts = async () => {
    if (!pipelineId || scripts.length === 0 || regeneratingAllScripts) return;

    const abort = new AbortController();
    regenerateScriptsAbortRef.current = abort;
    setRegeneratingAllScripts(true);

    for (let i = 0; i < scripts.length; i++) {
      if (abort.signal.aborted) break;
      setRegeneratingAllScriptsIndex(i);
      setRegeneratingScript(prev => ({ ...prev, [i]: true }));

      try {
        const res = await apiPost(`/pipeline/regenerate-script/${pipelineId}/${i}`, {
          provider,
          codex_model: codexModel.trim() || DEFAULT_CODEX_MODEL,
        }, { timeout: provider === "codex" ? 240_000 : 120_000 });
        const data = await res.json();

        setScripts(prev => {
          const next = [...prev];
          next[i] = data.script;
          return next;
        });

        setTtsResults(prev => {
          if (!prev[i]) return prev;
          return { ...prev, [i]: { ...prev[i], stale: true } };
        });
      } catch (err) {
        if (!abort.signal.aborted) {
          handleApiError(err, "Script regeneration error");
          toast.error(`Failed to regenerate script ${i + 1}`);
        }
        setRegeneratingScript(prev => ({ ...prev, [i]: false }));
        break;
      } finally {
        setRegeneratingScript(prev => ({ ...prev, [i]: false }));
      }
    }

    setRegeneratingAllScripts(false);
    setRegeneratingAllScriptsIndex(null);
    regenerateScriptsAbortRef.current = null;
    if (!abort.signal.aborted) {
      toast.success("All scripts regenerated");
    }
  };

  const handleCancelRegenerateAllScripts = () => {
    regenerateScriptsAbortRef.current?.abort();
    setRegeneratingAllScripts(false);
    setRegeneratingAllScriptsIndex(null);
    setRegeneratingScript({});
  };

  // Per-script TTS: generate voice-over for a single script
  const handleGenerateTts = async (variantIndex: number) => {
    if (!pipelineId) return;

    // Bug #88: prevent concurrent TTS calls for the same variant
    if (ttsResults[variantIndex]?.generating) return;

    setTtsResults(prev => ({
      ...prev,
      [variantIndex]: {
        audio_duration: 0,
        generating: true,
        stale: false,
        status: "queued",
        progress: 0,
        current_step: "Queued for voice-over generation",
      }
    }));
    // Clear approval — TTS regenerated, needs re-verification
    setApprovedScripts(prev => {
      if (!prev.has(variantIndex)) return prev;
      const next = new Set(prev);
      next.delete(variantIndex);
      return next;
    });

    try {
      const res = await apiPost(`/pipeline/tts/${pipelineId}/${variantIndex}`, {
        elevenlabs_model: elevenlabsModel,
        voice_id: voiceId && voiceId !== "default" ? voiceId : undefined,
        voice_settings: {
          stability: voiceStability,
          similarity_boost: voiceSimilarity,
          style: voiceStyle,
          speed: voiceSpeed,
          use_speaker_boost: voiceSpeakerBoost,
        },
        words_per_subtitle: getWordsPerSubtitleForVariant(variantIndex),
        min_segment_duration: minSegmentDuration,
        ultra_rapid_intro: ultraRapidIntro,
      }, { timeout: 60_000 });

      // apiPost throws on non-OK responses (FE-01)
      const data = await res.json();
      setTtsResults(prev => ({
        ...prev,
        [variantIndex]: {
          audio_duration: 0,
          generating: true,
          stale: false,
          status: data.job?.status || data.status || "queued",
          progress: data.job?.progress || 0,
          current_step: data.job?.current_step || "Queued for voice-over generation",
        }
      }));
    } catch (err) {
      handleApiError(err, "TTS generation error");
      const message = err instanceof ApiError
        ? err.detail || err.message
        : "Network error. Please check if the backend is running.";
      setPreviewError(message);
      setTtsResults(prev => ({
        ...prev,
        [variantIndex]: {
          audio_duration: 0,
          generating: false,
          stale: false,
          status: "failed",
          progress: 0,
          current_step: "Voice-over failed",
          error: message,
        },
      }));
    }
  };

  const regenerateAbortRef = useRef<AbortController | null>(null);

  const handleRegenerateAllTts = async () => {
    if (!pipelineId || scripts.length === 0) return;

    regenerateAbortRef.current?.abort();
    const abortController = new AbortController();
    regenerateAbortRef.current = abortController;

    setRegeneratingAll(true);
    setRegeneratingAllIndex(0);
    // Clear all approvals — all TTS being regenerated
    setApprovedScripts(new Set());

    await Promise.all(scripts.map(async (_, i) => {
      if (abortController.signal.aborted) return;

      setRegeneratingAllIndex(i);
      setTtsResults(prev => ({
        ...prev,
        [i]: {
          audio_duration: 0,
          generating: true,
          stale: false,
          status: "queued",
          progress: 0,
          current_step: "Queued for voice-over generation",
        }
      }));

      try {
        const res = await apiPost(`/pipeline/tts/${pipelineId}/${i}`, {
          elevenlabs_model: elevenlabsModel,
          voice_id: voiceId && voiceId !== "default" ? voiceId : undefined,
          voice_settings: {
            stability: voiceStability,
            similarity_boost: voiceSimilarity,
            style: voiceStyle,
            speed: voiceSpeed,
            use_speaker_boost: voiceSpeakerBoost,
          },
          words_per_subtitle: getWordsPerSubtitleForVariant(i),
          min_segment_duration: minSegmentDuration,
          ultra_rapid_intro: ultraRapidIntro,
        }, { timeout: 60_000, signal: abortController.signal });

        if (abortController.signal.aborted || !isMountedRef.current) return;

        // apiPost throws on non-OK responses (FE-01)
        const data = await res.json();
        if (!isMountedRef.current) return;
        setTtsResults(prev => ({
          ...prev,
          [i]: {
            audio_duration: 0,
            generating: true,
            stale: false,
            status: data.job?.status || data.status || "queued",
            progress: data.job?.progress || 0,
            current_step: data.job?.current_step || "Queued for voice-over generation",
          }
        }));
      } catch (err) {
        if (abortController.signal.aborted) return;
        handleApiError(err, "TTS regeneration error");
        const message = err instanceof ApiError ? err.detail || err.message : "Voice-over dispatch failed";
        setTtsResults(prev => ({
          ...prev,
          [i]: {
            audio_duration: 0,
            generating: false,
            stale: false,
            status: "failed",
            progress: 0,
            current_step: "Voice-over failed",
            error: message,
          },
        }));
      }
    }));

    if (abortController.signal.aborted) {
      setTtsResults(prev => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (next[Number(key)]?.generating) {
            next[Number(key)] = {
              ...next[Number(key)],
              generating: false,
              status: "cancelled",
              current_step: "Voice-over cancelled",
            };
          }
        }
        return next;
      });
      setRegeneratingAll(false);
      setRegeneratingAllIndex(null);
    }
  };

  const handleCancelRegenerateAll = async () => {
    regenerateAbortRef.current?.abort();
    regenerateAbortRef.current = null;
    if (pipelineId) {
      try {
        await apiPost(`/pipeline/tts-cancel/${pipelineId}`, {
          variant_indices: scripts.map((_, index) => index),
        });
      } catch (err) {
        handleApiError(err, "Could not cancel voice-over generation");
      }
    }
    setRegeneratingAll(false);
    setRegeneratingAllIndex(null);
    setTtsResults(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[Number(key)]?.generating) {
          next[Number(key)] = {
            ...next[Number(key)],
            generating: false,
            status: "cancelled",
            current_step: "Voice-over cancelled",
          };
        }
      }
      return next;
    });
  };

  const hasActiveTtsJobs = Object.values(ttsResults).some(result => result.generating);

  useEffect(() => {
    if (!pipelineId || !hasActiveTtsJobs) return;
    let disposed = false;
    let requestInFlight = false;

    const pollTtsJobs = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const res = await apiGet(`/pipeline/tts-status/${pipelineId}`);
        const data = await res.json();
        if (disposed || !isMountedRef.current) return;

        const jobs = (data.jobs || {}) as Record<string, Partial<AsyncJobState>>;
        const results = (data.results || {}) as Record<string, Partial<TtsResult>>;
        const activeIndices = Object.entries(jobs)
          .filter(([, job]) => isActiveAsyncJob(job))
          .map(([key]) => Number(key))
          .filter(index => Number.isInteger(index) && index >= 0 && index < scripts.length);
        const firstActive = activeIndices.length > 0 ? activeIndices[0] : null;
        const completedAny = Object.values(jobs).some(job => job.status === "completed");
        const firstFailure = Object.values(jobs)
          .find(job => job.status === "failed" && job.error)?.error || null;

        setTtsResults(prev => {
          const next = { ...prev };
          for (const [key, job] of Object.entries(jobs)) {
            const index = Number(key);
            if (!Number.isInteger(index) || index < 0 || index >= scripts.length) continue;
            if (isActiveAsyncJob(job)) {
              next[index] = {
                audio_duration: 0,
                generating: true,
                stale: false,
                status: job.status,
                progress: job.progress || 0,
                current_step: job.current_step || "Generating voice-over",
              };
              continue;
            }

            if (job.status === "completed") {
              const result = results[key] || (job.result as Partial<TtsResult> | undefined) || {};
              next[index] = {
                audio_duration: Number(result.audio_duration) || 0,
                generating: false,
                stale: false,
                status: "completed",
                progress: 100,
                current_step: job.current_step || "Voice-over ready",
                srt_content: result.srt_content,
                script_word_count: result.script_word_count,
                srt_word_count: result.srt_word_count,
              };
            } else if (job.status === "failed" || job.status === "cancelled") {
              const message = job.error || (job.status === "failed" ? "Voice-over generation failed" : null);
              next[index] = {
                audio_duration: 0,
                generating: false,
                stale: false,
                status: job.status,
                progress: job.progress || 0,
                current_step: job.current_step,
                error: message,
              };
            }
          }
          return next;
        });

        setRegeneratingAllIndex(firstActive);
        if (firstActive === null) {
          setRegeneratingAll(false);
          if (completedAny) fetchElevenCredits();
          if (firstFailure) setPreviewError(firstFailure);
        }
      } catch {
        if (!disposed) setPreviewError("Could not refresh voice-over progress. Retrying...");
      } finally {
        requestInFlight = false;
      }
    };

    void pollTtsJobs();
    const timer = window.setInterval(pollTtsJobs, 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [pipelineId, hasActiveTtsJobs, scripts.length, fetchElevenCredits]);

  // Step 3: Regenerate audio for a single variant (force TTS regeneration + re-match)
  const handleRegenerateVariantAudio = async (variantIndex: number, previewKey?: string, visualVersion?: string) => {
    if (!pipelineId) return;
    if (regeneratingVariantAudio[variantIndex]) return;

    setRegeneratingVariantAudio(prev => ({ ...prev, [variantIndex]: true }));

    try {
      const res = await apiPost(`/pipeline/preview/${pipelineId}/${variantIndex}`, {
        elevenlabs_model: elevenlabsModel,
        voice_id: voiceId && voiceId !== "default" ? voiceId : undefined,
        source_video_ids: selectedSourceIdsRef.current.size > 0 ? Array.from(selectedSourceIdsRef.current) : undefined,
        voice_settings: {
          stability: voiceStability,
          similarity_boost: voiceSimilarity,
          style: voiceStyle,
          speed: voiceSpeed,
          use_speaker_boost: voiceSpeakerBoost,
        },
        words_per_subtitle: getWordsPerSubtitleForVariant(variantIndex),
        min_segment_duration: minSegmentDuration,
        ultra_rapid_intro: ultraRapidIntro,
        visual_version: visualVersion,
        force_regenerate_tts: true,
        preset: assemblyPreset,
        segment_proximity: segmentProximity,
      }, { timeout: 300_000 });

      const data = await res.json();
      if (!isMountedRef.current) return;
      setPreviews(prev => {
        const key = previewKey ?? buildPreviewKey(variantIndex);
        // Preserve the variant default transition (not in the preview response).
        return { ...prev, [key]: { ...data, defaultTransition: prev[key]?.defaultTransition ?? null } };
      });
    } catch (err) {
      handleApiError(err, "Audio regeneration error");
      if (err instanceof ApiError && err.isTimeout) {
        setPreviewError("Audio regeneration timed out. Try again.");
      } else {
        setPreviewError("Failed to regenerate audio. Please check if the backend is running.");
      }
    } finally {
      if (isMountedRef.current) {
        setRegeneratingVariantAudio(prev => ({ ...prev, [variantIndex]: false }));
      }
    }
  };

  // Per-script TTS: adopt library audio instead of generating
  const handleUseLibraryTts = async (variantIndex: number) => {
    if (!pipelineId) return;
    // FE-19: Prevent race between TTS generation and library adoption
    if (ttsResults[variantIndex]?.generating || regeneratingAll) return;
    const match = libraryMatches[variantIndex];
    if (!match) return;

    setTtsResults(prev => ({
      ...prev,
      [variantIndex]: { audio_duration: 0, generating: true, stale: false }
    }));

    try {
      const res = await apiPost(`/pipeline/tts-from-library/${pipelineId}/${variantIndex}`, {
        asset_id: match.asset_id,
      });

      // apiPost throws on non-OK responses (FE-01)
      const data = await res.json();
      setTtsResults(prev => ({
        ...prev,
        [variantIndex]: { audio_duration: data.audio_duration, generating: false, stale: false }
      }));
    } catch (err) {
      handleApiError(err, "Library TTS adoption error");
      setPreviewError("Failed to load library audio. Please try generating instead.");
      setTtsResults(prev => {
        const next = { ...prev };
        delete next[variantIndex];
        return next;
      });
    }
  };

  // Per-script TTS: play/pause audio
  const handlePlayTts = (variantIndex: number) => {
    if (!pipelineId) return;

    if (playingTtsVariant === variantIndex) {
      ttsPlayAbortRef.current?.abort();
      ttsAudioRef.current?.pause();
      setPlayingTtsVariant(null);
      setTtsAudioProgress(0);
      setTtsAudioDuration(0);
      return;
    }

    // Stop previous
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }

    setPlayingTtsVariant(variantIndex);

    const playBlob = (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      // FE-06: Single cleanup prevents double-revocation from onended+onerror race
      let revoked = false;
      const cleanup = () => {
        if (revoked) return;
        revoked = true;
        setPlayingTtsVariant(null);
        setTtsAudioProgress(0);
        setTtsAudioDuration(0);
        URL.revokeObjectURL(url);
      };
      const audio = new Audio(url);
      audio.onended = cleanup;
      audio.onerror = cleanup;
      audio.ontimeupdate = () => { if (!ttsSeekingRef.current) setTtsAudioProgress(audio.currentTime); };
      audio.onloadedmetadata = () => setTtsAudioDuration(audio.duration);
      audio.play().catch(cleanup);
      ttsAudioRef.current = audio;
    };

    // Try Step 2 TTS audio first, fall back to Step 3 preview audio
    ttsPlayAbortRef.current?.abort();
    const controller = new AbortController();
    ttsPlayAbortRef.current = controller;

    // Cache-bust: append timestamp to URL so browser never serves stale audio
    const cacheBust = `_t=${Date.now()}`;
    apiGet(`/pipeline/tts-audio/${pipelineId}/${variantIndex}?${cacheBust}`, { signal: controller.signal })
      .then(res => res.blob())
      .then(playBlob)
      .catch(() => {
        if (controller.signal.aborted) return;
        // Fallback: try preview audio (Step 3)
        apiGet(`/pipeline/audio/${pipelineId}/${variantIndex}?${cacheBust}`, { signal: controller.signal })
          .then(res => res.blob())
          .then(playBlob)
          .catch(() => { if (!controller.signal.aborted) setPlayingTtsVariant(null); });
      });
  };

  // Toggle variant selection
  const toggleVariant = (index: number) => {
    setSelectedVariants((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Batch fetch associations for a set of segment IDs
  const fetchAssociations = useCallback(async (segmentIds: string[]) => {
    if (segmentIds.length === 0) return;
    try {
      const params = new URLSearchParams();
      params.set("segment_ids", segmentIds.join(","));
      const res = await apiGetWithRetry(`/associations/segments?${params}`);
      const json = await res.json();
      const assocMap = json.associations || {};
      const map: Record<string, AssociationResponse> = {};
      for (const [segId, assoc] of Object.entries(assocMap)) {
        if (assoc) map[segId] = assoc as AssociationResponse;
      }
      setAssociations(prev => ({ ...prev, ...map }));
    } catch (error) {
      handleApiError(error, "Failed to load product associations");
    }
  }, []);

  // FE-20: Track previous segment IDs to avoid redundant association fetches
  const prevAssocSegIdsRef = useRef<string>("");

  // Trigger association fetch when previews arrive
  useEffect(() => {
    const segIds = new Set<string>();
    for (const preview of Object.values(previews)) {
      for (const match of preview.matches) {
        if (match.segment_id) segIds.add(match.segment_id);
      }
    }
    const ids = Array.from(segIds).sort();
    const idsKey = ids.join(",");
    if (ids.length > 0 && idsKey !== prevAssocSegIdsRef.current) {
      prevAssocSegIdsRef.current = idsKey;
      fetchAssociations(ids);
    }
  }, [previews, fetchAssociations]);

  // Association handler callbacks
  const handleProductSelected = (association: AssociationResponse) => {
    setAssociations(prev => ({ ...prev, [association.segment_id]: association }));
    setPickerSegmentId(null);
  };

  const handleImagesUpdated = (updatedAssociation: AssociationResponse) => {
    setAssociations(prev => ({ ...prev, [updatedAssociation.segment_id]: updatedAssociation }));
    setImagePickerAssoc(null);
  };

  // Single bag passed to extracted step components (F4). Keeps all state and
  // closures in PipelinePage so behavior is identical to the inline JSX.
  const pipelineCtx = {
    aiRulesExpanded,
    setAiRulesExpanded,
    aiInstructions,
    setAiInstructions,
    aiRulesDirty,
    setAiRulesDirty,
    aiRulesSaved,
    saveAiInstructions,
    pipelineName,
    setPipelineName,
    idea,
    setIdea,
    context,
    setContext,
    contextExpanded,
    setContextExpanded,
    contextProductCount,
    contextProducts,
    setContextProducts,
    handleOpenCatalog,
    catalogOpen,
    catalogSearch,
    handleCatalogSearchChange,
    catalogBrand,
    catalogCategory,
    handleCatalogFilterChange,
    catalogFilters,
    catalogLoading,
    catalogProducts,
    toggleCatalogProduct,
    selectedCatalogIds,
    catalogPage,
    handleCatalogPageChange,
    catalogPagination,
    handleAddToContext,
    variantCount,
    setVariantCount,
    targetScriptDuration,
    setTargetScriptDuration,
    provider,
    setProvider,
    codexModel,
    setCodexModel,
    codexAvailable: DESKTOP_CODEX_AVAILABLE,
    error,
    totalSegmentDuration,
    isGenerating,
    generationJob,
    handleCancelGenerate,
    handleGenerate,
    handleCreateManual,
    step2HeaderRef,
    scripts,
    setScripts,
    scriptNames,
    setScriptNames,
    handleScriptNameChange,
    handleScriptNameCommit,
    regeneratingAllScripts,
    regeneratingAllScriptsIndex,
    handleRegenerateAllScripts,
    handleCancelRegenerateAllScripts,
    regeneratingAll,
    regeneratingAllIndex,
    handleRegenerateAllTts,
    handleCancelRegenerateAll,
    regeneratingScript,
    handleRegenerateScript,
    ttsResults,
    setTtsResults,
    setStep,
    previewError,
    setPreviewError,
    elevenCredits,
    elevenCreditsLoading,
    elevenCreditsError,
    fetchElevenCredits,
    elevenlabsModel,
    setElevenlabsModel,
    voiceId,
    setVoiceId,
    voices,
    voicesLoading,
    defaultVoiceId,
    handleSetDefaultVoice,
    savingDefault,
    voiceSpeed,
    setVoiceSpeed,
    voiceStability,
    setVoiceStability,
    voiceSimilarity,
    setVoiceSimilarity,
    voiceStyle,
    setVoiceStyle,
    voiceSpeakerBoost,
    setVoiceSpeakerBoost,
    userChangedVoiceRef,
    wordsPerSubtitle,
    setWordsPerSubtitle,
    minSegmentDuration,
    setMinSegmentDuration,
    ultraRapidIntro,
    setUltraRapidIntro,
    assemblyPreset,
    setAssemblyPreset,
    segmentProximity,
    setSegmentProximity,
    renderAdjust,
    setRenderAdjust,
    scheduleReassemblePreviews,
    approvedScripts,
    setApprovedScripts,
    pipelineId,
    templateTransferBusy,
    handleExportPipelineTemplate,
    handleImportPipelineTemplate,
    saveScriptsToBackend,
    libraryMatches,
    setLibraryMatches,
    previews,
    setPreviews,
    srtPreviewOpen,
    setSrtPreviewOpen,
    setSelectedVariants,
    handleScriptCommit,
    productGroups,
    groupTagSearch,
    setGroupTagSearch,
    insertGroupTag,
    handlePlayTts,
    playingTtsVariant,
    ttsAudioDuration,
    ttsAudioProgress,
    setTtsAudioProgress,
    ttsAudioRef,
    ttsSeekingRef,
    handleGenerateTts,
    handleUseLibraryTts,
    sourceVideos,
    sourceVideosLoading,
    selectedSourceIds,
    handleSelectAllSources,
    handleDeselectAllSources,
    sourceVideoSearch,
    setSourceVideoSearch,
    sourceVideoViewMode,
    setSourceVideoViewMode,
    handleSourceToggle,
    metaMultiplication,
    handleMetaMultiplicationChange,
    previewCards,
    previewingIndex,
    isRendering,
    isResettingUsage,
    setIsResettingUsage,
    handlePreviewAll,
    selectedVariants,
    presetName,
    setPresetName,
    subtitleSettingsLoaded,
    subtitleSaveState,
    activeStyleKey,
    setActiveStyleKey,
    handleCopyVariantSubtitle,
    activeStyleHasOverride,
    handleResetVariantSubtitle,
    savePresetDialogOpen,
    setSavePresetDialogOpen,
    userSubtitlePresets,
    setUserSubtitlePresets,
    subtitleRotation,
    handleSubtitleRotationChange,
    handleSubtitleTemplateChange,
    handleUpdateSubtitleTemplateStyles,
    handleUseSubtitleTemplateForAll,
    getWordsPerSubtitleForVariant,
    variantSubtitleOverrides,
    handleVariantTemplateOverrideChange,
    handleResetVariantTemplateOverride,
    variantTemplateSelections,
    subtitleSettings,
    setSubtitleSettings,
    scheduleProfileSubtitleSave,
    subtitleOverrides,
    setSubtitleOverrides,
    scheduleOverridesSave,
    currentProfileIdRef,
    getSubtitleSettingsFor,
    getPreviewSubtitleTextFor,
    handleVariantSubtitleChange,
    toggleVariant,
    handlePlayAudio,
    playingAudio,
    setPlayingAudio,
    audioRef,
    previewVariant,
    setPreviewVariant,
    handleRegenerateVariantAudio,
    regeneratingVariantAudio,
    variantThumbnails,
    setVariantThumbnails,
    thumbnailPickerKey,
    setThumbnailPickerKey,
    selectedSourceIdsArray,
    availableSegments,
    currentProfile,
    getPreviewSubtitleSettingsFor,
    getPreviewSubtitleTemplateSettingsFor,
    interstitialSlides,
    attentionTimelines,
    attentionSelection,
    handleAttentionSelectionChange,
    applyAttentionTemplateToVariants,
    EMPTY_SLIDES,
    getInterstitialSlidesChangeHandler,
    getAttentionTimelineChangeHandler,
    getMatchesChangeHandler,
    getVideoTimelineChangeHandler,
    getDefaultTransitionChangeHandler,
    getMusicChangeHandler,
    buildPipOverlaysForMatches,
    handlePreviewPlayerClose,
    savePresetName,
    setSavePresetName,
    savePresetError,
    setSavePresetError,
    savePresetSubmitting,
    handleSubmitSavePreset,
    renderSettings,
    setRenderSettings,
    existingRenderCount,
    setMetaMultiplication,
    setVariantStatuses,
    setIsRendering,
    handleRenderClick,
    isCheckingRender,
    skipCheckResults,
    setSkipCheckResults,
    showSkipDialog,
    setShowSkipDialog,
    handleRender,
    handleCancelRender,
    setConfirmDialog,
    resetPipeline,
    variantStatuses,
    handleRemakeVariant,
    getVideoCacheBust,
    setPublishVariant,
    setGeneratedCaptions,
    setGeneratedYoutubeTitles,
    generatedCaptions,
    generatedYoutubeTitles,
    libraryProjectId,
    step,
    step3Mode,
    setStep3Mode,
    historyLoading,
    historyPipelines,
    selectedHistoryId,
    setSelectedHistoryId,
    editingNameId,
    setEditingNameId,
    editingNameValue,
    setEditingNameValue,
    handleSavePipelineName,
    expandedIdeas,
    setExpandedIdeas,
    handleDeletePipeline,
    fetchHistoryScripts,
    historyScriptsLoading,
    historyImporting,
    setPipelineId,
    historyScripts,
    setHistoryScripts,
    formatScript,
    buildRestoredTts,
    historyTtsInfo,
    historyTtsJobs,
    historyPreviewInfo,
    historyContextProducts,
    historyTemplateSettings,
    applyPipelineTemplateSettings,
    setSelectedSourceIds,
    restoreSourceSelection,
    setHistorySelectedScripts,
    historySelectedScripts,
    handleHistoryImport,
    pipelineLayout,
    showHistoryPanel,
    setShowHistoryPanel,
  };

  const isEditingWorkspace = step >= 1 && step <= 3;
  // Preview always needs the wide live-editing workspace. The preference is
  // applied elsewhere, where a linear reading order is more approachable.
  const usesWideWorkspace = step === 3 || pipelineLayout === "workspace";
  const usesFixedWorkspace = isEditingWorkspace && usesWideWorkspace;
  // History is always opt-in and overlay-free, so closing it gives the current
  // step its full width and the choice persists when navigation changes steps.
  const historyVisible = showHistoryPanel;
  const splitEnabled = usesFixedWorkspace && historyVisible;

  return (
    <div className={`min-h-full bg-background ${
      usesFixedWorkspace
        ? "min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:flex-col min-[1280px]:overflow-hidden"
        : ""
    }`}>
      {/* One shared toolbar keeps the pipeline identity and progress stable at every step. */}
      <PipelineStepper ctx={pipelineCtx} />

      <div className={`mx-auto w-full ${
        usesFixedWorkspace
          ? "max-w-none p-0 min-[1280px]:min-h-0 min-[1280px]:flex-1"
          : "max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8"
      }`}>
        {/* Main content + History sidebar */}
        <WorkspaceSplit
          splitId="history"
          enabled={splitEnabled}
          fallbackClassName={`grid grid-cols-1 ${usesWideWorkspace && historyVisible ? "min-[1280px]:grid-cols-[minmax(0,1fr)_20rem]" : ""} ${
            usesFixedWorkspace ? "min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:gap-px min-[1280px]:bg-border" : "gap-5"
          }`}
          leftSizing={{ minSize: "40%" }}
          rightSizing={{ defaultSize: "20rem", minSize: "13rem" }}
        >
        <div className={`min-w-0 ${usesFixedWorkspace ? "min-[1280px]:h-full min-[1280px]:min-h-0" : ""}`}>

        {/* Step 1 — Idea Input */}
        {step === 1 && <Step1Script ctx={pipelineCtx} />}

        {/* Step 2 — Review Scripts */}
        {step === 2 && <Step2TTS ctx={pipelineCtx} />}

        {/* Step 3 — Preview & Select */}
        {step === 3 && (
          step3Mode === "edit"
            ? <Step3Preview ctx={pipelineCtx} />
            : <Step3Export ctx={pipelineCtx} />
        )}

        {/* Step 4 — Render Progress */}
        {step === 4 && <Step4Render ctx={pipelineCtx} />}

        </div>{/* end main content */}

        {/* History Sidebar — hidden on Step 3 unless toggled from the toolbar */}
          {historyVisible && (
          <div className={
            usesFixedWorkspace
              ? "min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:overflow-hidden"
              : ""
          }>
            <PipelineHistorySidebar ctx={pipelineCtx} />
          </div>
          )}

        </WorkspaceSplit>{/* end main + history split */}
      </div>

      {/* Product Picker Dialog — gated: association is Gomag-catalog only */}
      {CATALOG_ENABLED && pickerSegmentId && (
        <ProductPickerDialog
          open={!!pickerSegmentId}
          onOpenChange={(open) => { if (!open) setPickerSegmentId(null); }}
          segmentId={pickerSegmentId}
          onProductSelected={handleProductSelected}
        />
      )}

      {/* Image Picker Dialog — gated: association is Gomag-catalog only */}
      {CATALOG_ENABLED && imagePickerAssoc && (
        <ImagePickerDialog
          open={!!imagePickerAssoc}
          onOpenChange={(open) => { if (!open) setImagePickerAssoc(null); }}
          associationId={imagePickerAssoc.id}
          catalogProductId={imagePickerAssoc.catalog_product_id}
          currentSelectedUrls={imagePickerAssoc.selected_image_urls}
          productTitle={imagePickerAssoc.product_title}
          onImagesUpdated={handleImagesUpdated}
        />
      )}

      {/* Publish Dialog */}
      {publishVariant && publishVariant.clip_id && publishVariant.final_video_path && (
        <PublishDialog
          clipId={publishVariant.clip_id}
          videoPath={publishVariant.final_video_path}
          initialCaption={generatedCaptions[publishVariant.clip_id] || undefined}
          initialYoutubeTitle={generatedYoutubeTitles[publishVariant.clip_id] || undefined}
          open={!!publishVariant}
          onOpenChange={(open) => { if (!open) setPublishVariant(null); }}
          onPublished={() => {
            toast.success("Published successfully from pipeline!");
          }}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        loading={confirmDialog.loading}
      />

    </div>
  );
}

function extractPreviewSubtitleText(srtContent?: string): string | undefined {
  if (!srtContent) return undefined;
  const blocks = srtContent
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^\d+$/.test(line))
      .filter((line) => !/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(line));
    if (lines.length > 0) {
      return lines.join(" ");
    }
  }

  return undefined;
}
