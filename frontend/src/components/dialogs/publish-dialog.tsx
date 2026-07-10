"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Share2,
  Loader2,
  CheckCircle2,
  XCircle,
  Calendar,
  AlertTriangle,
  FileEdit,
  Upload,
  Sparkles,
  Info,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import { PostizMonthlyCalendar } from "@/components/schedule/postiz-monthly-calendar";
import { PLATFORM_CHAR_LIMITS, PLATFORM_NAMES } from "@/lib/platforms";

// Unified platform item — a Postiz integration, a Buffer channel, or a Blipost account
interface UnifiedPlatform {
  id: string;
  name: string;
  platformType: string; // facebook, instagram, tiktok, etc.
  picture?: string;
  source: "postiz" | "buffer" | "platform";
  // Buffer-specific
  channelId?: string;
}

interface PublishDialogProps {
  clipId: string;
  videoPath: string;
  contextText?: string;
  projectName?: string;
  initialCaption?: string;
  initialYoutubeTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished?: () => void;
}

// Unified neutral highlight for all selected platforms
const SELECTED_BORDER = "border-primary";
const SELECTED_BG = "bg-primary/15";

type DialogState = "form" | "publishing" | "uploading" | "success" | "error";
type PublishMode = "now" | "schedule" | "draft" | "upload";

