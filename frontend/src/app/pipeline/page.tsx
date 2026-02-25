"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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

export default function PipelinePage() {
  const { currentProfile } = useProfile();

  // Step tracking
  const [step, setStep] = useState(1);

  // Step 1: Input
  const [idea, setIdea] = useState("");
  const [context, setContext] = useState("");
  const [contextProducts, setContextProducts] = useState<ContextProduct[]>([]);
  const [variantCount, setVariantCount] = useState(3);
  const [provider, setProvider] = useState("gemini");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2: Scripts
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [scripts, setScripts] = useState<string[]>([]);

  // Step 3: Preview
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Record<number, PreviewData>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [elevenlabsModel, setElevenlabsModel] = useState("eleven_flash_v2_5");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [defaultVoiceId, setDefaultVoiceId] = useState("");
  const [savingDefault, setSavingDefault] = useState(false);
  // ElevenLabs voice settings (persisted to localStorage)
  const [voiceStability, setVoiceStability] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ef_voice_stability");
      return saved !== null ? parseFloat(saved) : 0.5;
    }
    return 0.5;
  });
  const [voiceSimilarity, setVoiceSimilarity] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ef_voice_similarity");
      return saved !== null ? parseFloat(saved) : 0.75;
    }
    return 0.75;
  });
  const [voiceStyle, setVoiceStyle] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ef_voice_style");
      return saved !== null ? parseFloat(saved) : 0.0;
    }
    return 0.0;
  });
  const [voiceSpeed, setVoiceSpeed] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ef_voice_speed");
      return saved !== null ? parseFloat(saved) : 1.0;
    }
    return 1.0;
  });
  const [voiceSpeakerBoost, setVoiceSpeakerBoost] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ef_voice_speaker_boost");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

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

  // TTS Library duplicate detection
  const [libraryMatches, setLibraryMatches] = useState<Record<number, { asset_id: string; audio_duration: number }>>({});

  // Script auto-save timer
  const scriptSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const sourceSelectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Available segments for timeline editor (collected from preview response)
  const [availableSegments, setAvailableSegments] = useState<SegmentOption[]>([]);

  // Subtitle settings state
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>({ ...DEFAULT_SUBTITLE_SETTINGS });
  const [, setSubtitleSettingsLoaded] = useState(false);
  const subtitleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Format helpers
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const countWords = (text: string): number => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

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
  }, []);

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
        if (pipelineId) {
          apiPut(`/pipeline/${pipelineId}/source-selection`, {
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
      const variants = data.variants || [];
      setVariantStatuses(variants);
      const allComplete = variants.every(
        (v) => v.status === "completed" || v.status === "failed"
      );
      if (allComplete && variants.length > 0) {
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
        setStep(2);
      } else {
        const errorData = await res.json().catch(() => ({
          detail: "Failed to generate scripts",
        }));
        setError(errorData.detail || "Failed to generate scripts");
      }
    } catch (err) {
      handleApiError(err, "Eroare la generarea scripturilor");
      if (err instanceof ApiError && err.isTimeout) {
        setError("Generarea scripturilor a expirat. Încearcă din nou.");
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

    setPreviewError(null);
    const newPreviews: Record<number, PreviewData> = {};

    for (let i = 0; i < scripts.length; i++) {
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
        }, { timeout: 300_000 }); // 5 min — TTS generation + SRT can be slow

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
        handleApiError(err, "Eroare la previzualizarea variantelor");
        if (err instanceof ApiError && err.isTimeout) {
          setPreviewError("Previzualizarea a expirat. Încearcă din nou.");
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
      if (err instanceof ApiError && err.isTimeout) {
        setPreviewError("Randarea a expirat. Încearcă din nou.");
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

  // History sidebar: auto-load on mount
  useEffect(() => {
    fetchHistory();
  }, []);

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
      } catch {
        // Silent — duplicate check is advisory only
      }
    };

    checkDuplicates();
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
      // Carry over TTS results from history preview info
      const restoredTts: Record<number, { audio_duration: number; generating: boolean; stale: boolean }> = {};
      Object.entries(historyPreviewInfo).forEach(([key, info]) => {
        if (info.has_audio) {
          restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
        }
      });
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

    const audio = new Audio(`${API_URL}/pipeline/audio/${pipelineId}/${variantIndex}`);
    audio.onended = () => setPlayingAudio(null);
    audio.onerror = () => setPlayingAudio(null);
    audio.play().catch(() => setPlayingAudio(null));
    audioRef.current = audio;
    setPlayingAudio(audioKey);
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
    };
  }, []);

  // Mark existing TTS results as stale when voice settings change
  useEffect(() => {
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

  // Persist voice settings to localStorage
  useEffect(() => {
    localStorage.setItem("ef_voice_stability", String(voiceStability));
    localStorage.setItem("ef_voice_similarity", String(voiceSimilarity));
    localStorage.setItem("ef_voice_style", String(voiceStyle));
    localStorage.setItem("ef_voice_speed", String(voiceSpeed));
    localStorage.setItem("ef_voice_speaker_boost", String(voiceSpeakerBoost));
  }, [voiceStability, voiceSimilarity, voiceStyle, voiceSpeed, voiceSpeakerBoost]);

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

    const audio = new Audio(`${API_URL}/pipeline/tts-audio/${pipelineId}/${variantIndex}`);
    audio.onended = () => setPlayingTtsVariant(null);
    audio.onerror = () => setPlayingTtsVariant(null);
    audio.play().catch(() => setPlayingTtsVariant(null));
    ttsAudioRef.current = audio;
    setPlayingTtsVariant(variantIndex);
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
                </div>
              </CardContent>
            </Card>

            {/* Scripts list — single column so each sentence has room */}
            <div className="grid grid-cols-1 gap-4">
              {scripts.map((script, index) => {
                const wordCount = countWords(script);
                const estimatedDuration = Math.round(wordCount / 2.5);

                return (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Script {index + 1}</CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {wordCount} words (~{estimatedDuration}s)
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
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Textarea
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
                        }}
                        rows={10}
                        className="resize-y font-mono text-sm"
                      />

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
                      {ttsCount} din {scripts.length} scripturi au deja voice-over generat
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
            <Button
              onClick={handlePreviewAll}
              disabled={isGenerating || previewingIndex !== null || sourceVideos.length === 0 || selectedSourceIds.size === 0}
              className="w-full"
              size="lg"
            >
              {previewingIndex !== null ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating voice-over {previewingIndex + 1} of {scripts.length}...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Voice-Overs
                </>
              )}
            </Button>
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
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Type className="h-4 w-4" />
                  Subtitle Style
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
                            onClick={() => {
                              const audioKey = `${pipelineId}-${index}`;
                              if (playingAudio === audioKey) {
                                // Stop
                                const audios = document.querySelectorAll('audio');
                                audios.forEach(a => { a.pause(); a.remove(); });
                                setPlayingAudio(null);
                              } else {
                                // Stop any previous
                                const audios = document.querySelectorAll('audio');
                                audios.forEach(a => { a.pause(); a.remove(); });
                                // Play from pipeline audio endpoint
                                const audio = new Audio(`${API_URL}/pipeline/audio/${pipelineId}/${index}`);
                                audio.onended = () => setPlayingAudio(null);
                                audio.onerror = () => setPlayingAudio(null);
                                audio.play().catch(() => setPlayingAudio(null));
                                setPlayingAudio(audioKey);
                              }
                            }}
                            title={playingAudio === `${pipelineId}-${index}` ? "Stop audio" : "Play voiceover"}
                          >
                            {playingAudio === `${pipelineId}-${index}` ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Volume2 className="h-4 w-4" />
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

                      {/* Full timeline editor */}
                      <TimelineEditor
                        matches={preview.matches}
                        audioDuration={preview.audio_duration}
                        sourceVideoIds={Array.from(selectedSourceIds)}
                        availableSegments={availableSegments}
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
              disabled={selectedVariants.size === 0}
              className="w-full"
              size="lg"
            >
              <Play className="h-4 w-4 mr-2" />
              Render Selected ({selectedVariants.size})
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
                      <button
                        onClick={() => fetchHistoryScripts(item.pipeline_id)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors hover:bg-accent ${
                          selectedHistoryId === item.pipeline_id ? "border-primary bg-accent" : "border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate flex-1 mr-2">
                            {item.idea.length > 50 ? item.idea.substring(0, 50) + "..." : item.idea}
                          </p>
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
                            <ChevronRight className={`h-4 w-4 transition-transform ${
                              selectedHistoryId === item.pipeline_id ? "rotate-90" : ""
                            }`} />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">{item.provider}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {item.variant_count} scripts
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </button>

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
                                    // Carry over TTS results from history preview info
                                    const restoredTts: Record<number, { audio_duration: number; generating: boolean; stale: boolean }> = {};
                                    Object.entries(historyPreviewInfo).forEach(([key, info]) => {
                                      if (info.has_audio) {
                                        restoredTts[Number(key)] = { audio_duration: info.audio_duration, generating: false, stale: false };
                                      }
                                    });
                                    setTtsResults(restoredTts);
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
