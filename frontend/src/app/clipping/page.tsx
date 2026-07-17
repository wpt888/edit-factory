"use client";

import * as React from "react";
import Link from "next/link";
import {
  Captions,
  Cloud,
  FileVideo,
  MonitorSmartphone,
  RefreshCw,
  Scissors,
  Sparkles,
  Upload,
} from "lucide-react";
import { apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type CloudMedia = {
  id: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: number;
  status: string;
  origin: string;
  previewUrl: string | null;
  createdAt: string;
};

type Highlight = {
  start: number;
  end: number;
  hookLine?: string;
  reason?: string;
  score?: number;
  enabled?: boolean;
};

type ClippingJob = {
  id: string;
  status: string;
  sourceMediaId: string;
  params: {
    maxClips?: number;
    durationMode?: "ai" | "exact" | "target";
    targetDurationSec?: number;
    captions?: boolean;
    hookOverlay?: boolean;
    autoDispatch?: boolean;
    renderTarget?: "cloud" | "desktop";
  };
  highlights: Highlight[];
  transcriptDurationSec: number | null;
  outputMediaIds: string[];
  error: string | null;
  createdAt: string;
};

type MediaResponse = { connected: boolean; media: CloudMedia[] };
type JobsResponse = { connected: boolean; jobs: ClippingJob[] };

const ACTIVE_STATUSES = new Set([
  "pending",
  "transcribing",
  "detecting",
  "rendering",
]);

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function statusProgress(status: string) {
  return (
    { pending: 8, transcribing: 30, detecting: 55, rendering: 78, done: 100 }[
      status
    ] ?? 0
  );
}

export default function ClippingPage() {
  const [media, setMedia] = React.useState<CloudMedia[]>([]);
  const [jobs, setJobs] = React.useState<ClippingJob[]>([]);
  const [connected, setConnected] = React.useState<boolean | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [sourceMediaId, setSourceMediaId] = React.useState("");
  const [maxClips, setMaxClips] = React.useState(5);
  const [duration, setDuration] = React.useState<
    "ai" | "10" | "15" | "20" | "30"
  >("ai");
  const [captions, setCaptions] = React.useState(true);
  const [hookOverlay, setHookOverlay] = React.useState(true);
  const [keepSource, setKeepSource] = React.useState(true);
  const [renderTarget, setRenderTarget] = React.useState<"desktop" | "cloud">(
    "desktop",
  );

  const load = React.useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [mediaResponse, jobsResponse] = await Promise.all([
        apiGet("/platform/media?kind=video&limit=100", { cache: "no-store" }),
        apiGet("/platform/clipping?limit=20", { cache: "no-store" }),
      ]);
      const mediaData = (await mediaResponse.json()) as MediaResponse;
      const jobsData = (await jobsResponse.json()) as JobsResponse;
      const isConnected = mediaData.connected && jobsData.connected;
      setConnected(isConnected);
      setMedia(mediaData.media);
      setJobs(jobsData.jobs);
      setSourceMediaId((current) =>
        current && mediaData.media.some((item) => item.id === current)
          ? current
          : (mediaData.media.find((item) => item.origin === "upload")?.id ??
            mediaData.media[0]?.id ??
            ""),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load Clipping.",
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const hasActiveJob = jobs.some((job) => ACTIVE_STATUSES.has(job.status));
  React.useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, load]);

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await apiUpload("/platform/media/upload", form, {
        timeout: 15 * 60_000,
      });
      const result = (await response.json()) as { mediaId: string };
      await load(true);
      setSourceMediaId(result.mediaId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function createRun() {
    if (!sourceMediaId) return;
    setCreating(true);
    setError(null);
    try {
      await apiPost("/platform/clipping", {
        source_media_id: sourceMediaId,
        max_clips: maxClips,
        duration_mode: duration === "ai" ? "ai" : "exact",
        target_duration_sec: duration === "ai" ? null : Number(duration),
        captions,
        hook_overlay: hookOverlay,
        keep_source: keepSource,
        render_target: renderTarget,
      });
      await load(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start clipping.",
      );
    } finally {
      setCreating(false);
    }
  }

  const mediaById = new Map(media.map((item) => [item.id, item]));

  return (
    <PageShell className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-border bg-card p-2.5">
            <Scissors className="size-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-3xl font-bold tracking-tight">
                Clipping
              </h1>
              <Badge variant="outline" className="gap-1">
                <Cloud className="size-3" /> Shared with web
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Turn one cloud video into reviewed short-form clips with one
              centralized credit charge.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />{" "}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && connected === false && (
        <Card>
          <CardHeader>
            <CardTitle>Connect your Blipost account</CardTitle>
            <CardDescription>
              Clipping and the cloud library use the platform token configured
              for this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/settings">Open Settings</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {connected && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>New clipping run</CardTitle>
                  <CardDescription>
                    Select an existing cloud source or upload a new long-form
                    video.
                  </CardDescription>
                </div>
                <Button variant="outline" asChild disabled={uploading}>
                  <label className="cursor-pointer">
                    <Upload className="size-4" />
                    {uploading ? "Uploading…" : "Upload video"}
                    <input
                      type="file"
                      accept="video/*"
                      className="sr-only"
                      onChange={upload}
                      disabled={uploading}
                    />
                  </label>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <label className="block space-y-1.5 text-sm font-medium">
                Source video
                <select
                  value={sourceMediaId}
                  onChange={(event) => setSourceMediaId(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                >
                  {media.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName ?? item.id} · {item.origin} ·{" "}
                      {formatBytes(item.sizeBytes)}
                    </option>
                  ))}
                </select>
              </label>
              {media.length === 0 && (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Upload a video to start.
                </p>
              )}

              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1.5 text-sm font-medium">
                  Maximum clips
                  <select
                    value={maxClips}
                    onChange={(event) =>
                      setMaxClips(Number(event.target.value))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                  >
                    {[3, 5, 10, 20].map((value) => (
                      <option key={value} value={value}>
                        Up to {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium">
                  Clip duration
                  <select
                    value={duration}
                    onChange={(event) =>
                      setDuration(event.target.value as typeof duration)
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                  >
                    <option value="ai">AI decides</option>
                    <option value="10">Exactly 10 seconds</option>
                    <option value="15">Exactly 15 seconds</option>
                    <option value="20">Exactly 20 seconds</option>
                    <option value="30">Exactly 30 seconds</option>
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium">
                  Render on
                  <select
                    value={renderTarget}
                    onChange={(event) =>
                      setRenderTarget(event.target.value as "desktop" | "cloud")
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal"
                  >
                    <option value="desktop">This desktop · free render</option>
                    <option value="cloud">Cloud · 4 credits/output</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <Choice
                  checked={captions}
                  onChange={setCaptions}
                  icon={Captions}
                  title="Burn in captions"
                  description="Word-by-word karaoke captions."
                />
                <Choice
                  checked={hookOverlay}
                  onChange={setHookOverlay}
                  icon={Sparkles}
                  title="AI hook overlay"
                  description="Separate opening hook text."
                />
                <Choice
                  checked={keepSource}
                  onChange={setKeepSource}
                  icon={FileVideo}
                  title="Keep source"
                  description="Retain the original in the shared library."
                />
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={createRun}
                  disabled={creating || !sourceMediaId}
                >
                  {renderTarget === "desktop" ? (
                    <MonitorSmartphone className="size-4" />
                  ) : (
                    <Cloud className="size-4" />
                  )}
                  {creating ? "Starting…" : "Analyze and find moments"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-xl font-semibold">
                Recent runs
              </h2>
              <p className="text-sm text-muted-foreground">
                Runs created on either surface appear here and on web.
              </p>
            </div>
            {jobs.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No clipping runs yet.
                </CardContent>
              </Card>
            )}
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                mediaById={mediaById}
                onChanged={() => load(true)}
              />
            ))}
          </section>
        </>
      )}
    </PageShell>
  );
}

function Choice({
  checked,
  onChange,
  icon: Icon,
  title,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-3",
        checked && "border-primary/50 bg-primary/5",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4"
      />
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

function JobCard({
  job,
  mediaById,
  onChanged,
}: {
  job: ClippingJob;
  mediaById: Map<string, CloudMedia>;
  onChanged: () => void;
}) {
  const source = mediaById.get(job.sourceMediaId);
  const awaitingReview =
    job.status === "rendering" && job.params.autoDispatch === false;
  const outputs = job.outputMediaIds
    .map((id) => mediaById.get(id))
    .filter(Boolean) as CloudMedia[];
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {source?.displayName ?? "Source video"}
            </CardTitle>
            <CardDescription>
              {new Date(job.createdAt).toLocaleString()} ·{" "}
              {job.params.durationMode === "ai"
                ? "AI duration"
                : `${job.params.targetDurationSec}s exact`}{" "}
              · {job.params.captions === false ? "no captions" : "captions"}
            </CardDescription>
          </div>
          <Badge variant={job.status === "failed" ? "destructive" : "outline"}>
            {job.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {ACTIVE_STATUSES.has(job.status) && (
          <Progress value={statusProgress(job.status)} />
        )}
        {job.error && <p className="text-sm text-destructive">{job.error}</p>}
        {awaitingReview && job.highlights.length > 0 && (
          <Review job={job} onChanged={onChanged} />
        )}
        {outputs.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {outputs.map((output) => (
              <div
                key={output.id}
                className="overflow-hidden rounded-lg border"
              >
                {output.previewUrl ? (
                  <video
                    src={output.previewUrl}
                    controls
                    preload="metadata"
                    className="aspect-[9/16] w-full bg-black object-cover"
                  />
                ) : (
                  <div className="flex aspect-[9/16] items-center justify-center text-xs text-muted-foreground">
                    Preview unavailable
                  </div>
                )}
                <div className="p-2 text-xs text-muted-foreground">
                  {formatBytes(output.sizeBytes)} · {output.origin}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Review({
  job,
  onChanged,
}: {
  job: ClippingJob;
  onChanged: () => void;
}) {
  const [rows, setRows] = React.useState(
    job.highlights.map((item) => ({ ...item, enabled: true })),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  function update(index: number, patch: Partial<Highlight>) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }
  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/platform/clipping/${job.id}/highlights`, {
        highlights: rows,
      });
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start render.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 p-4">
      <h3 className="text-sm font-semibold">Review AI-selected moments</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Analysis is already billed. Uncheck moments or adjust their start before
        render credits are committed.
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <div
            key={index}
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-md border bg-background p-2",
              !row.enabled && "opacity-50",
            )}
          >
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(event) =>
                update(index, { enabled: event.target.checked })
              }
            />
            <span className="w-7 text-xs text-muted-foreground">
              #{index + 1}
            </span>
            <input
              type="number"
              min={0}
              max={
                job.params.durationMode === "exact" &&
                job.transcriptDurationSec &&
                job.params.targetDurationSec
                  ? job.transcriptDurationSec - job.params.targetDurationSec
                  : undefined
              }
              step={0.5}
              value={row.start}
              onChange={(event) => {
                const start = Number(event.target.value);
                update(index, {
                  start,
                  ...(job.params.durationMode === "exact" &&
                  job.params.targetDurationSec
                    ? { end: start + job.params.targetDurationSec }
                    : {}),
                });
              }}
              className="h-8 w-20 rounded-md border bg-background px-2 text-xs"
            />
            <span className="text-xs">to</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={row.end}
              disabled={job.params.durationMode === "exact"}
              onChange={(event) =>
                update(index, { end: Number(event.target.value) })
              }
              className="h-8 w-20 rounded-md border bg-background px-2 text-xs disabled:opacity-60"
            />
            {job.params.hookOverlay !== false && (
              <input
                value={row.hookLine ?? ""}
                maxLength={120}
                placeholder="Hook line"
                onChange={(event) =>
                  update(index, { hookLine: event.target.value })
                }
                className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2 text-xs"
              />
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex justify-end">
        <Button
          onClick={confirm}
          disabled={saving || !rows.some((row) => row.enabled)}
        >
          <Sparkles className="size-4" />
          {saving ? "Starting…" : "Confirm and render"}
        </Button>
      </div>
    </div>
  );
}
