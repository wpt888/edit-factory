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

interface Integration {
  id: string;
  name: string;
  type: string;
  identifier?: string;
  picture?: string;
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

// Unified green for all selected platforms — per-platform colors were too subtle on dark backgrounds
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
  // Integrations
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
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
  const MAX_POLL_COUNT = 200; // ~5 min at 1.5s intervals

  // Fetch integrations when dialog opens
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

    let cancelled = false; // Bug #66: cancelled flag
    const fetchIntegrations = async () => {
      setLoadingIntegrations(true);
      try {
        const res = await apiGet("/postiz/integrations");
        if (cancelled) return;
        const data = await res.json();
        setIntegrations(data);
        setSelectedIds(new Set(data.map((i: Integration) => i.id)));
      } catch {
        if (cancelled) return;
        setIntegrations([]);
        toast.error("Could not load Postiz platforms");
      } finally {
        if (!cancelled) setLoadingIntegrations(false);
      }
    };
    fetchIntegrations();
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

  const toggleIntegration = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const charWarningsMemo = useMemo(() => {
    const warnings: { platform: string; limit: number }[] = [];
    for (const id of selectedIds) {
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
  }, [selectedIds, integrations, caption]);

  const minCharLimit = useMemo(() => {
    let min = Infinity;
    for (const id of selectedIds) {
      const integration = integrations.find((i) => i.id === id);
      if (!integration) continue;
      const limit = PLATFORM_CHAR_LIMITS[integration.type] || 5000;
      if (limit < min) min = limit;
    }
    return min === Infinity ? 5000 : min;
  }, [selectedIds, integrations]);

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

  // Poll progress
  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollCountRef.current = 0;

    const pollOnce = async () => {
      pollCountRef.current++;
      if (pollCountRef.current > MAX_POLL_COUNT) {
        pollRef.current = null;
        setDialogState("error");
        setErrorMessage("Timeout — publicarea dureaza prea mult. Verifica in Postiz.");
        return;
      }
      try {
        const res = await apiGet(`/postiz/publish/${jobId}/progress`);
        const data = await res.json();
        setProgressStep(data.step || "");
        setProgressPercent(data.percentage || 0);

        if (data.status === "completed") {
          pollRef.current = null;
          setDialogState("success");
          onPublished?.();
          return;
        } else if (data.status === "failed" || data.status === "completed_with_errors") {
          pollRef.current = null;
          setDialogState("error");
          setErrorMessage(data.step || "Publicarea a esuat");
          return;
        }
      } catch {
        // Keep polling on transient errors
      }
      pollRef.current = setTimeout(pollOnce, 1500);
    };

    pollRef.current = setTimeout(pollOnce, 1500);
  }, [onPublished]);

  // Upload only (no post creation)
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

  // Publish
  const handlePublish = async () => {
    // Upload mode doesn't need platforms or caption
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
    setProgressStep("Initializing...");

    try {
      const body: Record<string, unknown> = {
        clip_id: clipId,
        caption,
        integration_ids: Array.from(selectedIds),
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
        setPublishJobId(data.job_id);
        startPolling(data.job_id);
      } else {
        setDialogState("error");
        setErrorMessage(data.message || "Nu s-a putut porni publicarea");
      }
    } catch (err) {
      setDialogState("error");
      // Bug #116: use ApiError.detail if available
      if (err && typeof err === "object" && "detail" in err && (err as { detail: string }).detail) {
        setErrorMessage((err as { detail: string }).detail);
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Error publishing");
      }
    }
  };

  // Bug #171: memoize min date so it only recalculates when the dialog opens
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

  // Caption is required only for "now" publish — schedule/draft can proceed without it
  const isCaptionRequired = publishMode === "now";
  const isPublishDisabled =
    publishMode === "upload"
      ? false // upload doesn't require anything extra
      : selectedIds.size === 0 ||
        (publishMode === "now" && !caption.trim()) ||
        (publishMode === "schedule" && !scheduleDate);

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
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-medium text-blue-400">Produs:</span>{" "}
                  <span className="text-muted-foreground">
                    {projectName && <span className="font-medium">{projectName} — </span>}
                    {contextText.length > 200 ? contextText.slice(0, 200) + "..." : contextText}
                  </span>
                </div>
              </div>
            )}

            {/* Platform selector */}
            {publishMode !== "upload" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Platforme</Label>
                  {integrations.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (selectedIds.size === integrations.length) {
                          setSelectedIds(new Set());
                        } else {
                          setSelectedIds(new Set(integrations.map((i) => i.id)));
                        }
                      }}
                    >
                      {selectedIds.size === integrations.length ? "Deselecteaza tot" : "Selecteaza tot"}
                    </button>
                  )}
                </div>
                {loadingIntegrations ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : integrations.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    Nicio platforma conectata in Postiz. Configureaza integrari in Postiz.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {integrations.map((integration) => {
                      const isSelected = selectedIds.has(integration.id);
                      return (
                        <button
                          key={integration.id}
                          type="button"
                          onClick={() => toggleIntegration(integration.id)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-full border-2 transition-all text-sm ${
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
                              className="h-6 w-6 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-6 w-6 rounded-full bg-muted-foreground/20 flex items-center justify-center text-xs font-bold">
                              {(PLATFORM_NAMES[integration.type] || integration.type)[0]?.toUpperCase()}
                            </div>
                          )}
                          <span className="font-medium">
                            {integration.name}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {PLATFORM_NAMES[integration.type] || integration.type}
                          </Badge>
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
                        const integration = integrations.find((i) => i.id === id);
                        if (!integration) return null;
                        const limit =
                          PLATFORM_CHAR_LIMITS[integration.type] || 5000;
                        const isOver = caption.length > limit;
                        return (
                          <span
                            key={id}
                            className={isOver ? "text-red-500 font-medium" : ""}
                          >
                            {PLATFORM_NAMES[integration.type] || integration.type}: {limit}
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
                {/* Warnings */}
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
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setPublishMode("now")}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 transition-all text-sm ${
                    publishMode === "now"
                      ? "border-green-500 bg-green-500/15"
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
                      ? "border-blue-500 bg-blue-500/15"
                      : "border-transparent bg-muted hover:bg-accent/50"
                  }`}
                >
                  <Calendar className="h-4 w-4" />
                  <span className="font-medium">Programeaza</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPublishMode("draft")}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 transition-all text-sm ${
                    publishMode === "draft"
                      ? "border-purple-500 bg-purple-500/15"
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
                      ? "border-orange-500 bg-orange-500/15"
                      : "border-transparent bg-muted hover:bg-accent/50"
                  }`}
                >
                  <Upload className="h-4 w-4" />
                  <span className="font-medium">Upload</span>
                </button>
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
                    ? "Post scheduled!"
                    : publishMode === "draft"
                      ? "Draft saved in Postiz!"
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
                className={
                  publishMode === "upload"
                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white border-none hover:from-orange-600 hover:to-amber-600"
                    : "bg-gradient-to-r from-pink-500 to-purple-500 text-white border-none hover:from-pink-600 hover:to-purple-600"
                }
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
