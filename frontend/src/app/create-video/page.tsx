"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clapperboard, FileVideo, Loader2, Sparkles, Video } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost, handleApiError } from "@/lib/api";

type VideoStatus = { status: string; progress?: number; error?: string; error_message?: string; source_video_id?: string; library_clip_id?: string };

const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";
const DURATION_OPTIONS = DESKTOP_MODE ? ["4", "5", "6", "8", "10", "12", "15"] : ["5"];

export default function CreateVideoPage() {
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(DESKTOP_MODE ? "8" : "5");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [resolution, setResolution] = useState("720p");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [status, setStatus] = useState<VideoStatus | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!generating || !status || status.status === "completed" || status.status === "failed") return;
    const videoId = sessionStorage.getItem("blipost-ai-video-id");
    if (!videoId) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await apiGet(`/video-gen/${videoId}/status`);
        const next = await response.json() as VideoStatus;
        setStatus(next);
        if (next.status === "completed") {
          setGenerating(false);
          toast.success("AI video saved to Library and Source Videos");
        } else if (next.status === "failed") {
          setGenerating(false);
          toast.error(next.error || next.error_message || "AI video generation failed");
        }
      } catch {
        // The next poll can recover transient network errors.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [generating, status]);

  async function generate() {
    if (prompt.trim().length < 3) {
      toast.error("Describe the video you want to create.");
      return;
    }
    setGenerating(true);
    setStatus({ status: "pending", progress: 0 });
    try {
      const response = await apiPost("/video-gen/generate", {
        prompt: prompt.trim(), name: name.trim() || undefined, duration,
        aspect_ratio: aspectRatio, resolution, generate_audio: generateAudio,
        bitrate_mode: "standard",
      });
      const data = await response.json();
      sessionStorage.setItem("blipost-ai-video-id", data.video_id);
      setStatus({ status: data.status, progress: 0 });
    } catch (error) {
      setGenerating(false);
      setStatus({ status: "failed" });
      handleApiError(error, "Could not start AI video generation");
    }
  }

  const done = status?.status === "completed";
  const failed = status?.status === "failed";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary"><Sparkles className="size-5" /> Seedance 2.0</div>
          <PageHeader
            title="AI Video Generator"
            description="Create a local, editable video asset from a prompt."
          />
        </div>
        <Clapperboard className="size-10 text-primary/70" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader><CardTitle>Describe your video</CardTitle><CardDescription>Seedance can generate motion and synchronized audio directly.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2"><Label htmlFor="name">Asset name (optional)</Label><Input id="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Summer campaign opener" /></div>
            <div className="space-y-2"><Label htmlFor="prompt">Prompt</Label><Textarea id="prompt" rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="A cinematic vertical product reveal..." /></div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>Duration</Label><Select value={duration} onValueChange={setDuration} disabled={!DESKTOP_MODE}><SelectTrigger><SelectValue placeholder={`${duration} seconds`} /></SelectTrigger><SelectContent>{DURATION_OPTIONS.map((value) => <SelectItem key={value} value={value}>{value} seconds</SelectItem>)}</SelectContent></Select>{!DESKTOP_MODE && <p className="text-xs text-muted-foreground">Web generations use the fixed 5-second credit rate.</p>}</div>
              <div className="space-y-2"><Label>Format</Label><Select value={aspectRatio} onValueChange={setAspectRatio}><SelectTrigger><SelectValue placeholder={aspectRatio === "9:16" ? "Vertical 9:16" : aspectRatio === "16:9" ? "Landscape 16:9" : "Square 1:1"} /></SelectTrigger><SelectContent><SelectItem value="9:16">Vertical 9:16</SelectItem><SelectItem value="16:9">Landscape 16:9</SelectItem><SelectItem value="1:1">Square 1:1</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Resolution</Label><Select value={resolution} onValueChange={setResolution}><SelectTrigger><SelectValue placeholder={resolution} /></SelectTrigger><SelectContent><SelectItem value="480p">480p</SelectItem><SelectItem value="720p">720p</SelectItem><SelectItem value="1080p">1080p</SelectItem></SelectContent></Select></div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4"><div><Label htmlFor="audio">Generate native audio</Label><p className="text-sm text-muted-foreground">Keep this on for generated ambience, effects, or speech.</p></div><Switch id="audio" checked={generateAudio} onCheckedChange={setGenerateAudio} /></div>
            <Button className="w-full" size="lg" onClick={generate} disabled={generating}>{generating ? <><Loader2 className="mr-2 size-4 animate-spin" />Generating video…</> : <><Video className="mr-2 size-4" />Generate with Seedance 2.0</>}</Button>
          </CardContent>
        </Card>

        <Card className="h-fit"><CardHeader><CardTitle>After generation</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>The MP4 is downloaded to this device before it is shown anywhere else.</p>
          <p>It appears as a Source Video for timeline editing and as a completed Library clip for direct publishing.</p>
          <p>From Library it can use the existing voiceover, captions, download, and social publishing workflows.</p>
          {status && <div className={failed ? "rounded-md bg-destructive/10 p-3 text-destructive" : "rounded-md bg-muted p-3"}><p className="font-medium capitalize text-foreground">{status.status}</p>{generating && <Progress className="mt-2" value={status.progress ?? 10} />}{failed && <p className="mt-1">{status.error || "Please try again."}</p>}</div>}
          {done && <div className="space-y-2"><Button asChild className="w-full"><Link href="/librarie"><FileVideo className="mr-2 size-4" />Open Library</Link></Button><Button asChild className="w-full" variant="outline"><Link href="/segments">Open Source Videos</Link></Button></div>}
        </CardContent></Card>
      </div>
    </div>
  );
}
