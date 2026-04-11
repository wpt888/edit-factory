"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Suspense, Component, memo } from "react";
import type { ReactNode, ErrorInfo, ComponentProps } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Slider } from "@/components/ui/slider";
import { apiGet, apiGetWithRetry, apiPost, apiPut, apiPatch, apiDelete, API_URL, handleApiError, ApiError } from "@/lib/api";
import {
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle,
  XCircle,
  Play,
  Download,
  Film,
  ArrowLeft,
  ArrowRight,
  Workflow,
  Clock,
  ChevronRight,
  BookOpen,
  Search,
  ChevronDown,
  ChevronUp,
  X,
  Star,
  Type,
  Trash2,
  Volume2,
  Pause,
  Info,
  Library,
  Eye,
  AlertTriangle,
  Share2,
  RefreshCw,
  LayoutGrid,
  List,
} from "lucide-react";
import { usePolling } from "@/hooks";
import { useProfile } from "@/contexts/profile-context";
import { toast } from "sonner";
import { checkFallbacks } from "@/lib/api-fallback";
import { EmptyState } from "@/components/empty-state";
import { PublishDialog } from "@/components/PublishDialog";
import { PipelineSchedule } from "@/components/PipelineSchedule";
import { PipelineCaptionGenerator } from "@/components/PipelineCaptionGenerator";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProductPickerDialog } from "@/components/product-picker-dialog";
import { ImagePickerDialog } from "@/components/image-picker-dialog";
import type { AssociationResponse } from "@/components/product-picker-dialog";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { SubtitleSettings, DEFAULT_SUBTITLE_SETTINGS, UserSubtitlePreset } from "@/types/video-processing";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TimelineEditor, SegmentOption, InterstitialSlide } from "@/components/timeline-editor";
import { VariantPreviewPlayer } from "@/components/variant-preview-player";
import { SimplePipeline } from "@/components/simple-mode-pipeline";
import type { PipelineMode } from "@/types/pipeline-presets";
import { RenderSettingsPanel, DEFAULT_RENDER_SETTINGS } from "@/components/render-settings-panel";
import { SkipRenderDialog, RenderCheckResult } from "@/components/SkipRenderDialog";
import type { RenderSettings } from "@/components/render-settings-panel";

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
  is_auto_filled?: boolean;
  product_group?: string | null;
  source_video_id?: string;
  segment_start_time?: number;
  segment_end_time?: number;
  thumbnail_path?: string;
  merge_group?: number;
  merge_group_duration?: number;
  transforms?: Record<string, unknown> | null;
}

interface PreviewData {
  audio_duration: number;
  srt_content: string;
  matches: MatchPreview[];
  total_phrases: number;
  matched_count: number;
  unmatched_count: number;
  available_segments?: SegmentOption[];
}

type PreviewKey = string;

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
type StyleKey = "A" | "B" | "default";

interface PreviewCard {
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
const toStyleKey = (card: Pick<PreviewCard, "visualVersion">): StyleKey => {
  if (card.visualVersion === "A") return "A";
  if (card.visualVersion === "B") return "B";
  return "default";
};

interface PipelineListItem {
  pipeline_id: string;
  name: string;
  idea: string;
  provider: string;
  variant_count: number;
  keyword_count: number;
  created_at: string;
  target_script_duration?: number | null;
}

interface VariantStatus {
  variant_index: number;
  status: "not_started" | "processing" | "completed" | "failed" | "cancelled";
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
}

interface VariantPreviewInfo {
  has_audio: boolean;
  audio_duration: number;
  has_srt: boolean;
}

interface PipelineScriptsResponse {
  pipeline_id: string;
  scripts: string[];
  context_products?: ContextProduct[];
  preview_info?: Record<string, { has_audio: boolean; audio_duration: number; has_srt?: boolean }>;
  tts_info?: Record<string, { has_audio: boolean; audio_duration: number; approved?: boolean }>;
  captions?: Record<string, string[]>;
  selected_captions?: Record<string, string>;
  name?: string;
  idea?: string;
  context?: string;
  provider?: string;
  variant_count?: number;
  meta_multiplication?: boolean;
  library_project_id?: string | null;
}

interface CatalogProduct {
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
}

interface CatalogPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

interface Voice {
  voice_id: string;
  name: string;
  language?: string;
  category?: string;
}

interface ContextProduct {
  title: string;
  description: string;
}

const META_SUBTITLE_STYLE_BY_VERSION: Record<string, Partial<SubtitleSettings>> = {
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

// Error boundary prevents the entire page from going white on unexpected render errors.
interface PipelineErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PipelineErrorBoundary extends Component<{ children: ReactNode }, PipelineErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PipelineErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PipelinePage] Unhandled render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
          <h2 className="text-xl font-semibold">Something went wrong</h2>
          <p className="text-muted-foreground text-center max-w-md">
            The pipeline page encountered an unexpected error. Please refresh the page to try again.
          </p>
          <p className="text-xs text-muted-foreground font-mono">{this.state.error?.message}</p>
          <button
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function useDebouncedInput(
  value: string,
  onCommit: (nextValue: string) => void,
  delay = 300
) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef(value);

  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      setDraft(value);
      lastCommittedRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flushDraft = useCallback((nextValue: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (nextValue === lastCommittedRef.current) return;
    lastCommittedRef.current = nextValue;
    onCommit(nextValue);
  }, [onCommit]);

  const updateDraft = useCallback((nextValue: string) => {
    setDraft(nextValue);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      flushDraft(nextValue);
    }, delay);
  }, [delay, flushDraft]);

  return { draft, updateDraft, flushDraft };
}

interface DebouncedInputProps extends Omit<ComponentProps<typeof Input>, "value" | "onChange"> {
  value: string;
  onCommit: (nextValue: string) => void;
  debounceMs?: number;
}

const DebouncedInput = memo(function DebouncedInput({
  value,
  onCommit,
  debounceMs = 300,
  onBlur,
  ...props
}: DebouncedInputProps) {
  const { draft, updateDraft, flushDraft } = useDebouncedInput(value, onCommit, debounceMs);

  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => updateDraft(e.target.value)}
      onBlur={(e) => {
        flushDraft(e.target.value);
        onBlur?.(e);
      }}
    />
  );
});

interface DebouncedTextareaProps extends Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> {
  value: string;
  onCommit: (nextValue: string) => void;
  debounceMs?: number;
}

const DebouncedTextarea = memo(function DebouncedTextarea({
  value,
  onCommit,
  debounceMs = 300,
  onBlur,
  ...props
}: DebouncedTextareaProps) {
  const { draft, updateDraft, flushDraft } = useDebouncedInput(value, onCommit, debounceMs);

  return (
    <Textarea
      {...props}
      value={draft}
      onChange={(e) => updateDraft(e.target.value)}
      onBlur={(e) => {
        flushDraft(e.target.value);
        onBlur?.(e);
      }}
    />
  );
});

// ── Pure helpers (hoisted so ScriptCard + PipelinePage can share them) ──

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const countWords = (text: string): number => {
  const cleaned = text.replace(/\[([^\[\]]+)\]/g, "");
  return cleaned.trim().split(/\s+/).filter(Boolean).length;
};

/** Average TTS speech rate in words per second (ElevenLabs default) */
const WORDS_PER_SECOND = 2.3;

const analyzeGroupTags = (text: string): Array<{ label: string; isPaired: boolean; isOpen: boolean; occurrences: number }> => {
  const matches = text.match(/\[([^\[\]]+)\]/g);
  if (!matches) return [];
  const counts: Record<string, number> = {};
  for (const m of matches) {
    const label = m.slice(1, -1);
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts).map(([label, occurrences]) => ({
    label,
    occurrences,
    isPaired: occurrences % 2 === 0,
    isOpen: occurrences % 2 === 1,
  }));
};

// ── ScriptCard — memo'd to avoid re-rendering all cards on every keystroke ──

interface ProductGroupInfo {
  id: string;
  label: string;
  color: string | null;
  source_video_id: string;
  segments_count: number;
}

interface TtsResultInfo {
  audio_duration: number;
  generating: boolean;
  stale: boolean;
  srt_content?: string;
  script_word_count?: number;
  srt_word_count?: number;
}

interface ScriptCardProps {
  index: number;
  script: string;
  isApproved: boolean;
  ttsResult: TtsResultInfo | undefined;
  totalSegmentDuration: number;
  productGroups: ProductGroupInfo[];
  groupTagSearch: string;
  isRegenerating: boolean;
  regeneratingAllScripts: boolean;
  scriptsCount: number;
  playingTtsVariant: number | null;
  ttsAudioDuration: number;
  ttsAudioProgress: number;
  ttsAudioRef: React.RefObject<HTMLAudioElement | null>;
  ttsSeekingRef: React.MutableRefObject<boolean>;
  srtPreviewOpen: boolean;
  libraryMatch: { asset_id: string; audio_duration: number } | undefined;
  pipelineId: string | null;
  onScriptChange: (index: number, value: string) => void;
  onDelete: (index: number) => void;
  onRegenerate: (index: number) => void;
  onGenerateTts: (index: number) => void;
  onPlayTts: (index: number) => void;
  onUseLibraryTts: (index: number) => void;
  onInsertGroupTag: (index: number, label: string) => void;
  onApprove: (index: number, approved: boolean) => void;
  onToggleSrtPreview: (index: number) => void;
  onGroupTagSearchChange: (value: string) => void;
  setTtsAudioProgress: (value: number) => void;
}

