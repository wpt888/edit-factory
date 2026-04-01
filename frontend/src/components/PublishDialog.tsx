"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { PostizMonthlyCalendar } from "@/components/PostizMonthlyCalendar";

// Unified platform item — can be a Postiz integration or a Buffer channel
interface UnifiedPlatform {
  id: string;
  name: string;
  platformType: string; // facebook, instagram, tiktok, etc.
  picture?: string;
  source: "postiz" | "buffer";
  // Buffer-specific
  channelId?: string;
}

interface PublishDialogProps {
  clipId: string;
  videoPath: string;
  contextText?: string;
  projectName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished?: () => void;
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

// Friendly platform names
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

// Unified green for all selected platforms
const SELECTED_BORDER = "border-green-500";
const SELECTED_BG = "bg-green-500/15";

type DialogState = "form" | "publishing" | "uploading" | "success" | "error";
type PublishMode = "now" | "schedule" | "draft" | "upload";

export function PublishDialog({
  clipId,
  videoPath,
  contextText,
  projectName,
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
  const activeJobsRef = useRef<{ postiz?: string; buffer?: string }>({});
  const completedJobsRef = useRef<{ postiz?: string; buffer?: string }>({});

  // Fetch all platforms (Postiz + Buffer) when dialog opens
  useEffect(() => {
    if (!open) return;
    setDialogState("form");
    setProgressPercent(0);
    setProgressStep("");
    setErrorMessage("");
    setPublishJobId(null);
    setCaption("");
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

  const hasPostizSelected = selectedPostizIds.length > 0;
  const hasBufferSelected = selectedBufferChannels.length > 0;

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
      });
      const data = await res.json();
      if (data.caption) {
        setCaption(data.caption);
        toast.success("Caption generat cu AI!");
      }
    } catch (err) {
      if (err && typeof err === "object" && "detail" in err) {
        toast.error((err as { detail: string }).detail);
      } else {
        toast.error("Nu s-a putut genera caption-ul");
      }
    } finally {
      setGeneratingCaption(false);
    }
  };

  // Poll a single job
  const pollJob = useCallback(async (jobId: string, endpoint: string): Promise<"completed" | "failed" | "pending"> => {
    try {
      const res = await apiGet(endpoint);
      const data = await res.json();
      if (data.status === "completed") return "completed";
      if (data.status === "failed" || data.status === "completed_with_errors") return "failed";
      return "pending";
    } catch {
      return "pending";
    }
  }, []);

