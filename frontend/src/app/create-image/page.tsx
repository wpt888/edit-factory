"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { apiPost, apiGet, apiPut, apiDelete, apiUpload } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { LogoDragOverlay } from "@/components/logo-drag-overlay";
import {
  Loader2,
  ImageIcon,
  Send,
  Upload,
  Trash2,
  Plus,
  Pencil,
  CheckCircle2,
  XCircle,
  Sparkles,
  Share2,
  Calendar,
  AlertTriangle,
} from "lucide-react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// ============== Types ==============

interface Template {
  id: string;
  name: string;
  prompt_template: string;
  is_default: boolean;
}

interface GeneratedImage {
  id: string;
  prompt: string;
  status: string;
  image_url: string | null;
  image_local_path: string | null;
  final_image_path: string | null;
  logo_config: { x: number; y: number; scale: number } | null;
  error_message: string | null;
  template_name: string | null;
  created_at: string;
}

interface CatalogProduct {
  id: string;
  title: string;
  brand: string;
  price: string;
  description: string;
  image_link: string;
}

interface Integration {
  id: string;
  name: string;
  type: string;
  identifier?: string;
  picture?: string;
}

// Character limits per platform type
const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  twitter: 280,
  bluesky: 300,
  threads: 500,
  instagram: 2200,
  "instagram-standalone": 2200,
  youtube: 5000,
  linkedin: 3000,
  "linkedin-page": 3000,
  facebook: 63206,
  tiktok: 4000,
};

const PLATFORM_NAMES: Record<string, string> = {
  x: "X",
  twitter: "X",
  bluesky: "Bluesky",
  threads: "Threads",
  instagram: "Instagram",
  "instagram-standalone": "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  "linkedin-page": "LinkedIn Page",
  facebook: "Facebook",
  tiktok: "TikTok",
};

const SELECTED_BORDER = "border-green-500";
const SELECTED_BG = "bg-green-500/15";

// ============== Model / Resolution config ==============

const MODEL_OPTIONS = [
  { value: "nano-banana", label: "NanoBanana", desc: "basic, fast" },
  { value: "nano-banana-2", label: "NanoBanana 2", desc: "advanced, text rendering" },
  { value: "nano-banana-pro", label: "NanoBanana Pro", desc: "best quality" },
];

const RESOLUTION_OPTIONS: Record<string, { value: string; label: string }[]> = {
  "nano-banana-2": [
    { value: "0.5K", label: "0.5K" },
    { value: "1K", label: "1K" },
    { value: "2K", label: "2K" },
    { value: "4K", label: "4K" },
  ],
  "nano-banana-pro": [
    { value: "1K", label: "1K" },
    { value: "2K", label: "2K" },
    { value: "4K", label: "4K" },
  ],
};

const BASE_ASPECT_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "9:16", label: "9:16 (Portrait / Stories)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "5:4", label: "5:4" },
  { value: "4:5", label: "4:5" },
  { value: "21:9", label: "21:9 (Ultrawide)" },
];

const AUTO_ASPECT = { value: "auto", label: "Auto" };

// ============== Component ==============

