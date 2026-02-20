"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { apiPost, API_URL } from "@/lib/api";
import { useJobPolling, formatElapsedTime } from "@/hooks/use-job-polling";
import { toast } from "sonner";
import {
  ArrowLeft,
  Video,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ---- Inner component that uses useSearchParams ----
function ProductVideoContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Extract product info from query params
  const productId = searchParams.get("id") || "";
  const title = searchParams.get("title") || "Unknown Product";
  const image = searchParams.get("image") || "";
  const price = searchParams.get("price") || "";
  const brand = searchParams.get("brand") || "";

  // Form state
  const [voicoverMode, setVoiceoverMode] = useState<"quick" | "elaborate">("quick");
  const [ttsProvider, setTtsProvider] = useState<"edge" | "elevenlabs">("edge");
  const [voiceId, setVoiceId] = useState("");
  const [aiProvider, setAiProvider] = useState<"gemini" | "claude">("gemini");
  const [duration, setDuration] = useState<string>("30");
  const [encodingPreset, setEncodingPreset] = useState<string>("tiktok");
  const [ctaText, setCtaText] = useState("Comanda acum!");
  const [enableDenoise, setEnableDenoise] = useState(false);
  const [enableSharpen, setEnableSharpen] = useState(false);
  const [enableColorCorrection, setEnableColorCorrection] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Redirect if no product ID
  useEffect(() => {
    if (!productId) {
      router.push("/products");
    }
  }, [productId, router]);

  // Default voice based on TTS provider
  const defaultVoice = ttsProvider === "edge" ? "ro-RO-EmilNeural" : "";

  // Job polling
  const { startPolling, isPolling, progress, statusText, elapsedTime, estimatedRemaining } =
    useJobPolling({
      apiBaseUrl: API_URL,
      interval: 2000,
      onProgress: (p, status) => {
        // progress updates handled by hook state
        void p;
        void status;
      },
      onComplete: () => {
        setIsGenerating(false);
        setIsComplete(true);
        toast.success("Video generated successfully! View it in the library.");
      },
      onError: (error) => {
        setIsGenerating(false);
        setHasError(true);
        toast.error(`Generation failed: ${error}`);
      },
    });

  const handleGenerate = async () => {
    if (!productId) return;

    setIsGenerating(true);
    setIsComplete(false);
    setHasError(false);

    try {
      const res = await apiPost(`/products/${productId}/generate`, {
        voiceover_mode: voicoverMode,
        tts_provider: ttsProvider,
        voice_id: voiceId || defaultVoice || null,
        ai_provider: aiProvider,
        duration_s: parseInt(duration),
        encoding_preset: encodingPreset,
        cta_text: ctaText,
        enable_denoise: enableDenoise,
        enable_sharpen: enableSharpen,
        enable_color_correction: enableColorCorrection,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: "Generation failed" }));
        throw new Error(errData.detail || "Generation failed");
      }

      const data = await res.json();
      if (!data.job_id) {
        throw new Error("No job ID returned from server");
      }

      startPolling(data.job_id);
    } catch (err) {
      setIsGenerating(false);
      setHasError(true);
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to start generation: ${message}`);
    }
  };

  const isFormDisabled = isPolling || isGenerating;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back navigation */}
        <div className="mb-6">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Products
          </Link>
        </div>

        {/* Page title */}
        <div className="flex items-center gap-3 mb-6">
          <Video className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">Generate Product Video</h1>
        </div>

        {/* Product info card */}
        {productId && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex gap-4 items-start">
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image}
                    alt={title}
                    className="w-24 h-24 object-cover rounded-md flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-sm leading-tight line-clamp-3">{title}</h2>
                  {brand && (
                    <p className="text-xs text-muted-foreground mt-1">{brand}</p>
                  )}
                  {price && (
                    <p className="text-sm font-bold mt-2">{price}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Generation settings form */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Generation Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Voiceover Mode */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Voiceover Mode</Label>
              <RadioGroup
                value={voicoverMode}
                onValueChange={(v) => setVoiceoverMode(v as "quick" | "elaborate")}
                disabled={isFormDisabled}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="quick" id="mode-quick" />
                  <Label htmlFor="mode-quick" className="cursor-pointer font-normal">
                    Quick (template)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="elaborate" id="mode-elaborate" />
                  <Label htmlFor="mode-elaborate" className="cursor-pointer font-normal">
                    Elaborate (AI-generated)
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                {voicoverMode === "quick"
                  ? "Uses a product template for fast generation — no AI cost."
                  : "Uses Gemini/Claude to write a custom voiceover script — slower but more creative."}
              </p>
            </div>

            {/* AI Provider (only for elaborate mode) */}
            {voicoverMode === "elaborate" && (
              <div className="space-y-2">
                <Label htmlFor="ai-provider" className="text-sm font-medium">
                  AI Script Provider
                </Label>
                <Select
                  value={aiProvider}
                  onValueChange={(v) => setAiProvider(v as "gemini" | "claude")}
                  disabled={isFormDisabled}
                >
                  <SelectTrigger id="ai-provider" className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="claude">Claude</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* TTS Provider */}
            <div className="space-y-2">
              <Label htmlFor="tts-provider" className="text-sm font-medium">
                TTS Provider
              </Label>
              <Select
                value={ttsProvider}
                onValueChange={(v) => {
                  setTtsProvider(v as "edge" | "elevenlabs");
                  setVoiceId(""); // Reset voice on provider change
                }}
                disabled={isFormDisabled}
              >
                <SelectTrigger id="tts-provider" className="w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="edge">Edge TTS (free)</SelectItem>
                  <SelectItem value="elevenlabs">ElevenLabs (premium)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ttsProvider === "edge"
                  ? "Microsoft Edge TTS — free, no subtitles."
                  : "ElevenLabs — premium quality with automatic subtitle generation."}
              </p>
            </div>

            {/* Voice override */}
            <div className="space-y-2">
              <Label htmlFor="voice-id" className="text-sm font-medium">
                Voice{" "}
                <span className="text-muted-foreground font-normal">
                  (optional — leave blank for default)
                </span>
              </Label>
              <Input
                id="voice-id"
                placeholder={defaultVoice || "Default voice"}
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                disabled={isFormDisabled}
                className="w-full max-w-sm"
              />
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <Label htmlFor="duration" className="text-sm font-medium">
                Duration
              </Label>
              <Select
                value={duration}
                onValueChange={setDuration}
                disabled={isFormDisabled}
              >
                <SelectTrigger id="duration" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 seconds</SelectItem>
                  <SelectItem value="30">30 seconds</SelectItem>
                  <SelectItem value="45">45 seconds</SelectItem>
                  <SelectItem value="60">60 seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Encoding Preset */}
            <div className="space-y-2">
              <Label htmlFor="encoding-preset" className="text-sm font-medium">
                Encoding Preset
              </Label>
              <Select
                value={encodingPreset}
                onValueChange={setEncodingPreset}
                disabled={isFormDisabled}
              >
                <SelectTrigger id="encoding-preset" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="reels">Reels</SelectItem>
                  <SelectItem value="youtube_shorts">YouTube Shorts</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* CTA Text */}
            <div className="space-y-2">
              <Label htmlFor="cta-text" className="text-sm font-medium">
                CTA Text
              </Label>
              <Input
                id="cta-text"
                value={ctaText}
                onChange={(e) => setCtaText(e.target.value)}
                disabled={isFormDisabled}
                className="w-full max-w-sm"
                placeholder="e.g. Comanda acum!"
              />
            </div>

            {/* Video Filters (collapsible) */}
            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
                onClick={() => setFiltersExpanded((v) => !v)}
                disabled={isFormDisabled}
              >
                {filtersExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                Video Filters (optional)
              </button>
              {filtersExpanded && (
                <div className="pl-4 space-y-3 pt-1">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="filter-denoise"
                      checked={enableDenoise}
                      onCheckedChange={(c) => setEnableDenoise(!!c)}
                      disabled={isFormDisabled}
                    />
                    <Label htmlFor="filter-denoise" className="cursor-pointer font-normal">
                      Denoise
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="filter-sharpen"
                      checked={enableSharpen}
                      onCheckedChange={(c) => setEnableSharpen(!!c)}
                      disabled={isFormDisabled}
                    />
                    <Label htmlFor="filter-sharpen" className="cursor-pointer font-normal">
                      Sharpen
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="filter-color"
                      checked={enableColorCorrection}
                      onCheckedChange={(c) => setEnableColorCorrection(!!c)}
                      disabled={isFormDisabled}
                    />
                    <Label htmlFor="filter-color" className="cursor-pointer font-normal">
                      Color Correction
                    </Label>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Generate button */}
        <div className="mb-6">
          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={isFormDisabled || !productId || isComplete}
            className="w-full sm:w-auto"
          >
            {isPolling || isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Video className="h-4 w-4 mr-2" />
                Generate Video
              </>
            )}
          </Button>
        </div>

        {/* Progress section */}
        {(isPolling || isComplete || hasError) && (
          <Card>
            <CardContent className="p-6 space-y-4">
              {/* Progress bar */}
              {(isPolling || isComplete) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground capitalize">{statusText || "Processing..."}</span>
                    <span className="font-medium">{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Elapsed: {formatElapsedTime(elapsedTime)}</span>
                    {isPolling && <span>ETA: {estimatedRemaining}</span>}
                  </div>
                </div>
              )}

              {/* Success state */}
              {isComplete && (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="flex items-center gap-2 text-green-500">
                    <CheckCircle2 className="h-6 w-6" />
                    <span className="font-semibold text-lg">Video Generated!</span>
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Your product video is ready in the library. You can now review it and publish it to social media.
                  </p>
                  <Button asChild size="lg">
                    <Link href="/librarie">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View in Library
                    </Link>
                  </Button>
                </div>
              )}

              {/* Error state */}
              {hasError && !isPolling && !isComplete && (
                <div className="flex items-center gap-3 p-3 rounded-md bg-destructive/10 text-destructive">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Generation failed</p>
                    <p className="text-xs mt-0.5">
                      Check the error message above and try again. If the issue persists, check backend logs.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---- Page wrapper with Suspense (required for useSearchParams in Next.js App Router) ----
export default function ProductVideoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ProductVideoContent />
    </Suspense>
  );
}