export function PublishDialog({
  clipId,
  videoPath,
  contextText,
  projectName,
  initialCaption,
  initialYoutubeTitle,
  open,
  onOpenChange,
  onPublished,
}: PublishDialogProps) {
  // Unified platform list
  const [platforms, setPlatforms] = useState<UnifiedPlatform[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Caption
  const [caption, setCaption] = useState("");
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [generatingCaption, setGeneratingCaption] = useState(false);

  // Publish mode: now, schedule, draft, or upload
  const [publishMode, setPublishMode] = useState<PublishMode>("now");
  const [scheduleDate, setScheduleDate] = useState("");

  // Publishing state
  const [dialogState, setDialogState] = useState<DialogState>("form");
  const [progressStep, setProgressStep] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [publishJobId, setPublishJobId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);
  const MAX_POLL_COUNT = 200;

  // Track which polls are active (for multi-service polling)
  const activeJobsRef = useRef<{ postiz?: string; buffer?: string; platform?: string }>({});
  const completedJobsRef = useRef<{ postiz?: string; buffer?: string; platform?: string }>({});

  // Fetch all platforms (Postiz + Buffer) when dialog opens
  useEffect(() => {
    if (!open) return;
    setDialogState("form");
    setProgressPercent(0);
    setProgressStep("");
    setErrorMessage("");
    setPublishJobId(null);
    setCaption(initialCaption || "");
    setYoutubeTitle(initialYoutubeTitle || "");
    setPublishMode("now");
    setScheduleDate("");
    setSelectedIds(new Set());
    activeJobsRef.current = {};
    completedJobsRef.current = {};

    let cancelled = false;
    setLoadingPlatforms(true);

    const fetchAll = async () => {
      const allPlatforms: UnifiedPlatform[] = [];

      // Fetch Postiz integrations
      try {
        const res = await apiGet("/postiz/integrations");
        if (!cancelled) {
          const data = await res.json();
          for (const item of data) {
            allPlatforms.push({
              id: `postiz:${item.id}`,
              name: item.name,
              platformType: item.type,
              picture: item.picture,
              source: "postiz",
            });
          }
        }
      } catch {
        // Postiz not configured — skip
      }

      // Fetch Buffer channels
      try {
        const res = await apiGet("/buffer/channels");
        if (!cancelled) {
          const data = await res.json();
          for (const ch of data) {
            allPlatforms.push({
              id: `buffer:${ch.id}`,
              name: ch.name,
              platformType: ch.service,
              picture: ch.avatar,
              source: "buffer",
              channelId: ch.id,
            });
          }
        }
      } catch {
        // Buffer not configured — skip
      }

      // Fetch Blipost platform accounts (web account, if a token is connected)
      try {
        const res = await apiGet("/platform/accounts");
        if (!cancelled) {
          const data = await res.json();
          for (const acc of data) {
            allPlatforms.push({
              id: `platform:${acc.id}`,
              name: acc.displayName || acc.handle || acc.platform,
              platformType: acc.platform,
              picture: undefined,
              source: "platform",
            });
          }
        }
      } catch {
        // Blipost not connected — skip
      }

      if (!cancelled) {
        setPlatforms(allPlatforms);
        // Select all by default
        setSelectedIds(new Set(allPlatforms.map((p) => p.id)));
        setLoadingPlatforms(false);
      }
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [open]);

  // Cleanup poll on unmount or when dialog closes
  useEffect(() => {
    if (!open && pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open]);

  const togglePlatform = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Derived: selected platforms split by source
  const selectedPostizIds = useMemo(
    () => Array.from(selectedIds)
      .filter((id) => id.startsWith("postiz:"))
      .map((id) => id.replace("postiz:", "")),
    [selectedIds]
  );

  const selectedBufferChannels = useMemo(
    () => platforms
      .filter((p) => p.source === "buffer" && selectedIds.has(p.id))
      .map((p) => p.channelId!),
    [platforms, selectedIds]
  );

  const selectedPlatformIds = useMemo(
    () => Array.from(selectedIds)
      .filter((id) => id.startsWith("platform:"))
      .map((id) => id.replace("platform:", "")),
    [selectedIds]
  );

  const hasPostizSelected = selectedPostizIds.length > 0;
  const hasBufferSelected = selectedBufferChannels.length > 0;
  const hasPlatformSelected = selectedPlatformIds.length > 0;

  // Check if YouTube is among selected platforms
  const hasYoutubeSelected = useMemo(
    () => Array.from(selectedIds).some((id) => {
      const p = platforms.find((pl) => pl.id === id);
      return p && p.platformType === "youtube";
    }),
    [selectedIds, platforms]
  );

  // Draft and Upload modes only work with Postiz
  const hasDraftUpload = hasPostizSelected && !hasBufferSelected;

  const charWarningsMemo = useMemo(() => {
    const warnings: { platform: string; limit: number }[] = [];
    for (const id of selectedIds) {
      const p = platforms.find((pl) => pl.id === id);
      if (!p) continue;
      const limit = PLATFORM_CHAR_LIMITS[p.platformType] || 5000;
      if (caption.length > limit) {
        warnings.push({
          platform: PLATFORM_NAMES[p.platformType] || p.platformType,
          limit,
        });
      }
    }
    return warnings;
  }, [selectedIds, platforms, caption]);

  const minCharLimit = useMemo(() => {
    let min = Infinity;
    for (const id of selectedIds) {
      const p = platforms.find((pl) => pl.id === id);
      if (!p) continue;
      const limit = PLATFORM_CHAR_LIMITS[p.platformType] || 5000;
      if (limit < min) min = limit;
    }
    return min === Infinity ? 5000 : min;
  }, [selectedIds, platforms]);

  // Generate caption with AI
  const handleGenerateCaption = async () => {
    setGeneratingCaption(true);
    try {
      const res = await apiPost("/postiz/generate-caption", {
        clip_id: clipId,
        language: "ro",
        generate_youtube_title: hasYoutubeSelected,
      });
      const data = await res.json();
      if (data.caption) {
        setCaption(data.caption);
        if (data.youtube_title) {
          setYoutubeTitle(data.youtube_title);
        }
        toast.success(data.youtube_title ? "Caption + YouTube title generated with AI!" : "Caption generated with AI!");
      }
    } catch (err) {
      if (err && typeof err === "object" && "detail" in err) {
        toast.error((err as { detail: string }).detail);
      } else {
        toast.error("Couldn't generate the caption");
      }
    } finally {
      setGeneratingCaption(false);
    }
  };

  // Poll a single job — returns status + error detail if failed
  const pollJob = useCallback(async (jobId: string, endpoint: string): Promise<{ status: "completed" | "failed" | "pending"; errorDetail?: string }> => {
    try {
      const res = await apiGet(endpoint);
      const data = await res.json();
      if (data.status === "completed") return { status: "completed" };
      if (data.status === "failed" || data.status === "completed_with_errors") {
        return { status: "failed", errorDetail: data.error_detail || data.step || undefined };
      }
      return { status: "pending" };
    } catch {
      return { status: "pending" };
    }
  }, []);

  // Unified polling for all services
  const startUnifiedPolling = useCallback((jobs: { postiz?: string; buffer?: string; platform?: string }) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollCountRef.current = 0;
    activeJobsRef.current = { ...jobs };
    completedJobsRef.current = {};

    const totalJobs = (jobs.postiz ? 1 : 0) + (jobs.buffer ? 1 : 0) + (jobs.platform ? 1 : 0);
    let completedCount = 0;
    let failedCount = 0;
    const errorDetails: string[] = [];

    const pollOnce = async () => {
      pollCountRef.current++;
      if (pollCountRef.current > MAX_POLL_COUNT) {
        pollRef.current = null;
        setDialogState("error");
        setErrorMessage("Timeout — publishing is taking too long.");
        return;
      }

      // Poll Postiz job
      if (jobs.postiz && !completedJobsRef.current.postiz) {
        const result = await pollJob(jobs.postiz, `/postiz/publish/${jobs.postiz}/progress`);
        if (result.status === "completed") {
          completedJobsRef.current.postiz = "done";
          completedCount++;
        } else if (result.status === "failed") {
          completedJobsRef.current.postiz = "failed";
          if (result.errorDetail) errorDetails.push(`Postiz: ${result.errorDetail}`);
          failedCount++;
          completedCount++;
        }
      }

      // Poll Buffer job
      if (jobs.buffer && !completedJobsRef.current.buffer) {
        const result = await pollJob(jobs.buffer, `/buffer/publish/${jobs.buffer}/progress`);
        if (result.status === "completed") {
          completedJobsRef.current.buffer = "done";
          completedCount++;
        } else if (result.status === "failed") {
          completedJobsRef.current.buffer = "failed";
          if (result.errorDetail) errorDetails.push(`Buffer: ${result.errorDetail}`);
          failedCount++;
          completedCount++;
        }
      }

      // Poll Blipost platform job
      if (jobs.platform && !completedJobsRef.current.platform) {
        const result = await pollJob(jobs.platform, `/platform/publish/${jobs.platform}/progress`);
        if (result.status === "completed") {
          completedJobsRef.current.platform = "done";
          completedCount++;
        } else if (result.status === "failed") {
          completedJobsRef.current.platform = "failed";
          if (result.errorDetail) errorDetails.push(`Blipost: ${result.errorDetail}`);
          failedCount++;
          completedCount++;
        }
      }

      // Update progress
      const pct = Math.round((completedCount / totalJobs) * 100);
      setProgressPercent(pct);

      const parts: string[] = [];
      if (jobs.postiz) parts.push(`Postiz: ${completedJobsRef.current.postiz || "in progress..."}`);
      if (jobs.buffer) parts.push(`Buffer: ${completedJobsRef.current.buffer || "in progress..."}`);
      if (jobs.platform) parts.push(`Blipost: ${completedJobsRef.current.platform || "in progress..."}`);
      setProgressStep(parts.join(" | "));

      if (completedCount >= totalJobs) {
        pollRef.current = null;
        if (failedCount > 0) {
          setDialogState("error");
          setErrorMessage(
            errorDetails.length > 0
              ? errorDetails.join("\n")
              : failedCount < totalJobs
                ? "Some platforms failed."
                : "Publishing failed."
          );
        } else {
          setDialogState("success");
          onPublished?.();
        }
        return;
      }

      pollRef.current = setTimeout(pollOnce, 1500);
    };

    pollRef.current = setTimeout(pollOnce, 1500);
  }, [onPublished, pollJob]);

  // Upload only (Postiz)
  const handleUploadOnly = async () => {
    setDialogState("uploading");
    setProgressStep("Uploading the video to Postiz...");
    setProgressPercent(30);

    try {
      const res = await apiPost("/postiz/upload", {
        clip_id: clipId,
        video_path: videoPath,
      });
      const data = await res.json();

      if (data.status === "success") {
        setProgressPercent(100);
        setDialogState("success");
        onPublished?.();
      } else {
        setDialogState("error");
        setErrorMessage(data.message || "Upload failed");
      }
    } catch (err) {
      setDialogState("error");
      if (err && typeof err === "object" && "detail" in err && (err as { detail: string }).detail) {
        setErrorMessage((err as { detail: string }).detail);
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Upload error");
      }
    }
  };

  // Unified publish — sends to both Postiz and Buffer as needed
  const handlePublish = async () => {
    if (publishMode === "upload") {
      await handleUploadOnly();
      return;
    }

    if (selectedIds.size === 0) {
      toast.error("Select at least one platform");
      return;
    }

    setDialogState("publishing");
    setProgressPercent(0);
    setProgressStep("Starting publishing...");

    const jobs: { postiz?: string; buffer?: string; platform?: string } = {};

    try {
      // Launch Postiz publish if any Postiz platforms selected
      if (hasPostizSelected) {
        const body: Record<string, unknown> = {
          clip_id: clipId,
          caption,
          integration_ids: selectedPostizIds,
        };
        if (publishMode === "schedule" && scheduleDate) {
          body.schedule_date = new Date(scheduleDate).toISOString();
        }
        if (publishMode === "draft") {
          body.save_as_draft = true;
        }
        if (hasYoutubeSelected && youtubeTitle.trim()) {
          body.youtube_title = youtubeTitle.trim();
        }

        const res = await apiPost("/postiz/publish", body);
        const data = await res.json();
        if (data.job_id) {
          jobs.postiz = data.job_id;
        }
      }

      // Launch Buffer publish for each selected channel
      if (hasBufferSelected) {
        // Buffer publishes one channel at a time, use the first selected
        const channelId = selectedBufferChannels[0];
        const body: Record<string, unknown> = {
          clip_id: clipId,
          caption,
          channel_id: channelId,
        };
        if (publishMode === "schedule" && scheduleDate) {
          body.schedule_date = new Date(scheduleDate).toISOString();
        }

        const res = await apiPost("/buffer/publish", body);
        const data = await res.json();
        if (data.job_id) {
          jobs.buffer = data.job_id;
        }
      }

      // Launch Blipost platform publish if any web accounts selected
      if (hasPlatformSelected) {
        const body: Record<string, unknown> = {
          clip_id: clipId,
          caption,
          account_ids: selectedPlatformIds,
        };
        if (publishMode === "schedule" && scheduleDate) {
          body.schedule_date = new Date(scheduleDate).toISOString();
        }
        if (publishMode === "draft") {
          body.save_as_draft = true;
        }

        const res = await apiPost("/platform/publish", body);
        const data = await res.json();
        if (data.job_id) {
          jobs.platform = data.job_id;
        }
      }

      if (!jobs.postiz && !jobs.buffer && !jobs.platform) {
        setDialogState("error");
        setErrorMessage("Couldn't start publishing");
        return;
      }

      // Start unified polling
      startUnifiedPolling(jobs);

    } catch (err) {
      setDialogState("error");
      if (err && typeof err === "object" && "detail" in err && (err as { detail: string }).detail) {
        setErrorMessage((err as { detail: string }).detail);
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Error publishing");
      }
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const minScheduleDate = useMemo(() => new Date().toISOString().slice(0, 16), [open]);

  const handleRetry = () => {
    setDialogState("form");
    setErrorMessage("");
    setProgressPercent(0);
    setPublishJobId(null);
  };

  const handleClose = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    onOpenChange(false);
  };

  const charWarnings = charWarningsMemo;
  const minLimit = minCharLimit;

  const isCaptionRequired = publishMode === "now";
  const isPublishDisabled =
    publishMode === "upload"
      ? false
      : selectedIds.size === 0 ||
        (publishMode === "now" && !caption.trim()) ||
        (publishMode === "schedule" && !scheduleDate);

  // Draft/Upload only available when no Buffer platforms are selected
  const showDraftUpload = !hasBufferSelected;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Publish to Social Media
          </DialogTitle>
          <DialogDescription>
            Select platforms and configure your post.
          </DialogDescription>
        </DialogHeader>

        {/* Form state */}
        {dialogState === "form" && (
          <div className="space-y-5">
            {/* Product context info */}
            {contextText && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-muted/50 border border-border">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-medium text-muted-foreground">Product:</span>{" "}
                  <span className="text-muted-foreground">
                    {projectName && <span className="font-medium">{projectName} — </span>}
                    {contextText.length > 200 ? contextText.slice(0, 200) + "..." : contextText}
                  </span>
                </div>
              </div>
            )}

            {/* Unified platform selector */}
            {publishMode !== "upload" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Platforms</Label>
                  {platforms.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (selectedIds.size === platforms.length) {
                          setSelectedIds(new Set());
                        } else {
                          setSelectedIds(new Set(platforms.map((p) => p.id)));
                        }
                      }}
                    >
                      {selectedIds.size === platforms.length ? "Deselect all" : "Select all"}
                    </button>
                  )}
                </div>
                {loadingPlatforms ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : platforms.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No platform connected. Configure Postiz or Buffer in Settings.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {platforms.map((platform) => {
                      const isSelected = selectedIds.has(platform.id);
                      return (
                        <button
                          key={platform.id}
                          type="button"
                          onClick={() => togglePlatform(platform.id)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-full border-2 transition-all text-sm ${
                            isSelected
                              ? `${SELECTED_BORDER} ${SELECTED_BG}`
                              : "border-transparent bg-muted hover:bg-accent/50"
                          }`}
                        >
                          {platform.picture ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={platform.picture}
                              alt=""
                              className="h-6 w-6 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-6 w-6 rounded-full bg-muted-foreground/20 flex items-center justify-center text-xs font-bold">
                              {(PLATFORM_NAMES[platform.platformType] || platform.platformType)[0]?.toUpperCase()}
                            </div>
                          )}
                          <span className="font-medium">
                            {platform.name}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {PLATFORM_NAMES[platform.platformType] || platform.platformType}
                          </Badge>
                          {platform.source === "buffer" && (
                            <Badge variant="outline" className="text-xs text-primary border-primary/50">
                              Buffer
                            </Badge>
                          )}
                          {platform.source === "platform" && (
                            <Badge variant="outline" className="text-xs text-muted-foreground border-border">
                              Blipost
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Caption — hidden in upload mode */}
            {publishMode !== "upload" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="caption">Caption</Label>
                  {contextText && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateCaption}
                      disabled={generatingCaption}
                      className="h-7 text-xs gap-1.5"
                    >
                      {generatingCaption ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      {generatingCaption ? "Generating..." : "Generate with AI"}
                    </Button>
                  )}
                </div>
                <Textarea
                  id="caption"
                  placeholder="Write the caption for your post..."
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex flex-wrap gap-2">
                    {selectedIds.size > 0 &&
                      Array.from(selectedIds).map((id) => {
                        const p = platforms.find((pl) => pl.id === id);
                        if (!p) return null;
                        const limit = PLATFORM_CHAR_LIMITS[p.platformType] || 5000;
                        const isOver = caption.length > limit;
                        return (
                          <span
                            key={id}
                            className={isOver ? "text-red-500 font-medium" : ""}
                          >
                            {PLATFORM_NAMES[p.platformType] || p.platformType}: {limit}
                          </span>
                        );
                      })}
                  </div>
                  <span
                    className={
                      caption.length > minLimit
                        ? "text-red-500 font-medium"
                        : ""
                    }
                  >
                    {caption.length}
                  </span>
                </div>
                {charWarnings.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-yellow-600">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Caption will be automatically truncated on:{" "}
                      {charWarnings
                        .map((w) => `${w.platform} (max ${w.limit})`)
                        .join(", ")}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* YouTube Title — only when YouTube is selected */}
            {publishMode !== "upload" && hasYoutubeSelected && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="youtube-title">YouTube title</Label>
                  <span className="text-xs text-muted-foreground">(max 100 characters)</span>
                </div>
                <Input
                  id="youtube-title"
                  placeholder="SEO title for YouTube..."
                  value={youtubeTitle}
                  onChange={(e) => setYoutubeTitle(e.target.value.slice(0, 100))}
                  maxLength={100}
                />
                <div className="text-xs text-muted-foreground text-right">
                  {youtubeTitle.length}/100
                </div>
              </div>
            )}

            {/* Publish mode */}
            <div className="space-y-3">
              <Label>Publish mode</Label>
              <div className={`grid gap-2 ${showDraftUpload ? "grid-cols-4" : "grid-cols-2"}`}>
                <button
                  type="button"
                  onClick={() => setPublishMode("now")}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 transition-all text-sm ${
                    publishMode === "now"
                      ? "border-primary bg-primary/15"
                      : "border-transparent bg-muted hover:bg-accent/50"
                  }`}
                >
                  <Share2 className="h-4 w-4" />
                  <span className="font-medium">Publish now</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPublishMode("schedule")}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 transition-all text-sm ${
                    publishMode === "schedule"
                      ? "border-primary bg-primary/15"
                      : "border-transparent bg-muted hover:bg-accent/50"
                  }`}
                >
                  <Calendar className="h-4 w-4" />
                  <span className="font-medium">Schedule</span>
                </button>
                {showDraftUpload && (
                  <>
                    <button
                      type="button"
                      onClick={() => setPublishMode("draft")}
                      className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 transition-all text-sm ${
                        publishMode === "draft"
                          ? "border-primary bg-primary/15"
                          : "border-transparent bg-muted hover:bg-accent/50"
                      }`}
                    >
                      <FileEdit className="h-4 w-4" />
                      <span className="font-medium">Draft</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPublishMode("upload")}
                      className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 transition-all text-sm ${
                        publishMode === "upload"
                          ? "border-primary bg-primary/15"
                          : "border-transparent bg-muted hover:bg-accent/50"
                      }`}
                    >
                      <Upload className="h-4 w-4" />
                      <span className="font-medium">Upload</span>
                    </button>
                  </>
                )}
              </div>
              {publishMode === "draft" && (
                <p className="text-xs text-muted-foreground">
                  The video will be uploaded to Postiz as a draft. You can schedule the post directly from Postiz.
                </p>
              )}
              {publishMode === "upload" && (
                <p className="text-xs text-muted-foreground">
                  The video will only be uploaded to your Postiz library, without creating a post. Useful for preparing content in advance.
                </p>
              )}
              {publishMode === "schedule" && (
                <>
                  <input
                    type="datetime-local"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    min={minScheduleDate}
                  />
                  <PostizMonthlyCalendar title="Posts calendar" />
                </>
              )}
            </div>
          </div>
        )}

        {/* Publishing state */}
        {(dialogState === "publishing" || dialogState === "uploading") && (
          <div className="space-y-4 py-6">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">{progressStep}</p>
            </div>
            <Progress value={progressPercent} className="w-full" />
            <p className="text-xs text-center text-muted-foreground">
              {progressPercent}%
            </p>
          </div>
        )}

        {/* Success state */}
        {dialogState === "success" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <CheckCircle2 className="h-14 w-14 text-success" />
            <div className="text-center">
              <p className="text-lg font-semibold">
                {publishMode === "upload"
                  ? "Video uploaded to Postiz!"
                  : publishMode === "schedule"
                    ? "Post scheduled!"
                    : publishMode === "draft"
                      ? "Draft saved to Postiz!"
                      : "Published successfully!"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {progressStep}
              </p>
            </div>
          </div>
        )}

        {/* Error state */}
        {dialogState === "error" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <XCircle className="h-14 w-14 text-red-500" />
            <div className="text-center max-w-lg">
              <p className="text-lg font-semibold">Publishing failed</p>
              <div className="mt-2 space-y-1">
                {errorMessage.split("\n").map((line, i) => (
                  <p key={i} className="text-sm text-muted-foreground break-words text-left">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <DialogFooter>
          {dialogState === "form" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handlePublish}
                disabled={isPublishDisabled}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {publishMode === "upload" ? (
                  <Upload className="h-4 w-4 mr-2" />
                ) : publishMode === "schedule" ? (
                  <Calendar className="h-4 w-4 mr-2" />
                ) : publishMode === "draft" ? (
                  <FileEdit className="h-4 w-4 mr-2" />
                ) : (
                  <Share2 className="h-4 w-4 mr-2" />
                )}
                {publishMode === "upload"
                  ? "Upload to Postiz"
                  : publishMode === "schedule"
                    ? "Schedule"
                    : publishMode === "draft"
                      ? "Save draft"
                      : "Publish"}
              </Button>
            </>
          )}
          {(dialogState === "publishing" || dialogState === "uploading") && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {dialogState === "uploading" ? "Uploading..." : "Publishing..."}
            </Button>
          )}
          {dialogState === "success" && (
            <Button onClick={handleClose}>Close</Button>
          )}
          {dialogState === "error" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={handleRetry}>Try again</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