export default function CreateImagePage() {
  // Step state
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [promptText, setPromptText] = useState("");
  const [userText, setUserText] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [currentImageId, setCurrentImageId] = useState<string | null>(null);
  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null);

  // Model & resolution
  const [selectedModel, setSelectedModel] = useState("nano-banana-pro");
  const [resolution, setResolution] = useState("1K");

  // Step 2 state
  const [addLogo, setAddLogo] = useState(false);
  const [logoInfo, setLogoInfo] = useState<{ logo_path: string | null; exists: boolean }>({
    logo_path: null,
    exists: false,
  });
  const [logoPosition, setLogoPosition] = useState({ x: 20, y: 20, scale: 0.3 });
  const [applyingLogo, setApplyingLogo] = useState(false);

  // Step 3 state
  const [caption, setCaption] = useState("");
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  // AI Caption
  const [captionTone, setCaptionTone] = useState("professional");
  const [captionLang, setCaptionLang] = useState("ro");
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [includeCta, setIncludeCta] = useState(true);
  const [captionInstructions, setCaptionInstructions] = useState("");
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [showCaptionOptions, setShowCaptionOptions] = useState(false);

  // Publish panel
  const [showPublishPanel, setShowPublishPanel] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<Set<string>>(new Set());
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState({ step: "", percentage: 0 });
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "success" | "error">("idle");
  const [publishError, setPublishError] = useState("");
  const [publishJobId, setPublishJobId] = useState<string | null>(null);

  // Template management
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templatePrompt, setTemplatePrompt] = useState("");

  // History
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Product picker
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const publishPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishPollCountRef = useRef(0);
  const productSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // Bug #158
  const productSearchRef = useRef(productSearch);
  productSearchRef.current = productSearch;

  // Derived: whether current model supports resolution
  const showResolution = selectedModel === "nano-banana-2" || selectedModel === "nano-banana-pro";

  // Derived: aspect ratio options based on model
  const aspectRatioOptions = useMemo(() => {
    if (selectedModel === "nano-banana-2" || selectedModel === "nano-banana-pro") {
      return [AUTO_ASPECT, ...BASE_ASPECT_RATIOS];
    }
    return BASE_ASPECT_RATIOS;
  }, [selectedModel]);

  // Reset resolution when model changes
  useEffect(() => {
    if (selectedModel === "nano-banana") {
      setResolution("");
    } else {
      setResolution("1K");
    }
    // Reset aspect ratio to valid value if current is "auto" and model doesn't support it
    if (aspectRatio === "auto" && selectedModel === "nano-banana") {
      setAspectRatio("1:1");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel]);

  // ============== Data fetching ==============

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await apiGet("/image-gen/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchLogoInfo = useCallback(async () => {
    try {
      const res = await apiGet("/image-gen/logo");
      if (res.ok) {
        const data = await res.json();
        setLogoInfo(data);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await apiGet("/image-gen/history?limit=20");
      if (res.ok) {
        const data = await res.json();
        setHistory(data.images || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchProducts = useCallback(async (search?: string) => {
    try {
      const q = search ?? productSearch;
      const params = q ? `?search=${encodeURIComponent(q)}&page_size=20` : "?page_size=20";
      const res = await apiGet(`/catalog/products${params}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch {
      // ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchIntegrations = useCallback(async () => {
    setLoadingIntegrations(true);
    try {
      const res = await apiGet("/postiz/integrations");
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data);
        setSelectedIntegrationIds(new Set(data.map((i: Integration) => i.id)));
      }
    } catch {
      setIntegrations([]);
    } finally {
      setLoadingIntegrations(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchLogoInfo();
    fetchProducts();
  }, [fetchTemplates, fetchLogoInfo, fetchProducts]);

  // Debounced product search (Bug #158)
  useEffect(() => {
    if (productSearchTimer.current) clearTimeout(productSearchTimer.current);
    productSearchTimer.current = setTimeout(() => {
      fetchProducts(productSearchRef.current);
    }, 400);
    return () => { if (productSearchTimer.current) clearTimeout(productSearchTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSearch]);

  // ============== Template selection fills prompt ==============

  useEffect(() => {
    if (selectedTemplateId && selectedTemplateId !== "none") {
      const tpl = templates.find((t) => t.id === selectedTemplateId);
      if (tpl) {
        let prompt = tpl.prompt_template;
        // Auto-fill placeholders if a product is selected
        const product = products.find((p) => p.id === selectedProductId);
        if (product) {
          prompt = prompt
            .replace(/\{title\}/g, product.title || "")
            .replace(/\{brand\}/g, product.brand || "")
            .replace(/\{price\}/g, product.price || "")
            .replace(/\{description\}/g, product.description || "");
        }
        setPromptText(prompt);
      }
    }
  }, [selectedTemplateId, templates, selectedProductId, products]);

  // ============== Product selection fills placeholders in prompt ==============

  useEffect(() => {
    if (selectedProductId && selectedProductId !== "none" && promptText) {
      const product = products.find((p) => p.id === selectedProductId);
      if (product) {
        // Only substitute if there are placeholders in the prompt
        if (/\{(title|brand|price|description)\}/.test(promptText)) {
          setPromptText((prev) =>
            prev
              .replace(/\{title\}/g, product.title || "")
              .replace(/\{brand\}/g, product.brand || "")
              .replace(/\{price\}/g, product.price || "")
              .replace(/\{description\}/g, product.description || "")
          );
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- products is intentionally omitted to only trigger on selection change
  }, [selectedProductId, products]);

  // ============== Generation ==============

  const handleGenerate = async () => {
    if (!promptText.trim() && !userText.trim()) return;

    setGenerating(true);
    setGenerationStatus("Starting...");
    setCurrentImage(null);
    setSendResult(null);

    try {
      const res = await apiPost("/image-gen/generate", {
        prompt: promptText,
        template_id: (selectedTemplateId && selectedTemplateId !== "none") ? selectedTemplateId : undefined,
        product_id: (selectedProductId && selectedProductId !== "none") ? selectedProductId : undefined,
        aspect_ratio: aspectRatio,
        model: selectedModel,
        resolution: resolution || undefined,
        user_text: userText || undefined,
      });

      if (!res.ok) throw new Error("Generation failed");
      const data = await res.json();
      setCurrentImageId(data.image_id);

      // Start polling (clear any existing interval first)
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      let pollErrorCount = 0;
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await apiGet(`/image-gen/${data.image_id}/status`);
          if (statusRes.ok) {
            pollErrorCount = 0; // reset on success
            const statusData = await statusRes.json();
            setGenerationStatus(statusData.status || "generating");

            if (statusData.status === "completed") {
              clearInterval(pollRef.current!);
              pollRef.current = null;
              setCurrentImage(statusData);
              setGenerating(false);
              setStep(2);
            } else if (statusData.status === "failed") {
              clearInterval(pollRef.current!);
              pollRef.current = null;
              setGenerating(false);
              setGenerationStatus(`Failed: ${statusData.error_message || statusData.error || "Unknown error"}`);
            }
          }
        } catch (err) {
          // Bug #90: stop polling after repeated errors
          console.error("Image poll error:", err);
          pollErrorCount++;
          if (pollErrorCount > 5) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setGenerating(false);
            setGenerationStatus("Image generation check failed. Please try again.");
          }
        }
      }, 2000);
    } catch (err) {
      setGenerating(false);
      setGenerationStatus("Failed to start generation");
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (publishPollRef.current) clearTimeout(publishPollRef.current);
    };
  }, []);

  // ============== Logo ==============

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await apiUpload("/image-gen/logo/upload", formData);
      if (res.ok) {
        await fetchLogoInfo();
      }
    } catch {
      // ignore
    }
  };

  const handleApplyLogo = async () => {
    if (!currentImageId) return;
    setApplyingLogo(true);

    try {
      const res = await apiPost(`/image-gen/${currentImageId}/logo`, {
        x: logoPosition.x,
        y: logoPosition.y,
        scale: logoPosition.scale,
      });

      if (res.ok) {
        // Refresh image data
        const statusRes = await apiGet(`/image-gen/${currentImageId}/status`);
        if (statusRes.ok) {
          const data = await statusRes.json();
          setCurrentImage(data);
        }
      }
    } catch {
      // ignore
    } finally {
      setApplyingLogo(false);
    }
  };

  const handleDeleteLogo = async () => {
    try {
      await apiDelete("/image-gen/logo");
      await fetchLogoInfo();
    } catch {
      // ignore
    }
  };

  // ============== AI Caption ==============

  const handleGenerateCaption = async () => {
    if (!currentImageId) return;
    setGeneratingCaption(true);

    try {
      const res = await apiPost("/image-gen/generate-caption", {
        image_id: currentImageId,
        tone: captionTone,
        language: captionLang,
        include_hashtags: includeHashtags,
        include_cta: includeCta,
        custom_instructions: captionInstructions || undefined,
      });

      if (res.ok) {
        const data = await res.json();
        setCaption(data.caption || "");
        toast.success("Caption generated!");
        setShowCaptionOptions(false);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Caption generation failed: ${err.detail || "Unknown error"}`);
      }
    } catch {
      toast.error("Failed to generate caption");
    } finally {
      setGeneratingCaption(false);
    }
  };

  // ============== Send Telegram ==============

  const handleSendTelegram = async () => {
    if (!currentImageId) return;
    setSendingTelegram(true);
    setSendResult(null);

    try {
      const res = await apiPost(`/image-gen/${currentImageId}/send/telegram`, {
        caption,
      });
      if (res.ok) {
        setSendResult("Sent to Telegram successfully!");
      } else {
        const err = await res.json().catch(() => ({}));
        setSendResult(`Telegram error: ${err.detail || "Unknown"}`);
      }
    } catch (err) {
      setSendResult("Failed to send to Telegram");
    } finally {
      setSendingTelegram(false);
    }
  };

  // ============== Publish to Social Media ==============

  const toggleIntegration = (id: string) => {
    setSelectedIntegrationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const charWarnings = useMemo(() => {
    const warnings: { platform: string; limit: number }[] = [];
    for (const id of selectedIntegrationIds) {
      const integration = integrations.find((i) => i.id === id);
      if (!integration) continue;
      const limit = PLATFORM_CHAR_LIMITS[integration.type] || 5000;
      if (caption.length > limit) {
        warnings.push({
          platform: PLATFORM_NAMES[integration.type] || integration.type,
          limit,
        });
      }
    }
    return warnings;
  }, [selectedIntegrationIds, integrations, caption]);

  const minCharLimit = useMemo(() => {
    let min = Infinity;
    for (const id of selectedIntegrationIds) {
      const integration = integrations.find((i) => i.id === id);
      if (!integration) continue;
      const limit = PLATFORM_CHAR_LIMITS[integration.type] || 5000;
      if (limit < min) min = limit;
    }
    return min === Infinity ? 5000 : min;
  }, [selectedIntegrationIds, integrations]);

  const minScheduleDate = useMemo(() => new Date().toISOString().slice(0, 16), [showPublishPanel]);

  const startPublishPolling = useCallback((jobId: string) => {
    if (publishPollRef.current) clearTimeout(publishPollRef.current);
    publishPollCountRef.current = 0;

    const pollOnce = async () => {
      publishPollCountRef.current++;
      if (publishPollCountRef.current > 200) {
        publishPollRef.current = null;
        setPublishState("error");
        setPublishError("Timeout — publishing took too long.");
        setPublishing(false);
        return;
      }
      try {
        const res = await apiGet(`/postiz/publish/${jobId}/progress`);
        const data = await res.json();
        setPublishProgress({ step: data.step || "", percentage: data.percentage || 0 });

        if (data.status === "completed") {
          publishPollRef.current = null;
          setPublishState("success");
          setPublishing(false);
          return;
        } else if (data.status === "failed" || data.status === "completed_with_errors") {
          publishPollRef.current = null;
          setPublishState("error");
          setPublishError(data.step || "Publishing failed");
          setPublishing(false);
          return;
        }
      } catch {
        // Keep polling on transient errors
      }
      publishPollRef.current = setTimeout(pollOnce, 1500);
    };

    publishPollRef.current = setTimeout(pollOnce, 1500);
  }, []);

  const handlePublishImage = async () => {
    if (!currentImageId || selectedIntegrationIds.size === 0) {
      toast.error("Select at least one platform");
      return;
    }

    setPublishing(true);
    setPublishState("publishing");
    setPublishProgress({ step: "Initializing...", percentage: 0 });

    try {
      const body: Record<string, unknown> = {
        image_id: currentImageId,
        caption,
        integration_ids: Array.from(selectedIntegrationIds),
      };

      if (scheduleEnabled && scheduleDate) {
        body.schedule_date = new Date(scheduleDate).toISOString();
      }

      const res = await apiPost("/image-gen/publish-image", body);
      const data = await res.json();

      if (data.job_id) {
        setPublishJobId(data.job_id);
        startPublishPolling(data.job_id);
      } else {
        setPublishState("error");
        setPublishError(data.message || "Could not start publishing");
        setPublishing(false);
      }
    } catch (err) {
      setPublishState("error");
      if (err && typeof err === "object" && "detail" in err && (err as { detail: string }).detail) {
        setPublishError((err as { detail: string }).detail);
      } else {
        setPublishError(err instanceof Error ? err.message : "Error publishing");
      }
      setPublishing(false);
    }
  };

  // ============== Template CRUD ==============

  const handleSaveTemplate = async () => {
    if (!templateName.trim() || !templatePrompt.trim()) return;

    try {
      if (editingTemplate) {
        await apiPut(`/image-gen/templates/${editingTemplate.id}`, {
          name: templateName,
          prompt_template: templatePrompt,
        });
      } else {
        await apiPost("/image-gen/templates", {
          name: templateName,
          prompt_template: templatePrompt,
        });
      }

      setShowTemplateForm(false);
      setEditingTemplate(null);
      setTemplateName("");
      setTemplatePrompt("");
      await fetchTemplates();
    } catch (err) {
      toast.error("Failed to save template");
    }
  };

  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null); // Bug #124
  const handleDeleteTemplate = async (id: string) => {
    setDeletingTemplateId(id);
    try {
      await apiDelete(`/image-gen/templates/${id}`);
      await fetchTemplates();
    } catch (err) {
      toast.error("Failed to delete template"); // Bug #123
    } finally {
      setDeletingTemplateId(null);
    }
  };

  // ============== Image URL helper ==============
  // If logo was applied, serve the composited image via backend endpoint.
  // Otherwise, use the FAL CDN URL for display.
  const getImageDisplayUrl = (img: GeneratedImage | null) => {
    if (!img) return "";
    if (img.final_image_path) {
      return `${API_URL}/image-gen/${img.id}/file`;
    }
    return img.image_url || "";
  };

  // ============== Render ==============

  return (
    <div className="w-full max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Image Generator</h1>
          <p className="text-muted-foreground">
            Generate product images with AI, add your logo, and share
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory) fetchHistory();
            }}
          >
            {showHistory ? "Hide History" : "History"}
          </Button>
          {step > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Clear any active poll (Bug #51)
                if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                setStep(1);
                setCurrentImage(null);
                setCurrentImageId(null);
                setSendResult(null);
              }}
            >
              New Image
            </Button>
          )}
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <Badge
            key={s}
            variant={step === s ? "default" : step > s ? "secondary" : "outline"}
            className="cursor-pointer"
            onClick={() => {
              if (s === 1) setStep(1);
              else if (s === 2 && currentImage) setStep(2);
              else if (s === 3 && currentImage) setStep(3);
            }}
          >
            {s === 1 && "1. Generate"}
            {s === 2 && "2. Logo"}
            {s === 3 && "3. Share"}
          </Badge>
        ))}
      </div>

      {/* History panel */}
      {showHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Generations</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No images generated yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {history.map((img) => (
                  <div
                    key={img.id}
                    className="relative group rounded-lg overflow-hidden border cursor-pointer hover:ring-2 ring-primary"
                    onClick={() => {
                      setCurrentImage(img);
                      setCurrentImageId(img.id);
                      setStep(2);
                      setShowHistory(false);
                    }}
                  >
                    {img.image_url ? (
                      <img
                        src={img.image_url}
                        alt={img.template_name || "Generated"}
                        className="w-full aspect-square object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-square bg-muted flex items-center justify-center">
                        <ImageIcon className="size-8 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1.5">
                      <Badge variant={img.status === "completed" ? "secondary" : "destructive"} className="text-xs">
                        {img.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ============== STEP 1: Generate ============== */}
      {step === 1 && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left: Config */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ImageIcon className="size-4" /> Configure Generation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Product picker */}
              <div className="space-y-2">
                <Label>Product (optional)</Label>
                <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a product..." />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="p-2">
                      <Input
                        placeholder="Search products..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        className="mb-2"
                      />
                    </div>
                    <SelectItem value="none">No product</SelectItem>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title} {p.brand ? `(${p.brand})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Template selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Prompt Template</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowTemplateForm(true);
                      setEditingTemplate(null);
                      setTemplateName("");
                      setTemplatePrompt("");
                    }}
                  >
                    <Plus className="size-3 mr-1" /> New
                  </Button>
                </div>
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Custom prompt</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} {t.is_default ? "(default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Prompt text */}
              <div className="space-y-2">
                <Label>Prompt</Label>
                <Textarea
                  placeholder="Describe the image you want to generate..."
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Use placeholders: {"{title}"}, {"{brand}"}, {"{price}"}, {"{description}"} (filled from product)
                </p>
              </div>

              {/* Additional text */}
              <div className="space-y-2">
                <Label>Additional Text (optional)</Label>
                <Textarea
                  placeholder="Extra instructions appended to the prompt..."
                  value={userText}
                  onChange={(e) => setUserText(e.target.value)}
                  rows={2}
                />
              </div>

              {/* Model selector */}
              <div className="space-y-2">
                <Label>Model</Label>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label} — {m.desc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Resolution selector (conditional) */}
              {showResolution && (
                <div className="space-y-2">
                  <Label>Resolution</Label>
                  <Select value={resolution} onValueChange={setResolution}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(RESOLUTION_OPTIONS[selectedModel] || []).map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Aspect ratio */}
              <div className="space-y-2">
                <Label>Aspect Ratio</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {aspectRatioOptions.map((ar) => (
                      <SelectItem key={ar.value} value={ar.value}>
                        {ar.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Generate button */}
              <Button
                className="w-full"
                onClick={handleGenerate}
                disabled={generating || (!promptText.trim() && !userText.trim())}
              >
                {generating ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {generationStatus}
                  </>
                ) : (
                  <>
                    <ImageIcon className="size-4 mr-2" />
                    Generate Image
                  </>
                )}
              </Button>

              {!generating && generationStatus.startsWith("Failed") && (
                <p className="text-sm text-destructive">{generationStatus}</p>
              )}
            </CardContent>
          </Card>

          {/* Right: Templates management */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your Templates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {showTemplateForm && (
                <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                  <Input
                    placeholder="Template name"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                  <Textarea
                    placeholder="Prompt template with {title}, {brand}, etc."
                    value={templatePrompt}
                    onChange={(e) => setTemplatePrompt(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveTemplate}>
                      {editingTemplate ? "Update" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowTemplateForm(false);
                        setEditingTemplate(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No templates yet. Create one to speed up image generation.
                </p>
              ) : (
                <div className="space-y-2">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-start justify-between gap-2 p-3 border rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{t.name}</span>
                          {t.is_default && <Badge variant="secondary" className="text-xs">default</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {t.prompt_template}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => {
                            setEditingTemplate(t);
                            setTemplateName(t.name);
                            setTemplatePrompt(t.prompt_template);
                            setShowTemplateForm(true);
                          }}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          onClick={() => handleDeleteTemplate(t.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ============== STEP 2: Preview & Logo ============== */}
      {step === 2 && currentImage && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left: Image preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generated Image</CardTitle>
            </CardHeader>
            <CardContent>
              {addLogo && logoInfo.exists && !currentImage.final_image_path && currentImage.image_url ? (
                <LogoDragOverlay
                  imageUrl={currentImage.image_url}
                  logoUrl={`${API_URL}/image-gen/logo/file`}
                  imageWidth={1024}
                  imageHeight={1024}
                  onPositionChange={(x, y, scale) => setLogoPosition({ x, y, scale })}
                  initialX={logoPosition.x}
                  initialY={logoPosition.y}
                  initialScale={logoPosition.scale}
                />
              ) : getImageDisplayUrl(currentImage) ? (
                <img
                  src={getImageDisplayUrl(currentImage)}
                  alt="Generated"
                  className="w-full rounded-lg border"
                />
              ) : (
                <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                  <ImageIcon className="size-12 text-muted-foreground" />
                </div>
              )}

              {currentImage.final_image_path && (
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="secondary">
                    <CheckCircle2 className="size-3 mr-1" /> Logo applied
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCurrentImage((prev) =>
                        prev ? { ...prev, final_image_path: null, logo_config: null } : prev
                      );
                      setAddLogo(true);
                    }}
                  >
                    <Pencil className="size-3 mr-1" /> Reposition
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: Logo controls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Logo Overlay</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Logo upload */}
              <div className="space-y-2">
                <Label>Profile Logo</Label>
                {logoInfo.exists ? (
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">
                      <CheckCircle2 className="size-3 mr-1" /> Logo uploaded
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={handleDeleteLogo}>
                      <Trash2 className="size-3 mr-1" /> Remove
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Label
                      htmlFor="logo-upload"
                      className="flex items-center gap-2 cursor-pointer border border-dashed rounded-lg p-4 hover:bg-muted/50 transition-colors"
                    >
                      <Upload className="size-5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Upload logo (PNG with transparency recommended)
                      </span>
                    </Label>
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                  </div>
                )}
              </div>

              <Separator />

              {/* Add logo toggle */}
              <div className="flex items-center gap-3">
                <Checkbox
                  id="add-logo"
                  checked={addLogo}
                  onCheckedChange={(checked) => setAddLogo(!!checked)}
                  disabled={!logoInfo.exists}
                />
                <Label htmlFor="add-logo" className="cursor-pointer">
                  Add logo to image
                </Label>
              </div>

              {addLogo && logoInfo.exists && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Drag the logo on the image to position it. Use the slider to resize.
                  </p>

                  <Button
                    className="w-full"
                    onClick={handleApplyLogo}
                    disabled={applyingLogo}
                  >
                    {applyingLogo ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4 mr-2" />
                    )}
                    Apply Logo
                  </Button>
                </>
              )}

              <Separator />

              {/* Navigation */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button className="flex-1" onClick={() => setStep(3)}>
                  Continue to Share
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ============== STEP 3: Share ============== */}
      {step === 3 && currentImage && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left: Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Final Image</CardTitle>
            </CardHeader>
            <CardContent>
              {getImageDisplayUrl(currentImage) ? (
                <img
                  src={getImageDisplayUrl(currentImage)}
                  alt="Final"
                  className="w-full rounded-lg border"
                />
              ) : (
                <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                  <ImageIcon className="size-12 text-muted-foreground" />
                </div>
              )}
              <div className="mt-2 space-y-1">
                <p className="text-xs text-muted-foreground truncate">
                  Prompt: {currentImage.prompt}
                </p>
                {currentImage.logo_config && (
                  <Badge variant="secondary" className="text-xs">Logo applied</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Right: Caption + Publish */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="size-4" /> Share
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Caption */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Caption</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCaptionOptions(!showCaptionOptions)}
                  >
                    <Sparkles className="size-3 mr-1" />
                    AI Generate Caption
                  </Button>
                </div>
                <Textarea
                  placeholder="Write a caption for your image..."
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={4}
                />
              </div>

              {/* AI Caption Options */}
              {showCaptionOptions && (
                <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                  <p className="text-sm font-medium">AI Caption Settings</p>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Tone</Label>
                      <Select value={captionTone} onValueChange={setCaptionTone}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="professional">Professional</SelectItem>
                          <SelectItem value="casual">Casual</SelectItem>
                          <SelectItem value="funny">Funny</SelectItem>
                          <SelectItem value="luxury">Luxury</SelectItem>
                          <SelectItem value="urgenta">Urgenta</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Language</Label>
                      <Select value={captionLang} onValueChange={setCaptionLang}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ro">Romana</SelectItem>
                          <SelectItem value="en">English</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="include-hashtags"
                        checked={includeHashtags}
                        onCheckedChange={(checked) => setIncludeHashtags(!!checked)}
                      />
                      <Label htmlFor="include-hashtags" className="text-xs cursor-pointer">
                        Include hashtags
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="include-cta"
                        checked={includeCta}
                        onCheckedChange={(checked) => setIncludeCta(!!checked)}
                      />
                      <Label htmlFor="include-cta" className="text-xs cursor-pointer">
                        Include CTA
                      </Label>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Custom Instructions (optional)</Label>
                    <Input
                      placeholder="e.g. mention free shipping, use emojis..."
                      value={captionInstructions}
                      onChange={(e) => setCaptionInstructions(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>

                  <Button
                    size="sm"
                    className="w-full"
                    onClick={handleGenerateCaption}
                    disabled={generatingCaption}
                  >
                    {generatingCaption ? (
                      <>
                        <Loader2 className="size-3 mr-1 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3 mr-1" />
                        Generate Caption
                      </>
                    )}
                  </Button>
                </div>
              )}

              <Separator />

              {/* Publish to Social Media button */}
              <Button
                className="w-full bg-gradient-to-r from-pink-500 to-purple-500 text-white border-none hover:from-pink-600 hover:to-purple-600"
                onClick={() => {
                  setShowPublishPanel(!showPublishPanel);
                  if (!showPublishPanel) {
                    fetchIntegrations();
                    setPublishState("idle");
                    setPublishError("");
                    setPublishProgress({ step: "", percentage: 0 });
                  }
                }}
              >
                <Share2 className="size-4 mr-2" />
                {showPublishPanel ? "Hide Publish Panel" : "Publish to Social Media"}
              </Button>

              {/* Inline Publish Panel */}
              {showPublishPanel && (
                <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                  {publishState === "idle" && (
                    <>
                      {/* Platform selector */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">Platforms</Label>
                          {integrations.length > 0 && (
                            <button
                              type="button"
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              onClick={() => {
                                if (selectedIntegrationIds.size === integrations.length) {
                                  setSelectedIntegrationIds(new Set());
                                } else {
                                  setSelectedIntegrationIds(new Set(integrations.map((i) => i.id)));
                                }
                              }}
                            >
                              {selectedIntegrationIds.size === integrations.length ? "Deselect all" : "Select all"}
                            </button>
                          )}
                        </div>
                        {loadingIntegrations ? (
                          <div className="flex items-center justify-center py-3">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : integrations.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">
                            No platforms connected in Postiz. Configure integrations in Postiz.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {integrations.map((integration) => {
                              const isSelected = selectedIntegrationIds.has(integration.id);
                              return (
                                <button
                                  key={integration.id}
                                  type="button"
                                  onClick={() => toggleIntegration(integration.id)}
                                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border-2 transition-all text-xs ${
                                    isSelected
                                      ? `${SELECTED_BORDER} ${SELECTED_BG}`
                                      : "border-transparent bg-muted hover:bg-accent/50"
                                  }`}
                                >
                                  {integration.picture ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                      src={integration.picture}
                                      alt=""
                                      className="h-5 w-5 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="h-5 w-5 rounded-full bg-muted-foreground/20 flex items-center justify-center text-[10px] font-bold">
                                      {(PLATFORM_NAMES[integration.type] || integration.type)[0]?.toUpperCase()}
                                    </div>
                                  )}
                                  <span className="font-medium">{integration.name}</span>
                                  <Badge variant="secondary" className="text-[10px] px-1">
                                    {PLATFORM_NAMES[integration.type] || integration.type}
                                  </Badge>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Character limit info */}
                      {selectedIntegrationIds.size > 0 && caption.length > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex flex-wrap gap-1.5">
                            {Array.from(selectedIntegrationIds).map((id) => {
                              const integration = integrations.find((i) => i.id === id);
                              if (!integration) return null;
                              const limit = PLATFORM_CHAR_LIMITS[integration.type] || 5000;
                              const isOver = caption.length > limit;
                              return (
                                <span key={id} className={isOver ? "text-red-500 font-medium" : ""}>
                                  {PLATFORM_NAMES[integration.type] || integration.type}: {limit}
                                </span>
                              );
                            })}
                          </div>
                          <span className={caption.length > minCharLimit ? "text-red-500 font-medium" : ""}>
                            {caption.length}
                          </span>
                        </div>
                      )}

                      {charWarnings.length > 0 && (
                        <div className="flex items-start gap-2 text-xs text-yellow-600">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>
                            Caption exceeds limit on:{" "}
                            {charWarnings.map((w) => `${w.platform} (${w.limit})`).join(", ")}
                          </span>
                        </div>
                      )}

                      {/* Schedule */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">Schedule</Label>
                          <Switch
                            checked={scheduleEnabled}
                            onCheckedChange={setScheduleEnabled}
                          />
                        </div>
                        {scheduleEnabled && (
                          <input
                            type="datetime-local"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            min={minScheduleDate}
                          />
                        )}
                      </div>

                      {/* Publish button */}
                      <Button
                        className="w-full"
                        onClick={handlePublishImage}
                        disabled={
                          publishing ||
                          selectedIntegrationIds.size === 0 ||
                          !caption.trim() ||
                          (scheduleEnabled && !scheduleDate)
                        }
                      >
                        {scheduleEnabled ? (
                          <Calendar className="size-4 mr-2" />
                        ) : (
                          <Share2 className="size-4 mr-2" />
                        )}
                        {scheduleEnabled ? "Schedule Post" : "Publish Now"}
                      </Button>
                    </>
                  )}

                  {/* Publishing progress */}
                  {publishState === "publishing" && (
                    <div className="space-y-3 py-4">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm font-medium">{publishProgress.step}</p>
                      </div>
                      <Progress value={publishProgress.percentage} className="w-full" />
                      <p className="text-xs text-center text-muted-foreground">
                        {publishProgress.percentage}%
                      </p>
                    </div>
                  )}

                  {/* Success */}
                  {publishState === "success" && (
                    <div className="flex flex-col items-center gap-3 py-4">
                      <CheckCircle2 className="h-10 w-10 text-green-500" />
                      <p className="text-sm font-semibold">
                        {scheduleEnabled ? "Post scheduled!" : "Published successfully!"}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPublishState("idle");
                          setPublishProgress({ step: "", percentage: 0 });
                        }}
                      >
                        Done
                      </Button>
                    </div>
                  )}

                  {/* Error */}
                  {publishState === "error" && (
                    <div className="flex flex-col items-center gap-3 py-4">
                      <XCircle className="h-10 w-10 text-red-500" />
                      <div className="text-center">
                        <p className="text-sm font-semibold">Publishing failed</p>
                        <p className="text-xs text-muted-foreground mt-1">{publishError}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPublishState("idle");
                          setPublishError("");
                          setPublishProgress({ step: "", percentage: 0 });
                        }}
                      >
                        Try again
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <Separator />

              {/* Telegram as secondary option */}
              <Button
                variant="outline"
                onClick={handleSendTelegram}
                disabled={sendingTelegram}
                className="w-full h-auto py-3"
              >
                {sendingTelegram ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Send className="size-4 mr-2" />
                )}
                <div className="text-left">
                  <div className="font-medium text-sm">Send to Telegram</div>
                  <div className="text-xs text-muted-foreground">With approval buttons</div>
                </div>
              </Button>

              {sendResult && (
                <div
                  className={`flex items-center gap-2 text-sm p-3 rounded-lg ${
                    sendResult.includes("success")
                      ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                      : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                  }`}
                >
                  {sendResult.includes("success") ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <XCircle className="size-4 shrink-0" />
                  )}
                  {sendResult}
                </div>
              )}

              <Separator />

              <Button variant="outline" onClick={() => setStep(2)}>
                Back to Logo
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
