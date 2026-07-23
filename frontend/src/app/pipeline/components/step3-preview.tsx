"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { InspectorField, InspectorSection } from "@/components/ui/inspector";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiPost, apiDelete } from "@/lib/api";
import { useApiUrl } from "@/hooks/use-api-url";
import { segmentFileUrl } from "@/lib/media-url";
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  Play,
  ArrowRight,
  Type,
  Volume2,
  Pause,
  RefreshCw,
  Film,
  Info,
  Maximize2,
  Minimize2,
  Pencil,
  Images,
  Mic2,
  Music2,
  Search,
  List,
  Grid2X2,
  FileText,
  Captions,
} from "lucide-react";
import { toast } from "sonner";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { SubtitleSettings, UserSubtitlePreset } from "@/types/video-processing";
import type { AttentionTimeline } from "@/types/attention-timeline";
import {
  AttentionTemplatePicker,
  EMPTY_ATTENTION_SELECTION,
  type AttentionSelection,
} from "@/components/attention-template-picker";
import { uploadAttentionMedia } from "@/components/dialogs/attention-asset-picker-dialog";
import type { CompositionClip, TransitionSpec } from "@/types/composition-timeline";
import { TimelineEditor, SegmentOption, InterstitialSlide } from "@/components/timeline-editor";
import { ThumbnailPicker, ThumbnailSelection } from "@/components/thumbnail-picker";
import { VariantPreviewPlayer } from "@/components/variant-preview-player";
import {
  MatchPreview,
  PreviewData,
  PreviewKey,
  StyleKey,
  PreviewCard,
} from "../pipeline-types";
import { formatDuration } from "../pipeline-utils";
import { SubtitleStylePreviewPanel } from "./subtitle-style-preview-panel";
import { WorkspaceSplit } from "./workspace-split";
import { WorkspacePanelHeader } from "./workspace-panel-header";
import { SubtitleTemplateRotationPanel } from "./subtitle-template-rotation-panel";
import {
  findMatchingSubtitleTemplateGroup,
  formatSubtitleStyleCount,
  getAssignedSubtitleStyleCount,
  getSubtitleTemplateGroups,
} from "../subtitle-template-collections";
import {
  NO_SUBTITLES_PRESET_ID,
  resolveSubtitleAssignmentForCard,
  type SubtitleTemplateRotation,
} from "../subtitle-template-rotation";
import type { SafeZoneType } from "@/components/safe-zone-overlay";
import type { AttentionTemplateApplyResult } from "../attention-template-apply";
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

const ALL_ATTENTION_VARIANTS = "__all__";
const ATTENTION_INSPECTOR_TARGET_ID = "step3-attention-cue-inspector";

type SourceKind = "video" | "image" | "script" | "subtitle" | "voiceover" | "soundtrack";
type SourceView = "list" | "icons";
type ProjectSourceItem = {
  id: string;
  kind: SourceKind;
  label: string;
  detail: string;
  variantIndex?: number;
  thumbnailUrl?: string;
};
type SourceVideoInventoryItem = {
  id: string;
  name: string;
  thumbnail_path: string | null;
  duration: number | null;
  segments_count: number;
};

const SOURCE_KIND_META: Record<SourceKind, {
  label: string;
  icon: typeof Film;
}> = {
  video: { label: "Video", icon: Film },
  image: { label: "Images", icon: Images },
  script: { label: "Scripts", icon: FileText },
  subtitle: { label: "Subtitles / SRT", icon: Captions },
  voiceover: { label: "Voice-over", icon: Mic2 },
  soundtrack: { label: "Soundtracks", icon: Music2 },
};

const fileLabel = (value: string, fallback: string) => {
  const clean = value.split("?")[0].replaceAll("\\", "/");
  const last = clean.split("/").filter(Boolean).pop();
  if (!last) return fallback;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

type ConfirmDialogState = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant: "destructive" | "default";
  onConfirm: () => void;
  loading?: boolean;
};

/**
 * Timeline state contract consumed by the future CompositePreviewPlayer (F5).
 *
 * The precisely-typed fields below describe everything the Step 3 timeline
 * needs to render and edit a variant's preview: the per-variant preview data
 * (`previews`), the segment pool (`availableSegments`), interstitial slides,
 * thumbnails, the selected source videos, the stable per-key change handlers,
 * and the subtitle-style resolution helpers. Everything else stays loose
 * (`any`) via the index signature, matching the stage-2 ctx-bag pattern.
 */
