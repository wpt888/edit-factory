"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
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
  const [sendingPostiz, setSendingPostiz] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

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
  const productSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // Bug #158
  const productSearchRef = useRef(productSearch);
  productSearchRef.current = productSearch;

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

  // ============== Send ==============

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

  const handleSendPostiz = async () => {
    if (!currentImageId) return;
    setSendingPostiz(true);
    setSendResult(null);

    try {
      const res = await apiPost(`/image-gen/${currentImageId}/send/postiz`, {
        caption,
      });
      if (res.ok) {
        setSendResult("Sent to Postiz successfully!");
      } else {
        const err = await res.json().catch(() => ({}));
        setSendResult(`Postiz error: ${err.detail || "Unknown"}`);
      }
    } catch (err) {
      setSendResult("Failed to send to Postiz");
    } finally {
      setSendingPostiz(false);
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
            {s === 3 && "3. Send"}
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

              {/* Aspect ratio */}
              <div className="space-y-2">
                <Label>Aspect Ratio</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1:1">1:1 (Square)</SelectItem>
                    <SelectItem value="9:16">9:16 (Portrait / Stories)</SelectItem>
                    <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
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
                  Continue to Send
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ============== STEP 3: Send ============== */}
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

          {/* Right: Send options */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="size-4" /> Share
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Caption</Label>
                <Textarea
                  placeholder="Write a caption for your image..."
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  onClick={handleSendTelegram}
                  disabled={sendingTelegram}
                  className="h-auto py-3"
                >
                  {sendingTelegram ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="size-4 mr-2" />
                  )}
                  <div className="text-left">
                    <div className="font-medium text-sm">Telegram</div>
                    <div className="text-xs text-muted-foreground">With approval buttons</div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  onClick={handleSendPostiz}
                  disabled={sendingPostiz}
                  className="h-auto py-3"
                >
                  {sendingPostiz ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="size-4 mr-2" />
                  )}
                  <div className="text-left">
                    <div className="font-medium text-sm">Postiz</div>
                    <div className="text-xs text-muted-foreground">Social media</div>
                  </div>
                </Button>
              </div>

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