const ScriptCard = memo(function ScriptCard({
  index,
  script,
  isApproved,
  ttsResult,
  totalSegmentDuration,
  productGroups,
  groupTagSearch,
  isRegenerating,
  regeneratingAllScripts,
  scriptsCount,
  playingTtsVariant,
  ttsAudioDuration,
  ttsAudioProgress,
  ttsAudioRef,
  ttsSeekingRef,
  srtPreviewOpen,
  libraryMatch,
  pipelineId,
  onScriptChange,
  onDelete,
  onRegenerate,
  onGenerateTts,
  onPlayTts,
  onUseLibraryTts,
  onInsertGroupTag,
  onApprove,
  onToggleSrtPreview,
  onGroupTagSearchChange,
  setTtsAudioProgress,
}: ScriptCardProps) {
  // Local draft for instant typing — debounced sync to parent
  const { draft, updateDraft, flushDraft } = useDebouncedInput(script, (value) => onScriptChange(index, value), 300);

  // Compute from local draft so badges update instantly while typing
  const wordCount = countWords(draft);
  const estimatedDuration = Math.round(wordCount / WORDS_PER_SECOND);
  const charCount = draft.replace(/\[([^\[\]]+)\]/g, "").length;

  return (
    <Card className={`transition-colors ${isApproved ? "border-green-500 bg-green-50/50 dark:bg-green-950/20" : ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {ttsResult && !ttsResult.generating && !ttsResult.stale && (
              <Checkbox
                id={`approve-header-${index}`}
                checked={isApproved}
                onCheckedChange={(checked) => onApprove(index, checked === true)}
                className="h-5 w-5 border-green-500 data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600"
              />
            )}
            <CardTitle className="text-lg">
              Script {index + 1}
              {isApproved && (
                <CheckCircle className="inline-block h-4 w-4 ml-2 text-green-600" />
              )}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {wordCount} words (~{formatDuration(estimatedDuration)})
            </Badge>
            <Badge variant="outline" className="text-muted-foreground">
              {charCount} chars
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-muted-foreground hover:text-primary"
              title="Regenerate this script with AI"
              onClick={() => onRegenerate(index)}
              disabled={isRegenerating || regeneratingAllScripts}
            >
              {isRegenerating ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1" />
              )}
              {isRegenerating ? "Regenerating..." : "Regenerate"}
            </Button>
            {scriptsCount > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                title="Delete script"
                onClick={() => onDelete(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {totalSegmentDuration > 0 && estimatedDuration > totalSegmentDuration && (
        <div className="px-6 pb-2">
          <Alert className="border-muted-foreground/50 bg-muted/50">
            <Info className="h-4 w-4 text-muted-foreground" />
            <AlertDescription className="text-muted-foreground text-sm">
              Script exceeds available video material ({Math.round(totalSegmentDuration)}s) by ~{estimatedDuration - Math.round(totalSegmentDuration)}s. Segments will be repeated to cover the difference.
            </AlertDescription>
          </Alert>
        </div>
      )}
      <CardContent className="space-y-3">
        <Textarea
          id={`script-textarea-${index}`}
          value={draft}
          onChange={(e) => updateDraft(e.target.value)}
          onBlur={(e) => flushDraft(e.target.value)}
          rows={10}
          className="resize-y font-mono text-sm"
        />

        {/* Insert Group Tag — searchable button grid */}
        {productGroups.length > 0 && (() => {
          const tagStates = analyzeGroupTags(draft);
          const filtered = productGroups.filter(
            (g) => !groupTagSearch.trim() || g.label.toLowerCase().includes(groupTagSearch.toLowerCase())
          );
          return (
            <div className="space-y-1.5">
              {productGroups.length > 4 && (
                <div className="relative w-48">
                  <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Filter groups..."
                    value={groupTagSearch}
                    onChange={(e) => onGroupTagSearchChange(e.target.value)}
                    className="h-7 pl-7 text-xs"
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {filtered.map((g) => {
                  const state = tagStates.find((t) => t.label === g.label);
                  const isOpen = state?.isOpen ?? false;
                  const isPaired = state?.isPaired ?? false;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onInsertGroupTag(index, g.label)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors hover:bg-accent ${
                        isOpen
                          ? "ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-300"
                          : isPaired
                          ? "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30 border-green-300"
                          : "border-border"
                      }`}
                    >
                      {g.color && (
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: g.color }}
                        />
                      )}
                      {g.label}
                      <span className="text-muted-foreground">({g.segments_count})</span>
                      {isPaired && <CheckCircle className="h-3 w-3 text-green-600 flex-shrink-0" />}
                      {isOpen && <span className="text-amber-600 font-bold flex-shrink-0">…</span>}
                    </button>
                  );
                })}
              </div>
              {tagStates.length > 0 && (
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Open</span>
                  <span className="inline-flex items-center gap-1"><CheckCircle className="h-2.5 w-2.5 text-green-600" /> Paired</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Per-script TTS controls */}
        <div className="flex flex-wrap items-center gap-2">
          {ttsResult?.generating ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Generating...
            </Button>
          ) : ttsResult && !ttsResult.stale ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPlayTts(index)}
              >
                {playingTtsVariant === index ? (
                  <><Pause className="h-3.5 w-3.5 mr-1.5" />Pause</>
                ) : (
                  <><Play className="h-3.5 w-3.5 mr-1.5" />Play</>
                )}
              </Button>
              {playingTtsVariant === index && ttsAudioDuration > 0 && (
                <div
                  className="relative h-5 flex-1 min-w-[100px] max-w-[200px] cursor-pointer group select-none"
                  onMouseDown={(e) => {
                    const bar = e.currentTarget;
                    const seek = (clientX: number) => {
                      const rect = bar.getBoundingClientRect();
                      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                      setTtsAudioProgress(pct * ttsAudioDuration);
                      if (ttsAudioRef.current) ttsAudioRef.current.currentTime = pct * ttsAudioDuration;
                    };
                    ttsSeekingRef.current = true;
                    seek(e.clientX);
                    const onMove = (ev: MouseEvent) => seek(ev.clientX);
                    const onUp = () => {
                      ttsSeekingRef.current = false;
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                  }}
                >
                  <div className="absolute top-1/2 -translate-y-1/2 w-full h-1 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(ttsAudioProgress / ttsAudioDuration) * 100}%` }}
                    />
                  </div>
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary shadow-sm border-2 border-background"
                    style={{ left: `calc(${(ttsAudioProgress / ttsAudioDuration) * 100}% - 6px)` }}
                  />
                  <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {Math.floor(ttsAudioProgress / 60)}:{String(Math.floor(ttsAudioProgress % 60)).padStart(2, '0')} / {Math.floor(ttsAudioDuration / 60)}:{String(Math.floor(ttsAudioDuration % 60)).padStart(2, '0')}
                  </span>
                </div>
              )}
              <Badge variant="secondary" className="text-xs">
                {formatDuration(ttsResult.audio_duration)}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onGenerateTts(index)}
                title="Regenerate voice-over with current settings"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Regenerate
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onGenerateTts(index)}
            >
              <Volume2 className="h-3.5 w-3.5 mr-1.5" />
              {ttsResult?.stale ? "Regenerate Voice-over" : "Generate Voice-over"}
            </Button>
          )}
          {ttsResult?.stale && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
              Script changed — audio outdated
            </Badge>
          )}
          {libraryMatch && !ttsResult && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs text-muted-foreground border-muted-foreground/30 hover:bg-muted"
              onClick={() => onUseLibraryTts(index)}
            >
              <Library className="h-3.5 w-3.5 mr-1.5" />
              Use Library Audio ({formatDuration(libraryMatch.audio_duration)})
            </Button>
          )}
          {ttsResult && !ttsResult.generating && !ttsResult.stale && (
            <div className="ml-auto flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-2.5 py-1 dark:border-green-900 dark:bg-green-950/30">
              <Checkbox
                id={`approve-script-${index}`}
                checked={isApproved}
                onCheckedChange={(checked) => onApprove(index, checked === true)}
                className="h-4.5 w-4.5 border-green-500 data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600"
              />
              <Label
                htmlFor={`approve-script-${index}`}
                className="cursor-pointer text-xs font-medium text-green-700 dark:text-green-300"
              >
                Approve voice-over
              </Label>
            </div>
          )}
        </div>

        {/* SRT Subtitle Preview */}
        {ttsResult?.srt_content && !ttsResult?.generating && !ttsResult?.stale && (
          <div className="mt-2">
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => onToggleSrtPreview(index)}
            >
              {srtPreviewOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Subtitle Preview
              <span className="text-muted-foreground">
                — Script: {ttsResult.script_word_count} words | SRT: {ttsResult.srt_word_count} words
              </span>
              {ttsResult.script_word_count != null && ttsResult.srt_word_count != null && ttsResult.script_word_count! > ttsResult.srt_word_count! && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                  {ttsResult.script_word_count! - ttsResult.srt_word_count!} words missing
                </Badge>
              )}
            </button>
            {srtPreviewOpen && (
              <pre className="mt-1.5 p-2 bg-muted/50 rounded text-[11px] font-mono max-h-48 overflow-y-auto whitespace-pre-wrap border">
                {ttsResult.srt_content}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

export default function PipelinePageWrapper() {
  return (
    <PipelineErrorBoundary>
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
        <PipelinePage />
      </Suspense>
    </PipelineErrorBoundary>
  );
}

function PipelinePage() {
  const { currentProfile } = useProfile();
  // Ref to avoid stale closure in debounced setTimeout callbacks
  const currentProfileIdRef = useRef(currentProfile?.id);
  currentProfileIdRef.current = currentProfile?.id;

  // Simple / Advanced mode toggle (persisted to localStorage)
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>("simple");
  useEffect(() => {
    const saved = localStorage.getItem("ef_pipeline_mode") as PipelineMode;
    if (saved && saved !== pipelineMode) {
      setPipelineMode(saved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleModeChange = useCallback((mode: PipelineMode) => {
    setPipelineMode(mode);
    localStorage.setItem("ef_pipeline_mode", mode);
  }, []);

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

  // Pipeline ID from URL — used for restoring session on page load
  const urlPipelineId = searchParams.get("id");

  // Helper: update URL params (step + pipeline id) without full navigation
  const updateUrlParams = useCallback((stepNum: number, pid: string | null) => {
    const params = new URLSearchParams();
    params.set("step", String(stepNum));
    if (pid) params.set("id", pid);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname]);

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
  const [provider, setProvider] = useState("gemini");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiRulesExpanded, setAiRulesExpanded] = useState(false);
  const [aiRulesSaved, setAiRulesSaved] = useState(false);
  const [aiRulesDirty, setAiRulesDirty] = useState(false);
  const aiInstructionsSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const aiRulesSavedResetTimer = useRef<NodeJS.Timeout | null>(null);

  // Step 2: Scripts
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [scripts, setScripts] = useState<string[]>([]);
  const [approvedScripts, setApprovedScripts] = useState<Set<number>>(new Set());
  const [totalSegmentDuration, setTotalSegmentDuration] = useState<number>(0);

  // Step 3: Preview
  const [previewVariant, setPreviewVariant] = useState<PreviewKey | null>(null);
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Record<PreviewKey, PreviewData>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
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
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyScripts, setHistoryScripts] = useState<string[]>([]);
  const [historyScriptsLoading, setHistoryScriptsLoading] = useState(false);
  const [historySelectedScripts, setHistorySelectedScripts] = useState<Set<number>>(new Set());
  const [historyImporting, setHistoryImporting] = useState(false);
  const [historyPreviewInfo, setHistoryPreviewInfo] = useState<Record<string, VariantPreviewInfo>>({});
  const [historyTtsInfo, setHistoryTtsInfo] = useState<Record<string, { has_audio: boolean; audio_duration: number; approved?: boolean }>>({});
  const [historyContextProducts, setHistoryContextProducts] = useState<ContextProduct[]>([]);
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
  const [ttsResults, setTtsResults] = useState<Record<number, { audio_duration: number; generating: boolean; stale: boolean; srt_content?: string; script_word_count?: number; srt_word_count?: number }>>({});
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
  const [sourceVideoViewMode, setSourceVideoViewMode] = useState<"list" | "grid">("list");
  // FE-16: This is a single shared search string for all variants' group tag dropdowns.
  // Ideally this would be Record<number, string> (per-variant) to prevent search state leaking
  // across variants when multiple group tag dropdowns are open. Left as-is for now because
  // only one dropdown can be open at a time in the current UI, making the leak harmless.
  const [groupTagSearch, setGroupTagSearch] = useState("");
  const sourceSelectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineIdRef = useRef<string | null>(null);
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

  // ── Subtitle settings state ───────────────────────────────────────────────
  // `subtitleSettings` is the DEFAULT style for this pipeline (loaded from the
  // user's profile, used as fallback for any variant that doesn't have an
  // explicit override).
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>({ ...DEFAULT_SUBTITLE_SETTINGS });
  const [subtitleSettingsLoaded, setSubtitleSettingsLoaded] = useState(false);
  const subtitleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Debounced-save timer for per-variant overrides → PUT /pipeline/{id}/subtitle-overrides
  const overridesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Save as preset" dialog state
  const [savePresetDialogOpen, setSavePresetDialogOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [savePresetSubmitting, setSavePresetSubmitting] = useState(false);
  const [savePresetError, setSavePresetError] = useState<string | null>(null);

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
    (card: Pick<PreviewCard, "visualVersion">): SubtitleSettings => {
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
    [getSubtitleSettingsFor, subtitleOverrides]
  );

  // Stable empty slides constant to avoid new array reference on every render
  const EMPTY_SLIDES: InterstitialSlide[] = useMemo(() => [], []);

  // Stable per-index callback refs for TimelineEditor props
  const matchesChangeHandlers = useRef<Record<string, (matches: MatchPreview[]) => void>>({});
  const getMatchesChangeHandler = useCallback((previewKey: string) => {
    if (!matchesChangeHandlers.current[previewKey]) {
      matchesChangeHandlers.current[previewKey] = (updatedMatches: MatchPreview[]) => {
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
      };
    }
    return matchesChangeHandlers.current[previewKey];
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

  // Keep pipelineIdRef in sync with state + URL
  useEffect(() => {
    pipelineIdRef.current = pipelineId;
    // Sync pipeline ID to URL so it's always visible and shareable
    updateUrlParams(step, pipelineId);
  }, [pipelineId]); // eslint-disable-line react-hooks/exhaustive-deps — step read intentionally from current value

  // Mark component as unmounted — must be a separate effect with [] deps
  // so the cleanup only runs on actual unmount, not on every pipelineId change.
  // BUG-FE-24 originally merged these, but that caused isMountedRef to become
  // false whenever pipelineId changed, breaking all subsequent async operations.
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

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
        setScripts((data.scripts || []).map((s: string) => {
          const lines = s.trim().split('\n').filter((l: string) => l.trim());
          if (lines.length >= 3) return s;
          const sentences = s.trim().split(/([.!?])\s+/).reduce<string[]>((acc, part, i, arr) => {
            if (i % 2 === 0) acc.push(i + 1 < arr.length ? part + arr[i + 1] : part);
            return acc;
          }, []);
          return sentences.map((sent: string) => sent.trim()).filter(Boolean).join('\n');
        }));
        if (data.context_products) setContextProducts(data.context_products);

        // Restore pipeline metadata so "Back to Input" shows the original form
        if (data.name) setPipelineName(data.name);
        if (data.idea) setIdea(data.idea);
        if (data.context) setContext(stripEmbeddedProductBlocks(data.context));
        if (data.provider) setProvider(data.provider);
        if (data.variant_count) setVariantCount(data.variant_count);
        setMetaMultiplication(data.meta_multiplication !== undefined ? Boolean(data.meta_multiplication) : true);
        if (data.library_project_id) setLibraryProjectId(data.library_project_id);

        // Restore TTS results from history info (inline to avoid hoisting issues)
        const ttsInfo: Record<string, { has_audio: boolean; audio_duration: number; approved?: boolean }> = data.tts_info || {};
        const previewInfo: Record<string, { has_audio: boolean; audio_duration: number }> = data.preview_info || {};
        const restoredTts: Record<number, { audio_duration: number; generating: boolean; stale: boolean }> = {};
        const restoredApproved = new Set<number>();
        Object.entries(ttsInfo).forEach(([key, info]) => {
          if (info.has_audio) {
            restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
            if (info.approved) restoredApproved.add(Number(key));
          }
        });
        // Per-variant fallback: fill gaps from preview_info (Step 3 audio may
        // survive temp cleanup even when Step 2 TTS audio was deleted)
        Object.entries(previewInfo).forEach(([key, info]) => {
          if (info.has_audio && !restoredTts[Number(key)]) {
            restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
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
            setSubtitleOverrides(ovData.overrides as Partial<Record<StyleKey, SubtitleSettings>>);
          }
        } catch {
          // Old pipeline or no overrides — silent fallback
        }

        // Navigate to step 2 if on step 1 (scripts are loaded)
        if (step === 1) setStep(2);
      } catch {
        // Pipeline not found or expired — clear ID from URL
        updateUrlParams(step, null);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — one-time mount restore

  const stripEmbeddedProductBlocks = (value: string): string => {
    if (!value) return "";
    return value
      .replace(/(?:^|\n)\[Product:\s*[^\]]+\]\s*(?:\n[^\n\[]*)*/g, "")
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

  // Catalog: fetch products
  const fetchCatalogProducts = useCallback(async (search: string, brand: string, category: string, page: number) => {
    setCatalogLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), page_size: "20" });
      if (search) params.set("search", search);
      if (brand && brand !== "all") params.set("brand", brand);
      if (category && category !== "all") params.set("category", category);
      const res = await apiGet(`/catalog/products?${params}`);
      const data = await res.json();
      setCatalogProducts(data.products || []);
      setCatalogPagination(data.pagination || { page: 1, page_size: 20, total: 0, total_pages: 1 });
    } catch (err) {
      handleApiError(err, "Failed to load catalog products");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  // Catalog: fetch filters (once)
  const fetchCatalogFilters = useCallback(async () => {
    try {
      const res = await apiGet("/catalog/products/filters");
      const data = await res.json();
      setCatalogFilters({ brands: data.brands || [], categories: data.categories || [] });
    } catch (err) {
      handleApiError(err, "Failed to load catalog filters");
    }
  }, []);

  // Source videos: fetch list with segment counts
  const fetchSourceVideos = useCallback(async () => {
    setSourceVideosLoading(true);
    try {
      const res = await apiGet("/segments/source-videos");
      const data = await res.json();
      setSourceVideos(data || []);
    } catch (err) {
      handleApiError(err, "Failed to load source videos");
    } finally {
      setSourceVideosLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    let restored = false;
    try {
      const res = await apiGet(`/pipeline/${pid}/source-selection`);
      const data = await res.json();
      if (data.source_video_ids && data.source_video_ids.length > 0) {
        setSelectedSourceIds(new Set(data.source_video_ids));
        restored = true;
      }
    } catch {
      // Ignore — fresh pipeline or column not yet migrated
    }
    // No fallback — user selects manually if no saved selection exists
  }, [sourceVideos]);

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
      title: stripHtml(p.title),
      description: stripHtml(p.description) || "No description available.",
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
  const videoCacheBustRef = useRef<Record<number, number>>({});
  const completedFingerprint = useMemo(
    () => variantStatuses.filter(v => v.status === "completed").map(v => `${v.variant_index}${v.visual_version ? `_${v.visual_version}` : ""}`).join(","),
    [variantStatuses]
  );
  useEffect(() => {
    variantStatuses.filter(v => v.status === "completed").forEach(v => {
      if (!videoCacheBustRef.current[v.variant_index]) {
        videoCacheBustRef.current[v.variant_index] = Date.now();
      }
    });
  }, [completedFingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  const getVideoCacheBust = useCallback((variantIndex: number) => {
    return videoCacheBustRef.current[variantIndex] || Date.now();
  }, []);
  // Legacy single value for download links
  const videoCacheBust = useMemo(() => Date.now(), [completedFingerprint]);

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
          (v) => v.status === "completed" || v.status === "failed" || v.status === "cancelled"
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

  // Start/stop render polling when isRendering/step changes
  useEffect(() => {
    if (pipelineId && isRendering && step === 4) {
      startRenderPolling();
    } else {
      stopRenderPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, isRendering, step]);

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
              (v: { status: string }) => v.status === "completed" || v.status === "failed" || v.status === "cancelled"
            );
          if (allDone) {
            setIsRendering(false);
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
          // Get all variant indices from either source
          const allVarIndices = new Set([
            ...Object.keys(selectedCaptions),
            ...Object.keys(aiCaptions),
          ]);
          for (const varIdx of allVarIndices) {
            const vs = freshStatuses.find((v: VariantStatus) => String(v.variant_index) === varIdx);
            if (!vs?.clip_id) continue;
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

    scriptAbortRef.current?.abort();
    const abortController = new AbortController();
    scriptAbortRef.current = abortController;

    setError(null);
    setIsGenerating(true);

    try {
      const res = await apiPost("/pipeline/generate", {
        name: pipelineName.trim() || undefined,
        idea: idea.trim(),
        context: stripEmbeddedProductBlocks(context) || undefined,
        context_products: contextProducts.length > 0 ? contextProducts : undefined,
        variant_count: variantCount,
        provider,
        target_script_duration: targetScriptDuration,
      }, { timeout: 300_000, signal: abortController.signal }); // 5 min — AI script generation is slow

      if (abortController.signal.aborted || !isMountedRef.current) return;

      // apiPost throws on non-OK responses — no need for res.ok check (FE-01)
      const data = await res.json();
      if (!isMountedRef.current) return;
      setPipelineId(data.pipeline_id);
      setScripts((data.scripts || []).map(formatScript));
      setTotalSegmentDuration(data.total_segment_duration || 0);
      setStep(2);
      if (!isMountedRef.current) return;
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
      if (!abortController.signal.aborted && isMountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  const handleCancelGenerate = () => {
    scriptAbortRef.current?.abort();
    scriptAbortRef.current = null;
    setIsGenerating(false);
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
            words_per_subtitle: wordsPerSubtitle,
            min_segment_duration: minSegmentDuration,
            ultra_rapid_intro: ultraRapidIntro,
            visual_version: previewCard.visualVersion,
          }, { timeout: 300_000, signal: abortController.signal }); // 5 min — TTS generation + SRT can be slow

          if (abortController.signal.aborted || !isMountedRef.current) { setPreviewingIndex(null); return; }

          // apiPost throws on non-OK responses — no need for res.ok check (FE-01)
          const data = await res.json();
          if (!isMountedRef.current) return;
          newPreviews[previewCard.key] = data;
          setPreviews(prev => ({ ...prev, [previewCard.key]: data }));
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

      // Collect available segments from the first preview response (all previews share same segment pool)
      const firstPreview = Object.values(newPreviews)[0];
      if (firstPreview?.available_segments && firstPreview.available_segments.length > 0) {
        setAvailableSegments(firstPreview.available_segments);
      }

      // Select all variants by default
      const allIndices = new Set(scripts.map((_, i) => i));
      setSelectedVariants(allIndices);

      // Auto-advance to Step 3 when all TTS was already ready (user clicked "Generate Previews", not "Generate Voice-Overs")
      const readyCount = Object.values(ttsResultsRef.current).filter(r => !r.generating && !r.stale).length;
      if (readyCount === scripts.length && scripts.length > 0 && Object.keys(newPreviews).length > 0) {
        setStep(3);
      }
      // Otherwise stay on Step 2 so user can review voice-overs before proceeding
    } finally {
      if (isMountedRef.current) setPreviewingIndex(null);
    }
  };

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
      setPreviewError("Meta Multiplication activată. Rulează din nou Generate Previews pentru a crea și preview-urile B/Facebook.");
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

  // Build the render payload (shared between check-render and render calls)
  const buildRenderPayload = () => {
    const matchOverrides: Record<string, MatchPreview[]> = {};
    const selectedPreviewCards = previewCards.filter(card => selectedVariants.has(card.baseIndex));
    for (const card of selectedPreviewCards) {
      if (previews[card.key]?.matches && previews[card.key].matches.length > 0) {
        matchOverrides[card.key] = previews[card.key].matches;
      } else {
        console.warn(
          `[Render] Variant ${card.key}: no match_overrides available — render will use auto-matching (may differ from preview!). ` +
          `previews[${card.key}] exists: ${!!previews[card.key]}, matches count: ${previews[card.key]?.matches?.length ?? 0}`
        );
      }
    }

    const filteredInterstitialSlides = Object.keys(interstitialSlides).length > 0
      ? Object.fromEntries(
          Object.entries(interstitialSlides)
            .filter(([k]) => selectedPreviewCards.some(card => card.key === k))
            .map(([k, v]) => [k, v.filter((s) => s.imageUrl)])
            .filter(([, v]) => (v as InterstitialSlide[]).length > 0)
        )
      : undefined;

    const pipOverlays: Record<string, { image_url: string; position: string; size: string; animation: string }> = {};
    for (const card of selectedPreviewCards) {
      const preview = previews[card.key];
      if (!preview?.matches) continue;
      for (const match of preview.matches) {
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
    }

    return {
      variant_indices: Array.from(selectedVariants),
      preset_name: presetName,
      elevenlabs_model: elevenlabsModel,
      voice_id: voiceId && voiceId !== "default" ? voiceId : undefined,
      source_video_ids: selectedSourceIdsRef.current.size > 0 ? Array.from(selectedSourceIdsRef.current) : undefined,
      match_overrides: Object.keys(matchOverrides).length > 0 ? matchOverrides : undefined,
      interstitial_slides: filteredInterstitialSlides,
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
      min_segment_duration: minSegmentDuration,
      ultra_rapid_intro: ultraRapidIntro,
      meta_multiplication: metaMultiplication,
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
      // Per-Meta-version overrides. Only non-empty entries are sent — the
      // backend's PUT regex rejects `{}` entries, so we filter them out to
      // match the same contract when we POST to /render. When no overrides
      // remain after filtering, omit the field entirely so the backend
      // takes the simpler code path (flat defaults only).
      subtitle_settings_by_key: (() => {
        const filtered: Partial<Record<StyleKey, SubtitleSettings>> = {};
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
          current_step: "Render existent folosit",
        };
      }
      return {
        variant_index: idx,
        status: "processing" as const,
        progress: 0,
        current_step: "Initializing render...",
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
          v.status === "processing"
            ? { ...v, status: "cancelled" as const, current_step: "Cancelled by user", progress: 0 }
            : v
        )
      );
      toast.success("Render cancelled");
    } catch (err) {
      handleApiError(err, "Failed to cancel render");
    }
  };

  // Remake variant with different segments (same voiceover)
  const handleRemakeVariant = async (variantIndex: number) => {
    if (!pipelineId) return;

    // Optimistic UI: set variant back to processing
    setVariantStatuses(prev =>
      prev.map(v =>
        v.variant_index === variantIndex
          ? { ...v, status: "processing" as const, progress: 0, current_step: "Remaking with new segments...", final_video_path: undefined, render_fingerprint: undefined }
          : v
      )
    );

    try {
      const payload = buildRenderPayload();
      // Remove match_overrides — backend will auto-match with different segments
      delete payload.match_overrides;
      payload.variant_indices = [variantIndex];

      await apiPost(`/pipeline/remake/${pipelineId}/${variantIndex}`, payload, {
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
          v.variant_index === variantIndex
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
    setContext("");
    setContextProducts([]);
    setContextExpanded(true);
    setVariantCount(3);
    setProvider("gemini");
    setError(null);
    setPipelineId(null);
    setScripts([]);
    setPreviews({});
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

  // History sidebar: fetch scripts for a specific pipeline
  const fetchHistoryScripts = async (id: string) => {
    if (selectedHistoryId === id) {
      setSelectedHistoryId(null);
      setHistoryScripts([]);
      setHistorySelectedScripts(new Set());
      setHistoryPreviewInfo({});
      setHistoryTtsInfo({});
      return;
    }
    setSelectedHistoryId(id);
    setHistoryScriptsLoading(true);
    setHistorySelectedScripts(new Set());
    try {
      const res = await apiGet(`/pipeline/scripts/${id}`);
      const data = await res.json();
      const scriptsArr = data.scripts || data || [];
      setHistoryScripts(scriptsArr);
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
      // Store context products for restore
      setHistoryContextProducts(data.context_products || []);
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
            setPreviews({});
            setTtsResults({});
            setPreviewError(null);
            setStep(1);
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
        handleApiError(err, "Failed to load voices");
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
          setVoiceId((prev) => prev === "" ? savedVoiceId : prev);
        }
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
        setSubtitleSettings({ ...DEFAULT_SUBTITLE_SETTINGS, ...data });
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
  const scheduleOverridesSave = useCallback((nextOverrides: Partial<Record<StyleKey, SubtitleSettings>>) => {
    const savedPid = pipelineIdRef.current;
    if (!savedPid) return;
    if (overridesSaveTimer.current) clearTimeout(overridesSaveTimer.current);
    // Snapshot the dict so concurrent state mutations after this call don't
    // alter what we end up sending. Also strip empty-object entries: the
    // backend's regex accepts only {A,B,default}, and we never want to send
    // `{"A": {}}` which would look like a no-op override.
    const snapshot: Partial<Record<StyleKey, SubtitleSettings>> = {};
    for (const [k, v] of Object.entries(nextOverrides) as [StyleKey, SubtitleSettings | undefined][]) {
      if (v && Object.keys(v).length > 0) {
        snapshot[k] = v;
      }
    }
    overridesSaveTimer.current = setTimeout(async () => {
      // Bail out if the user navigated to a different pipeline meanwhile.
      if (pipelineIdRef.current !== savedPid) return;
      try {
        await apiPut(`/pipeline/${savedPid}/subtitle-overrides`, { overrides: snapshot });
      } catch {
        // Silent — overrides still work locally for this session
      }
    }, 800);
  }, []);

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
      setSubtitleOverrides(prev => {
        const next = { ...prev, [styleKey]: newSettings };
        scheduleOverridesSave(next);
        return next;
      });
    },
    [scheduleOverridesSave]
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
        const next = { ...prev, [targetKey]: sourceEffective };
        scheduleOverridesSave(next);
        return next;
      });
    },
    [scheduleOverridesSave, subtitleSettings]
  );

  // Submit a "Save as preset" — POSTs the active key's effective settings to
  // /profiles/{id}/subtitle-presets and refreshes the list on success.
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
    // Resolve effective settings for the active Meta version (inline to avoid stale closure)
    const override = subtitleOverrides[activeStyleKey];
    const effective: SubtitleSettings = override && Object.keys(override).length > 0
      ? { ...subtitleSettings, ...override }
      : { ...subtitleSettings };

    setSavePresetSubmitting(true);
    setSavePresetError(null);
    try {
      await apiPost(`/profiles/${profileId}/subtitle-presets`, {
        name: trimmedName,
        settings: effective,
      });
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
  }, [savePresetName, activeStyleKey, subtitleOverrides, subtitleSettings]);

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

  // Debounced auto-save scripts to backend
  const saveScriptsToBackend = useCallback((pId: string, updatedScripts: string[]) => {
    if (scriptSaveTimer.current) clearTimeout(scriptSaveTimer.current);
    scriptSaveTimer.current = setTimeout(async () => {
      try {
        const currentPid = pipelineIdRef.current;
        if (!currentPid) return;
        await apiPut(`/pipeline/${currentPid}/scripts`, { scripts: updatedScripts });
      } catch {
        // Silent — scripts still work locally, will retry on next edit
      }
    }, 1000);
  }, []);

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

  // FE-13: Shared helper to restore TTS results from history info maps
  const buildRestoredTts = (
    ttsInfo: Record<string, { has_audio: boolean; audio_duration: number; approved?: boolean }>,
    previewInfo: Record<string, { has_audio: boolean; audio_duration: number; has_srt?: boolean }>,
  ): { tts: Record<number, { audio_duration: number; generating: boolean; stale: boolean }>; approved: Set<number> } => {
    const restoredTts: Record<number, { audio_duration: number; generating: boolean; stale: boolean }> = {};
    const restoredApproved = new Set<number>();
    Object.entries(ttsInfo).forEach(([key, info]) => {
      if (info.has_audio) {
        restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
        if (info.approved) restoredApproved.add(Number(key));
      }
    });
    // Per-variant fallback: fill gaps from preview_info
    Object.entries(previewInfo).forEach(([key, info]) => {
      if (info.has_audio && !restoredTts[Number(key)]) {
        restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
      }
    });
    return { tts: restoredTts, approved: restoredApproved };
  };

  // History sidebar: import selected scripts
  const handleHistoryImport = async () => {
    const selected = historyScripts.filter((_, i) => historySelectedScripts.has(i));
    if (selected.length === 0) return;

    // If all scripts are selected, reuse the existing pipeline (no duplicate)
    if (selected.length === historyScripts.length && selectedHistoryId) {
      const pid = selectedHistoryId;
      setPipelineId(pid);
      setScripts(historyScripts.map(formatScript));
      // Carry over TTS results: prefer tts_info (Step 2) over preview_info (Step 3)
      const restored = buildRestoredTts(historyTtsInfo, historyPreviewInfo);
      setTtsResults(restored.tts);
      if (restored.approved.size > 0) setApprovedScripts(restored.approved);
      // Restore context products from history
      setContextProducts(historyContextProducts);
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
            setSubtitleOverrides(data.overrides as Partial<Record<StyleKey, SubtitleSettings>>);
          } else {
            setSubtitleOverrides({});
          }
        })
        .catch(() => {
          setSubtitleOverrides({});
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
      setPipelineId(pid);
      setScripts((data.scripts || []).map(formatScript));
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
      if (catalogSearchTimer.current) { clearTimeout(catalogSearchTimer.current); catalogSearchTimer.current = null; }
      if (voiceSettingsSaveTimer.current) { clearTimeout(voiceSettingsSaveTimer.current); voiceSettingsSaveTimer.current = null; }
      if (subtitleSaveTimer.current) { clearTimeout(subtitleSaveTimer.current); subtitleSaveTimer.current = null; }
      previewAbortRef.current?.abort();
      scriptAbortRef.current?.abort();
      regenerateAbortRef.current?.abort();
      ttsPlayAbortRef.current?.abort();
      audioPlayAbortRef.current?.abort();
    };
  }, []);

  // Mark existing TTS results as stale when voice settings change (user-initiated only)
  // voiceSettingsHydrated captures the settings value AFTER localStorage hydration.
  // Any change after that point is a real user change. (Bug #48: React batches all
  // setState calls from the hydration useEffect into a single render, so skipping
  // the first trigger after voiceSettingsLoaded is sufficient.)
  const voiceSettingsHydrated = useRef(false);
  useEffect(() => {
    // Wait until localStorage hydration is complete
    if (!voiceSettingsLoaded) return;
    // The first trigger after hydration is the hydrated values settling — skip it
    if (!voiceSettingsHydrated.current) {
      voiceSettingsHydrated.current = true;
      return;
    }
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
    try {
      const stability = localStorage.getItem("ef_voice_stability");
      const similarity = localStorage.getItem("ef_voice_similarity");
      const style = localStorage.getItem("ef_voice_style");
      const speed = localStorage.getItem("ef_voice_speed");
      const boost = localStorage.getItem("ef_voice_speaker_boost");
      const wps = localStorage.getItem("ef_words_per_subtitle");
      const elModel = localStorage.getItem("ef_elevenlabs_model");
      const hasVoiceValues = stability !== null || similarity !== null || style !== null || speed !== null || boost !== null;
      if (stability !== null) setVoiceStability(parseFloat(stability));
      if (similarity !== null) setVoiceSimilarity(parseFloat(similarity));
      if (style !== null) setVoiceStyle(parseFloat(style));
      if (speed !== null) setVoiceSpeed(parseFloat(speed));
      if (boost !== null) setVoiceSpeakerBoost(boost === "true");
      if (wps !== null) setWordsPerSubtitle(parseInt(wps, 10));
      if (elModel !== null) setElevenlabsModel(elModel);
      const msd = localStorage.getItem("ef_min_segment_duration");
      if (msd !== null) setMinSegmentDuration(parseFloat(msd));
      const uri = localStorage.getItem("ef_ultra_rapid_intro");
      if (uri !== null) setUltraRapidIntro(uri === "true");
      // If no voice values were stored, hydration won't trigger a re-render,
      // so pre-mark as hydrated to avoid skipping the first real user change
      if (!hasVoiceValues) voiceSettingsHydrated.current = true;
    } catch {
      // FE-16: SecurityError or QuotaExceededError — use defaults
    }
    setVoiceSettingsLoaded(true);
  }, []);

  // Keep voice settings ref in sync for debounced save (Bug #87)
  useEffect(() => {
    voiceSettingsValuesRef.current = { voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost, wordsPerSubtitle, minSegmentDuration, ultraRapidIntro, elevenlabsModel };
  }, [voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost, wordsPerSubtitle, minSegmentDuration, ultraRapidIntro, elevenlabsModel]);

  // Persist voice settings to localStorage (skip initial render before load)
  useEffect(() => {
    if (!voiceSettingsLoaded) return;
    localStorage.setItem("ef_voice_stability", String(voiceStability));
    localStorage.setItem("ef_voice_similarity", String(voiceSimilarity));
    localStorage.setItem("ef_voice_style", String(voiceStyle));
    localStorage.setItem("ef_voice_speed", String(voiceSpeed));
    localStorage.setItem("ef_voice_speaker_boost", String(voiceSpeakerBoost));
    localStorage.setItem("ef_words_per_subtitle", String(wordsPerSubtitle));
    localStorage.setItem("ef_min_segment_duration", String(minSegmentDuration));
    localStorage.setItem("ef_ultra_rapid_intro", String(ultraRapidIntro));
    localStorage.setItem("ef_elevenlabs_model", elevenlabsModel);
  }, [voiceSettingsLoaded, voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost, wordsPerSubtitle, minSegmentDuration, ultraRapidIntro, elevenlabsModel]);

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
      }, { timeout: 120_000 });
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
      toast.error("Failed to regenerate script. Please try again.");
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
        }, { timeout: 120_000 });
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
      [variantIndex]: { audio_duration: 0, generating: true, stale: false }
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
        words_per_subtitle: wordsPerSubtitle,
        min_segment_duration: minSegmentDuration,
        ultra_rapid_intro: ultraRapidIntro,
      }, { timeout: 300_000 });

      // apiPost throws on non-OK responses (FE-01)
      const data = await res.json();
      checkFallbacks(data);
      setTtsResults(prev => ({
        ...prev,
        [variantIndex]: {
          audio_duration: data.audio_duration,
          generating: false,
          stale: false,
          srt_content: data.srt_content,
          script_word_count: data.script_word_count,
          srt_word_count: data.srt_word_count,
        }
      }));
    } catch (err) {
      handleApiError(err, "TTS generation error");
      if (err instanceof ApiError && err.isTimeout) {
        setPreviewError("TTS generation timed out. Try again.");
      } else {
        setPreviewError("Network error. Please check if the backend is running.");
      }
      setTtsResults(prev => {
        const next = { ...prev };
        delete next[variantIndex];
        return next;
      });
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

    for (let i = 0; i < scripts.length; i++) {
      if (abortController.signal.aborted) break;

      setRegeneratingAllIndex(i);
      setTtsResults(prev => ({
        ...prev,
        [i]: { audio_duration: 0, generating: true, stale: false }
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
          words_per_subtitle: wordsPerSubtitle,
          min_segment_duration: minSegmentDuration,
          ultra_rapid_intro: ultraRapidIntro,
        }, { timeout: 300_000, signal: abortController.signal });

        if (abortController.signal.aborted || !isMountedRef.current) break;

        // apiPost throws on non-OK responses (FE-01)
        const data = await res.json();
        checkFallbacks(data);
        if (!isMountedRef.current) break;
        setTtsResults(prev => ({
          ...prev,
          [i]: {
            audio_duration: data.audio_duration,
            generating: false,
            stale: false,
            srt_content: data.srt_content,
            script_word_count: data.script_word_count,
            srt_word_count: data.srt_word_count,
          }
        }));
      } catch (err) {
        if (abortController.signal.aborted) break;
        handleApiError(err, "TTS regeneration error");
        setTtsResults(prev => { const next = { ...prev }; delete next[i]; return next; });
        break;
      }
    }

    // Clean up any entries left in generating state (e.g. after abort)
    setTtsResults(prev => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if (next[Number(key)]?.generating) {
          delete next[Number(key)];
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setRegeneratingAll(false);
    setRegeneratingAllIndex(null);
  };

  const handleCancelRegenerateAll = () => {
    regenerateAbortRef.current?.abort();
    regenerateAbortRef.current = null;
    setRegeneratingAll(false);
    setRegeneratingAllIndex(null);
    // Mark any currently-generating entries as not generating
    setTtsResults(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[Number(key)]?.generating) {
          delete next[Number(key)];
        }
      }
      return next;
    });
  };

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
        words_per_subtitle: wordsPerSubtitle,
        min_segment_duration: minSegmentDuration,
        ultra_rapid_intro: ultraRapidIntro,
        visual_version: visualVersion,
        force_regenerate_tts: true,
      }, { timeout: 300_000 });

      const data = await res.json();
      if (!isMountedRef.current) return;
      setPreviews(prev => ({ ...prev, [previewKey ?? buildPreviewKey(variantIndex)]: data }));
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Film className="h-8 w-8 text-primary" />
              {pipelineMode === "simple" ? "Video Creator" : "Multi-Variant Pipeline"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {pipelineMode === "simple"
                ? "Upload, choose a style, and download your videos"
                : "End-to-end workflow: generate scripts \u2192 preview matches \u2192 batch render"}
            </p>
          </div>
          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
            <Button
              variant={pipelineMode === "simple" ? "default" : "ghost"}
              size="sm"
              onClick={() => handleModeChange("simple")}
              className="text-xs"
            >
              Simple
            </Button>
            <Button
              variant={pipelineMode === "advanced" ? "default" : "ghost"}
              size="sm"
              onClick={() => handleModeChange("advanced")}
              className="text-xs"
            >
              Advanced
            </Button>
          </div>
        </div>

        {/* Simple Mode */}
        {pipelineMode === "simple" && (
          <div className="space-y-6">
            <SimplePipeline onSwitchToAdvanced={() => handleModeChange("advanced")} />

            {/* Advanced Settings teaser */}
            <div className="border rounded-lg p-4">
              <button
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                onClick={() => handleModeChange("advanced")}
              >
                <ChevronRight className="h-4 w-4" />
                <span>Advanced Settings</span>
                <span className="text-xs ml-auto">Switch to Advanced mode for full control over all parameters</span>
              </button>
            </div>
          </div>
        )}

        {/* Advanced Mode — existing 4-step pipeline */}
        {pipelineMode === "advanced" && (
        <>{/* Step indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {[
              { num: 1, label: "Idea Input" },
              { num: 2, label: "Review Scripts" },
              { num: 3, label: "Preview Matches" },
              { num: 4, label: "Render Videos" },
            ].map((s, index) => {
              /*
                Allow re-entering previously populated steps even when the current step is earlier.
                This fixes the 1 -> 2 dead-end after returning from Step 2 back to Step 1.
              */
              const canJumpToStep2 = s.num === 2 && step === 1 && !!pipelineId && scripts.length > 0;
              const canJumpToStep3 = s.num === 3 && step === 2 && Object.keys(previews).length > 0;
              const canJumpToStep4 = s.num === 4 && step === 3 && variantStatuses.length > 0;
              const isClickableForward = canJumpToStep2 || canJumpToStep3 || canJumpToStep4;

              return (
                <div key={s.num} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                        step === s.num
                          ? "bg-primary text-primary-foreground"
                          : step > s.num
                          ? "bg-green-600 text-white cursor-pointer hover:bg-green-700 transition-colors"
                          : isClickableForward
                          ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/80 transition-colors"
                          : "bg-secondary text-muted-foreground"
                      }`}
                      onClick={() => {
                        // BUG-FE-31: Step navigation rules:
                        // 1. Backward navigation: always allowed (click any completed step)
                        if (step > s.num) {
                          setStep(s.num);
                          setPreviewError(null);
                        }
                        // 2. Forward to Step 2: allowed from Step 1 when scripts already exist
                        if (canJumpToStep2) {
                          setStep(2);
                          setPreviewError(null);
                        }
                        // 3. Forward to Step 3: only from Step 2 when previews have been generated
                        if (canJumpToStep3) {
                          setStep(3);
                          setPreviewError(null);
                        }
                        // 4. Forward to Step 4: only from Step 3 when rendering has been initiated
                        if (canJumpToStep4) {
                          setStep(4);
                          setPreviewError(null);
                        }
                      }}
                    >
                      {step > s.num ? <CheckCircle className="h-5 w-5" /> : s.num}
                    </div>
                    <p
                      className={`text-xs mt-2 ${
                        step === s.num ? "font-semibold" : "text-muted-foreground"
                      }`}
                    >
                      {s.label}
                    </p>
                  </div>
                  {index < 3 && (
                    <div
                      className={`flex-1 h-1 mx-2 ${
                        step > s.num ? "bg-green-600" : "bg-secondary"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* New Pipeline button — visible on steps 2-4 */}
          {step > 1 && (
            <div className="flex justify-end mt-3">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (isRendering) {
                    setConfirmDialog({
                      open: true,
                      title: "Render in progress",
                      description: "A render is in progress. Are you sure you want to start a new pipeline?",
                      confirmLabel: "Start new pipeline",
                      variant: "destructive",
                      onConfirm: () => {
                        setConfirmDialog((prev) => ({ ...prev, open: false }));
                        handleCancelRender();
                        resetPipeline();
                      },
                    });
                  } else {
                    resetPipeline();
                  }
                }}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Start New Pipeline
              </Button>
            </div>
          )}
        </div>

        {/* Main content + History sidebar */}
        <div className="flex gap-6">
        <div className="flex-1 min-w-0">

        {/* Step 1 — Idea Input */}
        {step === 1 && (
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Video Idea</CardTitle>
                <CardDescription>
                  Describe your video idea and configure generation options
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* AI Rules (collapsible) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 -ml-2"
                      onClick={() => setAiRulesExpanded(!aiRulesExpanded)}
                    >
                      {aiRulesExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 mr-1" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      <BookOpen className="h-3.5 w-3.5 mr-1" />
                      AI Rules
                    </Button>
                    {aiInstructions.trim() && !aiRulesExpanded && (
                      <Badge variant="secondary" className="text-xs">
                        {aiInstructions.trim().length} chars
                      </Badge>
                    )}
                    {aiRulesSaved && (
                      <span className="text-xs text-green-500 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Saved
                      </span>
                    )}
                  </div>
                  {aiRulesExpanded && (
                    <div className="space-y-2">
                      <Textarea
                        id="ai-instructions"
                        placeholder="Persistent rules for AI script generation (tone, style, phrases, formatting)..."
                        rows={4}
                        value={aiInstructions}
                        onChange={(e) => {
                          setAiInstructions(e.target.value);
                          setAiRulesDirty(true);
                        }}
                        className="resize-y text-sm [field-sizing:fixed]"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant={aiRulesDirty ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => saveAiInstructions(aiInstructions, true)}
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Save & Close
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Script set name */}
                <div className="space-y-2">
                  <Label htmlFor="pipeline-name">Script Set Name</Label>
                  <DebouncedInput
                    id="pipeline-name"
                    placeholder="e.g. Nike Air Max Campaign, Summer Sale Promo..."
                    value={pipelineName}
                    onCommit={setPipelineName}
                    maxLength={200}
                  />
                </div>

                {/* Idea textarea */}
                <div className="space-y-2">
                  <Label htmlFor="idea">Video Idea *</Label>
                  <DebouncedTextarea
                    id="idea"
                    placeholder="Describe your video idea..."
                    rows={5}
                    value={idea}
                    onCommit={setIdea}
                    className="resize-y [field-sizing:fixed]"
                  />
                </div>

                {/* Context textarea (collapsible) */}
                <div className="space-y-2">
                  {/* Header row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label htmlFor="context" className="mr-auto">Context (Optional)</Label>
                    {contextProductCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {contextProductCount} {contextProductCount === 1 ? "product" : "products"}
                      </Badge>
                    )}
                    {context.trim() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setContextExpanded(!contextExpanded)}
                      >
                        {contextExpanded ? (
                          <><ChevronUp className="h-3.5 w-3.5 mr-1" />Collapse</>
                        ) : (
                          <><ChevronDown className="h-3.5 w-3.5 mr-1" />Expand</>
                        )}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={handleOpenCatalog}
                    >
                      <BookOpen className="h-3.5 w-3.5 mr-1" />
                      {catalogOpen ? "Close Catalog" : "Add from Catalog"}
                    </Button>
                  </div>

                  {/* Product chips — always visible */}
                  {contextProducts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {contextProducts.map((product, idx) => (
                        <span
                          key={idx}
                          title={product.description}
                          className="inline-flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 rounded-full px-2.5 py-1 text-xs font-medium max-w-[200px]"
                        >
                          <span className="truncate">{product.title}</span>
                          <button
                            type="button"
                            onClick={() => setContextProducts(prev => prev.filter((_, i) => i !== idx))}
                            className="flex-shrink-0 hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Expanded: textarea for manual text */}
                  {contextExpanded && (
                    <DebouncedTextarea
                      id="context"
                      placeholder="Additional context (brand info, instructions)..."
                      rows={3}
                      value={context}
                      onCommit={setContext}
                      className="resize-none max-h-[200px] overflow-y-auto [field-sizing:fixed]"
                    />
                  )}

                  {/* Catalog Picker */}
                  {catalogOpen && (
                    <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
                      {/* Filters row */}
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search by name or SKU..."
                            value={catalogSearch}
                            onChange={(e) => handleCatalogSearchChange(e.target.value)}
                            className="pl-9 h-9"
                          />
                        </div>
                        <Select value={catalogBrand} onValueChange={(v) => handleCatalogFilterChange("brand", v)}>
                          <SelectTrigger className="w-[140px] h-9">
                            <SelectValue placeholder="Brand" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Brands</SelectItem>
                            {catalogFilters.brands.map((b) => (
                              <SelectItem key={b} value={b}>{b}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={catalogCategory} onValueChange={(v) => handleCatalogFilterChange("category", v)}>
                          <SelectTrigger className="w-[140px] h-9">
                            <SelectValue placeholder="Category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            {catalogFilters.categories.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Products grid */}
                      {catalogLoading ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : catalogProducts.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No products found</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-1.5 max-h-[300px] overflow-y-auto">
                          {catalogProducts.map((product) => (
                            <div
                              key={product.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleCatalogProduct(product.id)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCatalogProduct(product.id); } }}
                              className={`flex items-center gap-3 p-2 rounded-md border text-left transition-colors hover:bg-accent cursor-pointer ${
                                selectedCatalogIds.has(product.id) ? "border-primary bg-primary/5" : "border-border"
                              }`}
                            >
                              <Checkbox
                                checked={selectedCatalogIds.has(product.id)}
                                onCheckedChange={() => toggleCatalogProduct(product.id)}
                                className="flex-shrink-0"
                              />
                              {product.image_link && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={product.image_link}
                                  alt=""
                                  className="w-10 h-10 object-cover rounded flex-shrink-0"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{product.title}</p>
                                <div className="flex items-center gap-2">
                                  {product.brand && <span className="text-xs text-muted-foreground">{product.brand}</span>}
                                  {product.sku && <span className="text-xs text-muted-foreground font-mono">{product.sku}</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Pagination + action footer */}
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={catalogPage <= 1}
                            onClick={() => handleCatalogPageChange(catalogPage - 1)}
                          >
                            <ArrowLeft className="h-3 w-3" />
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            Page {catalogPagination.page} of {catalogPagination.total_pages} ({catalogPagination.total} products)
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={catalogPage >= catalogPagination.total_pages}
                            onClick={() => handleCatalogPageChange(catalogPage + 1)}
                          >
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </div>
                        {selectedCatalogIds.size > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">
                              {selectedCatalogIds.size} selected
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleAddToContext}
                            >
                              Add to Context
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Configuration row */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Variant count */}
                  <div className="space-y-2">
                    <Label htmlFor="variant-count">Variants</Label>
                    <Select
                      value={variantCount.toString()}
                      onValueChange={(val) => setVariantCount(parseInt(val))}
                    >
                      <SelectTrigger id="variant-count">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <SelectItem key={n} value={n.toString()}>
                            {n} {n === 1 ? "variant" : "variants"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Script Duration */}
                  <div className="space-y-2">
                    <Label>Duration (sec)</Label>
                    <div className="flex items-center gap-2">
                       <Slider
                         value={[targetScriptDuration]}
                         onValueChange={([v]) => setTargetScriptDuration(v)}
                         min={10}
                         max={120}
                         step={1}
                         className="flex-1"
                       />
                       <Input
                         type="number"
                         min={5}
                         max={300}
                         step={1}
                         value={targetScriptDuration}
                         onChange={(e) => {
                           const v = parseInt(e.target.value);
                           if (!isNaN(v) && v >= 5 && v <= 300) setTargetScriptDuration(v);
                         }}
                        className="w-16 h-8 text-center text-sm px-1"
                      />
                    </div>
                  </div>

                  {/* AI Provider */}
                  <div className="space-y-2">
                    <Label htmlFor="provider">AI Provider</Label>
                    <Select value={provider} onValueChange={setProvider}>
                      <SelectTrigger id="provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemini">Gemini 2.5 Flash</SelectItem>
                        <SelectItem value="claude">Claude Sonnet 4</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Error display */}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Segment duration info */}
                {totalSegmentDuration > 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Info className="h-4 w-4" />
                    <span>{Math.round(totalSegmentDuration)}s material video disponibil (brut)</span>
                  </div>
                )}

                {/* Generate button */}
                {isGenerating ? (
                  <div className="flex gap-2 w-full">
                    <Button
                      disabled
                      className="flex-1"
                      size="lg"
                    >
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </Button>
                    <Button
                      variant="destructive"
                      size="lg"
                      onClick={handleCancelGenerate}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Stop
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={handleGenerate}
                    disabled={!idea.trim()}
                    className="w-full"
                    size="lg"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Scripts
                  </Button>
                )}
              </CardContent>
            </Card>

          </div>
        )}

        {/* Step 2 — Review Scripts */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Review Scripts ({scripts.length})</h2>
              <div className="flex items-center gap-2">
                {regeneratingAllScripts ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleCancelRegenerateAllScripts}
                  >
                    <X className="h-3.5 w-3.5 mr-1.5" />
                    Stop Scripts ({(regeneratingAllScriptsIndex ?? 0) + 1}/{scripts.length})
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateAllScripts}
                    disabled={scripts.length === 0 || regeneratingAll || Object.values(regeneratingScript).some(Boolean)}
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />Regenerate All Scripts
                  </Button>
                )}
                {regeneratingAll ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleCancelRegenerateAll}
                  >
                    <X className="h-3.5 w-3.5 mr-1.5" />
                    Stop ({(regeneratingAllIndex ?? 0) + 1}/{scripts.length})
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateAllTts}
                    disabled={scripts.length === 0 || Object.values(ttsResults).some(r => r.generating)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Regenerate All Voice-overs
                  </Button>
                )}
                <Button variant="outline" onClick={() => { setStep(1); setPreviewError(null); }}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Input
                </Button>
              </div>
            </div>

            {/* ElevenLabs model selector */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">TTS Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tts-model">ElevenLabs Model</Label>
                  <Select value={elevenlabsModel} onValueChange={setElevenlabsModel}>
                    <SelectTrigger id="tts-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eleven_flash_v2_5">
                        Flash v2.5 (Fastest, 32 langs)
                      </SelectItem>
                      <SelectItem value="eleven_turbo_v2_5">
                        Turbo v2.5 (Balanced)
                      </SelectItem>
                      <SelectItem value="eleven_multilingual_v2">
                        Multilingual v2 (Best quality)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tts-voice">Voice</Label>
                  <div className="flex gap-2">
                    <Select value={voiceId} onValueChange={setVoiceId}>
                      <SelectTrigger id="tts-voice" disabled={voicesLoading} className="flex-1">
                        <SelectValue placeholder={voicesLoading ? "Loading voices..." : "Select a voice"} />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const custom = voices.filter(v => v.category && v.category !== "premade");
                          const premade = voices.filter(v => !v.category || v.category === "premade");
                          return (
                            <>
                              {custom.length > 0 && (
                                <>
                                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">My Voices</div>
                                  {custom.map((voice) => (
                                    <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                      {voice.name}{voice.language ? ` (${voice.language})` : ""}{voice.voice_id === defaultVoiceId ? " \u2605" : ""}
                                    </SelectItem>
                                  ))}
                                </>
                              )}
                              {premade.length > 0 && (
                                <>
                                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Library</div>
                                  {premade.map((voice) => (
                                    <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                      {voice.name}{voice.language ? ` (${voice.language})` : ""}{voice.voice_id === defaultVoiceId ? " \u2605" : ""}
                                    </SelectItem>
                                  ))}
                                </>
                              )}
                            </>
                          );
                        })()}
                      </SelectContent>
                    </Select>
                    <Button
                      variant={voiceId === defaultVoiceId ? "outline" : "secondary"}
                      size="icon"
                      onClick={handleSetDefaultVoice}
                      disabled={!voiceId || voiceId === "default" || voiceId === defaultVoiceId || savingDefault}
                      title={voiceId === defaultVoiceId ? "This is your default voice" : "Set as default voice"}
                    >
                      {savingDefault ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Star className={`h-4 w-4 ${voiceId === defaultVoiceId ? "fill-yellow-400 text-yellow-400" : ""}`} />
                      )}
                    </Button>
                  </div>
                  {defaultVoiceId && (
                    <p className="text-xs text-muted-foreground">
                      Default: {voices.find(v => v.voice_id === defaultVoiceId)?.name || "Saved voice"}
                    </p>
                  )}
                </div>

                {/* Voice Settings */}
                <div className="border-t pt-4 space-y-4">
                  <p className="text-sm font-medium">Voice Settings</p>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Speed</Label>
                      <span className="text-xs text-muted-foreground">{voiceSpeed.toFixed(2)}x</span>
                    </div>
                    <Slider
                      value={[voiceSpeed]}
                      onValueChange={([v]) => setVoiceSpeed(v)}
                      min={0.7} max={1.2} step={0.01}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0.7x</span>
                      <span>1.2x</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Stability</Label>
                      <span className="text-xs text-muted-foreground">{Math.round(voiceStability * 100)}%</span>
                    </div>
                    <Slider
                      value={[voiceStability]}
                      onValueChange={([v]) => setVoiceStability(v)}
                      min={0} max={1} step={0.01}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0%</span>
                      <span>100%</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Similarity</Label>
                      <span className="text-xs text-muted-foreground">{Math.round(voiceSimilarity * 100)}%</span>
                    </div>
                    <Slider
                      value={[voiceSimilarity]}
                      onValueChange={([v]) => setVoiceSimilarity(v)}
                      min={0} max={1} step={0.01}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0%</span>
                      <span>100%</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Style Exaggeration</Label>
                      <span className="text-xs text-muted-foreground">{Math.round(voiceStyle * 100)}%</span>
                    </div>
                    <Slider
                      value={[voiceStyle]}
                      onValueChange={([v]) => setVoiceStyle(v)}
                      min={0} max={1} step={0.01}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0%</span>
                      <span>100%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">High values increase latency</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="speaker-boost"
                      checked={voiceSpeakerBoost}
                      onCheckedChange={(checked) => setVoiceSpeakerBoost(checked === true)}
                    />
                    <Label htmlFor="speaker-boost" className="text-xs">
                      Speaker Boost
                    </Label>
                    <span className="text-[10px] text-muted-foreground">Enhances voice clarity</span>
                  </div>

                  <div className="border-t pt-3 space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Words per subtitle</Label>
                      <span className="text-xs text-muted-foreground">{wordsPerSubtitle}</span>
                    </div>
                    <Slider
                      value={[wordsPerSubtitle]}
                      onValueChange={([v]) => setWordsPerSubtitle(v)}
                      min={1} max={4} step={1}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>1</span>
                      <span>4</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Fewer words = more dynamic subtitles (TikTok style)</p>
                  </div>

                  <div className="border-t pt-3 space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Minimum segment duration (sec)</Label>
                      <span className="text-xs text-muted-foreground">{minSegmentDuration}s</span>
                    </div>
                    <Slider
                      value={[minSegmentDuration]}
                      onValueChange={([v]) => setMinSegmentDuration(v)}
                      min={0.5} max={5} step={0.5}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0.5s</span>
                      <span>5s</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Video segments won&apos;t change faster than this duration</p>
                  </div>

                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="ultra-rapid-intro"
                        checked={ultraRapidIntro}
                        onCheckedChange={(checked) => setUltraRapidIntro(checked === true)}
                      />
                      <Label htmlFor="ultra-rapid-intro" className="text-xs cursor-pointer">
                        Ultra-fast sequences at the start
                      </Label>
                    </div>
                    {ultraRapidIntro && (
                      <p className="text-[10px] text-muted-foreground mt-1 ml-6">
                        The first ~2 seconds will contain 3-4 very short sequences (0.5s) from the best moments
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Scripts list — single column so each sentence has room */}
            <div className="grid grid-cols-1 gap-4">
              {scripts.map((script, index) => {
                const wordCount = countWords(script);
                const estimatedDuration = Math.round(wordCount / WORDS_PER_SECOND);

                return (
                  <Card key={index} className={`transition-colors ${approvedScripts.has(index) ? "border-green-500 bg-green-50/50 dark:bg-green-950/20" : ""}`}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {ttsResults[index] && !ttsResults[index].generating && !ttsResults[index].stale && (
                            <Checkbox
                              id={`approve-header-${index}`}
                              checked={approvedScripts.has(index)}
                              onCheckedChange={(checked) => {
                                const approved = checked === true;
                                setApprovedScripts(prev => {
                                  const next = new Set(prev);
                                  if (approved) next.add(index);
                                  else next.delete(index);
                                  return next;
                                });
                                if (pipelineId) {
                                  apiPatch(`/pipeline/${pipelineId}/tts-approve/${index}`, { approved }).catch(() => {});
                                }
                              }}
                              className="h-5 w-5 border-green-500 data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600"
                            />
                          )}
                          <CardTitle className="text-lg">
                            Script {index + 1}
                            {approvedScripts.has(index) && (
                              <CheckCircle className="inline-block h-4 w-4 ml-2 text-green-600" />
                            )}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {wordCount} words (~{formatDuration(estimatedDuration)})
                          </Badge>
                          <Badge variant="outline" className="text-muted-foreground">
                            {script.replace(/\[([^\[\]]+)\]/g, "").length} chars
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-muted-foreground hover:text-primary"
                            title="Regenerate this script with AI"
                            onClick={() => handleRegenerateScript(index)}
                            disabled={regeneratingScript[index] || regeneratingAllScripts}
                          >
                            {regeneratingScript[index] ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5 mr-1" />
                            )}
                            {regeneratingScript[index] ? "Regenerating..." : "Regenerate"}
                          </Button>
                          {scripts.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Delete script"
                              onClick={() => {
                                const newScripts = scripts.filter((_, i) => i !== index);
                                setScripts(newScripts);
                                if (pipelineId) saveScriptsToBackend(pipelineId, newScripts);
                                // Remap ttsResults: remove deleted index, shift higher indices down
                                setTtsResults(prev => {
                                  const next: typeof prev = {};
                                  for (const [k, v] of Object.entries(prev)) {
                                    const ki = Number(k);
                                    if (ki < index) next[ki] = v;
                                    else if (ki > index) next[ki - 1] = v;
                                    // ki === index is dropped
                                  }
                                  return next;
                                });
                                // Remap libraryMatches: remove deleted index, shift higher indices down
                                setLibraryMatches(prev => {
                                  const next: typeof prev = {};
                                  for (const [k, v] of Object.entries(prev)) {
                                    const ki = Number(k);
                                    if (ki < index) next[ki] = v;
                                    else if (ki > index) next[ki - 1] = v;
                                  }
                                  return next;
                                });
                                // Remap previews: remove deleted index, shift higher indices down
                                setPreviews(prev => {
                                  const next: typeof prev = {};
                                  for (const [k, v] of Object.entries(prev)) {
                                    const ki = Number(k);
                                    if (ki < index) next[ki] = v;
                                    else if (ki > index) next[ki - 1] = v;
                                  }
                                  return next;
                                });
                                // Remap srtPreviewOpen: remove deleted index, shift higher indices down
                                setSrtPreviewOpen(prev => {
                                  const next: typeof prev = {};
                                  for (const [k, v] of Object.entries(prev)) {
                                    const ki = Number(k);
                                    if (ki < index) next[ki] = v;
                                    else if (ki > index) next[ki - 1] = v;
                                  }
                                  return next;
                                });
                                // Remap approvedScripts: remove deleted index, shift higher indices down
                                setApprovedScripts(prev => {
                                  const next = new Set<number>();
                                  for (const ki of prev) {
                                    if (ki < index) next.add(ki);
                                    else if (ki > index) next.add(ki - 1);
                                  }
                                  return next;
                                });
                                // Remap selectedVariants: remove deleted index, shift higher indices down
                                setSelectedVariants(prev => {
                                  const next = new Set<number>();
                                  for (const ki of prev) {
                                    if (ki < index) next.add(ki);
                                    else if (ki > index) next.add(ki - 1);
                                  }
                                  return next;
                                });
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    {totalSegmentDuration > 0 && estimatedDuration > totalSegmentDuration && (
                      <div className="px-6 pb-2">
                        <Alert className="border-muted-foreground/50 bg-muted/50">
                          <Info className="h-4 w-4 text-muted-foreground" />
                          <AlertDescription className="text-muted-foreground text-sm">
                            Script exceeds available video material ({Math.round(totalSegmentDuration)}s) by ~{estimatedDuration - Math.round(totalSegmentDuration)}s. Segments will be repeated to cover the difference.
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}
                    <CardContent className="space-y-3">
                      <DebouncedTextarea
                        id={`script-textarea-${index}`}
                        value={script}
                        onCommit={(nextValue) => handleScriptCommit(index, nextValue)}
                        rows={10}
                        className="resize-y font-mono text-sm [field-sizing:fixed]"
                      />

                      {/* Insert Group Tag — searchable button grid */}
                      {productGroups.length > 0 && (() => {
                        const tagStates = analyzeGroupTags(script);
                        const filtered = productGroups.filter(
                          (g) => !groupTagSearch.trim() || g.label.toLowerCase().includes(groupTagSearch.toLowerCase())
                        );
                        return (
                          <div className="space-y-1.5">
                            {productGroups.length > 4 && (
                              <div className="relative w-48">
                                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                  placeholder="Filter groups..."
                                  value={groupTagSearch}
                                  onChange={(e) => setGroupTagSearch(e.target.value)}
                                  className="h-7 pl-7 text-xs"
                                />
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {filtered.map((g) => {
                                const state = tagStates.find((t) => t.label === g.label);
                                const isOpen = state?.isOpen ?? false;
                                const isPaired = state?.isPaired ?? false;
                                return (
                                  <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => insertGroupTag(index, g.label)}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors hover:bg-accent ${
                                      isOpen
                                        ? "ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-300"
                                        : isPaired
                                        ? "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30 border-green-300"
                                        : "border-border"
                                    }`}
                                  >
                                    {g.color && (
                                      <span
                                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: g.color }}
                                      />
                                    )}
                                    {g.label}
                                    <span className="text-muted-foreground">({g.segments_count})</span>
                                    {isPaired && <CheckCircle className="h-3 w-3 text-green-600 flex-shrink-0" />}
                                    {isOpen && <span className="text-amber-600 font-bold flex-shrink-0">…</span>}
                                  </button>
                                );
                              })}
                            </div>
                            {tagStates.length > 0 && (
                              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Open</span>
                                <span className="inline-flex items-center gap-1"><CheckCircle className="h-2.5 w-2.5 text-green-600" /> Paired</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Per-script TTS controls */}
                      <div className="flex flex-wrap items-center gap-2">
                        {ttsResults[index]?.generating ? (
                          <Button variant="outline" size="sm" disabled>
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            Generating...
                          </Button>
                        ) : ttsResults[index] && !ttsResults[index].stale ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePlayTts(index)}
                            >
                              {playingTtsVariant === index ? (
                                <><Pause className="h-3.5 w-3.5 mr-1.5" />Pause</>
                              ) : (
                                <><Play className="h-3.5 w-3.5 mr-1.5" />Play</>
                              )}
                            </Button>
                            {playingTtsVariant === index && ttsAudioDuration > 0 && (
                              <div
                                className="relative h-5 flex-1 min-w-[100px] max-w-[200px] cursor-pointer group select-none"
                                onMouseDown={(e) => {
                                  const bar = e.currentTarget;
                                  const seek = (clientX: number) => {
                                    const rect = bar.getBoundingClientRect();
                                    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                                    setTtsAudioProgress(pct * ttsAudioDuration);
                                    if (ttsAudioRef.current) ttsAudioRef.current.currentTime = pct * ttsAudioDuration;
                                  };
                                  ttsSeekingRef.current = true;
                                  seek(e.clientX);
                                  const onMove = (ev: MouseEvent) => seek(ev.clientX);
                                  const onUp = () => {
                                    ttsSeekingRef.current = false;
                                    document.removeEventListener('mousemove', onMove);
                                    document.removeEventListener('mouseup', onUp);
                                  };
                                  document.addEventListener('mousemove', onMove);
                                  document.addEventListener('mouseup', onUp);
                                }}
                              >
                                <div className="absolute top-1/2 -translate-y-1/2 w-full h-1 rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary"
                                    style={{ width: `${(ttsAudioProgress / ttsAudioDuration) * 100}%` }}
                                  />
                                </div>
                                <div
                                  className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary shadow-sm border-2 border-background"
                                  style={{ left: `calc(${(ttsAudioProgress / ttsAudioDuration) * 100}% - 6px)` }}
                                />
                                <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                  {Math.floor(ttsAudioProgress / 60)}:{String(Math.floor(ttsAudioProgress % 60)).padStart(2, '0')} / {Math.floor(ttsAudioDuration / 60)}:{String(Math.floor(ttsAudioDuration % 60)).padStart(2, '0')}
                                </span>
                              </div>
                            )}
                            <Badge variant="secondary" className="text-xs">
                              {formatDuration(ttsResults[index].audio_duration)}
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleGenerateTts(index)}
                              title="Regenerate voice-over with current settings"
                            >
                              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                              Regenerate
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleGenerateTts(index)}
                          >
                            <Volume2 className="h-3.5 w-3.5 mr-1.5" />
                            {ttsResults[index]?.stale ? "Regenerate Voice-over" : "Generate Voice-over"}
                          </Button>
                        )}
                        {ttsResults[index]?.stale && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            Script changed — audio outdated
                          </Badge>
                        )}
                        {libraryMatches[index] && !ttsResults[index] && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs text-muted-foreground border-muted-foreground/30 hover:bg-muted"
                            onClick={() => handleUseLibraryTts(index)}
                          >
                            <Library className="h-3.5 w-3.5 mr-1.5" />
                            Use Library Audio ({formatDuration(libraryMatches[index].audio_duration)})
                          </Button>
                        )}
                        {ttsResults[index] && !ttsResults[index].generating && !ttsResults[index].stale && (
                          <div className="ml-auto flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-2.5 py-1 dark:border-green-900 dark:bg-green-950/30">
                            <Checkbox
                              id={`approve-script-${index}`}
                              checked={approvedScripts.has(index)}
                              onCheckedChange={(checked) => {
                                const approved = checked === true;
                                setApprovedScripts(prev => {
                                  const next = new Set(prev);
                                  if (approved) next.add(index);
                                  else next.delete(index);
                                  return next;
                                });
                                if (pipelineId) {
                                  apiPatch(`/pipeline/${pipelineId}/tts-approve/${index}`, { approved }).catch(() => {});
                                }
                              }}
                              className="h-4.5 w-4.5 border-green-500 data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600"
                            />
                            <Label
                              htmlFor={`approve-script-${index}`}
                              className="cursor-pointer text-xs font-medium text-green-700 dark:text-green-300"
                            >
                              Approve voice-over
                            </Label>
                          </div>
                        )}
                      </div>

                      {/* SRT Subtitle Preview */}
                      {ttsResults[index]?.srt_content && !ttsResults[index]?.generating && !ttsResults[index]?.stale && (
                        <div className="mt-2">
                          <button
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setSrtPreviewOpen(prev => ({ ...prev, [index]: !prev[index] }))}
                          >
                            {srtPreviewOpen[index] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            Subtitle Preview
                            <span className="text-muted-foreground">
                              — Script: {ttsResults[index].script_word_count} words | SRT: {ttsResults[index].srt_word_count} words
                            </span>
                            {ttsResults[index].script_word_count != null && ttsResults[index].srt_word_count != null && ttsResults[index].script_word_count! > ttsResults[index].srt_word_count! && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                {ttsResults[index].script_word_count! - ttsResults[index].srt_word_count!} words missing
                              </Badge>
                            )}
                          </button>
                          {srtPreviewOpen[index] && (
                            <pre className="mt-1.5 p-2 bg-muted/50 rounded text-[11px] font-mono max-h-48 overflow-y-auto whitespace-pre-wrap border">
                              {ttsResults[index].srt_content}
                            </pre>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Source Video Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Film className="h-4 w-4" />
                      Source Videos
                    </CardTitle>
                    <CardDescription>
                      {sourceVideos.length <= 1
                        ? "Source video for segment matching"
                        : `Select which videos to match segments from (${selectedSourceIds.size} of ${sourceVideos.length} selected)`}
                    </CardDescription>
                  </div>
                  {sourceVideos.length > 1 && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDeselectAllSources}
                        disabled={selectedSourceIds.size === 0}
                      >
                        Deselect All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSelectAllSources}
                        disabled={selectedSourceIds.size === sourceVideos.length}
                      >
                        Select All
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {sourceVideosLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading source videos...
                  </div>
                ) : sourceVideos.length === 0 ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      No source videos uploaded yet. Go to the Segments page to add source videos before previewing.
                    </AlertDescription>
                  </Alert>
                ) : sourceVideos.length === 1 ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                    {sourceVideos[0].thumbnail_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${API_URL}/segments/files/${encodeURIComponent(sourceVideos[0].thumbnail_path?.split('/').pop() || 'placeholder.png')}`}
                        alt=""
                        className="w-10 h-10 rounded object-cover flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                        <Film className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{sourceVideos[0].name}</p>
                    </div>
                    {sourceVideos[0].duration && (
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        <Clock className="h-3 w-3 mr-1" />
                        {formatDuration(sourceVideos[0].duration)}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      {sourceVideos[0].segments_count} segments
                    </Badge>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {sourceVideos.length > 3 && (
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search videos by name..."
                            value={sourceVideoSearch}
                            onChange={(e) => setSourceVideoSearch(e.target.value)}
                            className="pl-9 pr-9"
                          />
                          {sourceVideoSearch && (
                            <button
                              onClick={() => setSourceVideoSearch("")}
                              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                      <div className="flex items-center border rounded-md">
                        <button
                          onClick={() => setSourceVideoViewMode("list")}
                          className={`p-2 transition-colors ${sourceVideoViewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          title="List view"
                        >
                          <List className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setSourceVideoViewMode("grid")}
                          className={`p-2 transition-colors ${sourceVideoViewMode === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          title="Grid view"
                        >
                          <LayoutGrid className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto pr-1">
                      {sourceVideoViewMode === "list" ? (
                        <div className="space-y-2">
                          {sourceVideos
                            .filter(video => !sourceVideoSearch.trim() || video.name.toLowerCase().includes(sourceVideoSearch.toLowerCase()))
                            .map(video => (
                            <div
                              key={video.id}
                              className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                                selectedSourceIds.has(video.id)
                                  ? "bg-primary/5 border-primary/30"
                                  : "hover:bg-muted/50"
                              }`}
                              onClick={() => handleSourceToggle(video.id)}
                            >
                              <Checkbox
                                checked={selectedSourceIds.has(video.id)}
                                onCheckedChange={() => handleSourceToggle(video.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              {video.thumbnail_path ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={`${API_URL}/segments/files/${encodeURIComponent(video.thumbnail_path?.split('/').pop() || 'placeholder.png')}`}
                                  alt=""
                                  className="w-10 h-10 rounded object-cover flex-shrink-0"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : (
                                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                                  <Film className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{video.name}</p>
                              </div>
                              {video.duration && (
                                <Badge variant="outline" className="text-xs flex-shrink-0">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {formatDuration(video.duration)}
                                </Badge>
                              )}
                              <Badge variant="secondary" className="text-xs flex-shrink-0">
                                {video.segments_count} segments
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2">
                          {sourceVideos
                            .filter(video => !sourceVideoSearch.trim() || video.name.toLowerCase().includes(sourceVideoSearch.toLowerCase()))
                            .map(video => (
                            <div
                              key={video.id}
                              className={`relative p-2 rounded-lg border cursor-pointer transition-colors ${
                                selectedSourceIds.has(video.id)
                                  ? "bg-primary/5 border-primary/30"
                                  : "hover:bg-muted/50"
                              }`}
                              onClick={() => handleSourceToggle(video.id)}
                            >
                              <div className="absolute top-1 left-1 z-10">
                                <Checkbox
                                  checked={selectedSourceIds.has(video.id)}
                                  onCheckedChange={() => handleSourceToggle(video.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="bg-background/80"
                                />
                              </div>
                              <div className="aspect-video rounded overflow-hidden bg-muted mb-1.5">
                                {video.thumbnail_path ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={`${API_URL}/segments/files/${encodeURIComponent(video.thumbnail_path?.split('/').pop() || 'placeholder.png')}`}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).src = ""; (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Film className="h-6 w-6 text-muted-foreground" />
                                  </div>
                                )}
                              </div>
                              <p className="text-xs font-medium truncate">{video.name}</p>
                              <div className="flex items-center gap-1 mt-1">
                                {video.duration && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    {formatDuration(video.duration)}
                                  </Badge>
                                )}
                                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                  {video.segments_count} seg
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground pt-2 border-t">
                      Total segments available: {sourceVideos.filter(v => selectedSourceIds.has(v.id)).reduce((sum, v) => sum + v.segments_count, 0)}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {/* Existing TTS banner */}
            {(() => {
              const ttsCount = Object.values(ttsResults).filter(r => !r.generating && !r.stale).length;
              if (ttsCount === 0) return null;
              return (
                <Alert className="border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-green-800 dark:text-green-300">
                      {ttsCount === scripts.length
                        ? "All scripts have voice-over generated"
                        : `${ttsCount} of ${scripts.length} scripts have voice-over. The remaining ${scripts.length - ttsCount} will be generated automatically.`}
                    </span>
                    {selectedSourceIds.size === 0 && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        Select a video clip with segments above ↑
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              );
            })()}

            {/* Reset segment diversity + Preview All button */}
            {(() => {
              const readyTtsCount = Object.values(ttsResults).filter(r => !r.generating && !r.stale).length;
              const allTtsReady = readyTtsCount === scripts.length && scripts.length > 0;
              const previewTargetCount = allTtsReady ? previewCards.length : scripts.length;
              return (
                <div className="space-y-2">
                  <div className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="meta-multiplication-step2"
                        checked={metaMultiplication}
                        onCheckedChange={(checked) => void handleMetaMultiplicationChange(checked === true)}
                      />
                      <Label htmlFor="meta-multiplication-step2" className="text-sm cursor-pointer font-medium">
                        Meta Multiplication before preview
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      {metaMultiplication
                        ? `Preview-ul va genera ${previewCards.length} variante (${scripts.length} scripturi × 2 versiuni Meta).`
                        : "Activează dacă vrei să vezi separat preview-urile Instagram și Facebook înainte de render."}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground hover:text-foreground"
                    disabled={isGenerating || previewingIndex !== null || isRendering || isResettingUsage}
                    onClick={async () => {
                      if (!confirm("Resetezi diversitatea segmentelor? Următoarele preview-uri vor putea reutiliza toate segmentele.")) return;
                      setIsResettingUsage(true);
                      try {
                        const filterIds = selectedSourceIds.size > 0 ? Array.from(selectedSourceIds) : undefined;
                        if (filterIds && filterIds.length > 0) {
                          for (const svId of filterIds) {
                            await apiPost("/segments/reset-usage", { source_video_id: svId });
                          }
                        } else {
                          await apiPost("/segments/reset-usage", {});
                        }
                        toast.success("Diversitatea segmentelor a fost resetată");
                      } catch (err) {
                        handleApiError(err, "Eroare la resetarea diversității");
                      } finally {
                        setIsResettingUsage(false);
                      }
                    }}
                  >
                    {isResettingUsage ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {isResettingUsage ? "Se resetează..." : "Resetează diversitatea segmentelor"}
                  </Button>
                  <Button
                    onClick={handlePreviewAll}
                    disabled={isGenerating || previewingIndex !== null || isRendering || sourceVideos.length === 0 || selectedSourceIds.size === 0}
                    className="w-full"
                    size="lg"
                  >
                    {/* BUG-FE-35: Counter is safe — previewingIndex is only non-null during batched generation when scripts.length > 0 */}
                    {previewingIndex !== null ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {allTtsReady
                          ? `Generating preview ${previewingIndex + 1} of ${previewTargetCount}...`
                          : `Generating voice-over ${previewingIndex + 1} of ${previewTargetCount}...`}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        {allTtsReady ? "Generate Previews" : "Generate Voice-Overs"}
                      </>
                    )}
                  </Button>
                </div>
              );
            })()}
            {/* Approval status */}
            {scripts.length > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className={`font-medium ${approvedScripts.size === scripts.length ? "text-green-600" : "text-muted-foreground"}`}>
                  {approvedScripts.size === 0
                    ? "No scripts approved yet — listen and check the ones you like"
                    : approvedScripts.size === scripts.length
                    ? `All ${scripts.length} scripts approved`
                    : `${approvedScripts.size} of ${scripts.length} scripts approved`}
                </span>
                {approvedScripts.size > 0 && approvedScripts.size < scripts.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setApprovedScripts(new Set(scripts.map((_, i) => i)))}
                  >
                    Approve all
                  </Button>
                )}
              </div>
            )}
            {Object.keys(previews).length > 0 && (
              <Button
                variant="outline"
                onClick={() => { setStep(3); setPreviewError(null); }}
                className="w-full"
                size="lg"
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                Continue to Preview (already generated)
              </Button>
            )}
            {sourceVideos.length > 0 && selectedSourceIds.size === 0 && (
              <p className="text-xs text-destructive text-center">Select at least one source video above</p>
            )}
          </div>
        )}

        {/* Step 3 — Preview & Select */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">
                Preview & Select Variants ({previewCards.filter(card => selectedVariants.has(card.baseIndex)).length} previews shown)
              </h2>
              <Button variant="outline" onClick={() => { setStep(2); setPreviewError(null); }}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Scripts
              </Button>
            </div>

            {/* Preset selector */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Render Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="preset">Export Preset</Label>
                  <Select value={presetName} onValueChange={setPresetName}>
                    <SelectTrigger id="preset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TikTok">TikTok (1080x1920)</SelectItem>
                      <SelectItem value="Instagram Reels">
                        Instagram Reels (1080x1920)
                      </SelectItem>
                      <SelectItem value="YouTube Shorts">
                        YouTube Shorts (1080x1920)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Subtitle Style — per-Meta-version editor.
                Meta OFF: one panel, one preview, no tabs.
                Meta ON:  two tabs (A/B), two always-on previews, one active settings panel. */}
            <Card className={!subtitleSettingsLoaded ? "opacity-60 pointer-events-none" : ""}>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Type className="h-4 w-4" />
                  Subtitle Style
                  {!subtitleSettingsLoaded && <Loader2 className="h-3 w-3 animate-spin" />}
                </CardTitle>
                <CardDescription>
                  {metaMultiplication
                    ? "Pick A or B — each Meta version has its own style, shared across all scripts. Both live previews stay visible so you can compare A and B as you edit."
                    : "Customize subtitles once — the style applies to every variant in this pipeline."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Tabs appear ONLY when Meta Multiplication is ON. */}
                {metaMultiplication && (
                  <Tabs
                    value={activeStyleKey}
                    onValueChange={(value) => setActiveStyleKey(value as StyleKey)}
                  >
                    <TabsList className="flex gap-1 h-auto">
                      {(["A", "B"] as const).map((sk) => {
                        const override = subtitleOverrides[sk];
                        const hasOverride = !!override && Object.keys(override).length > 0;
                        return (
                          <TabsTrigger
                            key={sk}
                            value={sk}
                            className="text-xs gap-1.5"
                          >
                            <span className="font-semibold">{sk}</span>
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                              {sk === "A" ? "Instagram" : "Facebook"}
                            </Badge>
                            {hasOverride ? (
                              <Badge variant="secondary" className="h-4 px-1 text-[9px]">custom</Badge>
                            ) : (
                              <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground">default</Badge>
                            )}
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </Tabs>
                )}

                {/* Auxiliary controls for the active tab */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Copy from the other Meta version (only when Meta ON) */}
                  {metaMultiplication && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        const source: StyleKey = activeStyleKey === "A" ? "B" : "A";
                        handleCopyVariantSubtitle(source, activeStyleKey);
                      }}
                    >
                      Copy from {activeStyleKey === "A" ? "B" : "A"}
                    </Button>
                  )}

                  {/* Reset to default — only meaningful when override exists */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!activeStyleHasOverride}
                    onClick={() => handleResetVariantSubtitle(activeStyleKey)}
                  >
                    Reset to default
                  </Button>

                  {/* Save current as named preset */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setSavePresetDialogOpen(true)}
                  >
                    Save as preset
                  </Button>

                  {/* Apply existing preset */}
                  {userSubtitlePresets.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 text-xs">
                          Apply preset…
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
                        {userSubtitlePresets.map(preset => (
                          <DropdownMenuItem
                            key={preset.id}
                            onClick={() => handleVariantSubtitleChange(activeStyleKey, preset.settings)}
                          >
                            {preset.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  {/* Status hint */}
                  <span className="text-xs text-muted-foreground ml-auto">
                    Editing:{" "}
                    <span className="font-medium text-foreground">
                      {activeStyleKey === "default"
                        ? "all variants"
                        : `${activeStyleKey} (${activeStyleKey === "A" ? "Instagram" : "Facebook"})`}
                    </span>
                  </span>
                </div>

                {/* Preview + settings layout.
                    Meta OFF: single "default" preview + settings panel.
                    Meta ON:  two always-on previews (A and B) + settings panel for the active tab. */}
                <div className="flex gap-4 items-start flex-wrap">
                  {metaMultiplication ? (
                    <>
                      <SubtitleStylePreviewPanel
                        styleKey="A"
                        settings={getSubtitleSettingsFor("A")}
                        hasOverride={
                          !!subtitleOverrides.A && Object.keys(subtitleOverrides.A).length > 0
                        }
                        pipelineId={pipelineId ?? undefined}
                        previewCards={previewCards}
                        isActive={activeStyleKey === "A"}
                      />
                      <SubtitleStylePreviewPanel
                        styleKey="B"
                        settings={getSubtitleSettingsFor("B")}
                        hasOverride={
                          !!subtitleOverrides.B && Object.keys(subtitleOverrides.B).length > 0
                        }
                        pipelineId={pipelineId ?? undefined}
                        previewCards={previewCards}
                        isActive={activeStyleKey === "B"}
                      />
                    </>
                  ) : (
                    <SubtitleStylePreviewPanel
                      styleKey="default"
                      settings={getSubtitleSettingsFor("default")}
                      hasOverride={activeStyleHasOverride}
                      pipelineId={pipelineId ?? undefined}
                      previewCards={previewCards}
                      isActive={true}
                    />
                  )}

                  {/* Active-tab settings panel (no preview — previews are rendered above) */}
                  <div className="flex-1 min-w-[320px]">
                    <SubtitleEditor
                      renderMode="settings-only"
                      settings={getSubtitleSettingsFor(activeStyleKey)}
                      onSettingsChange={(newSettings) =>
                        handleVariantSubtitleChange(activeStyleKey, newSettings)
                      }
                      showPreview={false}
                      compact={false}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Variant preview grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {previewCards.map((card) => {
                const preview = previews[card.key];
                if (!preview) return null;

                return (
                  <Card key={card.key} className="overflow-hidden">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedVariants.has(card.baseIndex)}
                            onCheckedChange={() => toggleVariant(card.baseIndex)}
                          />
                          <CardTitle className="text-lg">
                            {card.label}
                            {card.metaPlatform && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                {card.metaPlatform === "instagram" ? "Instagram" : "Facebook"}
                              </Badge>
                            )}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => pipelineId && handlePlayAudio(pipelineId, card.baseIndex)}
                            title={playingAudio === `${pipelineId}-${card.baseIndex}` ? "Stop audio" : "Play voiceover"}
                          >
                            {playingAudio === `${pipelineId}-${card.baseIndex}` ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Volume2 className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              // Stop any playing audio before opening preview player
                              if (audioRef.current) {
                                audioRef.current.pause();
                                audioRef.current = null;
                              }
                              setPlayingAudio(null);
                              setPreviewVariant(card.key);
                            }}
                            title="Preview variant with video"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleRegenerateVariantAudio(card.baseIndex, card.key, card.visualVersion)}
                            disabled={regeneratingVariantAudio[card.baseIndex]}
                            title="Regenerate voiceover"
                          >
                            {regeneratingVariantAudio[card.baseIndex] ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          <Badge variant="secondary">
                            {formatDuration(preview.audio_duration)}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Match summary counts */}
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1 text-green-600">
                          <CheckCircle className="h-4 w-4" />
                          <span className="font-semibold">{preview.matched_count}</span>
                          <span className="text-muted-foreground">matched</span>
                        </div>
                        <div className="flex items-center gap-1 text-red-600">
                          <XCircle className="h-4 w-4" />
                          <span className="font-semibold">{preview.unmatched_count}</span>
                          <span className="text-muted-foreground">unmatched</span>
                        </div>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {preview.total_phrases} phrases total
                        </span>
                      </div>

                      {/* Full timeline editor — uses this variant's effective subtitle style */}
                      <TimelineEditor
                        matches={preview.matches}
                        audioDuration={preview.audio_duration}
                        sourceVideoIds={selectedSourceIdsArray}
                        availableSegments={availableSegments}
                        profileId={currentProfile?.id}
                        pipelineId={pipelineId ?? undefined}
                        variantIndex={card.baseIndex}
                        subtitleSettings={getPreviewSubtitleSettingsFor(card)}
                        interstitialSlides={interstitialSlides[card.key] ?? EMPTY_SLIDES}
                        onInterstitialSlidesChange={getInterstitialSlidesChangeHandler(card.key)}
                        onMatchesChange={getMatchesChangeHandler(card.key)}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Variant preview player dialog */}
            {previewVariant !== null && pipelineId && currentProfile && (() => {
              const activeCard = previewCards.find(card => card.key === previewVariant);
              if (!activeCard) return null;
              // Match the render-time precedence rule: when the user has set
              // an explicit subtitle override for this Meta version, suppress
              // the visualVersion so the preview backend does NOT layer the
              // Meta profile on top. Otherwise the preview would show the
              // overlay while the final render does not — visible divergence.
              const _activeStyleKey = toStyleKey(activeCard);
              const _activeOverride = subtitleOverrides[_activeStyleKey];
              const _hasOverride = !!_activeOverride && Object.keys(_activeOverride).length > 0;
              return (
                <VariantPreviewPlayer
                  open={true}
                  onOpenChange={handlePreviewPlayerClose}
                  matches={previews[previewVariant]?.matches ?? []}
                  pipelineId={pipelineId}
                  variantIndex={activeCard.baseIndex}
                  visualVersion={_hasOverride ? undefined : activeCard.visualVersion}
                  title={activeCard.label}
                  profileId={currentProfile.id}
                  subtitleSettings={getSubtitleSettingsFor(_activeStyleKey)}
                  sourceVideoIds={selectedSourceIdsArray}
                  minSegmentDuration={minSegmentDuration}
                  wordsPerSubtitle={wordsPerSubtitle}
                  ultraRapidIntro={ultraRapidIntro}
                  interstitialSlides={interstitialSlides[previewVariant]}
                />
              );
            })()}

            {/* "Save as preset" dialog — captures the active variant's effective style */}
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
                    Save the current style of{" "}
                    <span className="font-medium">
                      {activeStyleKey === "default"
                        ? "this pipeline"
                        : `variant ${activeStyleKey} (${activeStyleKey === "A" ? "Instagram" : "Facebook"})`}
                    </span>{" "}
                    as a named preset. You can apply it to other variants later.
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
                      <AlertCircle className="h-4 w-4" />
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
                    {savePresetSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save preset
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {/* Render settings */}
            <RenderSettingsPanel
              settings={renderSettings}
              onChange={setRenderSettings}
            />

            {/* Continue to existing renders (same pattern as Step 2's "already generated") */}
            {existingRenderCount > 0 && (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await apiGet(`/pipeline/status/${pipelineId}`);
                    const data = await res.json();
                    if (!data?.variants) return;
                    setMetaMultiplication(Boolean(data.meta_multiplication || (data.meta_variants?.length ?? 0) > 0));
                    const currentScriptCount = scripts.length;
                    const allVars = (data.meta_variants?.length > 0 ? data.meta_variants : data.variants) || [];
                    let rendered = allVars.filter(
                      (v: { status: string; variant_index: number; final_video_path?: string }) =>
                        v.status === "completed" &&
                        v.final_video_path &&
                        v.variant_index < currentScriptCount
                    );
                    // Auto-recover: if any completed variants failed library save, retry sync
                    const hasUnsaved = rendered.some((v: { library_saved?: boolean }) => v.library_saved === false);
                    if (hasUnsaved && pipelineId) {
                      try {
                        await apiPost(`/pipeline/sync-to-library/${pipelineId}`);
                        const res2 = await apiGet(`/pipeline/status/${pipelineId}`);
                        const data2 = await res2.json();
                        if (data2?.variants) {
                          const allVars2 = (data2.meta_variants?.length > 0 ? data2.meta_variants : data2.variants) || [];
                          rendered = allVars2.filter(
                            (v: { status: string; variant_index: number; final_video_path?: string }) =>
                              v.status === "completed" &&
                              v.final_video_path &&
                              v.variant_index < currentScriptCount
                          );
                        }
                      } catch {
                        // Sync failed — continue with original data, user can retry manually
                      }
                    }
                    setVariantStatuses(rendered);
                    setIsRendering(false);
                    setStep(4);
                  } catch {
                    toast.error("Failed to load existing renders");
                  }
                }}
                className="w-full"
                size="lg"
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                Continue to Render Results (already rendered)
              </Button>
            )}

            {/* Render button */}
            <Button
              onClick={handleRenderClick}
              disabled={isRendering || isCheckingRender || selectedVariants.size === 0}
              className="w-full"
              size="lg"
            >
              {isCheckingRender ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {isCheckingRender ? "Se verifica..." : isRendering ? "Rendering..." : `Render Selected (${selectedVariants.size}${metaMultiplication ? ` × 2 = ${selectedVariants.size * 2}` : ""})`}
            </Button>

            {/* Skip render dialog */}
            {skipCheckResults && (
              <SkipRenderDialog
                open={showSkipDialog}
                onClose={() => { setShowSkipDialog(false); setSkipCheckResults(null); }}
                checkResults={skipCheckResults}
                onConfirm={(skipVars, _renderVars) => handleRender(skipVars)}
              />
            )}
          </div>
        )}

        {/* Step 4 — Render Progress */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Render Progress</h2>
              <div className="flex gap-2">
                {isRendering && (
                  <Button variant="destructive" onClick={handleCancelRender}>
                    <X className="h-4 w-4 mr-2" />
                    Stop Render
                  </Button>
                )}
                <Button variant="outline" onClick={() => {
                  if (isRendering) {
                    setConfirmDialog({
                      open: true,
                      title: "Render in progress",
                      description: "A render is in progress. Are you sure you want to start a new pipeline?",
                      confirmLabel: "Start new pipeline",
                      variant: "destructive",
                      onConfirm: () => {
                        setConfirmDialog((prev) => ({ ...prev, open: false }));
                        handleCancelRender();
                        resetPipeline();
                      },
                    });
                  } else {
                    resetPipeline();
                  }
                }}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Start New Pipeline
                </Button>
              </div>
            </div>

            {/* Variant status grid */}
            {variantStatuses.length === 0 ? (
              <EmptyState
                icon={<Workflow className="h-6 w-6" />}
                title="No pipeline"
                description="Configure a pipeline to generate videos."
              />
            ) : null}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {variantStatuses.map((status, statusIdx) => (
                <Card key={status.visual_version ? `${status.variant_index}_${status.visual_version}` : `${status.variant_index}_${statusIdx}`}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        Variant {status.variant_index + 1}
                        {status.visual_version && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            {status.visual_version} — {status.meta_platform === "instagram" ? "Instagram" : status.meta_platform === "facebook" ? "Facebook" : status.meta_platform}
                          </Badge>
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {status.current_step === "Render existent folosit" ? (
                          <Badge variant="default" className="bg-blue-600 hover:bg-blue-700">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Cached
                          </Badge>
                        ) : (
                          <Badge
                            variant={
                              status.status === "completed"
                                ? "default"
                                : status.status === "failed" || status.status === "cancelled"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {status.status}
                          </Badge>
                        )}
                        {status.status === "processing" && (
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={async () => {
                              try {
                                await apiPost(`/pipeline/${pipelineId}/cancel/${status.variant_index}`, {});
                                setVariantStatuses(prev =>
                                  prev.map(v =>
                                    v.variant_index === status.variant_index
                                      ? { ...v, status: "cancelled" as const, current_step: "Cancelled by user", progress: 0 }
                                      : v
                                  )
                                );
                                toast.success(`Variant ${status.variant_index + 1} cancelled`);
                                // If all variants are now done, stop polling
                                const updatedStatuses = variantStatuses.map(v =>
                                  v.variant_index === status.variant_index
                                    ? { ...v, status: "cancelled" as const }
                                    : v
                                );
                                const allDone = updatedStatuses.every(
                                  v => v.status === "completed" || v.status === "failed" || v.status === "cancelled"
                                );
                                if (allDone) {
                                  setIsRendering(false);
                                }
                              } catch (err) {
                                handleApiError(err, "Failed to cancel variant");
                              }
                            }}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Stop
                          </Button>
                        )}
                        {status.status === "completed" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            title="Remake with different segments"
                            onClick={() => handleRemakeVariant(status.variant_index)}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        {(status.status === "completed" || status.status === "failed" || status.status === "cancelled") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setConfirmDialog({
                                open: true,
                                title: "Delete variant",
                                description: `Are you sure you want to delete Variant ${status.variant_index + 1}? This will remove it from the list${status.clip_id ? " and delete the clip from the library" : ""}.`,
                                confirmLabel: "Delete",
                                variant: "destructive",
                                onConfirm: async () => {
                                  try {
                                    if (status.clip_id) {
                                      await apiDelete(`/library/clips/${status.clip_id}`);
                                    }
                                    setVariantStatuses(prev =>
                                      prev.filter(v => v.variant_index !== status.variant_index)
                                    );
                                    toast.success(`Variant ${status.variant_index + 1} deleted`);
                                  } catch (err) {
                                    console.error("Failed to delete variant:", err);
                                    toast.error("Failed to delete variant");
                                  }
                                  setConfirmDialog(prev => ({ ...prev, open: false }));
                                },
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Progress bar */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-semibold">
                          {status.progress >= 100 && status.status === "processing"
                            ? "Finalizing..."
                            : `${Math.round(status.progress)}%`}
                        </span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${status.progress >= 100 && status.status === "processing" ? 99 : status.progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Current step */}
                    <p className="text-sm text-muted-foreground">{status.current_step}</p>

                    {/* Render fingerprint (debug: unique per render parameters) */}
                    {status.render_fingerprint && (
                      <p className="text-xs font-mono text-muted-foreground/60">
                        Render ID: {status.render_fingerprint}
                      </p>
                    )}

                    {/* Inline video player + download button */}
                    {status.status === "completed" && status.final_video_path && (
                      <div className="space-y-3">
                        <video
                          key={`video-${status.variant_index}${status.visual_version ? `_${status.visual_version}` : ""}-${getVideoCacheBust(status.variant_index)}`}
                          controls
                          className="w-full rounded-md bg-black max-h-64 object-contain"
                          poster={
                            status.thumbnail_path
                              ? `${API_URL}/library/files/${encodeURIComponent(status.thumbnail_path)}`
                              : undefined
                          }
                          preload="auto"
                          src={`${API_URL}/library/files/${encodeURIComponent(status.final_video_path)}?v=${getVideoCacheBust(status.variant_index)}`}
                        />
                        <Button variant="outline" className="w-full" asChild>
                          <a
                            href={`${API_URL}/library/files/${encodeURIComponent(
                              status.final_video_path
                            )}?v=${videoCacheBust}&download=true`}
                            download
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download Video
                          </a>
                        </Button>
                        {status.clip_id && (
                          <Button
                            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                            onClick={() => setPublishVariant(status)}
                          >
                            <Share2 className="h-4 w-4 mr-2" />
                            Publish to Social Media
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Library save warning */}
                    {status.status === "completed" && status.library_saved === false && (
                      <Alert className="border-yellow-500/50 bg-yellow-500/10">
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                          Video rendered successfully, but was not saved to the library.
                          {status.library_error && <span className="block text-xs mt-1 opacity-75">{status.library_error}</span>}
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto text-yellow-700 dark:text-yellow-400 underline ml-1"
                            onClick={async () => {
                              // BUG-FE-32: Guard against null pipelineId
                              if (!pipelineId) return;
                              try {
                                await apiPost(`/pipeline/sync-to-library/${pipelineId}`);
                                const res = await apiGet(`/pipeline/status/${pipelineId}`);
                                const data = await res.json();
                                if (data?.variants) {
                                  const srcVars = (data.meta_variants?.length > 0 ? data.meta_variants : data.variants) || [];
                                  const renderedVariants = srcVars.filter((v: VariantStatus) => v.status !== "not_started");
                                  setVariantStatuses(renderedVariants);
                                }
                              } catch {
                                // ignore — user can retry
                              }
                            }}
                          >
                            Retry save
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Error message */}
                    {status.status === "failed" && status.error && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{status.error}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Captions — rendered directly (not as captionSlot) to avoid remounting on poll updates */}
            {pipelineId && variantStatuses.length > 0 && (
              <PipelineCaptionGenerator
                pipelineId={pipelineId}
                completedClips={variantStatuses.map(v => ({
                  clip_id: v.clip_id || `pending-${v.variant_index}${v.visual_version ? `_${v.visual_version}` : ""}`,
                  variant_index: v.variant_index,
                  final_video_path: v.final_video_path || "",
                  thumbnail_path: v.thumbnail_path,
                  visual_version: v.visual_version,
                }))}
                scripts={scripts}
                contextProducts={contextProducts}
                onProductsChange={setContextProducts}
                onCaptionsGenerated={setGeneratedCaptions}
                onYoutubeTitlesGenerated={setGeneratedYoutubeTitles}
                initialCaptions={generatedCaptions}
                initialYoutubeTitles={generatedYoutubeTitles}
              />
            )}

            {/* Schedule & Publish — calendar then schedule form */}
            <PipelineSchedule
              completedClips={variantStatuses
                .filter(v => v.status === "completed" && v.clip_id)
                .map(v => ({
                  clip_id: v.clip_id!,
                  variant_index: v.variant_index,
                  final_video_path: v.final_video_path || "",
                  thumbnail_path: v.thumbnail_path,
                  visual_version: v.visual_version,
                }))}
              initialCaptions={generatedCaptions}
              projectId={libraryProjectId ?? undefined}
              allLibrarySaved={
                variantStatuses.filter(v => v.status === "completed").length > 0 &&
                variantStatuses
                  .filter(v => v.status === "completed")
                  .every(v => v.library_saved === true)
              }
            />
          </div>
        )}

        </div>{/* end main content */}

        {/* History Sidebar */}
          <div className="w-80 flex-shrink-0">
            <Card className="sticky top-4">
              <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Script History
                  </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : historyPipelines.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No pipelines yet</p>
                ) : (
                  historyPipelines.map((item) => (
                    <div key={item.pipeline_id} className="space-y-2">
                      <div
                        className={`w-full text-left p-3 rounded-lg border transition-colors hover:bg-accent ${
                          selectedHistoryId === item.pipeline_id ? "border-primary bg-accent" : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            {editingNameId === item.pipeline_id ? (
                              <input
                                autoFocus
                                className="text-sm font-semibold w-full bg-transparent border-b border-primary outline-none px-0 py-0.5"
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                onBlur={() => handleSavePipelineName(item.pipeline_id, editingNameValue)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); handleSavePipelineName(item.pipeline_id, editingNameValue); }
                                  if (e.key === "Escape") { setEditingNameId(null); }
                                }}
                                maxLength={200}
                                placeholder="Script set name..."
                              />
                            ) : (
                              <p
                                className={`text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors ${
                                  item.name ? "" : "text-muted-foreground/50 italic"
                                }`}
                                title={item.name || "Click to add a name"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingNameId(item.pipeline_id);
                                  setEditingNameValue(item.name || "");
                                }}
                              >
                                {item.name || "Add name..."}
                              </p>
                            )}
                            <p
                              className={`text-sm text-muted-foreground cursor-pointer ${
                                expandedIdeas.has(item.pipeline_id) ? "whitespace-pre-wrap break-words" : "truncate"
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedIdeas(prev => {
                                  const next = new Set(prev);
                                  if (next.has(item.pipeline_id)) next.delete(item.pipeline_id);
                                  else next.add(item.pipeline_id);
                                  return next;
                                });
                              }}
                              title={expandedIdeas.has(item.pipeline_id) ? "Click to collapse" : item.idea}
                            >
                              {expandedIdeas.has(item.pipeline_id)
                                ? item.idea
                                : item.idea.length > 50 ? item.idea.substring(0, 50) + "..." : item.idea
                              }
                            </p>
                            {item.idea.length > 50 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedIdeas(prev => {
                                    const next = new Set(prev);
                                    if (next.has(item.pipeline_id)) next.delete(item.pipeline_id);
                                    else next.add(item.pipeline_id);
                                    return next;
                                  });
                                }}
                                className="text-[11px] text-primary/70 hover:text-primary mt-0.5"
                              >
                                {expandedIdeas.has(item.pipeline_id) ? "Show less" : "Show more"}
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => handleDeletePipeline(item.pipeline_id, e)}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleDeletePipeline(item.pipeline_id, e); } }}
                              className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                              title="Delete pipeline"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </span>
                            <ChevronRight
                              className={`h-4 w-4 transition-transform cursor-pointer ${
                                selectedHistoryId === item.pipeline_id ? "rotate-90" : ""
                              }`}
                              onClick={() => fetchHistoryScripts(item.pipeline_id)}
                            />
                          </div>
                        </div>
                        <div
                          className="flex items-center gap-2 mt-1 cursor-pointer"
                          onClick={() => fetchHistoryScripts(item.pipeline_id)}
                        >
                          <Badge variant="outline" className="text-xs">{item.provider}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {item.variant_count} scripts
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                          </span>
                        </div>
                      </div>

                      {/* Expanded: show scripts with checkboxes */}
                      {selectedHistoryId === item.pipeline_id && (
                        <div className="ml-2 pl-3 border-l-2 border-primary/30 space-y-2">
                          {historyScriptsLoading ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            <>
                              {historyScripts.map((script, idx) => {
                                const previewInf = historyPreviewInfo[String(idx)];
                                const hasAudio = previewInf?.has_audio;
                                const audioKey = `${item.pipeline_id}-${idx}`;
                                const isPlaying = playingAudio === audioKey;

                                return (
                                  <div key={idx} className="flex items-start gap-2">
                                    <Checkbox
                                      checked={historySelectedScripts.has(idx)}
                                      onCheckedChange={() => {
                                        setHistorySelectedScripts(prev => {
                                          const next = new Set(prev);
                                          if (next.has(idx)) next.delete(idx);
                                          else next.add(idx);
                                          return next;
                                        });
                                      }}
                                      className="mt-0.5"
                                    />
                                    <p className="text-xs text-muted-foreground line-clamp-3 flex-1">
                                      {script}
                                    </p>
                                    {hasAudio && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handlePlayAudio(item.pipeline_id, idx); }}
                                        className={`flex items-center gap-1 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                          isPlaying
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-primary/90 text-primary-foreground hover:bg-primary"
                                        }`}
                                        title={isPlaying ? "Pause audio" : "Play audio preview"}
                                      >
                                        {isPlaying ? (
                                          <Pause className="h-3 w-3" />
                                        ) : (
                                          <Volume2 className="h-3 w-3" />
                                        )}
                                        <span>{previewInf.audio_duration.toFixed(1)}s</span>
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                              <div className="flex gap-2 pt-1">
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  disabled={historyImporting}
                                  onClick={() => {
                                    // Reuse existing pipeline directly (no duplicate creation)
                                    if (!selectedHistoryId) return;
                                    setPipelineId(selectedHistoryId);
                                    setScripts(historyScripts.map(formatScript));
                                    // Carry over TTS results: prefer tts_info (Step 2) over preview_info (Step 3)
                                    const restored2 = buildRestoredTts(historyTtsInfo, historyPreviewInfo);
                                    setTtsResults(restored2.tts);
                                    if (restored2.approved.size > 0) setApprovedScripts(restored2.approved);
                                    // Restore pipeline metadata for "Back to Input"
                                    const histItem = historyPipelines.find(p => p.pipeline_id === selectedHistoryId);
                                    if (histItem) {
                                      if (histItem.name) setPipelineName(histItem.name);
                                      if (histItem.idea) setIdea(histItem.idea);
                                      if (histItem.provider) setProvider(histItem.provider);
                                      if (histItem.variant_count) setVariantCount(histItem.variant_count);
                                      if (histItem.target_script_duration) setTargetScriptDuration(histItem.target_script_duration);
                                    }
                                    setContextProducts(historyContextProducts);
                                    // Restore source video selection so product groups load
                                    setSelectedSourceIds(new Set());
                                    restoreSourceSelection(selectedHistoryId);
                                    setStep(2);
                                    setPreviewError(null);
                                    setSelectedHistoryId(null);
                                    setHistoryScripts([]);
                                    setHistorySelectedScripts(new Set());
                                    setPreviews({});
                                    setPreviewError(null);
                                  }}
                                >
                                  {historyImporting ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    "Load All"
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex-1"
                                  disabled={historySelectedScripts.size === 0 || historyImporting}
                                  onClick={handleHistoryImport}
                                >
                                  Load Selected ({historySelectedScripts.size})
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

          </div>

        </div>{/* end flex container */}
        </>
        )}
      </div>

      {/* Product Picker Dialog */}
      {pickerSegmentId && (
        <ProductPickerDialog
          open={!!pickerSegmentId}
          onOpenChange={(open) => { if (!open) setPickerSegmentId(null); }}
          segmentId={pickerSegmentId}
          onProductSelected={handleProductSelected}
        />
      )}

      {/* Image Picker Dialog */}
      {imagePickerAssoc && (
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

/**
 * Thin wrapper around <SubtitleEditor renderMode="preview-only"> used by
 * the Subtitle Style card in Step 3. Encapsulates the per-Meta-version
 * plumbing (picking a `variantIndex` for the FFmpeg background frame,
 * deciding whether to pass `visualVersion`, labelling the panel) so the
 * parent JSX stays readable.
 *
 * Meta ON renders two of these side-by-side (A and B). Meta OFF renders
 * one (styleKey="default"). In both cases the preview always reflects the
 * *effective* style (default + override + optional Meta overlay).
 */
function SubtitleStylePreviewPanel({
  styleKey,
  settings,
  hasOverride,
  pipelineId,
  previewCards,
  isActive,
}: {
  styleKey: StyleKey;
  settings: SubtitleSettings;
  hasOverride: boolean;
  pipelineId: string | undefined;
  previewCards: PreviewCard[];
  isActive: boolean;
}) {
  // Pick an arbitrary script variant that has the matching visualVersion so
  // the FFmpeg frame preview has a background frame to sample. Since the
  // style is now shared across all scripts under the same Meta version, it
  // doesn't matter *which* script we pick — just that one exists.
  const variantIndex = useMemo(() => {
    const targetVersion =
      styleKey === "A" ? "A" : styleKey === "B" ? "B" : undefined;
    const match = previewCards.find((c) => c.visualVersion === targetVersion);
    return match?.baseIndex ?? 0;
  }, [previewCards, styleKey]);

  // Only apply the Meta profile overlay in the preview when there is NO
  // user override for this key — mirrors the render-time suppression rule
  // so the preview doesn't diverge from the eventual render output.
  const visualVersion =
    hasOverride || styleKey === "default" ? undefined : styleKey;

  const label =
    styleKey === "default"
      ? "Live Preview"
      : `Live Preview — ${styleKey} (${styleKey === "A" ? "Instagram" : "Facebook"})`;

  return (
    <div
      className={`flex flex-col gap-2 flex-shrink-0 ${
        isActive ? "ring-2 ring-primary/40 rounded-lg p-2" : "p-2"
      }`}
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <SubtitleEditor
        renderMode="preview-only"
        settings={settings}
        onSettingsChange={() => {
          /* preview-only — no-op */
        }}
        showPreview={true}
        previewHeight={320}
        compact={false}
        pipelineId={pipelineId}
        variantIndex={variantIndex}
        visualVersion={visualVersion}
      />
    </div>
  );
}