type Step3Ctx = {
  previews: Record<PreviewKey, PreviewData>;
  previewCards: PreviewCard[];
  availableSegments: SegmentOption[];
  interstitialSlides: Record<PreviewKey, InterstitialSlide[]>;
  EMPTY_SLIDES: InterstitialSlide[];
  variantThumbnails: Record<PreviewKey, ThumbnailSelection>;
  setVariantThumbnails: Dispatch<SetStateAction<Record<PreviewKey, ThumbnailSelection>>>;
  selectedSourceIdsArray: string[];
  sourceVideos?: SourceVideoInventoryItem[];
  getMatchesChangeHandler: (previewKey: string) => (matches: MatchPreview[]) => void;
  getVideoTimelineChangeHandler: (previewKey: string) => (timeline: CompositionClip[]) => void;
  getDefaultTransitionChangeHandler: (previewKey: string) => (spec: TransitionSpec | null) => void;
  getInterstitialSlidesChangeHandler: (previewKey: string) => (slides: InterstitialSlide[]) => void;
  attentionTimelines: Record<PreviewKey, AttentionTimeline>;
  getAttentionTimelineChangeHandler: (previewKey: string) => (timeline: AttentionTimeline) => void;
  attentionSelection: AttentionSelection;
  handleAttentionSelectionChange: (selection: AttentionSelection) => void;
  applyAttentionTemplateToVariants: (
    selection: AttentionSelection,
    cardKeys: string[],
  ) => Promise<AttentionTemplateApplyResult>;
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState>>;
  getPreviewSubtitleSettingsFor: (card: Pick<PreviewCard, "key" | "baseIndex" | "visualVersion">) => SubtitleSettings;
  getPreviewSubtitleTemplateSettingsFor: (card: Pick<PreviewCard, "key" | "baseIndex" | "visualVersion">) => SubtitleSettings;
  getPreviewSubtitleTextFor: (card: Pick<PreviewCard, "key" | "baseIndex" | "visualVersion">) => string | undefined;
  getSubtitleSettingsFor: (styleKey: StyleKey) => SubtitleSettings;
  subtitleSettings: SubtitleSettings;
  subtitleOverrides: Partial<Record<StyleKey, SubtitleSettings>>;
  setSubtitleOverrides: Dispatch<SetStateAction<Partial<Record<StyleKey, SubtitleSettings>>>>;
  activeStyleKey: StyleKey;
  selectedVariants: Set<number>;
  userSubtitlePresets: UserSubtitlePreset[];
  setUserSubtitlePresets: Dispatch<SetStateAction<UserSubtitlePreset[]>>;
  subtitleRotation: SubtitleTemplateRotation;
  variantSubtitleOverrides: Partial<Record<PreviewKey, Partial<SubtitleSettings>>>;
  variantTemplateSelections: Partial<Record<PreviewKey, string>>;
  handleSubtitleTemplateChange: (rotation: SubtitleTemplateRotation) => void;
  handleUpdateSubtitleTemplateStyles: (
    templateId: string,
    templateName: string,
    styles: UserSubtitlePreset[],
  ) => Promise<boolean>;
  handleUseSubtitleTemplateForAll: () => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Step3Preview({ ctx }: { ctx: any }) {
  const mediaApiUrl = useApiUrl();
  const {
    previewCards,
    selectedVariants,
    setStep3Mode,
    subtitleSettingsLoaded,
    metaMultiplication,
    subtitleSaveState,
    activeStyleKey,
    setActiveStyleKey,
    handleCopyVariantSubtitle,
    handleResetVariantSubtitle,
    savePresetDialogOpen,
    setSavePresetDialogOpen,
    userSubtitlePresets,
    setUserSubtitlePresets,
    subtitleRotation,
    handleSubtitleRotationChange,
    getWordsPerSubtitleForVariant,
    variantSubtitleOverrides,
    handleVariantTemplateOverrideChange,
    handleResetVariantTemplateOverride,
    variantTemplateSelections,
    handleSubtitleTemplateChange,
    handleUpdateSubtitleTemplateStyles,
    handleUseSubtitleTemplateForAll,
    subtitleOverrides,
    currentProfileIdRef,
    pipelineId,
    getSubtitleSettingsFor,
    handleVariantSubtitleChange,
    previews,
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
    sourceVideos = [],
    availableSegments,
    currentProfile,
    getPreviewSubtitleSettingsFor,
    getPreviewSubtitleTemplateSettingsFor,
    getPreviewSubtitleTextFor,
    interstitialSlides,
    attentionTimelines,
    attentionSelection,
    handleAttentionSelectionChange,
    applyAttentionTemplateToVariants,
    setConfirmDialog,
    EMPTY_SLIDES,
    getInterstitialSlidesChangeHandler,
    getAttentionTimelineChangeHandler,
    getMatchesChangeHandler,
    getVideoTimelineChangeHandler,
    getMusicChangeHandler,
    buildPipOverlaysForMatches,
    handlePreviewPlayerClose,
    minSegmentDuration,
    setMinSegmentDuration,
    setWordsPerSubtitle,
    ultraRapidIntro,
    setUltraRapidIntro,
    segmentProximity,
    setSegmentProximity,
    renderAdjust,
    scheduleReassemblePreviews,
    savePresetName,
    setSavePresetName,
    savePresetError,
    setSavePresetError,
    savePresetSubmitting,
    handleSubmitSavePreset,
    previewError,
    renderSettings,
  }: Step3Ctx = ctx;

  // Which variant's full-screen editor modal is open (card.key), or null.
  const [maximizedKey, setMaximizedKey] = useState<string | null>(null);
  // Which settings tab is active in the maximized editor's settings column.
  const [maximizeSettingsTab, setMaximizeSettingsTab] = useState<"subtitles" | "timing" | "adjust">("subtitles");
  const [editingVariantKey, setEditingVariantKey] = useState<PreviewKey | null>(null);
  const [variantSubtitleDraft, setVariantSubtitleDraft] = useState<SubtitleSettings | null>(null);
  const [clearingLegacySubtitleAssignments, setClearingLegacySubtitleAssignments] = useState(false);
  const [safeZoneEnabled, setSafeZoneEnabled] = useState(false);
  const [safeZoneType, setSafeZoneType] = useState<SafeZoneType>("reel");
  const [sourceFilter, setSourceFilter] = useState<SourceKind | "all">("all");
  const [sourceView, setSourceView] = useState<SourceView>("list");
  const [sourceQuery, setSourceQuery] = useState("");
  const [resourcePanel, setResourcePanel] = useState<"image-templates" | "sources">("image-templates");
  const [attentionScopeOverride, setAttentionScopeOverride] = useState<{
    pipelineId: string | null;
    scope: string;
  } | null>(null);
  const [attentionApplying, setAttentionApplying] = useState(false);
  const [attentionApplyResult, setAttentionApplyResult] = useState<{
    pipelineId: string | null;
    note: string;
  } | null>(null);
  const subtitleRotationPanelRef = useRef<HTMLDivElement>(null);
  const subtitleTemplateGroups = useMemo(
    () => getSubtitleTemplateGroups(userSubtitlePresets),
    [userSubtitlePresets],
  );
  const activeSubtitleTemplateGroup = useMemo(
    () => findMatchingSubtitleTemplateGroup(subtitleTemplateGroups, subtitleRotation.presetIds),
    [subtitleRotation.presetIds, subtitleTemplateGroups],
  );
  const assignedSubtitleStyleCount = useMemo(
    () => getAssignedSubtitleStyleCount(subtitleRotation.presetIds, userSubtitlePresets),
    [subtitleRotation.presetIds, userSubtitlePresets],
  );
  const legacySubtitleAssignmentCount = useMemo(
    () => previewCards.filter((card) => Boolean(variantTemplateSelections[card.key])).length,
    [previewCards, variantTemplateSelections],
  );
  const subtitleAssignmentSummary = useMemo(() => {
    const manualCards = previewCards.filter((card) => Boolean(variantTemplateSelections[card.key]));
    if (manualCards.length > 0) {
      const manualIds = new Set(manualCards.map((card) => variantTemplateSelections[card.key]));
      if (manualCards.length === previewCards.length && manualIds.size === 1) {
        const [presetId] = [...manualIds];
        const label = presetId === NO_SUBTITLES_PRESET_ID
          ? "No subtitles"
          : userSubtitlePresets.find((preset) => preset.id === presetId)?.name ?? "Manual style";
        return `${label} · all ${manualCards.length} ${manualCards.length === 1 ? "output" : "outputs"}`;
      }
      if (subtitleRotation.enabled) {
        return `${activeSubtitleTemplateGroup?.name ?? "Custom rotation"} · ${manualCards.length} manual`;
      }
      return `${manualCards.length} manual ${manualCards.length === 1 ? "assignment" : "assignments"}`;
    }
    if (subtitleRotation.enabled) {
      return `${activeSubtitleTemplateGroup?.name ?? "Custom rotation"} · ${formatSubtitleStyleCount(assignedSubtitleStyleCount)}`;
    }
    return userSubtitlePresets.length > 0 ? "No template applied" : "No saved templates yet";
  }, [
    activeSubtitleTemplateGroup?.name,
    assignedSubtitleStyleCount,
    previewCards,
    subtitleRotation.enabled,
    userSubtitlePresets,
    variantTemplateSelections,
  ]);
  const attentionApplySelection = attentionSelection ?? EMPTY_ATTENTION_SELECTION;

  // Ctrl+V anywhere in Step 3 (outside a text field) drops a clipboard image
  // into the next attention slot. Browsers never expose video via clipboard,
  // so this is images-only by design.
  useEffect(() => {
    if (!pipelineId || !attentionApplySelection.templateId) return;
    const onPaste = (event: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      const toastId = toast.loading("Uploading pasted image...");
      void (async () => {
        try {
          const asset = await uploadAttentionMedia(file);
          handleAttentionSelectionChange({
            ...attentionApplySelection,
            assets: [...attentionApplySelection.assets, asset],
          });
          toast.success("Image added to the next attention slot", { id: toastId });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Paste upload failed", { id: toastId });
        }
      })();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pipelineId, attentionApplySelection, handleAttentionSelectionChange]);
  const attentionApplyScope = attentionScopeOverride
    && attentionScopeOverride.pipelineId === pipelineId
    ? attentionScopeOverride.scope
    : ALL_ATTENTION_VARIANTS;
  const attentionApplyNote = attentionApplyResult
    && attentionApplyResult.pipelineId === pipelineId
    ? attentionApplyResult.note
    : null;
  const attentionApplyTargetCards = attentionApplyScope === ALL_ATTENTION_VARIANTS
    ? previewCards
    : previewCards.filter((card) => card.key === attentionApplyScope);
  const attentionApplyTimelinesReady = attentionApplyTargetCards.length > 0
    && attentionApplyTargetCards.every((card) => attentionTimelines[card.key] !== undefined);
  const sourceInventory = useMemo(() => {
    const segmentCounts = new Map<string, number>();
    availableSegments.forEach((segment) => {
      if (!segment.source_video_id) return;
      segmentCounts.set(
        segment.source_video_id,
        (segmentCounts.get(segment.source_video_id) ?? 0) + 1,
      );
    });

    const sourceVideoIds = new Set(selectedSourceIdsArray);
    const attentionMedia = new Map<string, "image" | "video">();
    const imageUrls = new Set<string>();

    attentionApplySelection.assets.forEach((asset) => {
      attentionMedia.set(asset.url, asset.type);
    });
    Object.values(variantThumbnails).forEach((thumbnail) => {
      if (thumbnail?.imageUrl) imageUrls.add(thumbnail.imageUrl);
    });
    Object.values(attentionTimelines).forEach((timeline) => {
      timeline.cues.forEach((cue) => {
        cue.layers.forEach((layer) => {
          const url = layer.assetUrl || layer.assetId;
          if (url && !url.startsWith("pending:")) {
            attentionMedia.set(url, layer.mediaType === "video" ? "video" : "image");
          }
        });
      });
    });
    Object.values(previews).forEach((preview) => {
      preview.matches.forEach((match) => {
        if (match.source_video_id) sourceVideoIds.add(match.source_video_id);
      });
      (preview.video_timeline ?? []).forEach((clip) => {
        if (clip.source_video_id) sourceVideoIds.add(clip.source_video_id);
      });
    });
    attentionMedia.forEach((type, url) => {
      if (type === "image") imageUrls.add(url);
    });

    const videos: ProjectSourceItem[] = Array.from(sourceVideoIds).map((id, index) => {
      const video = sourceVideos.find((item) => item.id === id);
      const segmentCount = video?.segments_count ?? segmentCounts.get(id) ?? 0;
      const duration = video?.duration ? `${formatDuration(video.duration)} · ` : "";
      return {
        id: `video:${id}`,
        kind: "video",
        label: video?.name || `Source video ${index + 1}`,
        detail: `${duration}${segmentCount} segment${segmentCount === 1 ? "" : "s"}`,
        thumbnailUrl: video?.thumbnail_path
          ? `${mediaApiUrl}/segments/source-videos/${encodeURIComponent(id)}/thumbnail`
          : undefined,
      };
    });
    attentionMedia.forEach((type, url) => {
      if (type === "video" && !videos.some((item) => item.id === `video:${url}`)) {
        videos.push({
          id: `video:${url}`,
          kind: "video",
          label: fileLabel(url, `Overlay video ${videos.length + 1}`),
          detail: "Attention overlay",
        });
      }
    });

    const images: ProjectSourceItem[] = Array.from(imageUrls).map((url, index) => ({
      id: `image:${url}`,
      kind: "image",
      label: fileLabel(url, `Image ${index + 1}`),
      detail: Object.values(variantThumbnails).some((thumbnail) => thumbnail?.imageUrl === url)
        ? "Variant thumbnail"
        : "Attention image",
      thumbnailUrl: segmentFileUrl(mediaApiUrl, url),
    }));

    const sourceCards = Array.from(
      new Map(previewCards.map((card) => [card.baseIndex, card])).values(),
    );
    const scripts: ProjectSourceItem[] = sourceCards.map((card) => ({
      id: `script:${card.baseIndex}`,
      kind: "script",
      label: card.label || `Script ${card.baseIndex + 1}`,
      detail: card.script.trim().replace(/\s+/g, " ").slice(0, 120) || "Empty script",
    }));
    const subtitles: ProjectSourceItem[] = sourceCards.flatMap((card) => {
      const srtContent = previews[card.key]?.srt_content?.trim();
      if (!srtContent) return [];
      const cueCount = srtContent.split(/\r?\n\s*\r?\n/).filter(Boolean).length;
      return [{
        id: `subtitle:${card.baseIndex}`,
        kind: "subtitle",
        label: `${card.label || `Script ${card.baseIndex + 1}`} subtitles`,
        detail: `${cueCount} subtitle cue${cueCount === 1 ? "" : "s"} · SRT`,
      }];
    });
    const voiceovers: ProjectSourceItem[] = sourceCards.map((card) => ({
      id: `voiceover:${card.baseIndex}`,
      kind: "voiceover",
      label: `Script ${card.baseIndex + 1} voice-over`,
      detail: formatDuration(previews[card.key]?.audio_duration ?? 0),
      variantIndex: card.baseIndex,
    }));

    const soundtracks: ProjectSourceItem[] = Array.from(new Map(
      Object.values(previews)
        .filter((preview) => Boolean(preview.music))
        .map((preview) => {
          const item = preview.music!;
          return [item.assetUrl || item.assetId, item] as const;
        }),
    ).entries()).map(([id, item], index) => ({
      id: `soundtrack:${id}`,
      kind: "soundtrack",
      label: item.label || fileLabel(item.assetUrl || item.assetId, `Audio ${index + 1}`),
      detail: "Background soundtrack",
    }));

    return {
      items: [...videos, ...images, ...scripts, ...subtitles, ...voiceovers, ...soundtracks],
    };
  }, [
    attentionApplySelection.assets,
    attentionTimelines,
    availableSegments,
    mediaApiUrl,
    previewCards,
    previews,
    selectedSourceIdsArray,
    sourceVideos,
    variantThumbnails,
  ]);
  const filteredSourceItems = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    return sourceInventory.items.filter((item) => (
      (sourceFilter === "all" || item.kind === sourceFilter)
      && (!query || `${item.label} ${item.detail}`.toLocaleLowerCase().includes(query))
    ));
  }, [sourceFilter, sourceInventory.items, sourceQuery]);
  const activeSafeZone = safeZoneEnabled ? safeZoneType : null;
  const editingVariantCard = useMemo(
    () => previewCards.find((card) => card.key === editingVariantKey),
    [editingVariantKey, previewCards],
  );

  const runAttentionTemplateApply = async (cardKeys: string[]) => {
    setAttentionApplying(true);
    setAttentionApplyResult(null);
    try {
      const result = await applyAttentionTemplateToVariants(attentionApplySelection, cardKeys);
      const messages: string[] = [];
      if (result.appliedKeys.length > 0) {
        const message = `Applied to ${result.appliedKeys.length} variant${result.appliedKeys.length === 1 ? "" : "s"}.`;
        messages.push(message);
        toast.success(message);
      }
      if (result.skippedKeys.length > 0) {
        const message = `Skipped ${result.skippedKeys.length} variant${result.skippedKeys.length === 1 ? "" : "s"} without a preview and matches.`;
        messages.push(message);
        toast.warning(message);
      }
      if (result.failedKeys.length > 0) {
        const message = `Could not apply to ${result.failedKeys.length} variant${result.failedKeys.length === 1 ? "" : "s"}.`;
        messages.push(message);
        toast.error(message);
      }
      setAttentionApplyResult({
        pipelineId,
        note: messages.join(" ") || "No variants were targeted.",
      });
    } finally {
      setAttentionApplying(false);
    }
  };

  const handleAttentionTemplateApply = () => {
    const targetKeys = attentionApplyTargetCards.map((card) => card.key);
    const overwriteCards = attentionApplyTargetCards.filter(
      (card) => (attentionTimelines[card.key]?.cues.length ?? 0) > 0,
    );
    const apply = () => runAttentionTemplateApply(targetKeys);

    if (overwriteCards.length === 0) {
      void apply();
      return;
    }

    setConfirmDialog({
      open: true,
      title: "Replace attention images?",
      description: `${overwriteCards.length} targeted variant${overwriteCards.length === 1 ? " already has" : "s already have"} attention images. Applying this template will replace the existing timeline${overwriteCards.length === 1 ? "" : "s"}.`,
      confirmLabel: "Replace attention images",
      variant: "default",
      onConfirm: () => {
        setConfirmDialog((current) => ({ ...current, loading: true }));
        void apply().finally(() => {
          setConfirmDialog((current) => ({ ...current, open: false, loading: false }));
        });
      },
    });
  };

  // Confine the maximized editor to the app work area (below the workspace
  // titlebar, right of the settings sidebar) instead of the whole screen.
  // Measuring <main> handles every mode for free — desktop titlebar or not,
  // sidebar collapsed/expanded, mobile — since <main> already starts past both.
  const [maximizedBounds, setMaximizedBounds] = useState<{
    top: number; left: number; width: number; height: number;
  } | null>(null);
  useEffect(() => {
    if (maximizedKey === null) return;
    const main = document.querySelector("main");
    if (!main) return;
    const measure = () => {
      const r = main.getBoundingClientRect();
      setMaximizedBounds({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [maximizedKey]);

  const previewProxySourceIdsKey = useMemo(() => Array.from(new Set(
    previewCards.flatMap((card) =>
      (previews[card.key]?.matches ?? [])
        .map((match) => match.source_video_id)
        .filter((sourceVideoId): sourceVideoId is string => Boolean(sourceVideoId))
    )
  )).sort().join(","), [previewCards, previews]);

  // This component only mounts while the workflow is in Step 3. Trigger proxy
  // generation now so seek-friendly media can be ready before Preview is played.
  useEffect(() => {
    if (!currentProfile?.id || !previewProxySourceIdsKey) return;

    const controller = new AbortController();
    apiPost(
      "/segments/source-videos/preview-proxies",
      { video_ids: previewProxySourceIdsKey.split(",") },
      { signal: controller.signal }
    ).catch((error) => {
      if (!controller.signal.aborted) {
        console.warn("[Step3Preview] Failed to start eager preview proxies", error);
      }
    });

    return () => controller.abort();
  }, [currentProfile?.id, previewProxySourceIdsKey]);

  const openRenderedPreview = (previewKey: PreviewKey) => {
    // The FFmpeg preview owns its rendered audio track. Stop the standalone
    // voice-over first so two variants cannot play over each other.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingAudio(null);
    setPreviewVariant(previewKey);
  };

  const activeSubtitleStyleKey: StyleKey = metaMultiplication
    ? activeStyleKey === "B" ? "B" : "A"
    : "default";
  const activeSubtitleStyleHasOverride = Boolean(
    subtitleOverrides[activeSubtitleStyleKey]
      && Object.keys(subtitleOverrides[activeSubtitleStyleKey] ?? {}).length > 0
  );

  // Lifted out of the JSX below so the exact same element (same state, same
  // handlers) can render both in the left inspector and inside the maximized
  // editor's settings column — no divergent copies of the settings UI.
  const previewTimingCard = (
    <div className="order-2" data-testid="step3-preview-timing">
      <InspectorSection
        title="Preview Timing"
        summary={`${minSegmentDuration}s · ${segmentProximity === "merge" ? "Merge" : "Separate"}${ultraRapidIntro ? " · Rapid intro" : ""}`}
        defaultOpen
      >
        <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <Label htmlFor="pacing" className="text-xs font-medium text-muted-foreground">Pacing</Label>
            <InlineInfo label="About pacing">
              Choose how quickly the visual cuts change.
            </InlineInfo>
          </div>
          <Select
            value={String(minSegmentDuration)}
            onValueChange={(value) => {
              setMinSegmentDuration(Number(value));
              scheduleReassemblePreviews();
            }}
          >
            <SelectTrigger id="pacing" size="sm" className="w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">Fast (2s)</SelectItem>
              <SelectItem value="3">Normal (3s)</SelectItem>
              <SelectItem value="5">Slow (5s)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <Label htmlFor="segment-proximity" className="text-xs font-medium text-muted-foreground">Segment proximity</Label>
            <InlineInfo label="About segment proximity">
              Separate: keep clips cut from nearby moments of the same source apart. Merge: fuse them into one continuous shot to avoid a jump-cut.
            </InlineInfo>
          </div>
          <Select
            value={segmentProximity}
            onValueChange={(value) => {
              setSegmentProximity(value as typeof segmentProximity);
              scheduleReassemblePreviews();
            }}
          >
            <SelectTrigger id="segment-proximity" size="sm" className="w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="separate">Separate</SelectItem>
              <SelectItem value="merge">Merge</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <Label htmlFor="rapid-intro" className="text-xs font-medium text-muted-foreground">Rapid intro (2s)</Label>
            <InlineInfo label="About rapid intro">
              Force the first shot to a snappy 2-second cut regardless of min shot length.
            </InlineInfo>
          </div>
          <Switch
            id="rapid-intro"
            checked={ultraRapidIntro}
            onCheckedChange={(checked) => {
              setUltraRapidIntro(checked);
              scheduleReassemblePreviews();
            }}
          />
        </div>
        </div>

      </InspectorSection>
    </div>
  );

  const safeZoneCard = (
    <div className="order-3" data-testid="step3-safe-zone-settings">
      <InspectorSection
        title="Safe Zone"
        summary={safeZoneEnabled ? (safeZoneType === "post" ? "Post (4:5)" : safeZoneType === "story" ? "Story" : "Reel") : "Off"}
        defaultOpen
      >
        <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Show over preview</Label>
            <p className="text-[11px] text-muted-foreground">Guide only; it is never included in the render.</p>
          </div>
          <Switch
            checked={safeZoneEnabled}
            onCheckedChange={setSafeZoneEnabled}
            aria-label="Show safe zone over preview"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label className="text-xs font-medium text-muted-foreground">Format</Label>
          <Select value={safeZoneType} onValueChange={(value) => setSafeZoneType(value as SafeZoneType)} disabled={!safeZoneEnabled}>
            <SelectTrigger size="sm" className="w-36 text-xs" aria-label="Safe zone format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="post">Post (4:5)</SelectItem>
              <SelectItem value="story">Story</SelectItem>
              <SelectItem value="reel">Reel</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </div>
      </InspectorSection>
    </div>
  );

  const subtitleTemplateControls = (
    <div className="space-y-3" data-testid="subtitle-template-controls">
      <p className="text-[11px] text-muted-foreground">
        Choose a saved caption template. Its styles are assigned in their saved order and repeat automatically.
      </p>
      {subtitleTemplateGroups.length > 0 && (
        <InspectorField label="Template" htmlFor="step3-subtitle-template">
          <Select
            value={activeSubtitleTemplateGroup?.id}
            onValueChange={(templateId) => {
              const template = subtitleTemplateGroups.find((candidate) => candidate.id === templateId);
              if (!template) return;
              handleSubtitleTemplateChange({
                enabled: true,
                presetIds: template.presets.map((preset) => preset.id),
              });
            }}
          >
            <SelectTrigger
              id="step3-subtitle-template"
              size="sm"
              className="w-full text-xs"
              aria-label="Subtitle template"
              data-testid="step3-subtitle-template-select"
            >
              <SelectValue placeholder={subtitleRotation.enabled ? "Custom rotation" : "Choose a template"} />
            </SelectTrigger>
            <SelectContent>
              {subtitleTemplateGroups.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name} · {formatSubtitleStyleCount(template.presets.length)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InspectorField>
      )}
      {legacySubtitleAssignmentCount > 0 && (
        <div className="space-y-1.5" data-testid="subtitle-legacy-assignments">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {legacySubtitleAssignmentCount} legacy {legacySubtitleAssignmentCount === 1 ? "assignment takes" : "assignments take"} precedence over this template. Card-level adjustments stay in place.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={clearingLegacySubtitleAssignments}
            onClick={() => {
              setClearingLegacySubtitleAssignments(true);
              void handleUseSubtitleTemplateForAll().finally(() => {
                setClearingLegacySubtitleAssignments(false);
              });
            }}
          >
            {clearingLegacySubtitleAssignments ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {subtitleRotation.enabled ? "Use template for all outputs" : "Clear legacy assignments"}
          </Button>
        </div>
      )}
      <SubtitleTemplateRotationPanel
        rotation={subtitleRotation}
        presets={userSubtitlePresets}
        onChange={handleSubtitleRotationChange}
        onSaveStyles={activeSubtitleTemplateGroup
          ? (styles) => handleUpdateSubtitleTemplateStyles(
              activeSubtitleTemplateGroup.id,
              activeSubtitleTemplateGroup.name,
              styles,
            )
          : undefined}
        panelRef={subtitleRotationPanelRef}
      />
    </div>
  );

  const subtitleStyleCard = (
    <Card variant="workspace" className={`${!subtitleSettingsLoaded ? "opacity-60 pointer-events-none" : ""} order-1 gap-0 py-0 min-[1280px]:contents`}>
      <WorkspacePanelHeader
        icon={Type}
        title="Subtitle Settings"
        className="min-[1280px]:bg-surface-canvas"
        data-testid="step3-subtitle-style-header"
        titleAccessory={!subtitleSettingsLoaded ? <Loader2 className="size-3 animate-spin" /> : undefined}
        actions={(
          <>
            <InlineInfo label="About subtitle settings">
              {metaMultiplication
                ? "Switch between A and B to preview and edit each platform style. Changes are saved automatically and shared across all scripts."
                : "This style applies to every variant in the pipeline and is saved automatically."}
            </InlineInfo>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          {subtitleSaveState === "saving" && (
            <>
              <Loader2 className="size-3 animate-spin" />
              <span>Saving…</span>
            </>
          )}
          {subtitleSaveState === "saved" && (
            <>
              <CheckCircle className="size-3 text-success" />
              <span>Saved</span>
            </>
          )}
          {subtitleSaveState === "error" && (
            <>
              <AlertCircle className="size-3 text-red-600" />
              <span className="text-red-600">Save failed</span>
            </>
          )}
            </div>
          </>
        )}
      />
      <CardContent className="space-y-3 min-[1280px]:contents">
        {/* Keep the preview and controls in one continuous scroll surface.
            A nested sticky region made the preview and settings move in
            separate stages inside the already-scrollable inspector. */}
        <div className="min-[1280px]:bg-surface-canvas">
          <div className="divide-y divide-border/70" data-testid="subtitle-settings-sections">
            <InspectorSection
              title="Subtitle templates"
              summary={subtitleAssignmentSummary}
              defaultOpen
            >
              {subtitleTemplateControls}
            </InspectorSection>

            <InspectorSection
              title="Subtitle style"
              summary={metaMultiplication ? `Version ${activeSubtitleStyleKey}` : "Default"}
              defaultOpen
            >
              <div className="flex flex-wrap items-center gap-2">
                {metaMultiplication && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      const source: StyleKey = activeSubtitleStyleKey === "A" ? "B" : "A";
                      handleCopyVariantSubtitle(source, activeSubtitleStyleKey);
                    }}
                  >
                    Copy from {activeSubtitleStyleKey === "A" ? "B" : "A"}
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!activeSubtitleStyleHasOverride}
                  onClick={() => handleResetVariantSubtitle(activeSubtitleStyleKey)}
                >
                  Reset to default
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setSavePresetDialogOpen(true)}
                >
                  Save as preset
                </Button>
              </div>

            <div
              data-testid="subtitle-style-variant-editor"
            >
            <SubtitleEditor
              renderMode="settings-only"
              settings={getSubtitleSettingsFor(activeSubtitleStyleKey)}
              onSettingsChange={(newSettings) =>
                handleVariantSubtitleChange(activeSubtitleStyleKey, newSettings)
              }
              showPreview={false}
              compact={true}
              userPresets={userSubtitlePresets}
              onApplyUserPreset={(preset) => {
                if (preset.wordsPerSubtitle != null) setWordsPerSubtitle(preset.wordsPerSubtitle);
                const presetSettings =
                  activeSubtitleStyleKey === "A"
                    ? preset.settingsA ?? preset.settings
                    : activeSubtitleStyleKey === "B"
                      ? preset.settingsB ?? preset.settings
                      : preset.settings;
                const merged = mergeSubtitleStylePreservingPlacement(
                  getSubtitleSettingsFor(activeSubtitleStyleKey),
                  presetSettings,
                );
                handleVariantSubtitleChange(activeSubtitleStyleKey, merged);
              }}
              onDeleteUserPreset={async (preset) => {
                const profileId = currentProfileIdRef.current;
                if (!profileId) return;
                try {
                  await apiDelete(`/profiles/${profileId}/subtitle-presets/${preset.id}`);
                  setUserSubtitlePresets((prev) => prev.filter((item) => item.id !== preset.id));
                  if (subtitleRotation.presetIds.includes(preset.id)) {
                    handleSubtitleRotationChange({
                      ...subtitleRotation,
                      presetIds: subtitleRotation.presetIds.filter((id: string) => id !== preset.id),
                    });
                  }
                } catch (err) { console.error("Failed to delete preset:", err); }
              }}
              />
            </div>
            </InspectorSection>

          </div>
        </div>
      </CardContent>
    </Card>
  );

  const sourceTotal = sourceInventory.items.length;

  const attentionAndSourcesTabs = (
    <div
      role="tablist"
      className="flex h-10 w-full shrink-0 justify-start gap-0 rounded-none border-y border-border p-0"
      aria-label="Preview resource panels"
    >
        <button
          type="button"
          role="tab"
          aria-selected={resourcePanel === "image-templates"}
          className={`-mt-px inline-flex h-10 items-center gap-1.5 border-t-2 px-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
            resourcePanel === "image-templates"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            setResourcePanel("image-templates");
          }}
        >
          <Images className="size-3.5" />
          Image Templates
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={resourcePanel === "sources"}
          className={`-mt-px inline-flex h-10 items-center gap-1.5 border-t-2 px-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
            resourcePanel === "sources"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            setResourcePanel("sources");
          }}
        >
          <FileText className="size-3.5" />
          Sources
          <span className="font-mono text-[11px] tabular-nums">{sourceTotal}</span>
        </button>
    </div>
  );

  const attentionAndSourcesPanel = (
    <>
      <div
        role="tabpanel"
        data-testid="step3-attention-apply"
        hidden={resourcePanel !== "image-templates"}
      >
        <InspectorSection
          title="Image templates"
          summary={attentionApplySelection.templateId
            ? `${attentionApplySelection.assets.length} asset${attentionApplySelection.assets.length === 1 ? "" : "s"}`
            : "Not selected"}
          defaultOpen
        >
        <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground">Choose and apply a reusable image layout.</p>
        <AttentionTemplatePicker
          selection={attentionApplySelection}
          onSelectionChange={(selection) => {
            handleAttentionSelectionChange(selection);
            setAttentionApplyResult(null);
          }}
          profileId={currentProfile?.id}
          outputWidth={renderSettings.output_width || 1080}
          outputHeight={renderSettings.output_height || 1920}
        />
        <InspectorField label="Apply to" htmlFor="step3-attention-scope">
          <Select
            value={attentionApplyScope}
            onValueChange={(scope) => {
              setAttentionScopeOverride({ pipelineId, scope });
              setAttentionApplyResult(null);
            }}
          >
            <SelectTrigger
              id="step3-attention-scope"
              size="sm"
              className="w-full text-xs"
              aria-label="Image template apply scope"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ATTENTION_VARIANTS}>All variants</SelectItem>
              {previewCards.map((card) => (
                <SelectItem key={card.key} value={card.key}>{card.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InspectorField>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={
              attentionApplying
              || !attentionApplySelection.templateId
              || attentionApplySelection.assets.length === 0
              || !attentionApplyTimelinesReady
            }
            onClick={handleAttentionTemplateApply}
          >
            {attentionApplying && <Loader2 className="size-3.5 animate-spin" />}
            {!attentionApplying
              && attentionApplySelection.templateId
              && attentionApplySelection.assets.length > 0
              && !attentionApplyTimelinesReady
              ? "Loading timelines..."
              : "Apply template"}
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/attention-templates">Manage templates</Link>
          </Button>
        </div>
        {attentionApplyNote && (
          <p className="text-[11px] text-muted-foreground" role="status" data-testid="attention-apply-result">
            {attentionApplyNote}
          </p>
        )}
        <div
          id={ATTENTION_INSPECTOR_TARGET_ID}
          className="pt-1 [&:has(>[data-attention-cue-editor])>[data-empty]]:hidden"
          data-testid="step3-attention-cue-inspector"
        >
          <p data-empty className="border-t border-border pt-3 text-[11px] text-muted-foreground">
            Select an image cue on a variant timeline to edit its images here.
          </p>
        </div>
        </div>
        </InspectorSection>
      </div>

      {resourcePanel === "sources" && (
      <div role="tabpanel" data-testid="step3-sources">
        <div className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">Sources</h3>
              <p className="text-[11px] text-muted-foreground">
                Project media, scripts, subtitles, voice-over, and soundtracks.
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-[11px] tabular-nums">
              {sourceTotal}
            </Badge>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={sourceQuery}
                onChange={(event) => setSourceQuery(event.target.value)}
                placeholder="Search sources"
                aria-label="Search sources"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as SourceKind | "all")}>
                <SelectTrigger size="sm" className="min-w-0 flex-1 text-xs" aria-label="Filter sources by type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All source types</SelectItem>
                  {(Object.entries(SOURCE_KIND_META) as Array<[SourceKind, (typeof SOURCE_KIND_META)[SourceKind]]>)
                    .map(([kind, meta]) => (
                      <SelectItem key={kind} value={kind}>{meta.label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Source view">
                <Button
                  type="button"
                  variant={sourceView === "list" ? "secondary" : "ghost"}
                  size="icon"
                  className="size-7"
                  aria-label="List view"
                  aria-pressed={sourceView === "list"}
                  onClick={() => setSourceView("list")}
                >
                  <List className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant={sourceView === "icons" ? "secondary" : "ghost"}
                  size="icon"
                  className="size-7"
                  aria-label="Icon view"
                  aria-pressed={sourceView === "icons"}
                  onClick={() => setSourceView("icons")}
                >
                  <Grid2X2 className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div
            className={sourceView === "icons"
              ? "grid grid-cols-2 gap-2"
              : "divide-y divide-border/70"}
            data-testid="step3-source-inventory"
            data-view={sourceView}
          >
            {filteredSourceItems.length === 0 ? (
              <p className="col-span-full py-6 text-center text-[11px] text-muted-foreground">
                No sources match this filter.
              </p>
            ) : filteredSourceItems.map((item) => {
              const meta = SOURCE_KIND_META[item.kind];
              const SourceIcon = meta.icon;
              const isVoiceover = item.kind === "voiceover" && item.variantIndex !== undefined;
              const isVisualMedia = item.kind === "video" || item.kind === "image";
              return (
                <div
                  key={item.id}
                  className={sourceView === "icons"
                    ? "flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2"
                    : "flex min-w-0 items-center gap-3 py-2.5"}
                >
                  {sourceView === "icons" ? (
                    <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-border text-muted-foreground">
                      {isVisualMedia && item.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <SourceIcon className="size-6" />
                      )}
                    </div>
                  ) : isVisualMedia ? (
                    <div className="flex aspect-video w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border text-muted-foreground">
                      {item.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <SourceIcon className="size-4" />
                      )}
                    </div>
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
                      <SourceIcon className="size-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-xs text-foreground" title={item.label}>{item.label}</p>
                      {sourceView === "list" && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">{meta.label}</span>
                      )}
                    </div>
                    <p className={sourceView === "icons"
                      ? "line-clamp-2 text-[11px] text-muted-foreground"
                      : "truncate text-[11px] text-muted-foreground"}
                      title={item.detail}
                    >
                      {item.detail}
                    </p>
                  </div>
                  {isVoiceover && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => pipelineId && handlePlayAudio(pipelineId, item.variantIndex!)}
                      aria-label={`Play ${item.label}`}
                    >
                      {playingAudio === `${pipelineId}-${item.variantIndex}`
                        ? <Pause className="size-3.5" />
                        : <Play className="size-3.5" />}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}
    </>
  );

  return (
          <div
            className="min-w-0 space-y-3 min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:w-full min-[1280px]:flex-col min-[1280px]:gap-0 min-[1280px]:space-y-0 min-[1280px]:overflow-hidden"
            data-testid="step3-workspace"
          >
            <div className="flex shrink-0 items-center justify-between min-[1280px]:hidden">
              {/* "Back to Scripts" lives in the pipeline toolbar; don't repeat it here. */}
              <div>
                <h2 className="font-heading text-2xl font-semibold">Preview & Select Variants</h2>
                <p className="text-sm text-muted-foreground">
                  {previewCards.filter(card => selectedVariants.has(card.baseIndex)).length} previews shown
                </p>
              </div>
            </div>

            {/*
              Step 3 is an editing workspace, not a sequence of form cards.
              Keep the controls in a persistent left inspector and leave the
              right-hand canvas for the variant timelines and previews.
            */}
            <WorkspaceSplit
              splitId="step3"
              fallbackClassName="grid items-start gap-3 min-[1180px]:grid-cols-[minmax(22rem,0.82fr)_minmax(0,1.6fr)] min-[1280px]:min-h-0 min-[1280px]:flex-1 min-[1280px]:items-stretch min-[1280px]:gap-px min-[1280px]:bg-border"
              groupClassName="h-auto min-h-0 flex-1"
              leftSizing={{ defaultSize: "34%", minSize: "18rem" }}
              rightSizing={{ minSize: "30%" }}
            >
              <aside
                className="workspace-inspector-scrollbar-hidden flex min-w-0 flex-col gap-3 bg-background min-[1180px]:sticky min-[1180px]:top-4 min-[1280px]:static min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:gap-0 min-[1280px]:divide-y min-[1280px]:divide-border min-[1280px]:overflow-y-auto min-[1280px]:overscroll-contain"
                data-testid="step3-inspector"
              >
            {/* Timing controls can reassemble the previews from inside the editor. */}
            {previewTimingCard}

            {safeZoneCard}

            {/* Subtitle settings are edited here; preview target selection lives with the preview itself. */}
            {subtitleStyleCard}

              </aside>

              <WorkspaceSplit
                splitId="step3-preview-canvas"
                fallbackClassName="min-w-0 bg-background min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-h-0"
                groupClassName="h-full min-h-0 flex-1 bg-background"
                leftSizing={{ defaultSize: "26%", minSize: "17rem" }}
                rightSizing={{ minSize: "30%" }}
              >
                {/* Keep preview and assignment together so the user always
                    knows which real output is being changed. */}
                <aside
                  id="subtitle-style-preview"
                  role="tabpanel"
                  data-testid="subtitle-sticky-preview"
                  className="min-w-0 border-b bg-background min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:overflow-hidden min-[1280px]:border-b-0"
                  aria-label="Subtitle output preview"
                >
                  <Card variant="workspace" className="min-h-full gap-0 py-0 min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:py-0" data-testid="step3-preview-target-panel">
                    <WorkspacePanelHeader
                      title="Subtitle Preview"
                      data-testid="step3-preview-target-header"
                    />
                    <CardContent className="min-[1280px]:shrink-0 min-[1280px]:px-0">
                      <SubtitleStylePreviewPanel
                        previewCards={previewCards}
                        pipelineId={pipelineId ?? undefined}
                        subtitleRotation={subtitleRotation}
                        userSubtitlePresets={userSubtitlePresets}
                        variantTemplateSelections={variantTemplateSelections}
                        variantSubtitleOverrides={variantSubtitleOverrides}
                        getPreviewSubtitleSettingsFor={getPreviewSubtitleSettingsFor}
                        getPreviewSubtitleTextFor={getPreviewSubtitleTextFor}
                        onPreviewCardChange={setActiveStyleKey}
                      />
                    </CardContent>
                    {attentionAndSourcesTabs}
                    <div
                      className="min-[1280px]:min-h-0 min-[1280px]:flex-1 min-[1280px]:overflow-y-auto min-[1280px]:overscroll-contain"
                      data-testid="step3-preview-panels-scroll"
                    >
                      {attentionAndSourcesPanel}
                    </div>
                  </Card>
                </aside>

                <section
                  className="min-w-0 flex-1 space-y-3 bg-background min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:flex-col min-[1280px]:space-y-0 min-[1280px]:overflow-x-hidden min-[1280px]:overflow-y-auto min-[1280px]:overscroll-contain min-[1280px]:[&>[data-slot=card]]:gap-3 min-[1280px]:[&>[data-slot=card]]:rounded-none min-[1280px]:[&>[data-slot=card]]:border-0 min-[1280px]:[&>[data-slot=card]]:py-3 min-[1280px]:[&>[data-slot=card]>[data-slot=card-header]]:px-4 min-[1280px]:[&>[data-slot=card]>[data-slot=card-content]]:px-4"
                  aria-label="Variant previews"
                  data-testid="step3-variant-canvas"
                >
                <WorkspacePanelHeader
                  icon={Film}
                  title="Variant Previews"
                  sticky
                  className="hidden min-[1280px]:flex"
                  data-testid="step3-variant-header"
                  actions={(
                    <InlineInfo label="About variant previews">
                      {metaMultiplication
                        ? "Each script is generated in two visual versions, A and B, with different footage selections. Compare them and choose the stronger result before rendering."
                        : "Each preview is a visual version of its script that you can review and refine before rendering."}
                    </InlineInfo>
                  )}
                />

            {/* Variant preview grid */}
            <div className="grid grid-cols-1 gap-3 min-[1280px]:gap-px min-[1280px]:bg-border min-[1480px]:grid-cols-2">
              {previewCards.map((card) => {
                const preview = previews[card.key];
                if (!preview) return null;
                const subtitleAssignment = resolveSubtitleAssignmentForCard(
                  subtitleRotation,
                  variantTemplateSelections,
                  userSubtitlePresets,
                  card,
                );
                const assignedTemplate = subtitleAssignment.preset;
                const hasVariantSubtitleOverride = Boolean(variantSubtitleOverrides[card.key]);
                const effectiveSubtitleSettings = getPreviewSubtitleSettingsFor(card);
                const assignmentLabel = subtitleAssignment.disabled
                  ? "No subtitles"
                  : assignedTemplate?.name ?? "Default style";
                const assignmentSource = subtitleAssignment.source === "manual"
                  ? "Manual"
                  : subtitleAssignment.source === "rotation"
                    ? "Rotation"
                    : "Default";

                return (
                  <Card key={card.key} variant="workspace" className="overflow-hidden min-[1280px]:pt-3 min-[1280px]:pb-0">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={selectedVariants.has(card.baseIndex)}
                              onCheckedChange={() => toggleVariant(card.baseIndex)}
                            />
                            <CardTitle className="truncate text-lg">
                              {card.label}
                            </CardTitle>
                          </div>
                          <Badge
                            variant="outline"
                            className="ml-6 max-w-[min(20rem,calc(100vw-8rem))] truncate font-normal"
                            data-testid="subtitle-assignment-badge"
                            title={`${assignmentLabel} · ${assignmentSource}${hasVariantSubtitleOverride ? " · Local override" : ""}`}
                          >
                            {assignmentLabel} · {assignmentSource}
                            {hasVariantSubtitleOverride ? " · Override" : ""}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {assignedTemplate && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1 px-2 text-xs"
                                onClick={() => {
                                  setEditingVariantKey(card.key);
                                  setVariantSubtitleDraft(getPreviewSubtitleSettingsFor(card));
                                }}
                                title={`Override subtitles for ${card.label}`}
                              >
                                <Pencil className="size-3.5" />
                                Override
                              </Button>
                              {hasVariantSubtitleOverride && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-xs text-muted-foreground"
                                  onClick={() => handleResetVariantTemplateOverride(card.key)}
                                >
                                  Reset to template
                                </Button>
                              )}
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => pipelineId && handlePlayAudio(pipelineId, card.baseIndex)}
                            title={playingAudio === `${pipelineId}-${card.baseIndex}` ? "Stop audio" : "Play voiceover"}
                          >
                            {playingAudio === `${pipelineId}-${card.baseIndex}` ? (
                              <Pause className="size-4" />
                            ) : (
                              <Volume2 className="size-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => setMaximizedKey(card.key)}
                            title="Maximize editor — full-screen timeline for this variant"
                          >
                            <Maximize2 className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleRegenerateVariantAudio(card.baseIndex, card.key, card.visualVersion)}
                            disabled={regeneratingVariantAudio[card.baseIndex]}
                            title="Regenerate voiceover"
                          >
                            {regeneratingVariantAudio[card.baseIndex] ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <RefreshCw className="size-4" />
                            )}
                          </Button>
                          <Badge variant="secondary">
                            {formatDuration(preview.audio_duration)}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 min-[1280px]:px-4">
                      {preview.variety_warning && (
                        <Alert className="border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                          <AlertCircle className="size-4 text-amber-600" />
                          <AlertDescription>{preview.variety_warning.message}</AlertDescription>
                        </Alert>
                      )}
                      {/* Full timeline editor — uses this variant's effective subtitle style */}
                      <TimelineEditor
                        matches={preview.matches}
                        audioDuration={preview.audio_duration}
                        introOffsetSec={preview.intro_offset_sec ?? 0}
                        introSegments={preview.intro_segments ?? []}
                        videoTimeline={preview.video_timeline ?? []}
                        sourceVideoIds={selectedSourceIdsArray}
                        availableSegments={availableSegments}
                        profileId={currentProfile?.id}
                        pipelineId={pipelineId ?? undefined}
                        variantIndex={card.baseIndex}
                        subtitleSettings={effectiveSubtitleSettings}
                        interstitialSlides={interstitialSlides[card.key] ?? EMPTY_SLIDES}
                        onInterstitialSlidesChange={getInterstitialSlidesChangeHandler(card.key)}
                        attentionTimeline={attentionTimelines[card.key] ?? { revision: 0, cues: [] }}
                        onAttentionTimelineChange={getAttentionTimelineChangeHandler(card.key)}
                        onMatchesChange={getMatchesChangeHandler(card.key)}
                        onVideoTimelineChange={getVideoTimelineChangeHandler(card.key)}
                        defaultTransition={preview.defaultTransition ?? null}
                        music={preview.music ?? null}
                        onMusicChange={getMusicChangeHandler(card.key)}
                        onRenderPreview={() => openRenderedPreview(card.key)}
                        safeZone={activeSafeZone}
                        attentionInspectorTargetId={ATTENTION_INSPECTOR_TARGET_ID}
                        previewTopLeftAccessory={(() => {
                          const thumb = variantThumbnails[card.key];
                          const thumbUrl = thumb
                            ? segmentFileUrl(mediaApiUrl, thumb.imageUrl)
                            : null;
                          const openThumbnailPicker = () => setThumbnailPickerKey(card.key);

                          return (
                            <div
                              data-testid={`variant-thumbnail-control-${card.key}`}
                              className="flex w-24 flex-col items-stretch gap-1.5 rounded-sm border bg-background/95 p-2 shadow-lg backdrop-blur-sm"
                            >
                              <div
                                data-preview-accessory-drag-handle
                                className="flex min-w-0 touch-none select-none items-center justify-between gap-1 overflow-hidden cursor-grab active:cursor-grabbing"
                                title="Drag thumbnail panel"
                              >
                                <span className="min-w-0 text-[11px] font-semibold leading-none">
                                  Thumbnail
                                </span>
                                <span
                                  className="shrink-0 text-[9px] leading-none text-muted-foreground"
                                  title={thumb ? (thumb.isAutoSelected ? "auto-selected" : "manual") : "none"}
                                >
                                  {thumb ? (thumb.isAutoSelected ? "Auto" : "Manual") : "None"}
                                </span>
                              </div>
                              {thumbUrl ? (
                                <button
                                  type="button"
                                  onClick={openThumbnailPicker}
                                  className="aspect-[9/16] w-full overflow-hidden rounded-sm border-2 border-border transition-opacity hover:opacity-80"
                                  title="Click to change thumbnail"
                                >
                                  <img src={thumbUrl} alt="Thumbnail" className="h-full w-full object-cover" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={openThumbnailPicker}
                                  className="flex aspect-[9/16] w-full items-center justify-center rounded-sm border-2 border-dashed border-muted-foreground/30 bg-muted transition-colors hover:border-muted-foreground/50"
                                  title="Choose thumbnail"
                                >
                                  <Film className="size-5 text-muted-foreground" />
                                </button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full rounded-sm px-1 text-[11px]"
                                onClick={openThumbnailPicker}
                              >
                                Change
                              </Button>
                            </div>
                          );
                        })()}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Dialog
              open={editingVariantKey !== null}
              onOpenChange={(open) => {
                if (!open) {
                  setEditingVariantKey(null);
                  setVariantSubtitleDraft(null);
                }
              }}
            >
              <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto" data-testid="variant-subtitle-override-dialog">
                <DialogHeader>
                  <DialogTitle>Override {editingVariantCard?.label ?? "variant"}</DialogTitle>
                  <DialogDescription>
                    This changes only this output. The assigned template and other variants stay unchanged.
                  </DialogDescription>
                </DialogHeader>
                {variantSubtitleDraft && (
                  <SubtitleEditor
                    renderMode="settings-only"
                    settings={variantSubtitleDraft}
                    onSettingsChange={setVariantSubtitleDraft}
                    showPreview={false}
                    compact
                  />
                )}
                <DialogFooter>
                  {editingVariantKey && variantSubtitleOverrides[editingVariantKey] && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        handleResetVariantTemplateOverride(editingVariantKey);
                        setVariantSubtitleDraft(
                          editingVariantCard ? getPreviewSubtitleTemplateSettingsFor(editingVariantCard) : null,
                        );
                      }}
                    >
                      Reset to template
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setEditingVariantKey(null)}>Cancel</Button>
                  <Button
                    disabled={!editingVariantKey || !variantSubtitleDraft}
                    onClick={() => {
                      if (!editingVariantKey || !variantSubtitleDraft) return;
                      if (!editingVariantCard) return;
                      handleVariantTemplateOverrideChange(
                        editingVariantKey,
                        variantSubtitleDraft,
                        getPreviewSubtitleTemplateSettingsFor(editingVariantCard),
                      );
                      setEditingVariantKey(null);
                    }}
                  >
                    Save override
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Thumbnail picker dialog */}
            <ThumbnailPicker
              open={thumbnailPickerKey !== null}
              onOpenChange={(open) => { if (!open) setThumbnailPickerKey(null); }}
              currentThumbnail={thumbnailPickerKey ? variantThumbnails[thumbnailPickerKey] ?? null : null}
              matchedSegments={thumbnailPickerKey ? (previews[thumbnailPickerKey]?.matches ?? []) : []}
              usedImageUrls={new Set(
                Object.entries(variantThumbnails)
                  .filter(([key]) => key !== thumbnailPickerKey)
                  .map(([, sel]) => sel.imageUrl)
              )}
              onSelect={(segmentId, imageUrl) => {
                if (!thumbnailPickerKey) return;
                setVariantThumbnails(prev => ({
                  ...prev,
                  [thumbnailPickerKey]: { segmentId, imageUrl, isAutoSelected: false },
                }));
              }}
              onResetAuto={() => {
                if (!thumbnailPickerKey) return;
                // Clear manual selection — useEffect will re-auto-select
                setVariantThumbnails(prev => {
                  const next = { ...prev };
                  delete next[thumbnailPickerKey];
                  return next;
                });
              }}
            />

            {/* Variant preview player dialog */}
            {previewVariant !== null && pipelineId && currentProfile && (() => {
              const activeCard = previewCards.find(card => card.key === previewVariant);
              if (!activeCard) return null;
              // Match the render-time precedence rule: when the user has set
              // an explicit subtitle override for this Meta version, suppress
              // the visualVersion so the preview backend does NOT layer the
              // Meta profile on top. Otherwise the preview would show the
              // overlay while the final render does not — visible divergence.
              const _previewPipOverlays = buildPipOverlaysForMatches(previews[previewVariant]?.matches);
              return (
                <VariantPreviewPlayer
                  open={true}
                  onOpenChange={handlePreviewPlayerClose}
                  matches={previews[previewVariant]?.matches ?? []}
                  videoTimeline={previews[previewVariant]?.video_timeline ?? []}
                  defaultTransition={previews[previewVariant]?.defaultTransition ?? null}
                  music={previews[previewVariant]?.music ?? null}
                  pipelineId={pipelineId}
                  variantIndex={activeCard.baseIndex}
                  visualVersion={activeCard.visualVersion}
                  title={activeCard.label}
                  profileId={currentProfile.id}
                  subtitleSettings={getPreviewSubtitleSettingsFor(activeCard)}
                  applyMetaSubtitleStyle={false}
                  sourceVideoIds={selectedSourceIdsArray}
                  minSegmentDuration={minSegmentDuration}
                  wordsPerSubtitle={getWordsPerSubtitleForVariant(activeCard.baseIndex)}
                  ultraRapidIntro={ultraRapidIntro}
                  interstitialSlides={interstitialSlides[previewVariant]}
                  attentionTimeline={attentionTimelines[previewVariant]}
                  pipOverlays={Object.keys(_previewPipOverlays).length > 0 ? _previewPipOverlays : undefined}
                  enableColor={renderAdjust.enableColor}
                  brightness={renderAdjust.brightness}
                  contrast={renderAdjust.contrast}
                  saturation={renderAdjust.saturation}
                  voiceVolume={renderAdjust.voiceVolume}
                  audioFadeIn={renderAdjust.audioFadeIn}
                  audioFadeOut={renderAdjust.audioFadeOut}
                  safeZone={activeSafeZone}
                  outputWidth={renderSettings.output_width || 1080}
                  outputHeight={renderSettings.output_height || 1920}
                />
              );
            })()}

            {/* Portal the full editor above the workspace cards, but keep it
                non-modal: the app sidebar and desktop window controls remain
                visible and interactive while the editor is maximized. */}
            {maximizedKey !== null && (() => {
              const card = previewCards.find((c) => c.key === maximizedKey);
              const preview = card ? previews[card.key] : null;
              if (!card || !preview) return null;
              const maximizedAssignment = resolveSubtitleAssignmentForCard(
                subtitleRotation,
                variantTemplateSelections,
                userSubtitlePresets,
                card,
              );
              const maximizedAssignmentLabel = maximizedAssignment.disabled
                ? "No subtitles"
                : maximizedAssignment.preset?.name ?? "Default style";
              const maximizedAssignmentSource = maximizedAssignment.source === "manual"
                ? "Manual"
                : maximizedAssignment.source === "rotation"
                  ? "Rotation"
                  : "Default";
              const maximizedHasOverride = Boolean(variantSubtitleOverrides[card.key]);
              // Confine the editor to the measured work area, but fall back to
              // full-screen whenever that rect is missing or too small to lay
              // out the NLE grid. A null/degenerate <main> rect leaves
              // DialogContent without a definite height, which collapses the
              // grid's `minmax(0, 1fr)` row (inspector + program monitor) to
              // ~0px — the "left panel and settings vanished" regression. The
              // full-screen floor keeps the editor usable no matter what the
              // measurement returns; confinement is the enhancement on top.
              const editorStyle =
                maximizedBounds &&
                maximizedBounds.width >= 400 &&
                maximizedBounds.height >= 400
                  ? maximizedBounds
                  : { top: 0, left: 0, width: "100vw", height: "100dvh" };
              return (
                <Dialog modal={false} open onOpenChange={(open) => { if (!open) setMaximizedKey(null); }}>
                  <DialogContent
                    showCloseButton={false}
                    showOverlay={false}
                    onInteractOutside={(event) => event.preventDefault()}
                    style={editorStyle}
                    className="z-[70] flex max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
                    data-testid="step3-full-editor"
                  >
                    <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <DialogTitle className="flex items-center gap-2 text-sm">
                          <Film className="size-4" />
                          <span>{card.label} — Full Editor</span>
                        </DialogTitle>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0"
                          onClick={() => setMaximizedKey(null)}
                          title="Minimize editor — back to the variant cards"
                        >
                          <Minimize2 className="size-4" />
                          <span className="sr-only">Minimize editor</span>
                        </Button>
                      </div>
                    </DialogHeader>
                    <div className="flex min-h-0 flex-1 overflow-hidden">
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-workspace-pane>
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <TimelineEditor
                          displayMode="full"
                          matches={preview.matches}
                          audioDuration={preview.audio_duration}
                          introOffsetSec={preview.intro_offset_sec ?? 0}
                          introSegments={preview.intro_segments ?? []}
                          videoTimeline={preview.video_timeline ?? []}
                          sourceVideoIds={selectedSourceIdsArray}
                          availableSegments={availableSegments}
                          profileId={currentProfile?.id}
                          pipelineId={pipelineId ?? undefined}
                          variantIndex={card.baseIndex}
                          subtitleSettings={getPreviewSubtitleSettingsFor(card)}
                          interstitialSlides={interstitialSlides[card.key] ?? EMPTY_SLIDES}
                          onInterstitialSlidesChange={getInterstitialSlidesChangeHandler(card.key)}
                          attentionTimeline={attentionTimelines[card.key] ?? { revision: 0, cues: [] }}
                          onAttentionTimelineChange={getAttentionTimelineChangeHandler(card.key)}
                          onMatchesChange={getMatchesChangeHandler(card.key)}
                          onVideoTimelineChange={getVideoTimelineChangeHandler(card.key)}
                          defaultTransition={preview.defaultTransition ?? null}
                          music={preview.music ?? null}
                          onMusicChange={getMusicChangeHandler(card.key)}
                          onRenderPreview={() => openRenderedPreview(card.key)}
                          safeZone={activeSafeZone}
                          />
                        </div>
                      </div>

                      {/* Every preview-affecting setting, reachable without leaving the
                          maximized view. Reuses the exact same state/handlers as the left
                          inspector (subtitleStyleCard/previewTimingCard/RenderSettingsPanel
                          are shared elements or components, not copies) so edits made here
                          are the same edits, live-reflected in the TimelineEditor preview
                          to the left via the shared subtitleSettings/matches props. */}
                      <aside
                        className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l bg-background"
                        data-workspace-pane
                        data-testid="step3-full-editor-settings"
                      >
                        <Tabs
                          value={maximizeSettingsTab}
                          onValueChange={(value) => setMaximizeSettingsTab(value as typeof maximizeSettingsTab)}
                          className="flex min-h-0 flex-1 flex-col"
                        >
                          <TabsList className="mx-3 mt-3 grid w-auto grid-cols-3">
                            <TabsTrigger value="subtitles" className="text-xs">Subtitles</TabsTrigger>
                            <TabsTrigger value="timing" className="text-xs">Timing</TabsTrigger>
                            <TabsTrigger value="adjust" className="text-xs">Adjust</TabsTrigger>
                          </TabsList>
                          <div className="min-h-0 flex-1 overflow-y-auto p-3">
                            <TabsContent value="subtitles" className="mt-0 space-y-3">
                              <div className="flex items-center justify-between gap-2 px-1 py-1">
                                <span className="text-xs text-muted-foreground">Applied style</span>
                                <Badge variant="outline" className="max-w-52 truncate font-normal">
                                  {maximizedAssignmentLabel} · {maximizedAssignmentSource}
                                  {maximizedHasOverride ? " · Override" : ""}
                                </Badge>
                              </div>
                              <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                                Output styles follow the selected subtitle template automatically.
                              </p>
                              {subtitleStyleCard}
                            </TabsContent>
                            <TabsContent value="timing" className="mt-0 space-y-3">
                              {previewTimingCard}
                            </TabsContent>
                            <TabsContent value="adjust" className="mt-0 space-y-3">
                              {safeZoneCard}
                            </TabsContent>
                          </div>
                        </Tabs>
                      </aside>
                    </div>
                  </DialogContent>
                </Dialog>
              );
            })()}

            {/* "Save as preset" dialog — captures shared default + any A/B overrides. */}
            <Dialog
              open={savePresetDialogOpen}
              onOpenChange={(open) => {
                setSavePresetDialogOpen(open);
                if (!open) {
                  setSavePresetName("");
                  setSavePresetError(null);
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Save subtitle preset</DialogTitle>
                  <DialogDescription>
                    Saves the shared default plus any explicit Meta A / Meta B
                    overrides. Applying the preset restores all of them at once.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label htmlFor="preset-name-input" className="text-sm">Preset name</Label>
                    <Input
                      id="preset-name-input"
                      value={savePresetName}
                      onChange={(e) => {
                        setSavePresetName(e.target.value);
                        if (savePresetError) setSavePresetError(null);
                      }}
                      placeholder="e.g. Aggressive Red"
                      maxLength={80}
                      disabled={savePresetSubmitting}
                      className="mt-1"
                      autoFocus
                    />
                  </div>
                  {savePresetError && (
                    <Alert variant="destructive">
                      <AlertCircle className="size-4" />
                      <AlertDescription>{savePresetError}</AlertDescription>
                    </Alert>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setSavePresetDialogOpen(false)}
                    disabled={savePresetSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmitSavePreset}
                    disabled={savePresetSubmitting || !savePresetName.trim()}
                  >
                    {savePresetSubmitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                    Save preset
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            <div className="border-t border-border pt-4">
              <Button
                variant="cta"
                size="lg"
                className="w-full"
                disabled={selectedVariants.size === 0}
                onClick={() => setStep3Mode("export")}
                data-testid="step3-go-to-export"
              >
                Go to Render Settings
                <ArrowRight className="ml-2 size-4" />
              </Button>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Configure the final output before starting Step 4.
              </p>
            </div>

                </section>
              </WorkspaceSplit>
            </WorkspaceSplit>
          </div>
  );
}

function InlineInfo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/info relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-64 rounded-md border bg-popover px-3 py-2 text-xs font-normal leading-relaxed text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/info:opacity-100 group-focus-within/info:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

function mergeSubtitleStylePreservingPlacement(
  currentSettings: SubtitleSettings,
  nextSettings: SubtitleSettings
): SubtitleSettings {
  return {
    ...currentSettings,
    ...nextSettings,
    positionY: currentSettings.positionY,
    position: currentSettings.position,
    marginV: currentSettings.marginV,
  };
}
