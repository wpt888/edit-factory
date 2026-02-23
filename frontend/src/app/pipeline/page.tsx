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
import { apiGet, apiGetWithRetry, apiPost, apiDelete, API_URL, handleApiError } from "@/lib/api";
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
  Package,
  Images,
  X,
} from "lucide-react";
import { usePolling } from "@/hooks";
import { EmptyState } from "@/components/empty-state";
import { ProductPickerDialog } from "@/components/product-picker-dialog";
import { ImagePickerDialog } from "@/components/image-picker-dialog";
import type { AssociationResponse } from "@/components/product-picker-dialog";

// TypeScript interfaces
interface MatchPreview {
  srt_index: number;
  srt_text: string;
  srt_start: number;
  srt_end: number;
  segment_id: string | null;
  segment_keywords: string[];
  matched_keyword: string | null;
  confidence: number;
}

interface PreviewData {
  audio_duration: number;
  srt_content: string;
  matches: MatchPreview[];
  total_phrases: number;
  matched_count: number;
  unmatched_count: number;
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
  error?: string;
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

  // Format helpers
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const countWords = (text: string): number => {
    return text.trim().split(/\s+/).filter(Boolean).length;
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
      });

      if (res.ok) {
        const data = await res.json();
        setPipelineId(data.pipeline_id);
        setScripts(data.scripts || []);
        setStep(2);
      } else {
        const errorData = await res.json().catch(() => ({
          detail: "Failed to generate scripts",
        }));
        setError(errorData.detail || "Failed to generate scripts");
      }
    } catch (err) {
      handleApiError(err, "Eroare la generarea scripturilor");
      setError("Network error. Please check if the backend is running.");
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
        });

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
        setPreviewError("Network error. Please check if the backend is running.");
        setPreviewingIndex(null);
        return;
      }
    }

    setPreviews(newPreviews);
    setPreviewingIndex(null);

    // Select all variants by default
    const allIndices = new Set(scripts.map((_, i) => i));
    setSelectedVariants(allIndices);

    setStep(3);
  };

  // Step 3: Render selected variants
  const handleRender = async () => {
    if (!pipelineId || selectedVariants.size === 0) return;

    setIsRendering(true);
    setVariantStatuses([]);

    try {
      const res = await apiPost(`/pipeline/render/${pipelineId}`, {
        variant_indices: Array.from(selectedVariants),
        preset_name: presetName,
        elevenlabs_model: elevenlabsModel,
        voice_id: voiceId && voiceId !== "default" ? voiceId : undefined,
        subtitle_settings: {
          enable_subtitles: true,
          font_size: 24,
          outline_width: 2,
          position_y: 0.8,
        },
        video_filters: {
          enable_denoise: false,
          enable_sharpen: false,
          enable_color_enhancement: false,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setVariantStatuses(data.variants || []);
        setStep(4);
      } else {
        const errorData = await res.json().catch(() => ({
          detail: "Failed to start render",
        }));
        setPreviewError(errorData.detail || "Failed to start render");
        setIsRendering(false);
      }
    } catch (err) {
      handleApiError(err, "Eroare la generarea variantelor");
      setPreviewError("Network error. Please check if the backend is running.");
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
      }
    } catch (err) {
      handleApiError(err, "Failed to load pipeline scripts");
    } finally {
      setHistoryScriptsLoading(false);
    }
  };

  // History sidebar: auto-load on mount
  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // History sidebar: import selected scripts
  const handleHistoryImport = async () => {
    const selected = historyScripts.filter((_, i) => historySelectedScripts.has(i));
    if (selected.length === 0) return;

    // If all scripts are selected, reuse the existing pipeline (no duplicate)
    if (selected.length === historyScripts.length && selectedHistoryId) {
      setPipelineId(selectedHistoryId);
      setScripts([...historyScripts]);
      setStep(2);
      setSelectedHistoryId(null);
      setHistoryScripts([]);
      setHistorySelectedScripts(new Set());
      setPreviews({});
      setPreviewError(null);
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
        setPipelineId(data.pipeline_id);
        setScripts(data.scripts || []);
        setStep(2);
        setSelectedHistoryId(null);
        setHistoryScripts([]);
        setHistorySelectedScripts(new Set());
        setPreviews({});
        setPreviewError(null);
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

  const handleRemoveAssociation = async (segmentId: string) => {
    try {
      const res = await apiDelete(`/associations/segment/${segmentId}`);
      if (res.ok) {
        setAssociations(prev => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    } catch (error) {
      handleApiError(error, "Failed to remove product association");
    }
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
                        ? "bg-green-600 text-white"
                        : "bg-secondary text-muted-foreground"
                    }`}
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
                  <Select value={voiceId} onValueChange={setVoiceId}>
                    <SelectTrigger id="tts-voice" disabled={voicesLoading}>
                      <SelectValue placeholder={voicesLoading ? "Loading voices..." : "Default voice (from settings)"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default voice (from settings)</SelectItem>
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
                                    {voice.name}{voice.language ? ` (${voice.language})` : ""}
                                  </SelectItem>
                                ))}
                              </>
                            )}
                            {premade.length > 0 && (
                              <>
                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Library</div>
                                {premade.map((voice) => (
                                  <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                    {voice.name}{voice.language ? ` (${voice.language})` : ""}
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </>
                        );
                      })()}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Scripts grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {scripts.map((script, index) => {
                const wordCount = countWords(script);
                const estimatedDuration = Math.round(wordCount / 2.5);

                return (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Script {index + 1}</CardTitle>
                        <Badge variant="outline">
                          {wordCount} words (~{estimatedDuration}s)
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        value={script}
                        onChange={(e) => {
                          const newScripts = [...scripts];
                          newScripts[index] = e.target.value;
                          setScripts(newScripts);
                        }}
                        rows={6}
                        className="resize-y font-mono text-sm"
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

            {/* Preview All button */}
            <Button
              onClick={handlePreviewAll}
              disabled={previewingIndex !== null}
              className="w-full"
              size="lg"
            >
              {previewingIndex !== null ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Previewing variant {previewingIndex + 1} of {scripts.length}...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Preview All Matches
                </>
              )}
            </Button>
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

            {/* Variant preview grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {scripts.map((script, index) => {
                const preview = previews[index];
                if (!preview) return null;

                const topMatches = preview.matches.slice(0, 3);

                return (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedVariants.has(index)}
                            onCheckedChange={() => toggleVariant(index)}
                          />
                          <CardTitle className="text-lg">Variant {index + 1}</CardTitle>
                        </div>
                        <Badge variant="secondary">
                          {formatDuration(preview.audio_duration)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Match summary */}
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
                      </div>

                      {/* Top matches */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-muted-foreground">
                          Top 3 Matches:
                        </p>
                        {topMatches.map((match, mIndex) => {
                          const isMatched = match.confidence > 0;
                          const textPreview =
                            match.srt_text.length > 40
                              ? match.srt_text.substring(0, 40) + "..."
                              : match.srt_text;

                          return (
                            <div
                              key={mIndex}
                              className="p-2 border rounded text-xs space-y-1"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-muted-foreground flex-1">
                                  {textPreview}
                                </p>
                                {isMatched ? (
                                  <Badge variant="default" className="text-xs">
                                    {Math.round(match.confidence * 100)}%
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive" className="text-xs">
                                    No match
                                  </Badge>
                                )}
                              </div>
                              {/* Product association for matched segment */}
                              {match.segment_id && (() => {
                                const segId = match.segment_id;
                                const assoc = associations[segId];
                                return (
                                  <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-border/50">
                                    {assoc ? (
                                      <>
                                        {assoc.product_image && (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={assoc.product_image}
                                            alt=""
                                            className="w-5 h-5 rounded object-cover flex-shrink-0"
                                          />
                                        )}
                                        <span className="text-[10px] truncate flex-1" title={assoc.product_title || ""}>
                                          {assoc.product_title || "Product"}
                                        </span>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-5 w-5"
                                          title="Select images"
                                          onClick={() => setImagePickerAssoc(assoc)}
                                        >
                                          <Images className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-5 w-5 text-destructive"
                                          title="Remove product"
                                          onClick={() => handleRemoveAssociation(segId)}
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-5 text-[10px] px-1.5 text-muted-foreground"
                                        onClick={() => setPickerSegmentId(segId)}
                                      >
                                        <Package className="h-3 w-3 mr-1" />
                                        Add Product
                                      </Button>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
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

                    {/* Download button */}
                    {status.status === "completed" && status.final_video_path && (
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
                          <ChevronRight className={`h-4 w-4 flex-shrink-0 transition-transform ${
                            selectedHistoryId === item.pipeline_id ? "rotate-90" : ""
                          }`} />
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
                              {historyScripts.map((script, idx) => (
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
                                  <p className="text-xs text-muted-foreground line-clamp-3">
                                    {script}
                                  </p>
                                </div>
                              ))}
                              <div className="flex gap-2 pt-1">
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  disabled={historyImporting}
                                  onClick={() => {
                                    // Reuse existing pipeline directly (no duplicate creation)
                                    if (!selectedHistoryId) return;
                                    const historyItem = historyPipelines.find(p => p.pipeline_id === selectedHistoryId);
                                    setPipelineId(selectedHistoryId);
                                    setScripts([...historyScripts]);
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
