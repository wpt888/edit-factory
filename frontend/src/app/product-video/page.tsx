"use client";

import { useState, useEffect, useRef, Suspense } from "react";
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
import { apiPost, apiGet, apiPatch, apiGetWithRetry, handleApiError } from "@/lib/api";
import { useProfile } from "@/contexts/profile-context";
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
  X,
  Film,
  Images,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_SCRIPT_AI_PROVIDER,
  DESKTOP_CODEX_AVAILABLE,
  type ScriptAiProvider,
} from "@/lib/script-ai";

// ---- Inner component that uses useSearchParams ----
function ProductVideoContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentProfile } = useProfile();

  // Extract product info from query params
  const productId = searchParams.get("id") || "";
  const title = searchParams.get("title") || "Unknown Product";
  const image = searchParams.get("image") || "";
  const price = searchParams.get("price") || "";
  const brand = searchParams.get("brand") || "";
  const source = searchParams.get("source") || "feed";

  // Form state
  const [voiceoverMode, setVoiceoverMode] = useState<"quick" | "elaborate">("quick");
  const [ttsProvider, setTtsProvider] = useState<"edge" | "elevenlabs">("edge");
  const [voiceId, setVoiceId] = useState("");
  const [aiProvider, setAiProvider] = useState<ScriptAiProvider>(
    DEFAULT_SCRIPT_AI_PROVIDER,
  );
  const [codexModel, setCodexModel] = useState(DEFAULT_CODEX_MODEL);
  const [duration, setDuration] = useState<string>("30");
  const [encodingPreset, setEncodingPreset] = useState<string>("tiktok");
  const [ctaText, setCtaText] = useState("Comanda acum!");
  const [enableDenoise, setEnableDenoise] = useState(false);
  const [enableSharpen, setEnableSharpen] = useState(false);
  const [enableColorCorrection, setEnableColorCorrection] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Footage-mode state (Wave 4.1 / G6) — does this product have associated clips?
  type FootageSegment = { association_id: string; segment_id: string; keywords: string[] };
  const [footageCount, setFootageCount] = useState<number | null>(null); // null = still loading
  const [footageSegments, setFootageSegments] = useState<FootageSegment[]>([]);
  const [pipPosition, setPipPosition] = useState<string>("bottom-right");
  const [savingPip, setSavingPip] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  // No redirect — show empty state inline when no product ID

  // Pre-fill CTA from profile template settings (only if user hasn't changed the default)
  useEffect(() => {
    if (!currentProfile?.id) return;

    const loadProfileDefaults = async () => {
      try {
        const res = await apiGetWithRetry(`/profiles/${currentProfile.id}`);
        if (!res.ok) return;
        const profileData = await res.json();
        const ctaFromProfile = profileData?.video_template_settings?.cta_text;
        if (ctaFromProfile) {
          // Only override the default value — do not override if user has already changed it
          setCtaText((prev) => (prev === "Comanda acum!" ? ctaFromProfile : prev));
        }
      } catch (err) {
        console.warn("Failed to load profile template defaults:", err);
      }
    };

    loadProfileDefaults();
  }, [currentProfile?.id]);

  // Detect footage associations for this product → footage-mode vs slideshow
  useEffect(() => {
    if (!productId) return;
    let cancelled = false;

    const loadFootage = async () => {
      try {
        const res = await apiGet(`/associations/product/${productId}`);
        if (!res.ok) {
          if (!cancelled) setFootageCount(0);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setFootageCount(data?.count ?? 0);
        setFootageSegments(data?.segments ?? []);
        if (data?.pip_config?.position) setPipPosition(data.pip_config.position);
      } catch {
        if (!cancelled) setFootageCount(0);
      }
    };

    loadFootage();
    return () => { cancelled = true; };
  }, [productId]);

  // Persist a new PiP position across every associated segment
  const handlePipPositionChange = async (position: string) => {
    const prev = pipPosition;
    setPipPosition(position); // optimistic
    setSavingPip(true);
    try {
      await Promise.all(
        footageSegments.map((s) =>
          apiPatch(`/associations/${s.association_id}/pip-config`, {
            enabled: true,
            position,
            size: "medium",
            animation: "fade",
          })
        )
      );
    } catch {
      setPipPosition(prev); // roll back on failure
      toast.error("Failed to save overlay position");
    } finally {
      setSavingPip(false);
    }
  };

  // Default voice based on TTS provider
  const defaultVoice = ttsProvider === "edge" ? "ro-RO-EmilNeural" : "";

  // Bug #130: isMounted ref for async callback safety
  const isMountedRef = useRef(true);
  useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

  // Job polling
  const { startPolling, stopPolling, isPolling, progress, statusText, elapsedTime, estimatedRemaining } =
    useJobPolling({
      interval: 2000,
      onProgress: (p, status) => {
        void p;
        void status;
      },
      onComplete: () => {
        if (!isMountedRef.current) return; // Bug #130
        setIsGenerating(false);
        setIsComplete(true);
        toast.success("Video generated successfully! View it in the library.");
      },
      onError: (error) => {
        if (!isMountedRef.current) return; // Bug #130
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
        source,
        voiceover_mode: voiceoverMode,
        tts_provider: ttsProvider,
        voice_id: voiceId || defaultVoice || null,
        ai_provider: aiProvider,
        codex_model: codexModel.trim() || DEFAULT_CODEX_MODEL,
        duration_s: parseInt(duration, 10) || 30,
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

      setCurrentJobId(data.job_id);
      startPolling(data.job_id);
    } catch (err) {
      setIsGenerating(false);
      setHasError(true);
      handleApiError(err, "Failed to start generation");
    }
  };

  const handleCancelGeneration = async () => {
    if (currentJobId) {
      try {
        await apiPost(`/jobs/${currentJobId}/cancel`, {});
      } catch { /* best effort */ }
    }
    stopPolling();
    setIsGenerating(false);
    setCurrentJobId(null);
  };

  const isFormDisabled = isPolling || isGenerating;

  return (
    <div className="min-h-full bg-background">
      <PageShell width="narrow">
        {/* Back navigation */}
        <div className="mb-6">
          <Link
            href={source === "local" ? "/product-library" : "/products"}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            Back to Library
          </Link>
        </div>

        {/* Page title */}
        <PageHeader className="mb-6" icon={<Video className="size-7 text-primary" />} title="Generate Video" />

        {/* Empty state when no product is selected */}
        {!productId && (
          <div className="flex flex-col items-center justify-center py-20">
            <EmptyState
              icon={<Video className="size-6" />}
              title="Select an item first"
              description="Pick an item from your Context Library to generate a video."
              action={{ label: "Open Context Library", onClick: () => router.push("/product-library") }}
            />
          </div>
        )}

        {/* Product info card */}
        {productId && (
          <Card className="mb-6">
            <CardContent>
              <div className="flex gap-4 items-start">
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image}
                    alt={title}
                    className="size-24 object-cover rounded-md flex-shrink-0"
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

        {/* Footage-mode card (Wave 4.1 / G6) */}
        {productId && footageCount !== null && (
          footageCount > 0 ? (
            <Card className="mb-6 border-primary/40">
              <CardContent>
                <div className="flex items-start gap-3">
                  <Film className="size-5 text-primary flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">
                        Footage mode — uses your own video
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        This product is matched to{" "}
                        <span className="font-medium text-foreground">
                          {footageCount} of your clip{footageCount === 1 ? "" : "s"}
                        </span>
                        . The video is assembled from your real footage with the product
                        image overlaid as a Picture-in-Picture.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pip-position" className="text-xs font-medium">
                        Product overlay position
                      </Label>
                      <Select
                        value={pipPosition}
                        onValueChange={handlePipPositionChange}
                        disabled={isFormDisabled || savingPip}
                      >
                        <SelectTrigger id="pip-position" className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="top-left">Top left</SelectItem>
                          <SelectItem value="top-right">Top right</SelectItem>
                          <SelectItem value="bottom-left">Bottom left</SelectItem>
                          <SelectItem value="bottom-right">Bottom right</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="mb-6">
              <CardContent>
                <div className="flex items-start gap-3">
                  <Images className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">Slideshow mode</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      The video animates the product image (Ken Burns). To use your own
                      footage, associate video segments with this product on the
                      Segments page, then return here.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
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
                value={voiceoverMode}
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
                {voiceoverMode === "quick"
                  ? "Uses a product template for fast generation — no AI cost."
                  : "Uses your selected AI provider to write a custom voiceover script."}
              </p>
            </div>

            {/* AI Provider (only for elaborate mode) */}
            {voiceoverMode === "elaborate" && (
              <div className="space-y-2">
                <Label htmlFor="ai-provider" className="text-sm font-medium">
                  AI Script Provider
                </Label>
                <Select
                  value={aiProvider}
                  onValueChange={(v) => setAiProvider(v as ScriptAiProvider)}
                  disabled={isFormDisabled}
                >
                  <SelectTrigger id="ai-provider" className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="claude">Claude</SelectItem>
                    {DESKTOP_CODEX_AVAILABLE && (
                      <SelectItem value="codex">Codex (ChatGPT subscription)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {aiProvider === "codex" && DESKTOP_CODEX_AVAILABLE && (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor="codex-model">Codex Model</Label>
                    <Input
                      id="codex-model"
                      value={codexModel}
                      onChange={(event) => setCodexModel(event.target.value)}
                      placeholder="gpt-5.4-mini"
                      spellCheck={false}
                      autoCapitalize="none"
                      className="w-full max-w-sm font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Uses this computer&apos;s ChatGPT Codex subscription login.
                    </p>
                  </div>
                )}
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
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
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
        <div className="mb-6 flex gap-2">
          <Button
            size="lg"
            variant="cta"
            onClick={handleGenerate}
            disabled={isFormDisabled || !productId || isComplete}
            className="w-full sm:w-auto"
          >
            {isPolling || isGenerating ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Video className="size-4 mr-2" />
                Generate Video
              </>
            )}
          </Button>
          {(isPolling || isGenerating) && (
            <Button
              size="lg"
              variant="destructive"
              onClick={handleCancelGeneration}
            >
              <X className="size-4 mr-1" />
              Stop
            </Button>
          )}
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
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="size-6" />
                    <span className="font-semibold text-lg">Video Generated!</span>
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Your product video is ready in the library. You can now review it and publish it to social media.
                  </p>
                  <Button asChild size="lg">
                    <Link href="/librarie">
                      <ExternalLink className="size-4 mr-2" />
                      View in Library
                    </Link>
                  </Button>
                </div>
              )}

              {/* Error state */}
              {hasError && !isPolling && !isComplete && (
                <div className="flex items-center gap-3 p-3 rounded-md bg-destructive/10 text-destructive">
                  <AlertCircle className="size-5 flex-shrink-0" />
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
      </PageShell>
    </div>
  );
}

// ---- Page wrapper with Suspense (required for useSearchParams in Next.js App Router) ----
export default function ProductVideoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-full bg-background flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ProductVideoContent />
    </Suspense>
  );
}