  // Unified polling for both services
  const startUnifiedPolling = useCallback((jobs: { postiz?: string; buffer?: string }) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollCountRef.current = 0;
    activeJobsRef.current = { ...jobs };
    completedJobsRef.current = {};

    const totalJobs = (jobs.postiz ? 1 : 0) + (jobs.buffer ? 1 : 0);
    let completedCount = 0;
    let failedCount = 0;

    const pollOnce = async () => {
      pollCountRef.current++;
      if (pollCountRef.current > MAX_POLL_COUNT) {
        pollRef.current = null;
        setDialogState("error");
        setErrorMessage("Timeout — publicarea dureaza prea mult.");
        return;
      }

      // Poll Postiz job
      if (jobs.postiz && !completedJobsRef.current.postiz) {
        const status = await pollJob(jobs.postiz, `/postiz/publish/${jobs.postiz}/progress`);
        if (status === "completed") {
          completedJobsRef.current.postiz = "done";
          completedCount++;
        } else if (status === "failed") {
          completedJobsRef.current.postiz = "failed";
          failedCount++;
          completedCount++;
        }
      }

      // Poll Buffer job
      if (jobs.buffer && !completedJobsRef.current.buffer) {
        const status = await pollJob(jobs.buffer, `/buffer/publish/${jobs.buffer}/progress`);
        if (status === "completed") {
          completedJobsRef.current.buffer = "done";
          completedCount++;
        } else if (status === "failed") {
          completedJobsRef.current.buffer = "failed";
          failedCount++;
          completedCount++;
        }
      }

      // Update progress
      const pct = Math.round((completedCount / totalJobs) * 100);
      setProgressPercent(pct);

      const parts: string[] = [];
      if (jobs.postiz) parts.push(`Postiz: ${completedJobsRef.current.postiz || "in curs..."}`);
      if (jobs.buffer) parts.push(`Buffer: ${completedJobsRef.current.buffer || "in curs..."}`);
      setProgressStep(parts.join(" | "));

      if (completedCount >= totalJobs) {
        pollRef.current = null;
        if (failedCount > 0 && failedCount < totalJobs) {
          setDialogState("error");
          setErrorMessage("Unele platforme au esuat. Verifica logurile.");
        } else if (failedCount >= totalJobs) {
          setDialogState("error");
          setErrorMessage("Publicarea a esuat pe toate platformele.");
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
    setProgressStep("Se incarca videoclipul in Postiz...");
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
        setErrorMessage(data.message || "Upload esuat");
      }
    } catch (err) {
      setDialogState("error");
      if (err && typeof err === "object" && "detail" in err && (err as { detail: string }).detail) {
        setErrorMessage((err as { detail: string }).detail);
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Eroare la upload");
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
      toast.error("Selecteaza cel putin o platforma");
      return;
    }

    setDialogState("publishing");
    setProgressPercent(0);
    setProgressStep("Se porneste publicarea...");

    const jobs: { postiz?: string; buffer?: string } = {};

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

      if (!jobs.postiz && !jobs.buffer) {
        setDialogState("error");
        setErrorMessage("Nu s-a putut porni publicarea");
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
            Publica pe Social Media
          </DialogTitle>
        </DialogHeader>

        {/* Form state */}
        {dialogState === "form" && (
          <div className="space-y-5">
            {/* Product context info */}
            {contextText && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-muted/50 border border-border">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-medium text-muted-foreground">Produs:</span>{" "}
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
                  <Label>Platforme</Label>
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
                      {selectedIds.size === platforms.length ? "Deselecteaza tot" : "Selecteaza tot"}
                    </button>
                  )}
                </div>
                {loadingPlatforms ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : platforms.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    Nicio platforma conectata. Configureaza Postiz sau Buffer in Settings.
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
                            <Badge variant="outline" className="text-xs text-blue-400 border-blue-400/50">
                              Buffer
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
                      {generatingCaption ? "Se genereaza..." : "Genereaza cu AI"}
                    </Button>
                  )}
                </div>
                <Textarea
                  id="caption"
                  placeholder="Scrie caption-ul pentru postare..."
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
                      Caption depaseste limita pe:{" "}
                      {charWarnings
                        .map((w) => `${w.platform} (${w.limit})`)
                        .join(", ")}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Publish mode */}
            <div className="space-y-3">
              <Label>Mod publicare</Label>
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
                  <span className="font-medium">Publica acum</span>
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
                  <span className="font-medium">Programeaza</span>
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
                  Videoclipul va fi incarcat in Postiz ca draft. Poti programa postarea direct din Postiz.
                </p>
              )}
              {publishMode === "upload" && (
                <p className="text-xs text-muted-foreground">
                  Videoclipul va fi doar incarcat in biblioteca Postiz, fara a crea o postare. Util pentru a pregati continutul in avans.
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
                  <PostizMonthlyCalendar title="Calendar postari" />
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
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            <div className="text-center">
              <p className="text-lg font-semibold">
                {publishMode === "upload"
                  ? "Video incarcat in Postiz!"
                  : publishMode === "schedule"
                    ? "Postare programata!"
                    : publishMode === "draft"
                      ? "Draft salvat in Postiz!"
                      : "Publicat cu succes!"}
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
            <div className="text-center">
              <p className="text-lg font-semibold">Publicare esuata</p>
              <p className="text-sm text-muted-foreground mt-1">
                {errorMessage}
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <DialogFooter>
          {dialogState === "form" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Anuleaza
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
                  ? "Incarca in Postiz"
                  : publishMode === "schedule"
                    ? "Programeaza"
                    : publishMode === "draft"
                      ? "Salveaza draft"
                      : "Publica"}
              </Button>
            </>
          )}
          {(dialogState === "publishing" || dialogState === "uploading") && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {dialogState === "uploading" ? "Se incarca..." : "Se publica..."}
            </Button>
          )}
          {dialogState === "success" && (
            <Button onClick={handleClose}>Inchide</Button>
          )}
          {dialogState === "error" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Inchide
              </Button>
              <Button onClick={handleRetry}>Incearca din nou</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
