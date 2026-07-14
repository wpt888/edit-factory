"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Sparkles,
  Loader2,
  Settings2,
  Plus,
  Trash2,
  Check,
  Copy,
  MessageSquareText,
  ChevronDown,
  Pencil,
  ShoppingBag,
  BookOpen,
  XCircle,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { apiGet, apiGetWithRetry, apiPost, apiPut, apiPatch, apiDelete } from "@/lib/api";
import { useProfile } from "@/contexts/profile-context";
import {
  readWorkspaceStorage,
  removeWorkspaceStorage,
  writeWorkspaceStorage,
} from "@/lib/workspace-session";
import { toast } from "sonner";

/* ---------- Types ---------- */

interface CompletedClip {
  clip_id: string;
  variant_index: number;
  final_video_path: string;
  thumbnail_path?: string;
}

interface CaptionTemplate {
  id: string;
  name: string;
  prompt_template: string;
  is_default: boolean;
}

interface ContextProduct {
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
  image_urls?: string[];
  product_url?: string;
  extra_fields?: Record<string, unknown>;
}

interface CatalogPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

interface PipelineCaptionGeneratorProps {
  pipelineId: string;
  completedClips: CompletedClip[];
  scripts: string[];
  contextProducts?: ContextProduct[];
  onProductsChange?: (products: ContextProduct[]) => void;
  onCaptionsGenerated: (captions: Record<string, string>) => void;
  onYoutubeTitlesGenerated?: (titles: Record<string, string>) => void;
  initialCaptions?: Record<string, string>;  // clip_id -> caption text (from DB restore)
  initialYoutubeTitles?: Record<string, string>;  // clip_id -> youtube title (from DB restore)
}

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "funny", label: "Funny" },
  { value: "luxury", label: "Luxury" },
  { value: "urgenta", label: "Urgenta" },
];

const LANGUAGES = [
  { value: "ro", label: "Romanian" },
  { value: "en", label: "English" },
];

const TEMPLATE_KEY = "pipeline.caption.template-id";
const TONE_KEY = "pipeline.caption.tone";
const LANGUAGE_KEY = "pipeline.caption.language";
const LEGACY_TEMPLATE_KEY = "ef_video_caption_template_id";
const LEGACY_TONE_KEY = "ef_video_caption_tone";
const LEGACY_LANGUAGE_KEY = "ef_video_caption_language";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

/* ---------- Component ---------- */

