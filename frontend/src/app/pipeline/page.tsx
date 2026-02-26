"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react";
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
} from "lucide-react";
import { usePolling } from "@/hooks";
import { useProfile } from "@/contexts/profile-context";
import { EmptyState } from "@/components/empty-state";
import { ProductPickerDialog } from "@/components/product-picker-dialog";
import { ImagePickerDialog } from "@/components/image-picker-dialog";
import type { AssociationResponse } from "@/components/product-picker-dialog";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { SubtitleSettings, DEFAULT_SUBTITLE_SETTINGS } from "@/types/video-processing";
import { TimelineEditor, SegmentOption } from "@/components/timeline-editor";
import { VariantPreviewPlayer } from "@/components/variant-preview-player";

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

interface PipelineListItem {
  pipeline_id: string;
  idea: string;
  provider: string;
  variant_count: number;
  keyword_count: number;
  created_at: string;
}

interface VariantStatus {
  variant_index: number;
  status: "not_started" | "processing" | "completed" | "failed";
  progress: number;
  current_step: string;
  final_video_path?: string;
  thumbnail_path?: string;
  error?: string;
  library_saved?: boolean;
  library_error?: string;
}

interface VariantPreviewInfo {
  has_audio: boolean;
  audio_duration: number;
  has_srt: boolean;
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

export default function PipelinePageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <PipelinePage />
    </Suspense>
  );
}

