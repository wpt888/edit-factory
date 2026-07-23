"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Film,
  ImageIcon,
  Loader2,
  Music2,
  RefreshCw,
  Sparkles,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";

import { ExampleGallery } from "@/app/create/example-gallery";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost, getApiUrl, handleApiError } from "@/lib/api";
import type { TTSAsset } from "@/types/video-processing";

type CreationMode = "image" | "video" | "soundtrack";
type CreationStatus = "completed" | "generating" | "failed";

interface GeneratedImage {
  id: string;
  prompt?: string;
  status?: string;
  image_url?: string | null;
  image_local_path?: string | null;
  final_image_path?: string | null;
  template_name?: string | null;
  created_at?: string;
}

interface GeneratedVideo {
  id: string;
  prompt?: string;
  name?: string | null;
  status?: string;
  source_video_id?: string | null;
  created_at?: string;
}

interface CreationItem {
  id: string;
  kind: CreationMode;
  title: string;
  prompt: string;
  status: CreationStatus;
  createdAt: string;
  previewUrl?: string;
  audioUrl?: string;
}

const MODES: Array<{
  value: CreationMode;
  label: string;
  icon: typeof ImageIcon;
  placeholder: string;
  helper: string;
}> = [
  {
    value: "image",
    label: "Image",
    icon: ImageIcon,
    placeholder: "Describe the image you want to create…",
    helper: "Generate a finished visual, then refine branding and publishing in the advanced flow.",
  },
  {
    value: "video",
    label: "Video",
    icon: Film,
    placeholder: "Describe the scene, motion, camera and atmosphere…",
    helper: "Create an editable Seedance clip with optional native audio.",
  },
  {
    value: "soundtrack",
    label: "Soundtrack",
    icon: Music2,
    placeholder: "Write the narration for the voice soundtrack…",
    helper: "Generate a voice track with ElevenLabs, then manage versions and files in the TTS Library.",
  },
];

const MODE_COPY: Record<CreationMode, { plural: string; empty: string }> = {
  image: {
    plural: "images",
    empty: "No images yet. Describe the first visual you want to create below.",
  },
  video: {
    plural: "videos",
    empty: "No videos yet. Describe the first clip you want to create below.",
  },
  soundtrack: {
    plural: "soundtracks",
    empty: "No soundtracks yet. Write the first narration you want to generate below.",
  },
};

const IMAGE_MODELS = [
  { value: "nano-banana", label: "NanoBanana" },
  { value: "nano-banana-2", label: "NanoBanana 2" },
  { value: "nano-banana-pro", label: "NanoBanana Pro" },
];

const VOICE_MODELS = [
  { value: "eleven_flash_v2_5", label: "Flash v2.5" },
  { value: "eleven_turbo_v2_5", label: "Turbo v2.5" },
  { value: "eleven_multilingual_v2", label: "Multilingual v2" },
];

const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";
const VIDEO_DURATIONS = DESKTOP_MODE ? ["4", "5", "6", "8", "10", "12", "15"] : ["5"];
const POLL_INTERVAL_MS = 2500;
const POLL_ATTEMPTS = 120;

function normalizeStatus(status?: string): CreationStatus {
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "completed" || status === "ready") return "completed";
  return "generating";
}

function mediaHostUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${getApiUrl().replace(/\/api\/v1\/?$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function imagePreview(image: GeneratedImage) {
  if (image.final_image_path || image.image_local_path) {
    return `${getApiUrl()}/image-gen/${image.id}/file`;
  }
  return image.image_url || undefined;
}

function videoPreview(video: GeneratedVideo) {
  if (!video.source_video_id) return undefined;
  const profileId = typeof window !== "undefined"
    ? localStorage.getItem("editai_current_profile_id")
    : null;
  const query = profileId ? `?profile_id=${encodeURIComponent(profileId)}` : "";
  return `${getApiUrl()}/segments/source-videos/${video.source_video_id}/thumbnail${query}`;
}

function imageToItem(image: GeneratedImage): CreationItem {
  return {
    id: `image:${image.id}`,
    kind: "image",
    title: image.template_name || "AI image",
    prompt: image.prompt || "Generated image",
    status: normalizeStatus(image.status),
    createdAt: image.created_at || new Date().toISOString(),
    previewUrl: imagePreview(image),
  };
}

function videoToItem(video: GeneratedVideo): CreationItem {
  return {
    id: `video:${video.id}`,
    kind: "video",
    title: video.name || "AI video",
    prompt: video.prompt || "Generated video",
    status: normalizeStatus(video.status),
    createdAt: video.created_at || new Date().toISOString(),
    previewUrl: videoPreview(video),
  };
}

function soundtrackToItem(asset: TTSAsset): CreationItem {
  return {
    id: `soundtrack:${asset.id}`,
    kind: "soundtrack",
    title: "Voice soundtrack",
    prompt: asset.tts_text,
    status: normalizeStatus(asset.status),
    createdAt: asset.created_at || new Date().toISOString(),
    audioUrl: asset.mp3_url ? mediaHostUrl(asset.mp3_url) : undefined,
  };
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function advancedHref(mode: CreationMode) {
  if (mode === "image") return "/create-image";
  if (mode === "video") return "/create-video";
  return "/tts-library";
}

function advancedLabel(mode: CreationMode) {
  if (mode === "image") return "Advanced image workflow";
  if (mode === "video") return "Advanced video setup";
  return "Open TTS Library";
}

function resultHref(mode: CreationMode) {
  if (mode === "image") return "/create-image";
  if (mode === "video") return "/librarie";
  return "/tts-library";
}

function resultLabel(mode: CreationMode) {
  if (mode === "image") return "Open image history";
  if (mode === "video") return "Open in Library";
  return "Open in TTS Library";
}

const WAVEFORM_HEIGHTS = [14, 26, 38, 22, 44, 30, 18, 36, 24, 40, 16, 28];

function SoundtrackTile({ item }: { item: CreationItem }) {
  return (
    <Card
      data-testid="creation-soundtrack"
      className="gap-0 overflow-hidden py-0"
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <div
          className="flex h-20 items-center justify-center gap-1 rounded-md border border-border bg-surface-canvas px-3"
          aria-hidden="true"
        >
          {WAVEFORM_HEIGHTS.map((height, barIndex) => (
            <span
              key={`${item.id}:${barIndex}`}
              className="w-1 rounded-full bg-primary/55"
              style={{ height }}
            />
          ))}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {item.prompt}
              </p>
            </div>
            <Badge
              variant={item.status === "failed" ? "destructive" : "outline"}
              className="shrink-0 capitalize"
            >
              {item.status}
            </Badge>
          </div>

          {item.audioUrl && item.status === "completed" && (
            <audio
              aria-label={`Play ${item.title}`}
              className="h-8 w-full"
              src={item.audioUrl}
              controls
              preload="metadata"
            />
          )}

          {item.status === "completed" && (
            <Button asChild variant="ghost" size="sm" className="px-0">
              <Link href={resultHref(item.kind)}>
                <Music2 className="size-4" />
                {resultLabel(item.kind)}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function CreationTile({ item, index }: { item: CreationItem; index: number }) {
  if (item.kind === "soundtrack") return <SoundtrackTile item={item} />;

  const Icon = item.kind === "image" ? ImageIcon : Film;
  const mediaClassName = index % 5 === 0 ? "aspect-[4/5]" : index % 3 === 0 ? "aspect-video" : "aspect-square";

  return (
    <Card
      data-testid={`creation-${item.kind}`}
      className="group mb-4 break-inside-avoid gap-0 overflow-hidden py-0"
    >
      {item.previewUrl ? (
        <div className={`relative overflow-hidden bg-black ${mediaClassName}`}>
          {/* Generation URLs can come from several configured providers, so a
              native media element is intentional here instead of a host-
              allowlisted Next Image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.previewUrl}
            alt={item.prompt}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-opacity group-hover:opacity-85"
          />
          {item.kind === "video" && (
            <span className="absolute right-3 bottom-3 flex size-8 items-center justify-center rounded-full bg-black/70 text-white">
              <Film className="size-4" />
            </span>
          )}
        </div>
      ) : (
        <div className={`flex items-center justify-center bg-surface-canvas ${mediaClassName}`}>
          {item.status === "generating" ? (
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          ) : (
            <Icon className="size-8 text-muted-foreground" />
          )}
        </div>
      )}

      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {item.prompt}
            </p>
          </div>
          <Badge variant={item.status === "failed" ? "destructive" : "outline"} className="shrink-0 capitalize">
            {item.status}
          </Badge>
        </div>
        {item.status === "completed" && (
          <Button asChild variant="ghost" size="sm" className="w-full justify-start">
            <Link href={resultHref(item.kind)}>
              <Icon className="size-4" />
              {resultLabel(item.kind)}
            </Link>
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function CreatePage() {
  const [mode, setMode] = useState<CreationMode>("image");
  const [prompt, setPrompt] = useState("");
  const [items, setItems] = useState<CreationItem[]>([]);
  const [loadingHistoryMode, setLoadingHistoryMode] = useState<CreationMode | null>("image");
  const [generating, setGenerating] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");

  const [imageModel, setImageModel] = useState("nano-banana-pro");
  const [imageAspect, setImageAspect] = useState("1:1");
  const [imageResolution, setImageResolution] = useState("1K");
  const [videoDuration, setVideoDuration] = useState(DESKTOP_MODE ? "8" : "5");
  const [videoAspect, setVideoAspect] = useState("9:16");
  const [videoResolution, setVideoResolution] = useState("720p");
  const [videoAudio, setVideoAudio] = useState(true);
  const [voiceModel, setVoiceModel] = useState("eleven_flash_v2_5");

  const mountedRef = useRef(true);
  const historyAbortRef = useRef<AbortController | null>(null);
  const loadedHistoryModesRef = useRef(new Set<CreationMode>());
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const currentMode = MODES.find((candidate) => candidate.value === mode) ?? MODES[0];
  const loadingHistory = loadingHistoryMode === mode;

  useEffect(() => {
    // React Strict Mode replays effects in development. Restore the flag on
    // every setup so the replayed cleanup cannot permanently suppress updates.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      historyAbortRef.current?.abort();
    };
  }, []);

  const loadHistory = useCallback(async (targetMode: CreationMode, force = false) => {
    if (!force && loadedHistoryModesRef.current.has(targetMode)) return;

    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;
    setLoadingHistoryMode(targetMode);

    try {
      const nextItems: CreationItem[] = [];
      if (targetMode === "image") {
        const response = await apiGet("/image-gen/history?limit=16", {
          memoryCache: false,
          signal: controller.signal,
        });
        const data = await response.json() as { images?: GeneratedImage[] };
        nextItems.push(...(data.images ?? []).map(imageToItem));
      } else if (targetMode === "video") {
        const response = await apiGet("/video-gen/history", {
          memoryCache: false,
          signal: controller.signal,
        });
        const data = await response.json() as { videos?: GeneratedVideo[] };
        nextItems.push(...(data.videos ?? []).map(videoToItem));
      } else {
        const response = await apiGet("/tts-library/", {
          memoryCache: false,
          signal: controller.signal,
        });
        const data = await response.json() as TTSAsset[];
        nextItems.push(...data.slice(0, 12).map(soundtrackToItem));
      }

      if (!mountedRef.current || controller.signal.aborted) return;
      loadedHistoryModesRef.current.add(targetMode);
      setItems((current) => (
        [
          ...current.filter((item) => item.kind !== targetMode),
          ...nextItems,
        ].sort((left, right) => (
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        ))
      ));
    } catch (error) {
      if (!controller.signal.aborted) {
        handleApiError(error, `Could not load ${MODE_COPY[targetMode].plural}`);
      }
    } finally {
      if (mountedRef.current && historyAbortRef.current === controller) {
        historyAbortRef.current = null;
        setLoadingHistoryMode(null);
      }
    }
  }, []);

  useEffect(() => {
    void loadHistory(mode);
  }, [loadHistory, mode]);

  const pollImage = useCallback(async (imageId: string) => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS && mountedRef.current; attempt += 1) {
      await wait(POLL_INTERVAL_MS);
      const response = await apiGet(`/image-gen/${imageId}/status`, { memoryCache: false });
      const image = await response.json() as GeneratedImage;
      const status = normalizeStatus(image.status);
      setLiveStatus(status === "generating" ? "Generating image…" : "");
      if (status === "completed") return image;
      if (status === "failed") throw new Error("Image generation failed");
    }
    throw new Error("Image generation timed out");
  }, []);

  const pollVideo = useCallback(async (videoId: string) => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS && mountedRef.current; attempt += 1) {
      await wait(POLL_INTERVAL_MS);
      const response = await apiGet(`/video-gen/${videoId}/status`, { memoryCache: false });
      const video = await response.json() as GeneratedVideo;
      const status = normalizeStatus(video.status);
      setLiveStatus(status === "generating" ? "Generating video…" : "");
      if (status === "completed") return video;
      if (status === "failed") throw new Error("Video generation failed");
    }
    throw new Error("Video generation timed out");
  }, []);

  const pollSoundtrack = useCallback(async (assetId: string) => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS && mountedRef.current; attempt += 1) {
      await wait(POLL_INTERVAL_MS);
      const response = await apiGet("/tts-library/", { memoryCache: false });
      const assets = await response.json() as TTSAsset[];
      const asset = assets.find((candidate) => candidate.id === assetId);
      if (!asset) continue;
      setLiveStatus(asset.status === "generating" ? "Generating soundtrack…" : "");
      if (asset.status === "ready") return asset;
      if (asset.status === "failed") throw new Error("Soundtrack generation failed");
    }
    throw new Error("Soundtrack generation timed out");
  }, []);

  const generate = useCallback(async () => {
    const cleanPrompt = prompt.trim();
    if (cleanPrompt.length < 3 || generating) return;

    setGenerating(true);
    setLiveStatus(`Starting ${mode} generation…`);
    try {
      if (mode === "image") {
        const response = await apiPost("/image-gen/generate", {
          prompt: cleanPrompt,
          aspect_ratio: imageAspect,
          model: imageModel,
          resolution: imageModel === "nano-banana" ? undefined : imageResolution,
        });
        const started = await response.json() as { image_id: string };
        const result = await pollImage(started.image_id);
        setItems((current) => [imageToItem(result), ...current.filter((item) => item.id !== `image:${result.id}`)]);
        toast.success("Image ready.");
      } else if (mode === "video") {
        const response = await apiPost("/video-gen/generate", {
          prompt: cleanPrompt,
          duration: videoDuration,
          aspect_ratio: videoAspect,
          resolution: videoResolution,
          generate_audio: videoAudio,
          bitrate_mode: "standard",
        });
        const started = await response.json() as { video_id: string };
        const result = await pollVideo(started.video_id);
        setItems((current) => [videoToItem(result), ...current.filter((item) => item.id !== `video:${result.id}`)]);
        toast.success("Video ready.");
      } else {
        const response = await apiPost("/tts-library/", {
          tts_text: cleanPrompt,
          tts_model: voiceModel,
        });
        const started = await response.json() as TTSAsset;
        const result = await pollSoundtrack(started.id);
        setItems((current) => [soundtrackToItem(result), ...current.filter((item) => item.id !== `soundtrack:${result.id}`)]);
        toast.success("Soundtrack ready.");
      }
      setPrompt("");
      setLiveStatus("");
    } catch (error) {
      setLiveStatus("Generation failed. Review the message and try again.");
      handleApiError(error, `Could not generate ${mode}`);
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }, [
    generating,
    imageAspect,
    imageModel,
    imageResolution,
    mode,
    pollImage,
    pollSoundtrack,
    pollVideo,
    prompt,
    videoAspect,
    videoAudio,
    videoDuration,
    videoResolution,
    voiceModel,
  ]);

  const visibleItems = useMemo(
    () => items.filter((item) => item.kind === mode),
    [items, mode],
  );
  const readyCount = useMemo(
    () => visibleItems.filter((item) => item.status === "completed").length,
    [visibleItems],
  );
  const useSuggestedNarration = useCallback((narration: string) => {
    setPrompt(narration);
    setLiveStatus("Narration added. Adjust it or generate when ready.");
    window.requestAnimationFrame(() => {
      promptInputRef.current?.focus();
      promptInputRef.current?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  return (
    <PageShell width="wide" className="flex min-h-full flex-col gap-6 space-y-0 pb-4">
      <PageHeader
        icon={<Sparkles className="size-6 text-primary" />}
        title="Create"
        description="Generate images, videos and voice soundtracks from one focused workspace."
      />

      <ExampleGallery
        mode={mode}
        onUsePrompt={useSuggestedNarration}
      />

      <section className="min-h-80 flex-1" aria-labelledby="recent-creations-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 id="recent-creations-heading" className="font-heading text-lg font-semibold">
              Recent {MODE_COPY[mode].plural}
            </h2>
            <p className="text-sm text-muted-foreground">
              {readyCount > 0
                ? `${readyCount} ready`
                : `Your ${MODE_COPY[mode].plural} will appear here`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void loadHistory(mode, true)}
            disabled={loadingHistory}
            aria-label="Refresh recent creations"
          >
            <RefreshCw className={loadingHistory ? "animate-spin" : ""} />
          </Button>
        </div>

        {loadingHistory ? (
          <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" />
            Loading your creations…
          </div>
        ) : visibleItems.length > 0 ? (
          mode === "soundtrack" ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {visibleItems.map((item, index) => (
                <CreationTile key={item.id} item={item} index={index} />
              ))}
            </div>
          ) : (
            <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
              {visibleItems.map((item, index) => (
                <CreationTile key={item.id} item={item} index={index} />
              ))}
            </div>
          )
        ) : (
          <Card className="flex min-h-40 items-center justify-center border-dashed px-6 text-center">
            <div className="max-w-sm space-y-3">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Sparkles className="size-5" />
              </span>
              <h3 className="font-heading text-lg font-semibold">Start with an idea</h3>
              <p className="text-sm text-muted-foreground">
                {MODE_COPY[mode].empty}
              </p>
            </div>
          </Card>
        )}
      </section>

      <div className="sticky bottom-4 z-30 mx-auto w-full max-w-4xl pt-2">
        <Card data-testid="create-composer" className="gap-0 overflow-hidden py-0">
          <Tabs
            value={mode}
            onValueChange={(value) => {
              historyAbortRef.current?.abort();
              historyAbortRef.current = null;
              setLoadingHistoryMode(null);
              setMode(value as CreationMode);
              setLiveStatus("");
            }}
          >
            <TabsList aria-label="Creation type" className="m-3">
              {MODES.map((candidate) => (
                <TabsTrigger
                  key={candidate.value}
                  value={candidate.value}
                  className="px-3 data-[state=active]:bg-lime data-[state=active]:text-ink dark:data-[state=active]:bg-lime dark:data-[state=active]:text-ink"
                >
                  <candidate.icon className="size-4" />
                  {candidate.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Separator />

          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <Label htmlFor="creation-prompt">{currentMode.label} prompt</Label>
              <Textarea
                ref={promptInputRef}
                id="creation-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void generate();
                  }
                }}
                rows={3}
                maxLength={mode === "soundtrack" ? 5000 : 2000}
                placeholder={currentMode.placeholder}
                disabled={generating}
                className="resize-none"
              />
              <p className="text-[11px] text-muted-foreground">{currentMode.helper}</p>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap items-end gap-3">
                {mode === "image" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Model</Label>
                      <Select value={imageModel} onValueChange={setImageModel} disabled={generating}>
                        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {IMAGE_MODELS.map((model) => (
                            <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Format</Label>
                      <Select value={imageAspect} onValueChange={setImageAspect} disabled={generating}>
                        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[
                            ["1:1", "Square 1:1"],
                            ["9:16", "Vertical 9:16"],
                            ["16:9", "Landscape 16:9"],
                            ["4:5", "Portrait 4:5"],
                          ].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {imageModel !== "nano-banana" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Resolution</Label>
                        <Select value={imageResolution} onValueChange={setImageResolution} disabled={generating}>
                          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(["1K", "2K", "4K"] as const).map((value) => (
                              <SelectItem key={value} value={value}>{value}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </>
                )}

                {mode === "video" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Duration</Label>
                      <Select value={videoDuration} onValueChange={setVideoDuration} disabled={generating || !DESKTOP_MODE}>
                        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VIDEO_DURATIONS.map((value) => (
                            <SelectItem key={value} value={value}>{value} seconds</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Format</Label>
                      <Select value={videoAspect} onValueChange={setVideoAspect} disabled={generating}>
                        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="9:16">Vertical 9:16</SelectItem>
                          <SelectItem value="16:9">Landscape 16:9</SelectItem>
                          <SelectItem value="1:1">Square 1:1</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Resolution</Label>
                      <Select value={videoResolution} onValueChange={setVideoResolution} disabled={generating}>
                        <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="480p">480p</SelectItem>
                          <SelectItem value="720p">720p</SelectItem>
                          <SelectItem value="1080p">1080p</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex h-8 items-center gap-2">
                      <Switch id="video-audio" checked={videoAudio} onCheckedChange={setVideoAudio} disabled={generating} />
                      <Label htmlFor="video-audio" className="text-xs text-muted-foreground">
                        Native audio
                      </Label>
                    </div>
                  </>
                )}

                {mode === "soundtrack" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Voice model</Label>
                    <Select value={voiceModel} onValueChange={setVoiceModel} disabled={generating}>
                      <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {VOICE_MODELS.map((model) => (
                          <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 lg:justify-end">
                <Button asChild variant="ghost" size="sm">
                  <Link href={advancedHref(mode)}>{advancedLabel(mode)}</Link>
                </Button>
                <Button
                  variant="cta"
                  size="icon-lg"
                  aria-label={`Generate ${mode}`}
                  title={`Generate ${mode} · Ctrl/⌘ + Enter`}
                  onClick={() => void generate()}
                  disabled={generating || prompt.trim().length < 3}
                >
                  {generating ? <Loader2 className="animate-spin" /> : mode === "soundtrack" ? <Volume2 /> : <ArrowUp />}
                </Button>
              </div>
            </div>

            <p className="min-h-4 text-xs text-muted-foreground" role="status" aria-live="polite">
              {liveStatus}
            </p>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