export function PipelineCaptionGenerator({
  pipelineId,
  completedClips,
  scripts,
  contextProducts = [],
  onProductsChange,
  onCaptionsGenerated,
  onYoutubeTitlesGenerated,
  initialCaptions,
  initialYoutubeTitles,
}: PipelineCaptionGeneratorProps) {
  const { currentProfile } = useProfile();
  const profileId = currentProfile?.id;
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const clipKey = useCallback((clip: CompletedClip) => clip.clip_id, []);

  // Manual captions per clip (always editable)
  const [manualCaptions, setManualCaptions] = useState<Record<string, string>>({});

  // Seed manual captions from initialCaptions (DB restore)
  const initialCaptionsAppliedRef = useRef(false);
  useEffect(() => {
    if (initialCaptionsAppliedRef.current) return;
    if (!initialCaptions || Object.keys(initialCaptions).length === 0) return;
    const restored: Record<string, string> = {};
    for (const clip of completedClips) {
      if (clip.clip_id in initialCaptions) {
        restored[clip.clip_id] = initialCaptions[clip.clip_id] || "";
      } else if (String(clip.variant_index) in initialCaptions) {
        restored[clip.clip_id] = initialCaptions[String(clip.variant_index)] || "";
      }
    }
    if (Object.keys(restored).length > 0) {
      setManualCaptions(prev => {
        const merged = { ...prev };
        for (const [k, v] of Object.entries(restored)) {
          if (!merged[k]?.trim()) {
            merged[k] = v;
          }
        }
        return merged;
      });
      initialCaptionsAppliedRef.current = true;
    }
  }, [initialCaptions, completedClips]);  // eslint-disable-line react-hooks/exhaustive-deps

  // AI settings state (persisted in localStorage)
  const [tone, setTone] = useState(() =>
    profileId ? readWorkspaceStorage(profileId, TONE_KEY, LEGACY_TONE_KEY) || "professional" : "professional"
  );
  const [language, setLanguage] = useState(() =>
    profileId ? readWorkspaceStorage(profileId, LANGUAGE_KEY, LEGACY_LANGUAGE_KEY) || "ro" : "ro"
  );
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [includeCta, setIncludeCta] = useState(true);
  const [generateYoutubeTitles, setGenerateYoutubeTitles] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");

  // AI generation collapsible — open by default
  const [aiSettingsOpen, setAiSettingsOpen] = useState(true);

  // Template state
  const [templates, setTemplates] = useState<CaptionTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() =>
    profileId ? readWorkspaceStorage(profileId, TEMPLATE_KEY, LEGACY_TEMPLATE_KEY) || "" : ""
  );
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(false);

  // Template management dialog
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplatePrompt, setNewTemplatePrompt] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<CaptionTemplate | null>(null);

  // Catalog product picker state
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogPagination, setCatalogPagination] = useState<CatalogPagination>({ page: 1, page_size: 20, total: 0, total_pages: 1 });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [catalogPage, setCatalogPage] = useState(1);

  // Generation state
  const [generating, setGenerating] = useState(false);
  // clip_id -> string[] (multiple AI caption options)
  const [generatedCaptions, setGeneratedCaptions] = useState<Record<string, string[]>>({});
  // clip_id -> string[] (YouTube titles per clip)
  const [generatedYoutubeTitles, setGeneratedYoutubeTitles] = useState<Record<string, string[]>>({});
  // clip_id -> manually edited YouTube title
  const [manualYoutubeTitles, setManualYoutubeTitles] = useState<Record<string, string>>({});
  // clip_id -> selected AI caption index
  const [selectedCaptionIdx, setSelectedCaptionIdx] = useState<Record<string, number>>({});

  // Persist tone/language to localStorage
  useEffect(() => {
    if (profileId) writeWorkspaceStorage(profileId, TONE_KEY, tone);
  }, [tone, profileId]);
  useEffect(() => {
    if (profileId) writeWorkspaceStorage(profileId, LANGUAGE_KEY, language);
  }, [language, profileId]);

  /* ---------- Propagate captions to parent ---------- */

  // Use a ref to always access the latest completedClips without re-creating the callback
  const completedClipsRef = useRef(completedClips);
  completedClipsRef.current = completedClips;

  const propagateCaptions = useCallback((
    manual: Record<string, string>,
    aiCaptions: Record<string, string[]>,
    aiSelections: Record<string, number>,
  ) => {
    const captionMap: Record<string, string> = {};
    for (const clip of completedClipsRef.current) {
      const key = clip.clip_id;
      const manualText = manual[key];
      if (manualText && manualText.trim()) {
        captionMap[clip.clip_id] = manualText;
      } else {
        const varCaptions = aiCaptions[key];
        const idx = aiSelections[key] ?? 0;
        if (varCaptions && varCaptions[idx]) {
          captionMap[clip.clip_id] = varCaptions[idx];
        }
      }
    }
    onCaptionsGenerated(captionMap);
  }, [onCaptionsGenerated]);

  // Re-propagate when clip_ids change (pending-* → real ids after render completes)
  // Use a stable string key to avoid infinite re-render loops from array reference changes
  const clipIdsKey = completedClips.map(c => `${c.clip_id}:${c.variant_index}`).join(",");
  useEffect(() => {
    const hasContent = Object.values(manualCaptions).some(v => v?.trim()) ||
                       Object.keys(generatedCaptions).length > 0;
    if (hasContent) {
      propagateCaptions(manualCaptions, generatedCaptions, selectedCaptionIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipIdsKey]);

  // Propagate YouTube titles to parent when they change
  useEffect(() => {
    if (!onYoutubeTitlesGenerated) return;
    const titleMap: Record<string, string> = {};
    for (const clip of completedClips) {
      const title = manualYoutubeTitles[clip.clip_id];
      if (title?.trim()) {
        titleMap[clip.clip_id] = title;
      }
    }
    if (Object.keys(titleMap).length > 0) {
      onYoutubeTitlesGenerated(titleMap);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualYoutubeTitles, clipIdsKey]);

  /* ---------- Debounced save to backend ---------- */

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Record<string, string> | null>(null);

  // Send save request that survives page unload (keepalive: true)
  const sendSave = useCallback((data: Record<string, string>, keepalive = false) => {
    // Map the frontend dev/desktop port to the backend (8000). 3947 = desktop shell.
    const url = `${window.location.origin.replace(/:3947|:3001|:3000/, ':8000')}/api/v1/pipeline/selected-captions`;
    const body = JSON.stringify({ pipeline_id: pipelineId, selected_captions: data });
    if (keepalive && navigator.sendBeacon) {
      // sendBeacon is the most reliable for page unload
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      // Normal async save (or keepalive fetch fallback)
      fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive,
      }).catch(err => console.warn("[CaptionGenerator] Auto-save failed:", err));
    }
  }, [pipelineId]);

  const flushSave = useCallback((keepalive = false) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const pending = pendingSaveRef.current;
    if (pending) {
      pendingSaveRef.current = null;
      sendSave(pending, keepalive);
    }
  }, [sendSave]);

  const saveSelectedCaptions = useCallback((manual: Record<string, string>) => {
    // Build clip_id -> caption text map for backend
    // Include empty strings too — they mark "user deliberately cleared this"
    const selected: Record<string, string> = {};
    for (const [varIdx, text] of Object.entries(manual)) {
      selected[String(varIdx)] = text ?? "";
    }
    pendingSaveRef.current = selected;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => flushSave(false), 1500);
  }, [flushSave]);

  // Flush pending save on unmount
  useEffect(() => () => { flushSave(false); }, [flushSave]);

  // Flush with keepalive on browser refresh/close — survives page unload
  useEffect(() => {
    const handleBeforeUnload = () => { flushSave(true); };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushSave]);

  /* ---------- Manual caption editing ---------- */

  const handleManualCaptionChange = (clipId: string, text: string) => {
    const updated = { ...manualCaptions, [clipId]: text };
    setManualCaptions(updated);
    propagateCaptions(updated, generatedCaptions, selectedCaptionIdx);
    saveSelectedCaptions(updated);
  };

  /* ---------- Fetch templates ---------- */

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(false);
    try {
      const res = await apiGetWithRetry("/pipeline/video-caption-templates", { timeout: 15_000 });
      const data = await res.json();
      const tpls = data.templates || [];
      setTemplates(tpls);

      const savedId = profileId
        ? readWorkspaceStorage(profileId, TEMPLATE_KEY, LEGACY_TEMPLATE_KEY)
        : null;
      const savedExists = tpls.some((t: CaptionTemplate) => t.id === savedId);
      if (savedExists) {
        setSelectedTemplateId(savedId!);
      } else {
        const defaultTpl = tpls.find((t: CaptionTemplate) => t.is_default);
        if (defaultTpl) {
          setSelectedTemplateId(defaultTpl.id);
          if (profileId) writeWorkspaceStorage(profileId, TEMPLATE_KEY, defaultTpl.id);
        }
      }
    } catch (err) {
      console.error("[CaptionGenerator] Failed to fetch templates:", err);
      setTemplatesError(true);
    } finally {
      setTemplatesLoading(false);
    }
  }, [profileId]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  /* ---------- Catalog product picker ---------- */

  const stripHtml = (html: string): string => {
    if (typeof window === "undefined") return html;
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent?.trim() || "";
  };

  // D1: products come from the local Product Library (Gomag catalog gated off).
  // The library is small — filter client-side, no server pagination.
  const fetchCatalogProducts = useCallback(async (search: string, page: number) => {
    void page;
    setCatalogLoading(true);
    try {
      const q = search.trim().toLowerCase();
      const params = new URLSearchParams({ search, page: String(page), page_size: "50" });
      const res = await apiGet(`/product-library?${params}`);
      const data = await res.json();
      interface LibraryProduct { id: string; title: string; description?: string; image_urls?: string[]; brand?: string; category?: string; sku?: string; price?: string; sale_price?: string; product_url?: string; extra_fields?: Record<string, unknown> }
      const all = ((data.products || []) as LibraryProduct[])
        .filter((p) => !q || p.title.toLowerCase().includes(q))
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
    } catch {
      toast.error("Failed to load products");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const handleOpenCatalog = () => {
    if (catalogOpen) {
      setCatalogOpen(false);
      return;
    }
    setCatalogOpen(true);
    fetchCatalogProducts("", 1);
  };

  const handleCatalogSearch = (value: string) => {
    setCatalogSearch(value);
    setCatalogPage(1);
    fetchCatalogProducts(value, 1);
  };

  const handleCatalogPageChange = (newPage: number) => {
    setCatalogPage(newPage);
    fetchCatalogProducts(catalogSearch, newPage);
  };

  const toggleCatalogProduct = (id: string) => {
    setSelectedCatalogIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddCatalogProducts = () => {
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
    const updated = [...contextProducts, ...newProducts];
    onProductsChange?.(updated);
    setSelectedCatalogIds(new Set());
    setCatalogOpen(false);
  };

  const handleRemoveProduct = (idx: number) => {
    const updated = contextProducts.filter((_, i) => i !== idx);
    onProductsChange?.(updated);
  };

  /* ---------- Template selection ---------- */

  const handleSelectTemplate = (id: string) => {
    const effectiveId = id === "none" ? "" : id;
    setSelectedTemplateId(effectiveId);
    if (profileId) {
      if (effectiveId) {
        writeWorkspaceStorage(profileId, TEMPLATE_KEY, effectiveId);
      } else {
        removeWorkspaceStorage(profileId, TEMPLATE_KEY);
      }
    }
  };

  /* ---------- Template CRUD ---------- */

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim() || !newTemplatePrompt.trim()) return;
    try {
      await apiPost("/pipeline/video-caption-templates", {
        name: newTemplateName.trim(),
        prompt_template: newTemplatePrompt.trim(),
        is_default: templates.length === 0,
      });
      toast.success("Template created");
      setNewTemplateName("");
      setNewTemplatePrompt("");
      fetchTemplates();
    } catch (err) {
      console.error("[CaptionGenerator] Failed to create template:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to create template: ${msg}`);
    }
  };

  const handleUpdateTemplate = async () => {
    if (!editingTemplate) return;
    try {
      await apiPut(`/pipeline/video-caption-templates/${editingTemplate.id}`, {
        name: editingTemplate.name,
        prompt_template: editingTemplate.prompt_template,
      });
      toast.success("Template updated");
      setEditingTemplate(null);
      fetchTemplates();
    } catch (err) {
      console.error("[CaptionGenerator] Failed to update template:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to update template: ${msg}`);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await apiDelete(`/pipeline/video-caption-templates/${id}`);
      toast.success("Template deleted");
      if (selectedTemplateId === id) {
        setSelectedTemplateId("");
        if (profileId) removeWorkspaceStorage(profileId, TEMPLATE_KEY);
      }
      fetchTemplates();
    } catch (err) {
      console.error("[CaptionGenerator] Failed to delete template:", err);
      toast.error("Failed to delete template");
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await apiPut(`/pipeline/video-caption-templates/${id}`, { is_default: true });
      fetchTemplates();
    } catch (err) {
      console.error("[CaptionGenerator] Failed to set default:", err);
      toast.error("Failed to set default");
    }
  };

  /* ---------- Generate captions via AI ---------- */

  const handleGenerate = async () => {
    const variantIndices = completedClips.map(c => c.variant_index);
    if (variantIndices.length === 0) return;

    setGenerating(true);
    try {
      console.log("[CaptionGenerator] Sending request for variants:", variantIndices);
      const res = await apiPost("/pipeline/generate-video-captions", {
        pipeline_id: pipelineId,
        variant_indices: variantIndices,
        tone,
        language,
        include_hashtags: includeHashtags,
        include_cta: includeCta,
        template_id: selectedTemplateId || undefined,
        custom_instructions: customInstructions.trim() || undefined,
        variants_per_clip: 3,
        generate_youtube_titles: generateYoutubeTitles,
      }, { timeout: 120_000 });
      console.log("[CaptionGenerator] Response status:", res.status);
      const data = await res.json();
      console.log("[CaptionGenerator] Response data:", JSON.stringify(data).slice(0, 500));
      console.log("[CaptionGenerator] isMountedRef:", isMountedRef.current);
      // NOTE: removed isMountedRef early-return — it was likely causing captions to silently drop
      // when the component remounted during the async API call

      const captions: Record<string, string[]> = {};
      const captionsObj = data.captions || {};
      for (const [key, val] of Object.entries(captionsObj)) {
        for (const clip of completedClips) {
          if (String(clip.variant_index) === key) {
            captions[clip.clip_id] = val as string[];
          }
        }
      }
      console.log("[CaptionGenerator] Parsed captions:", Object.keys(captions).length, "variants");
      setGeneratedCaptions(captions);

      // Parse YouTube titles if generated
      if (data.youtube_titles) {
        const ytTitles: Record<string, string[]> = {};
        for (const [key, val] of Object.entries(data.youtube_titles)) {
          for (const clip of completedClips) {
            if (String(clip.variant_index) === key) {
              ytTitles[clip.clip_id] = val as string[];
            }
          }
        }
        setGeneratedYoutubeTitles(ytTitles);
        // Auto-fill manual YouTube title fields with first option
        const updatedYt: Record<string, string> = { ...manualYoutubeTitles };
        for (const [clipId, titles] of Object.entries(ytTitles)) {
          if (titles && titles.length > 0 && !updatedYt[clipId]?.trim()) {
            updatedYt[clipId] = titles[0];
          }
        }
        setManualYoutubeTitles(updatedYt);
      }

      // Auto-select first AI caption for each variant (only if no manual caption)
      const selections: Record<string, number> = {};
      for (const clip of completedClips) {
        const varCaptions = captions[clip.clip_id];
        if (varCaptions && varCaptions.length > 0) {
          selections[clip.clip_id] = 0;
        }
      }
      setSelectedCaptionIdx(selections);

      // Auto-fill manual caption fields with first AI option for each variant
      const updatedManual: Record<string, string> = { ...manualCaptions };
      for (const [clipId, varCaptions] of Object.entries(captions)) {
        if (varCaptions && varCaptions.length > 0 && !updatedManual[clipId]?.trim()) {
          updatedManual[clipId] = varCaptions[0];
        }
      }
      setManualCaptions(updatedManual);
      propagateCaptions(updatedManual, captions, selections);
      saveSelectedCaptions(updatedManual);

      const errorCount = Object.keys(data.errors || {}).length;
      if (errorCount > 0) {
        toast.warning(`Generated captions with ${errorCount} error(s)`);
      } else {
        toast.success("Captions generated!");
      }
    } catch (err) {
      console.error("[CaptionGenerator] Error:", err);
      toast.error("Failed to generate captions");
    } finally {
      console.log("[CaptionGenerator] Finally block, isMounted:", isMountedRef.current);
      setGenerating(false);
    }
  };

  /* ---------- AI Caption selection ---------- */

  const handleSelectCaption = (clipId: string, captionIdx: number) => {
    const newSelections = { ...selectedCaptionIdx, [clipId]: captionIdx };
    setSelectedCaptionIdx(newSelections);

    // Apply the selected AI caption to the manual field
    const varCaptions = generatedCaptions[clipId];
    if (varCaptions && varCaptions[captionIdx]) {
      const updated = { ...manualCaptions, [clipId]: varCaptions[captionIdx] };
      setManualCaptions(updated);
      propagateCaptions(updated, generatedCaptions, newSelections);
      saveSelectedCaptions(updated);
    }
  };

  const copyCaption = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied!");
  };

  if (completedClips.length === 0) return null;

  /* ---------- Render ---------- */

  return (
    <div className="space-y-4 mt-6">
      <div className="flex items-center gap-3">
        <MessageSquareText className="size-6 text-primary" />
        <div>
          <h3 className="text-lg font-semibold">Social Media Captions</h3>
          <p className="text-sm text-muted-foreground">
            Generate captions with AI or write them manually below
          </p>
        </div>
      </div>

      {/* AI Generation — collapsible (shown BEFORE manual fields) */}
      <Collapsible open={aiSettingsOpen} onOpenChange={setAiSettingsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-3 cursor-pointer hover:bg-accent/50 transition-colors">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Sparkles className="size-4" />
                  AI Caption Generator
                  <Badge variant="outline" className="text-xs font-normal">Optional</Badge>
                  {contextProducts.length > 0 && (
                    <Badge variant="secondary" className="text-xs font-normal">
                      {contextProducts.length} {contextProducts.length === 1 ? "product" : "products"}
                    </Badge>
                  )}
                </span>
                <ChevronDown className={`size-4 transition-transform ${aiSettingsOpen ? "rotate-180" : ""}`} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">

              {/* Product selection — inside AI section so it's visible alongside generation settings */}
              <div className={`rounded-lg border p-3 space-y-3 ${contextProducts.length > 0 ? "border-primary/30 bg-primary/5" : "bg-muted/30"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="size-4 text-primary" />
                    <span className="text-sm font-medium">
                      {contextProducts.length === 0
                        ? "No products selected"
                        : contextProducts.length === 1
                          ? "Product selected"
                          : `${contextProducts.length} products selected`}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={handleOpenCatalog}
                  >
                    <BookOpen className="h-3.5 w-3.5 mr-1" />
                    {catalogOpen ? "Close Catalog" : "Add from Catalog"}
                  </Button>
                </div>

                {/* Product chips with remove */}
                {contextProducts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {contextProducts.map((product, idx) => (
                      <span
                        key={idx}
                        title={product.description}
                        className="inline-flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 rounded-full px-2.5 py-1 text-xs font-medium max-w-[200px]"
                      >
                        <span className="truncate">{product.title}</span>
                        {onProductsChange && (
                          <button
                            type="button"
                            onClick={() => handleRemoveProduct(idx)}
                            className="flex-shrink-0 hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {/* Catalog picker */}
                {catalogOpen && (
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              {/* Search */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search products..."
                    value={catalogSearch}
                    onChange={(e) => handleCatalogSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
              </div>

              {/* Products grid */}
              {catalogLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : catalogProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No products found</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto">
                  {catalogProducts.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => toggleCatalogProduct(p.id)}
                      className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors text-xs ${
                        selectedCatalogIds.has(p.id)
                          ? "border-primary bg-primary/10"
                          : "border-transparent bg-background hover:bg-accent/50"
                      }`}
                    >
                      {p.image_link && (
                        <img src={p.image_link} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{stripHtml(p.title)}</p>
                        {p.brand && <p className="text-muted-foreground truncate">{p.brand}</p>}
                      </div>
                      {selectedCatalogIds.has(p.id) && (
                        <Check className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination + Add button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={catalogPage <= 1}
                    onClick={() => handleCatalogPageChange(catalogPage - 1)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {catalogPage} / {catalogPagination.total_pages || 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={catalogPage >= catalogPagination.total_pages}
                    onClick={() => handleCatalogPageChange(catalogPage + 1)}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Button
                  size="sm"
                  disabled={selectedCatalogIds.size === 0}
                  onClick={handleAddCatalogProducts}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add {selectedCatalogIds.size > 0 ? `(${selectedCatalogIds.size})` : ""}
                </Button>
              </div>
                </div>
              )}
              </div>

              {/* Template selector + management */}
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Label>Template</Label>
                  {templatesError ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>Failed to load templates.</span>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={fetchTemplates}>
                        Retry
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Select value={selectedTemplateId || "none"} onValueChange={handleSelectTemplate}>
                        <SelectTrigger>
                          <SelectValue placeholder={templatesLoading ? "Loading..." : "No template (generate freely)"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No template</SelectItem>
                          {templates.map((tpl) => (
                            <SelectItem key={tpl.id} value={tpl.id}>
                              {tpl.name} {tpl.is_default ? "(default)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {templatesLoading && (
                        <Loader2 className="size-3 animate-spin absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </div>
                <Dialog open={templateDialogOpen} onOpenChange={(open) => { setTemplateDialogOpen(open); if (open) fetchTemplates(); }}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Settings2 className="size-4 mr-1" />
                      Templates
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Caption Templates</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      {templates.map((tpl) => (
                        <div key={tpl.id} className="border rounded-md p-3 space-y-2">
                          {editingTemplate?.id === tpl.id ? (
                            <>
                              <Input
                                value={editingTemplate.name}
                                onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                                placeholder="Template name"
                              />
                              <Textarea
                                value={editingTemplate.prompt_template}
                                onChange={(e) => setEditingTemplate({ ...editingTemplate, prompt_template: e.target.value })}
                                rows={4}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={handleUpdateTemplate}>Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingTemplate(null)}>Cancel</Button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-sm">{tpl.name}</span>
                                <div className="flex items-center gap-1">
                                  {tpl.is_default && <Badge variant="secondary" className="text-xs">Default</Badge>}
                                  {!tpl.is_default && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSetDefault(tpl.id)} title="Set as default">
                                      <Check className="size-3" />
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingTemplate({ ...tpl })} title="Edit">
                                    <Settings2 className="size-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteTemplate(tpl.id)} title="Delete">
                                    <Trash2 className="size-3" />
                                  </Button>
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-3">{tpl.prompt_template}</p>
                            </>
                          )}
                        </div>
                      ))}

                      <div className="border-2 border-dashed rounded-md p-3 space-y-2">
                        <Label className="text-sm font-medium">New Template</Label>
                        <Input
                          placeholder="Template name (e.g. Product Promo)"
                          value={newTemplateName}
                          onChange={(e) => setNewTemplateName(e.target.value)}
                        />
                        <Textarea
                          placeholder="Template prompt... (e.g. You are a social media expert for an online fashion store. Focus on product benefits and lifestyle appeal.)"
                          value={newTemplatePrompt}
                          onChange={(e) => setNewTemplatePrompt(e.target.value)}
                          rows={4}
                        />
                        <Button
                          size="sm"
                          onClick={handleCreateTemplate}
                          disabled={!newTemplateName.trim() || !newTemplatePrompt.trim()}
                        >
                          <Plus className="size-4 mr-1" />
                          Create Template
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Tone + Language */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tone</Label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Options */}
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={includeHashtags} onCheckedChange={(v) => setIncludeHashtags(v === true)} />
                  Include hashtags
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={includeCta} onCheckedChange={(v) => setIncludeCta(v === true)} />
                  Include CTA
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={generateYoutubeTitles} onCheckedChange={(v) => setGenerateYoutubeTitles(v === true)} />
                  YouTube titles
                </label>
              </div>

              {/* Custom instructions */}
              <div className="space-y-2">
                <Label>Custom Instructions (optional)</Label>
                <Textarea
                  placeholder="Any additional instructions for the AI..."
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  rows={2}
                />
              </div>

              {/* Generate button */}
              <Button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {generating ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="size-4 mr-2" />
                )}
                Generate Captions for {completedClips.length} Clip{completedClips.length !== 1 ? "s" : ""}
              </Button>

              {/* AI-generated caption options per variant */}
              {Object.keys(generatedCaptions).length > 0 && (
                <div className="space-y-3 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Click an AI caption to use it. It will be copied to the caption field below.
                  </p>
                  {completedClips.map((clip, clipIdx) => {
                    const key = clipKey(clip);
                    const varCaptions = generatedCaptions[key];
                    if (!varCaptions || varCaptions.length === 0) return null;
                    const selectedIdx = selectedCaptionIdx[key] ?? 0;

                    return (
                      <div key={`${clip.clip_id}-${clipIdx}`} className="space-y-2">
                        <p className="text-sm font-medium">Variant {clip.variant_index + 1} — AI Options</p>
                        {varCaptions.map((caption, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleSelectCaption(key, idx)}
                            className={`relative p-3 rounded-md border-2 cursor-pointer transition-colors text-sm ${
                              idx === selectedIdx
                                ? "border-primary bg-primary/5"
                                : "border-transparent bg-muted/50 hover:bg-muted"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge
                                    variant={idx === selectedIdx ? "default" : "outline"}
                                    className="text-xs"
                                  >
                                    {idx === selectedIdx ? "Selected" : `Option ${idx + 1}`}
                                  </Badge>
                                </div>
                                <p className="whitespace-pre-wrap break-words">{caption}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={(e) => { e.stopPropagation(); copyCaption(caption); }}
                              >
                                <Copy className="size-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Manual caption fields per variant — always visible, below AI generator */}
      <div className="space-y-3">
        {completedClips.map((clip, clipIdx) => {
          const key = clipKey(clip);
          return (
          <Card key={`${clip.clip_id}-${clipIdx}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Pencil className="size-3.5" />
                Variant {clip.variant_index + 1} — Caption
                {manualCaptions[key]?.trim() && (
                  <Badge variant="default" className="text-xs">Has caption</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder={`Write the social media caption for variant ${clip.variant_index + 1}...`}
                value={manualCaptions[key] || ""}
                onChange={(e) => handleManualCaptionChange(key, e.target.value)}
                rows={3}
                className="resize-y"
              />
              {manualCaptions[key]?.trim() && (
                <p className="text-xs text-muted-foreground mt-1">
                  {manualCaptions[key].length} characters
                </p>
              )}

              {/* YouTube Title — shown when generated or toggle is on */}
              {(generateYoutubeTitles || manualYoutubeTitles[key]?.trim()) && (
                <div className="mt-3 space-y-1">
                  <Label className="text-xs text-muted-foreground">YouTube Title (max 100)</Label>
                  <Input
                    placeholder="SEO title for YouTube..."
                    value={manualYoutubeTitles[key] || ""}
                    onChange={(e) => {
                      setManualYoutubeTitles(prev => ({
                        ...prev,
                        [key]: e.target.value.slice(0, 100)
                      }));
                    }}
                    maxLength={100}
                  />
                  {/* AI-generated title alternatives */}
                  {generatedYoutubeTitles[key]?.length > 1 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {generatedYoutubeTitles[key].map((title, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setManualYoutubeTitles(prev => ({ ...prev, [key]: title }))}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                            manualYoutubeTitles[key] === title
                              ? "border-primary bg-primary/10"
                              : "border-border hover:bg-accent/50"
                          }`}
                        >
                          {title.length > 50 ? title.slice(0, 50) + "..." : title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          );
        })}
      </div>
    </div>
  );
}