function PipelinePage() {
  const { currentProfile } = useProfile();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Step tracking — synced with URL ?step=N
  const [step, setStepRaw] = useState(() => {
    const param = searchParams.get("step");
    const n = param ? parseInt(param, 10) : NaN;
    return n >= 1 && n <= 4 ? n : 1;
  });

  const setStep = useCallback((n: number) => {
    setStepRaw(n);
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", String(n));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, router, pathname]);

  // Step 1: Input
  const [idea, setIdea] = useState("");
  const [context, setContext] = useState("");
  const [contextProducts, setContextProducts] = useState<ContextProduct[]>([]);
  const [variantCount, setVariantCount] = useState(3);
  const [provider, setProvider] = useState("gemini");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiRulesExpanded, setAiRulesExpanded] = useState(false);
  const [aiRulesSaved, setAiRulesSaved] = useState(false);
  const [aiRulesDirty, setAiRulesDirty] = useState(false);
  const aiInstructionsSaveTimer = useRef<NodeJS.Timeout | null>(null);

  // Step 2: Scripts
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [scripts, setScripts] = useState<string[]>([]);
  const [totalSegmentDuration, setTotalSegmentDuration] = useState<number>(0);

  // Step 3: Preview
  const [previewVariant, setPreviewVariant] = useState<number | null>(null);
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Record<number, PreviewData>>({});
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
  const voiceSettingsLoaded = useRef(false);

  // Step 4: Render
  const [selectedVariants, setSelectedVariants] = useState<Set<number>>(new Set());
  const [isRendering, setIsRendering] = useState(false);
  const [variantStatuses, setVariantStatuses] = useState<VariantStatus[]>([]);
  const [presetName, setPresetName] = useState("TikTok");

  // History sidebar
  const [historyPipelines, setHistoryPipelines] = useState<PipelineListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyScripts, setHistoryScripts] = useState<string[]>([]);
  const [historyScriptsLoading, setHistoryScriptsLoading] = useState(false);
  const [historySelectedScripts, setHistorySelectedScripts] = useState<Set<number>>(new Set());
  const [historyImporting, setHistoryImporting] = useState(false);
  const [historyPreviewInfo, setHistoryPreviewInfo] = useState<Record<string, VariantPreviewInfo>>({});
  const [historyTtsInfo, setHistoryTtsInfo] = useState<Record<string, { has_audio: boolean; audio_duration: number }>>({});
  const [expandedIdeas, setExpandedIdeas] = useState<Set<string>>(new Set());
  const [playingAudio, setPlayingAudio] = useState<string | null>(null); // "pipelineId-variantIndex"
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
  const [ttsResults, setTtsResults] = useState<Record<number, { audio_duration: number; generating: boolean; stale: boolean }>>({});
  const [playingTtsVariant, setPlayingTtsVariant] = useState<number | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceSettingsInitialized = useRef(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const pendingBlobUrl = useRef<string | null>(null);

  // TTS Library duplicate detection
  const [libraryMatches, setLibraryMatches] = useState<Record<number, { asset_id: string; audio_duration: number }>>({});

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
  const [sourceVideosLoading, setSourceVideosLoading] = useState(false);
  const [sourceVideoSearch, setSourceVideoSearch] = useState("");
  const [groupTagSearch, setGroupTagSearch] = useState("");
  const sourceSelectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineIdRef = useRef<string | null>(null);

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

  // Subtitle settings state
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>({ ...DEFAULT_SUBTITLE_SETTINGS });
  const [subtitleSettingsLoaded, setSubtitleSettingsLoaded] = useState(false);
  const subtitleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep pipelineIdRef in sync for use in closures/timeouts
  useEffect(() => { pipelineIdRef.current = pipelineId; }, [pipelineId]);

  // Format helpers
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const countWords = (text: string): number => {
    // Strip [ProductGroup] tags before counting words
    const cleaned = text.replace(/\[([^\[\]]+)\]/g, "");
    return cleaned.trim().split(/\s+/).filter(Boolean).length;
  };

  /** Average TTS speech rate in words per second (ElevenLabs default) */
  const WORDS_PER_SECOND = 2.3;

  // Format script: ensure each sentence starts on a new line
  const formatScript = (text: string): string => {
    // If already has multiple lines (3+), assume it's formatted
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length >= 3) return text;
    // Split by sentence-ending punctuation followed by space
    const sentences = text.trim().split(/(?<=[.!?])\s+/);
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
      if (res.ok) {
        const data = await res.json();
        setCatalogProducts(data.products || []);
        setCatalogPagination(data.pagination || { page: 1, page_size: 20, total: 0, total_pages: 1 });
      }
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
      if (res.ok) {
        const data = await res.json();
        setCatalogFilters({ brands: data.brands || [], categories: data.categories || [] });
      }
    } catch (err) {
      handleApiError(err, "Failed to load catalog filters");
    }
  }, []);

  // Source videos: fetch list with segment counts
  const fetchSourceVideos = useCallback(async () => {
    setSourceVideosLoading(true);
    try {
      const res = await apiGet("/segments/source-videos");
      if (res.ok) {
        const data = await res.json();
        setSourceVideos(data || []);
        // Auto-select all if no selection has been made yet
        setSelectedSourceIds(prev => {
          if (prev.size === 0 && data.length > 0) {
            return new Set(data.map((v: { id: string }) => v.id));
          }
          return prev;
        });
      }
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
        if (res.ok) {
          const data = await res.json();
          setTotalSegmentDuration(data.total_segment_duration || 0);
        }
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
        if (res.ok) {
          const data = await res.json();
          setAiInstructions(data.ai_instructions || "");
          if (data.ai_instructions) setAiRulesExpanded(true);
        }
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
      setTimeout(() => setAiRulesSaved(false), 2000);
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
      if (res.ok) {
        const data = await res.json();
        if (data.source_video_ids && data.source_video_ids.length > 0) {
          setSelectedSourceIds(new Set(data.source_video_ids));
        }
      }
    } catch {
      // Ignore — fresh pipeline or column not yet migrated
    }
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
    setSelectedSourceIds(new Set());
    if (pipelineId) {
      apiPut(`/pipeline/${pipelineId}/source-selection`, {
        source_video_ids: []
      }).catch(() => {});
    }
  };

  // Fetch product groups when source video selection changes
  useEffect(() => {
    if (selectedSourceIds.size === 0) {
      setProductGroups([]);
      return;
    }
    const ids = Array.from(selectedSourceIds).join(",");
    apiGet(`/segments/product-groups-bulk?source_video_ids=${encodeURIComponent(ids)}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setProductGroups(data);
        }
      })
      .catch(() => setProductGroups([]));
  }, [selectedSourceIds]);

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
    if (pipelineId) saveScriptsToBackend(pipelineId, newScripts);
  };

  // Detect [GroupLabel] tags in a script
  const detectGroupTags = (text: string): string[] => {
    const matches = text.match(/\[([^\[\]]+)\]/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.slice(1, -1)))];
  };

  // Analyze pairing state of group tags in a script
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

  // Catalog: open picker
  const handleOpenCatalog = () => {
    const next = !catalogOpen;
    setCatalogOpen(next);
    if (next) {
      fetchCatalogProducts("", "all", "all", 1);
      if (catalogFilters.brands.length === 0) fetchCatalogFilters();
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

  const { startPolling: startRenderPolling, stopPolling: stopRenderPolling } = usePolling<{
    variants: VariantStatus[];
  }>({
    endpoint: renderStatusEndpoint,
    interval: 2000,
    enabled: false,
    onData: (data) => {
      const allVariants = data.variants || [];
      // Only show variants that have been submitted for rendering (not "not_started")
      const renderedVariants = allVariants.filter(
        (v) => v.status !== "not_started"
      );
      setVariantStatuses(renderedVariants);
      // Stop polling only when every rendered variant is done (ignore not_started ones)
      const allComplete =
        renderedVariants.length > 0 &&
        renderedVariants.every(
          (v) => v.status === "completed" || v.status === "failed"
        );
      if (allComplete) {
        stopRenderPolling();
        setIsRendering(false);
      }
    },
    onError: (err) => {
      handleApiError(err, "Eroare la actualizarea statusului pipeline");
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

  // One-time status check when entering Step 4 (detect already-complete variants)
  useEffect(() => {
    if (step === 4 && pipelineId && isRendering) {
      apiGet(`/pipeline/status/${pipelineId}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data?.variants) return;
          // Filter out not_started variants (same logic as polling onData)
          const rendered = data.variants.filter(
            (v: { status: string }) => v.status !== "not_started"
          );
          setVariantStatuses(rendered);
          const allDone =
            rendered.length > 0 &&
            rendered.every(
              (v: { status: string }) => v.status === "completed" || v.status === "failed"
            );
          if (allDone) {
            setIsRendering(false);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pipelineId]); // intentionally exclude isRendering to run only on step change

  // Step 1: Generate scripts
  const handleGenerate = async () => {
    if (!idea.trim()) return;

    setError(null);
    setIsGenerating(true);

    try {
      // Combine manual text context with structured product data
      const fullContext = [
        context.trim(),
        ...contextProducts.map(p => `[Product: ${p.title}]\n${p.description}`),
      ].filter(Boolean).join("\n\n");

      const res = await apiPost("/pipeline/generate", {
        idea: idea.trim(),
        context: fullContext || undefined,
        variant_count: variantCount,
        provider,
      }, { timeout: 300_000 }); // 5 min — AI script generation is slow

      if (res.ok) {
        const data = await res.json();
        setPipelineId(data.pipeline_id);
        setScripts((data.scripts || []).map(formatScript));
        setTotalSegmentDuration(data.total_segment_duration || 0);
        setStep(2);
      } else {
        const errorData = await res.json().catch(() => ({
          detail: "Failed to generate scripts",
        }));
        setError(errorData.detail || "Failed to generate scripts");
      }
    } catch (err) {
      handleApiError(err, "Eroare la generarea scripturilor");
      if (err instanceof ApiError) {
        if (err.isTimeout) {
          setError("Generarea scripturilor a expirat. Încearcă din nou.");
        } else {
          setError(err.detail || err.message || "Script generation failed. Please try again.");
        }
      } else {
        setError("Network error. Please check if the backend is running.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Step 2: Preview all matches
  const handlePreviewAll = async () => {
    if (!pipelineId) return;

    // Cancel any in-flight preview requests from a previous run
    previewAbortRef.current?.abort();
    const abortController = new AbortController();
    previewAbortRef.current = abortController;

    setPreviewError(null);
    const newPreviews: Record<number, PreviewData> = {};

    for (let i = 0; i < scripts.length; i++) {
      if (abortController.signal.aborted) return;
      setPreviewingIndex(i);
      try {
        const res = await apiPost(`/pipeline/preview/${pipelineId}/${i}`, {
          elevenlabs_model: elevenlabsModel,
          voice_id: voiceId && voiceId !== "default" ? voiceId : undefined,
          source_video_ids: selectedSourceIds.size > 0 ? Array.from(selectedSourceIds) : undefined,
          voice_settings: {
            stability: voiceStability,
            similarity_boost: voiceSimilarity,
            style: voiceStyle,
            speed: voiceSpeed,
            use_speaker_boost: voiceSpeakerBoost,
          },
          words_per_subtitle: wordsPerSubtitle,
        }, { timeout: 300_000, signal: abortController.signal }); // 5 min — TTS generation + SRT can be slow

        if (abortController.signal.aborted) return;

        if (res.ok) {
          const data = await res.json();
          newPreviews[i] = data;
        } else {
          const errorData = await res.json().catch(() => ({
            detail: `Failed to preview variant ${i + 1}`,
          }));
          setPreviewError(errorData.detail || `Failed to preview variant ${i + 1}`);
          setPreviewingIndex(null);
          return;
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        handleApiError(err, "Eroare la previzualizarea variantelor");
        if (err instanceof ApiError) {
          if (err.isTimeout) {
            setPreviewError("Previzualizarea a expirat. Încearcă din nou.");
          } else {
            setPreviewError(err.detail || err.message || `Failed to preview variant ${i + 1}.`);
          }
        } else {
          setPreviewError("Network error. Please check if the backend is running.");
        }
        setPreviewingIndex(null);
        return;
      }
    }

    setPreviews(newPreviews);
    setPreviewingIndex(null);

    // Collect available segments from the first preview response (all previews share same segment pool)
    const firstPreview = Object.values(newPreviews)[0];
    if (firstPreview?.available_segments && firstPreview.available_segments.length > 0) {
      setAvailableSegments(firstPreview.available_segments);
    }

    // Select all variants by default
    const allIndices = new Set(scripts.map((_, i) => i));
    setSelectedVariants(allIndices);

    setStep(3);
  };

  // Step 3: Render selected variants
  const handleRender = async () => {
    if (!pipelineId || selectedVariants.size === 0) return;
    setPreviewError(null);

    // Build initial variant statuses from selected variants BEFORE the API call.
    // The render response returns rendering_variants (indices) and total_variants,
    // NOT a `variants` field — so we must populate this from request data to avoid
    // an empty-state flash when entering Step 4.
    const initialStatuses: VariantStatus[] = Array.from(selectedVariants).map(idx => ({
      variant_index: idx,
      status: "processing" as const,
      progress: 0,
      current_step: "Initializing render...",
    }));

    setIsRendering(true);
    setVariantStatuses(initialStatuses);

    // Collect match overrides from timeline editor for each selected variant
    const matchOverrides: Record<number, MatchPreview[]> = {};
    for (const idx of Array.from(selectedVariants)) {
      if (previews[idx]?.matches && previews[idx].matches.length > 0) {
        matchOverrides[idx] = previews[idx].matches;
      }
    }

    try {
      const res = await apiPost(`/pipeline/render/${pipelineId}`, {
        variant_indices: Array.from(selectedVariants),
        preset_name: presetName,
        elevenlabs_model: elevenlabsModel,
        voice_id: voiceId && voiceId !== "default" ? voiceId : undefined,
        source_video_ids: selectedSourceIds.size > 0 ? Array.from(selectedSourceIds) : undefined,
        match_overrides: Object.keys(matchOverrides).length > 0 ? matchOverrides : undefined,
        voice_settings: {
          stability: voiceStability,
          similarity_boost: voiceSimilarity,
          style: voiceStyle,
          speed: voiceSpeed,
          use_speaker_boost: voiceSpeakerBoost,
        },
        words_per_subtitle: wordsPerSubtitle,
        font_size: subtitleSettings.fontSize,
        font_family: subtitleSettings.fontFamily,
        text_color: subtitleSettings.textColor,
        outline_color: subtitleSettings.outlineColor,
        outline_width: subtitleSettings.outlineWidth,
        position_y: subtitleSettings.positionY,
        shadow_depth: subtitleSettings.shadowDepth ?? 0,
        enable_glow: subtitleSettings.enableGlow ?? false,
        glow_blur: subtitleSettings.glowBlur ?? 0,
        adaptive_sizing: subtitleSettings.adaptiveSizing ?? false,
      }, { timeout: 600_000 }); // 10 min — rendering can be very slow

      if (res.ok) {
        // data.variants does not exist on PipelineRenderResponse — initialStatuses
        // already set above serve as placeholder until polling fills in real data.
        setStep(4);
      } else {
        const errorData = await res.json().catch(() => ({
          detail: "Failed to start render",
        }));
        setPreviewError(errorData.detail || "Failed to start render");
        setVariantStatuses([]);
        setIsRendering(false);
      }
    } catch (err) {
      handleApiError(err, "Eroare la generarea variantelor");
      if (err instanceof ApiError) {
        if (err.isTimeout) {
          setPreviewError("Randarea a expirat. Încearcă din nou.");
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

  // Reset all state
  const resetPipeline = () => {
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

  // History sidebar: fetch pipeline list
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiGet("/pipeline/list?limit=20");
      if (res.ok) {
        const data = await res.json();
        setHistoryPipelines(data.pipelines || []);
      }
    } catch (err) {
      handleApiError(err, "Failed to load pipeline history");
    } finally {
      setHistoryLoading(false);
    }
  };

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
      const res = await apiGet(`/pipeline/status/${id}`);
      if (res.ok) {
        const data = await res.json();
        setHistoryScripts(data.scripts || []);
        // Select all by default
        setHistorySelectedScripts(new Set((data.scripts || []).map((_: string, i: number) => i)));
        // Store preview info for audio indicators
        if (data.preview_info) {
          setHistoryPreviewInfo(data.preview_info);
        } else {
          setHistoryPreviewInfo({});
        }
        // Store TTS info (Step 2 per-script TTS)
        setHistoryTtsInfo(data.tts_info || {});
      }
    } catch (err) {
      handleApiError(err, "Failed to load pipeline scripts");
    } finally {
      setHistoryScriptsLoading(false);
    }
  };

  // History sidebar: delete a pipeline
  const handleDeletePipeline = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Sigur vrei să ștergi acest set de scripturi?")) return;
    try {
      const res = await apiDelete(`/pipeline/${id}`);
      if (res.ok) {
        setHistoryPipelines(prev => prev.filter(p => p.pipeline_id !== id));
        if (selectedHistoryId === id) {
          setSelectedHistoryId(null);
          setHistoryScripts([]);
          setHistorySelectedScripts(new Set());
        }
      } else {
        const errorData = await res.json().catch(() => ({ detail: "Failed to delete pipeline" }));
        setError(errorData.detail || "Failed to delete pipeline");
      }
    } catch (err) {
      handleApiError(err, "Failed to delete pipeline");
    }
  };

  // History sidebar: auto-load on mount and when profile changes
  useEffect(() => {
    fetchHistory();
    // Reset expanded history when profile changes
    setSelectedHistoryId(null);
    setHistoryScripts([]);
    setHistorySelectedScripts(new Set());
    setHistoryPreviewInfo({});
    setHistoryTtsInfo({});
  }, [currentProfile?.id]);

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
        if (res.ok) {
          const data = await res.json();
          setVoices(data.voices || []);
        }
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
    if (!currentProfile) return;
    const loadDefaultVoice = async () => {
      try {
        const res = await apiGetWithRetry(`/profiles/${currentProfile.id}`);
        if (res.ok) {
          const data = await res.json();
          const savedVoiceId = data.tts_settings?.voice_id;
          if (savedVoiceId) {
            setDefaultVoiceId(savedVoiceId);
            // Pre-select if user hasn't manually chosen yet
            setVoiceId((prev) => prev === "" ? savedVoiceId : prev);
          }
        }
      } catch {
        // Silently fail — voice selector still works with default
      }
    };
    loadDefaultVoice();
  }, [currentProfile]);

  // Load subtitle settings from profile
  useEffect(() => {
    if (!currentProfile) return;
    const loadSubtitleSettings = async () => {
      try {
        const res = await apiGetWithRetry(`/profiles/${currentProfile.id}/subtitle-settings`);
        if (res.ok) {
          const data = await res.json();
          setSubtitleSettings({ ...DEFAULT_SUBTITLE_SETTINGS, ...data });
        }
      } catch {
        // Use defaults
      } finally {
        setSubtitleSettingsLoaded(true);
      }
    };
    loadSubtitleSettings();
  }, [currentProfile]);

  // Debounced save subtitle settings to profile
  const handleSubtitleSettingsChange = useCallback((newSettings: SubtitleSettings) => {
    setSubtitleSettings(newSettings);
    if (!currentProfile) return;
    if (subtitleSaveTimer.current) clearTimeout(subtitleSaveTimer.current);
    subtitleSaveTimer.current = setTimeout(async () => {
      try {
        await apiPut(`/profiles/${currentProfile.id}/subtitle-settings`, newSettings);
      } catch {
        // Silent — settings still work locally
      }
    }, 1000);
  }, [currentProfile]);

  // Debounced auto-save scripts to backend
  const saveScriptsToBackend = useCallback((pId: string, updatedScripts: string[]) => {
    if (scriptSaveTimer.current) clearTimeout(scriptSaveTimer.current);
    scriptSaveTimer.current = setTimeout(async () => {
      try {
        await apiPut(`/pipeline/${pId}/scripts`, { scripts: updatedScripts });
      } catch {
        // Silent — scripts still work locally, will retry on next edit
      }
    }, 1000);
  }, []);

  // Check TTS library for duplicate texts when scripts load
  // Debounced 1.5s so rapid edits don't flood the API
  useEffect(() => {
    if (step !== 2 || scripts.length === 0) {
      setLibraryMatches({});
      return;
    }

    const checkDuplicates = async () => {
      try {
        const res = await apiPost("/tts-library/check-duplicates", { texts: scripts });
        if (res.ok) {
          const data = await res.json();
          const parsed: Record<number, { asset_id: string; audio_duration: number }> = {};
          for (const [key, val] of Object.entries(data.matches || {})) {
            parsed[parseInt(key)] = val as { asset_id: string; audio_duration: number };
          }
          setLibraryMatches(parsed);
        }
      } catch (err) {
        console.warn("TTS library duplicate check failed:", err);
      }
    };

    if (ttsLibraryCheckTimer.current) clearTimeout(ttsLibraryCheckTimer.current);
    ttsLibraryCheckTimer.current = setTimeout(checkDuplicates, 1500);

    return () => {
      if (ttsLibraryCheckTimer.current) clearTimeout(ttsLibraryCheckTimer.current);
    };
  }, [step, scripts]);

  // Save selected voice as default in profile
  const handleSetDefaultVoice = async () => {
    if (!currentProfile || !voiceId || voiceId === "default") return;
    setSavingDefault(true);
    try {
      const selectedVoice = voices.find(v => v.voice_id === voiceId);
      const res = await apiGetWithRetry(`/profiles/${currentProfile.id}`);
      if (!res.ok) throw new Error("Failed to load profile");
      const profileData = await res.json();
      const existingTts = profileData.tts_settings || {};

      const ttsSettings = {
        ...existingTts,
        provider: "elevenlabs",
        voice_id: voiceId,
        voice_name: selectedVoice?.name || "",
      };

      const patchRes = await apiPatch(`/profiles/${currentProfile.id}`, { tts_settings: ttsSettings });
      if (!patchRes.ok) throw new Error("Failed to save default voice");
      setDefaultVoiceId(voiceId);
    } catch (err) {
      handleApiError(err, "Failed to save default voice");
    } finally {
      setSavingDefault(false);
    }
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
      const restoredTts: Record<number, { audio_duration: number; generating: boolean; stale: boolean }> = {};
      Object.entries(historyTtsInfo).forEach(([key, info]) => {
        if (info.has_audio) {
          restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
        }
      });
      // Fall back to preview_info if no tts_info available
      if (Object.keys(restoredTts).length === 0) {
        Object.entries(historyPreviewInfo).forEach(([key, info]) => {
          if (info.has_audio) {
            restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
          }
        });
      }
      setTtsResults(restoredTts);
      setStep(2);
      setSelectedHistoryId(null);
      setHistoryScripts([]);
      setHistorySelectedScripts(new Set());
      setPreviews({});
      setPreviewError(null);
      // Restore source video selection from DB
      setSelectedSourceIds(new Set());
      restoreSourceSelection(pid);
      return;
    }

    // Only create a new pipeline when importing a subset of scripts
    const historyItem = historyPipelines.find(p => p.pipeline_id === selectedHistoryId);

    setHistoryImporting(true);
    try {
      const res = await apiPost("/pipeline/import", {
        scripts: selected,
        idea: historyItem?.idea || "Imported from history",
        provider: "imported",
      });

      if (res.ok) {
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
      } else {
        const errorData = await res.json().catch(() => ({ detail: "Failed to import scripts" }));
        setError(errorData.detail || "Failed to import scripts");
      }
    } catch (err) {
      handleApiError(err, "Failed to import scripts");
    } finally {
      setHistoryImporting(false);
    }
  };

  // Audio preview: play/pause toggle
  const handlePlayAudio = (pipelineId: string, variantIndex: number) => {
    const audioKey = `${pipelineId}-${variantIndex}`;

    if (playingAudio === audioKey) {
      // Pause current audio
      audioRef.current?.pause();
      setPlayingAudio(null);
      return;
    }

    // Stop previous audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setPlayingAudio(audioKey);
    // Revoke any pending blob URL before creating a new one to prevent memory leaks
    if (pendingBlobUrl.current) {
      URL.revokeObjectURL(pendingBlobUrl.current);
      pendingBlobUrl.current = null;
    }
    apiGet(`/pipeline/audio/${pipelineId}/${variantIndex}`)
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        pendingBlobUrl.current = url;
        const audio = new Audio(url);
        audio.onended = () => { setPlayingAudio(null); pendingBlobUrl.current = null; URL.revokeObjectURL(url); };
        audio.onerror = () => { setPlayingAudio(null); pendingBlobUrl.current = null; URL.revokeObjectURL(url); };
        audio.play().catch(() => { setPlayingAudio(null); pendingBlobUrl.current = null; URL.revokeObjectURL(url); });
        audioRef.current = audio;
      })
      .catch((err) => {
        console.warn("Audio playback failed:", err);
        setPlayingAudio(null);
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
      if (sourceSelectionTimer.current) clearTimeout(sourceSelectionTimer.current);
      if (ttsLibraryCheckTimer.current) clearTimeout(ttsLibraryCheckTimer.current);
      previewAbortRef.current?.abort();
    };
  }, []);

  // Mark existing TTS results as stale when voice settings change (skip initial mount)
  useEffect(() => {
    if (!voiceSettingsInitialized.current) {
      voiceSettingsInitialized.current = true;
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
  }, [voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost]);

  // Load voice settings from localStorage after hydration
  useEffect(() => {
    const stability = localStorage.getItem("ef_voice_stability");
    const similarity = localStorage.getItem("ef_voice_similarity");
    const style = localStorage.getItem("ef_voice_style");
    const speed = localStorage.getItem("ef_voice_speed");
    const boost = localStorage.getItem("ef_voice_speaker_boost");
    const wps = localStorage.getItem("ef_words_per_subtitle");
    if (stability !== null) setVoiceStability(parseFloat(stability));
    if (similarity !== null) setVoiceSimilarity(parseFloat(similarity));
    if (style !== null) setVoiceStyle(parseFloat(style));
    if (speed !== null) setVoiceSpeed(parseFloat(speed));
    if (boost !== null) setVoiceSpeakerBoost(boost === "true");
    if (wps !== null) setWordsPerSubtitle(parseInt(wps, 10));
    voiceSettingsLoaded.current = true;
  }, []);

  // Persist voice settings to localStorage (skip initial render before load)
  useEffect(() => {
    if (!voiceSettingsLoaded.current) return;
    localStorage.setItem("ef_voice_stability", String(voiceStability));
    localStorage.setItem("ef_voice_similarity", String(voiceSimilarity));
    localStorage.setItem("ef_voice_style", String(voiceStyle));
    localStorage.setItem("ef_voice_speed", String(voiceSpeed));
    localStorage.setItem("ef_voice_speaker_boost", String(voiceSpeakerBoost));
    localStorage.setItem("ef_words_per_subtitle", String(wordsPerSubtitle));
  }, [voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost, wordsPerSubtitle]);

  // Per-script TTS: generate voice-over for a single script
  const handleGenerateTts = async (variantIndex: number) => {
    if (!pipelineId) return;

    setTtsResults(prev => ({
      ...prev,
      [variantIndex]: { audio_duration: 0, generating: true, stale: false }
    }));

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
      }, { timeout: 300_000 });

      if (res.ok) {
        const data = await res.json();
        setTtsResults(prev => ({
          ...prev,
          [variantIndex]: { audio_duration: data.audio_duration, generating: false, stale: false }
        }));
      } else {
        const errorData = await res.json().catch(() => ({ detail: "TTS generation failed" }));
        setPreviewError(errorData.detail || "TTS generation failed");
        setTtsResults(prev => {
          const next = { ...prev };
          delete next[variantIndex];
          return next;
        });
      }
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

  // Per-script TTS: adopt library audio instead of generating
  const handleUseLibraryTts = async (variantIndex: number) => {
    if (!pipelineId) return;
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

      if (res.ok) {
        const data = await res.json();
        setTtsResults(prev => ({
          ...prev,
          [variantIndex]: { audio_duration: data.audio_duration, generating: false, stale: false }
        }));
      } else {
        const errorData = await res.json().catch(() => ({ detail: "Failed to load library audio" }));
        setPreviewError(errorData.detail || "Failed to load library audio");
        setTtsResults(prev => {
          const next = { ...prev };
          delete next[variantIndex];
          return next;
        });
      }
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
      ttsAudioRef.current?.pause();
      setPlayingTtsVariant(null);
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
      const audio = new Audio(url);
      audio.onended = () => { setPlayingTtsVariant(null); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPlayingTtsVariant(null); URL.revokeObjectURL(url); };
      audio.play().catch(() => { setPlayingTtsVariant(null); URL.revokeObjectURL(url); });
      ttsAudioRef.current = audio;
    };

    // Try Step 2 TTS audio first, fall back to Step 3 preview audio
    apiGet(`/pipeline/tts-audio/${pipelineId}/${variantIndex}`)
      .then(res => res.blob())
      .then(playBlob)
      .catch(() => {
        // Fallback: try preview audio (Step 3)
        apiGet(`/pipeline/audio/${pipelineId}/${variantIndex}`)
          .then(res => res.blob())
          .then(playBlob)
          .catch(() => setPlayingTtsVariant(null));
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
      if (res.ok) {
        const data: AssociationResponse[] = await res.json();
        const map: Record<string, AssociationResponse> = {};
        for (const a of data) {
          map[a.segment_id] = a;
        }
        setAssociations(prev => ({ ...prev, ...map }));
      }
    } catch (error) {
      handleApiError(error, "Failed to load product associations");
    }
  }, []);

  // Trigger association fetch when previews arrive
  useEffect(() => {
    const segIds = new Set<string>();
    for (const preview of Object.values(previews)) {
      for (const match of preview.matches) {
        if (match.segment_id) segIds.add(match.segment_id);
      }
    }
    const ids = Array.from(segIds);
    if (ids.length > 0) fetchAssociations(ids);
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
              Multi-Variant Pipeline
            </h1>
            <p className="text-muted-foreground mt-2">
              End-to-end workflow: generate scripts → preview matches → batch render
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {[
              { num: 1, label: "Idea Input" },
              { num: 2, label: "Review Scripts" },
              { num: 3, label: "Preview Matches" },
              { num: 4, label: "Render Videos" },
            ].map((s, index) => (
              <div key={s.num} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                      step === s.num
                        ? "bg-primary text-primary-foreground"
                        : step > s.num
                        ? "bg-green-600 text-white cursor-pointer hover:bg-green-700 transition-colors"
                        : "bg-secondary text-muted-foreground"
                    }`}
                    onClick={() => {
                      if (step > s.num) setStep(s.num);
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
            ))}
          </div>
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
                        className="resize-y text-sm"
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

                {/* Idea textarea */}
                <div className="space-y-2">
                  <Label htmlFor="idea">Video Idea *</Label>
                  <Textarea
                    id="idea"
                    placeholder="Describe your video idea..."
                    rows={5}
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    className="resize-y"
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
                    <Textarea
                      id="context"
                      placeholder="Additional context (brand info, instructions)..."
                      rows={3}
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                      className="resize-none max-h-[200px] overflow-y-auto"
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

                      {/* Quick action bar (visible when products selected) */}
                      {selectedCatalogIds.size > 0 && (
                        <div className="flex items-center justify-between bg-primary/10 rounded-md px-3 py-1.5">
                          <span className="text-xs font-medium">
                            {selectedCatalogIds.size} selected
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7"
                            onClick={handleAddToContext}
                          >
                            Add to Context
                          </Button>
                        </div>
                      )}

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
                <div className="grid grid-cols-2 gap-4">
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
                    <span>{Math.round(totalSegmentDuration)}s material video disponibil</span>
                  </div>
                )}

                {/* Generate button */}
                <Button
                  onClick={handleGenerate}
                  disabled={!idea.trim() || isGenerating}
                  className="w-full"
                  size="lg"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Scripts
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 2 — Review Scripts */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Review Scripts ({scripts.length})</h2>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Input
              </Button>
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
                      <Label className="text-xs">Cuvinte per subtitrare</Label>
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
                    <p className="text-[10px] text-muted-foreground">Mai putine cuvinte = subtitrari mai dinamice (TikTok style)</p>
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
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Script {index + 1}</CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {wordCount} words (~{formatDuration(estimatedDuration)})
                          </Badge>
                          {scripts.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Șterge scriptul"
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
                        <Alert className="border-blue-500/50 bg-blue-500/10">
                          <Info className="h-4 w-4 text-blue-500" />
                          <AlertDescription className="text-blue-700 dark:text-blue-400 text-sm">
                            Scriptul depășește materialul video disponibil ({Math.round(totalSegmentDuration)}s) cu ~{estimatedDuration - Math.round(totalSegmentDuration)}s. Segmentele vor fi repetate pentru a acoperi diferența.
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}
                    <CardContent className="space-y-3">
                      <Textarea
                        id={`script-textarea-${index}`}
                        value={script}
                        onChange={(e) => {
                          const newScripts = [...scripts];
                          newScripts[index] = e.target.value;
                          setScripts(newScripts);
                          if (pipelineId) saveScriptsToBackend(pipelineId, newScripts);
                          // Mark TTS as stale if it exists
                          if (ttsResults[index] && !ttsResults[index].generating) {
                            setTtsResults(prev => ({
                              ...prev,
                              [index]: { ...prev[index], stale: true }
                            }));
                          }
                          // Clear any stale preview error so the banner doesn't persist during editing
                          if (previewError) setPreviewError(null);
                        }}
                        rows={10}
                        className="resize-y font-mono text-sm"
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
                      <div className="flex items-center gap-2">
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
                            <Badge variant="secondary" className="text-xs">
                              {formatDuration(ttsResults[index].audio_duration)}
                            </Badge>
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
                            className="text-xs text-blue-600 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950"
                            onClick={() => handleUseLibraryTts(index)}
                          >
                            <Library className="h-3.5 w-3.5 mr-1.5" />
                            Use Library Audio ({formatDuration(libraryMatches[index].audio_duration)})
                          </Button>
                        )}
                      </div>
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
                        src={`${API_URL.replace('/api/v1', '')}/thumbnails/${sourceVideos[0].thumbnail_path.split('/').pop()}`}
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
                    {sourceVideos.length > 3 && (
                      <div className="relative">
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
                        />
                        {video.thumbnail_path ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${API_URL.replace('/api/v1', '')}/thumbnails/${video.thumbnail_path.split('/').pop()}`}
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
                        ? "Toate scripturile au voice-over generat"
                        : `${ttsCount} din ${scripts.length} scripturi au voice-over. Restul de ${scripts.length - ttsCount} vor fi generate automat.`}
                    </span>
                    <div className="flex items-center gap-2">
                      {selectedSourceIds.size === 0 && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          Selectează un videoclip cu segmente mai sus ↑
                        </span>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-green-400 text-green-700 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-900"
                        onClick={handlePreviewAll}
                        disabled={isGenerating || previewingIndex !== null || sourceVideos.length === 0 || selectedSourceIds.size === 0}
                      >
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                        {previewingIndex !== null ? "Se generează preview..." : "Continuă la Preview"}
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              );
            })()}

            {/* Preview All button */}
            {(() => {
              const readyTtsCount = Object.values(ttsResults).filter(r => !r.generating && !r.stale).length;
              const allTtsReady = readyTtsCount === scripts.length && scripts.length > 0;
              return (
                <Button
                  onClick={handlePreviewAll}
                  disabled={isGenerating || previewingIndex !== null || sourceVideos.length === 0 || selectedSourceIds.size === 0}
                  className="w-full"
                  size="lg"
                >
                  {previewingIndex !== null ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {allTtsReady
                        ? `Generare preview ${previewingIndex + 1} din ${scripts.length}...`
                        : `Generating voice-over ${previewingIndex + 1} of ${scripts.length}...`}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      {allTtsReady ? "Generează Preview-uri" : "Generate Voice-Overs"}
                    </>
                  )}
                </Button>
              );
            })()}
            {Object.keys(previews).length > 0 && (
              <Button
                variant="outline"
                onClick={() => setStep(3)}
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
                Preview & Select Variants ({selectedVariants.size} selected)
              </h2>
              <Button variant="outline" onClick={() => setStep(2)}>
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

            {/* Subtitle Style */}
            <Card className={!subtitleSettingsLoaded ? "opacity-60 pointer-events-none" : ""}>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Type className="h-4 w-4" />
                  Subtitle Style
                  {!subtitleSettingsLoaded && <Loader2 className="h-3 w-3 animate-spin" />}
                </CardTitle>
                <CardDescription>
                  Configure font, colors, and position for subtitles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SubtitleEditor
                  settings={subtitleSettings}
                  onSettingsChange={handleSubtitleSettingsChange}
                  showPreview={true}
                  previewHeight={350}
                  compact={false}
                />
              </CardContent>
            </Card>

            {/* Variant preview grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {scripts.map((script, index) => {
                const preview = previews[index];
                if (!preview) return null;

                return (
                  <Card key={index} className="overflow-hidden">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedVariants.has(index)}
                            onCheckedChange={() => toggleVariant(index)}
                          />
                          <CardTitle className="text-lg">Variant {index + 1}</CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePlayAudio(pipelineId!, index)}
                            title={playingAudio === `${pipelineId}-${index}` ? "Stop audio" : "Play voiceover"}
                          >
                            {playingAudio === `${pipelineId}-${index}` ? (
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
                              setPreviewVariant(index);
                            }}
                            title="Preview variant with video"
                          >
                            <Eye className="h-4 w-4" />
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

                      {/* Full timeline editor */}
                      <TimelineEditor
                        matches={preview.matches}
                        audioDuration={preview.audio_duration}
                        sourceVideoIds={Array.from(selectedSourceIds)}
                        availableSegments={availableSegments}
                        profileId={currentProfile?.id}
                        pipelineId={pipelineId ?? undefined}
                        variantIndex={index}
                        subtitleSettings={subtitleSettings}
                        onMatchesChange={(updatedMatches) => {
                          setPreviews(prev => ({
                            ...prev,
                            [index]: {
                              ...prev[index],
                              matches: updatedMatches,
                              matched_count: updatedMatches.filter(m => m.segment_id !== null).length,
                              unmatched_count: updatedMatches.filter(m => m.segment_id === null).length,
                            }
                          }));
                        }}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Variant preview player dialog */}
            {previewVariant !== null && pipelineId && currentProfile && (
              <VariantPreviewPlayer
                open={true}
                onOpenChange={(open) => { if (!open) setPreviewVariant(null); }}
                matches={previews[previewVariant]?.matches ?? []}
                pipelineId={pipelineId}
                variantIndex={previewVariant}
                profileId={currentProfile.id}
                subtitleSettings={subtitleSettings}
              />
            )}

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {/* Render button */}
            <Button
              onClick={handleRender}
              disabled={isRendering || selectedVariants.size === 0}
              className="w-full"
              size="lg"
            >
              <Play className="h-4 w-4 mr-2" />
              {isRendering ? "Rendering..." : `Render Selected (${selectedVariants.size})`}
            </Button>
          </div>
        )}

        {/* Step 4 — Render Progress */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Render Progress</h2>
              <Button variant="outline" onClick={resetPipeline}>
                <Sparkles className="h-4 w-4 mr-2" />
                Start New Pipeline
              </Button>
            </div>

            {/* Variant status grid */}
            {variantStatuses.length === 0 ? (
              <EmptyState
                icon={<Workflow className="h-6 w-6" />}
                title="Niciun pipeline"
                description="Configureaza un pipeline pentru a genera video-uri."
              />
            ) : null}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {variantStatuses.map((status) => (
                <Card key={status.variant_index}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        Variant {status.variant_index + 1}
                      </CardTitle>
                      <Badge
                        variant={
                          status.status === "completed"
                            ? "default"
                            : status.status === "failed"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {status.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Progress bar */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-semibold">{status.progress}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${status.progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Current step */}
                    <p className="text-sm text-muted-foreground">{status.current_step}</p>

                    {/* Inline video player + download button */}
                    {status.status === "completed" && status.final_video_path && (
                      <div className="space-y-3">
                        <video
                          controls
                          className="w-full rounded-md bg-black max-h-64 object-contain"
                          poster={
                            status.thumbnail_path
                              ? `${API_URL}/library/files/${encodeURIComponent(status.thumbnail_path)}`
                              : undefined
                          }
                          preload="none"
                        >
                          <source
                            src={`${API_URL}/library/files/${encodeURIComponent(status.final_video_path)}`}
                            type="video/mp4"
                          />
                          Your browser does not support HTML5 video.
                        </video>
                        <Button variant="outline" className="w-full" asChild>
                          <a
                            href={`${API_URL}/library/files/${encodeURIComponent(
                              status.final_video_path
                            )}`}
                            download
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download Video
                          </a>
                        </Button>
                      </div>
                    )}

                    {/* Library save warning */}
                    {status.status === "completed" && status.library_saved === false && (
                      <Alert className="border-yellow-500/50 bg-yellow-500/10">
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                          Video renderizat cu succes, dar nu a fost salvat în library.
                          {status.library_error && <span className="block text-xs mt-1 opacity-75">{status.library_error}</span>}
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto text-yellow-700 dark:text-yellow-400 underline ml-1"
                            onClick={async () => {
                              try {
                                await apiPost(`/pipeline/sync-to-library/${pipelineId}`);
                                const res = await apiGet(`/pipeline/status/${pipelineId}`);
                                if (res.ok) {
                                  const data = await res.json();
                                  if (data?.variants) setVariantStatuses(data.variants);
                                }
                              } catch {
                                // ignore — user can retry
                              }
                            }}
                          >
                            Retry salvare
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
                            <p
                              className={`text-sm font-medium cursor-pointer ${
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
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleDeletePipeline(item.pipeline_id, e as unknown as React.MouseEvent); } }}
                              className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                              title="Șterge pipeline"
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
                            {new Date(item.created_at).toLocaleDateString()}
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
                                            ? "bg-green-500 text-white"
                                            : "bg-green-500/90 text-white hover:bg-green-600"
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
                                    const restoredTts: Record<number, { audio_duration: number; generating: boolean; stale: boolean }> = {};
                                    Object.entries(historyTtsInfo).forEach(([key, info]) => {
                                      if (info.has_audio) {
                                        restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
                                      }
                                    });
                                    if (Object.keys(restoredTts).length === 0) {
                                      Object.entries(historyPreviewInfo).forEach(([key, info]) => {
                                        if (info.has_audio) {
                                          restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
                                        }
                                      });
                                    }
                                    setTtsResults(restoredTts);
                                    // Restore source video selection so product groups load
                                    setSelectedSourceIds(new Set());
                                    restoreSourceSelection(selectedHistoryId);
                                    setStep(2);
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
    </div>
  );
}
