"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Loader2, Send, Share2, XCircle } from "lucide-react";

interface Integration {
  id: string;
  name: string;
  type: string;
  picture?: string;
}

interface ImageSelection {
  id: string;
  prompt: string;
  template_name: string | null;
}

interface ImageBulkPublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: ImageSelection[];
  onPublished?: (imageIds: string[]) => void;
}

type DialogState = "form" | "publishing" | "success" | "error";

export function ImageBulkPublishDialog({
  open,
  onOpenChange,
  images,
  onPublished,
}: ImageBulkPublishDialogProps) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("1440");
  const [dialogState, setDialogState] = useState<DialogState>("form");
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStep, setProgressStep] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    setDialogState("form");
    setCaption("");
    setScheduleEnabled(false);
    setScheduleDate("");
    setIntervalMinutes("1440");
    setProgressPercent(0);
    setProgressStep("");
    setErrorMessage("");
    setSubmitting(false);

    let cancelled = false;
    setLoadingPlatforms(true);

    const fetchIntegrations = async () => {
      try {
        const res = await apiGet("/postiz/integrations");
        const data = await res.json();
        if (cancelled) return;
        const items = Array.isArray(data) ? data : data.integrations || [];
        setIntegrations(items);
        setSelectedIntegrationIds(new Set(items.map((item: Integration) => item.id)));
      } catch {
        if (!cancelled) {
          setIntegrations([]);
          setSelectedIntegrationIds(new Set());
        }
      } finally {
        if (!cancelled) {
          setLoadingPlatforms(false);
        }
      }
    };

    fetchIntegrations();
    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open]);

  const toggleIntegration = (integrationId: string) => {
    setSelectedIntegrationIds((prev) => {
      const next = new Set(prev);
      if (next.has(integrationId)) next.delete(integrationId);
      else next.add(integrationId);
      return next;
    });
  };

  const pollJob = useCallback((jobId: string) => {
    const pollOnce = async () => {
      try {
        const res = await apiGet(`/postiz/publish/${jobId}/progress`);
        const data = await res.json();
        setProgressPercent(data.percentage || 0);
        setProgressStep(data.step || "");

        if (data.status === "completed") {
          pollRef.current = null;
          setDialogState("success");
          setSubmitting(false);
          onPublished?.(images.map((image) => image.id));
          return;
        }

        if (data.status === "failed") {
          pollRef.current = null;
          setDialogState("error");
          setSubmitting(false);
          setErrorMessage(data.step || "Bulk image publish failed");
          return;
        }
      } catch (error) {
        pollRef.current = null;
        setDialogState("error");
        setSubmitting(false);
        setErrorMessage(error instanceof Error ? error.message : "Bulk image publish failed");
        return;
      }

      pollRef.current = setTimeout(pollOnce, 1500);
    };

    pollRef.current = setTimeout(pollOnce, 1000);
  }, [images, onPublished]);

  const handleSubmit = async () => {
    if (images.length === 0) {
      toast.error("Select at least one image");
      return;
    }
    if (selectedIntegrationIds.size === 0) {
      toast.error("Select at least one platform");
      return;
    }
    if (scheduleEnabled && !scheduleDate) {
      toast.error("Select a schedule date");
      return;
    }

    setSubmitting(true);
    setDialogState("publishing");
    setErrorMessage("");
    setProgressPercent(5);
    setProgressStep("Starting bulk image publish...");

    try {
      const res = await apiPost("/image-gen/bulk-publish", {
        image_ids: images.map((image) => image.id),
        caption,
        integration_ids: Array.from(selectedIntegrationIds),
        schedule_date: scheduleEnabled ? new Date(scheduleDate).toISOString() : undefined,
        schedule_interval_minutes: Number(intervalMinutes) || 1440,
      });
      const data = await res.json();
      pollJob(data.job_id);
    } catch (error) {
      setDialogState("error");
      setSubmitting(false);
      setErrorMessage(error instanceof Error ? error.message : "Bulk image publish failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-5" />
            Publish Images
          </DialogTitle>
          <DialogDescription>
            Send {images.length} selected {images.length === 1 ? "image" : "images"} to your social media integrations.
          </DialogDescription>
        </DialogHeader>

        {dialogState === "form" && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">{images.length} selected</p>
              <div className="mt-2 space-y-1">
                {images.slice(0, 3).map((image) => (
                  <p key={image.id} className="text-xs text-muted-foreground truncate">
                    {image.template_name || "Image"}: {image.prompt || image.id}
                  </p>
                ))}
                {images.length > 3 && (
                  <p className="text-xs text-muted-foreground">+{images.length - 3} more</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Platforms</Label>
              {loadingPlatforms ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading integrations...
                </div>
              ) : integrations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Postiz integrations found.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {integrations.map((integration) => (
                    <button
                      key={integration.id}
                      type="button"
                      onClick={() => toggleIntegration(integration.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        selectedIntegrationIds.has(integration.id)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-muted text-foreground hover:bg-accent"
                      }`}
                    >
                      {integration.picture && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={integration.picture} alt="" className="size-4 rounded-full" />
                      )}
                      {integration.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulk-image-caption">Caption</Label>
              <Input
                id="bulk-image-caption"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Optional shared caption for all selected images"
              />
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulk-image-schedule"
                  checked={scheduleEnabled}
                  onCheckedChange={(checked) => setScheduleEnabled(checked === true)}
                />
                <Label htmlFor="bulk-image-schedule" className="flex items-center gap-2">
                  <CalendarClock className="size-4" />
                  Schedule selected images
                </Label>
              </div>

              {scheduleEnabled && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="bulk-image-schedule-date">Start date</Label>
                    <Input
                      id="bulk-image-schedule-date"
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={(event) => setScheduleDate(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bulk-image-interval">Interval minutes</Label>
                    <Input
                      id="bulk-image-interval"
                      type="number"
                      min="1"
                      value={intervalMinutes}
                      onChange={(event) => setIntervalMinutes(event.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {dialogState === "publishing" && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" />
              Publishing images...
            </div>
            <Progress value={progressPercent} className="w-full" />
            <p className="text-sm text-muted-foreground">{progressStep || "Preparing request..."}</p>
          </div>
        )}

        {dialogState === "success" && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-5" />
              <span className="font-medium">Image batch sent successfully.</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {scheduleEnabled ? "The selected images were scheduled in order." : "The selected images were sent for publishing."}
            </p>
          </div>
        )}

        {dialogState === "error" && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="size-5" />
              <span className="font-medium">Bulk image publish failed.</span>
            </div>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
          </div>
        )}

        <DialogFooter>
          {dialogState === "form" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || loadingPlatforms || integrations.length === 0 || selectedIntegrationIds.size === 0}
              >
                {scheduleEnabled ? <CalendarClock className="size-4 mr-2" /> : <Send className="size-4 mr-2" />}
                {scheduleEnabled ? "Schedule Images" : "Publish Images"}
              </Button>
            </>
          )}

          {dialogState === "success" && (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}

          {dialogState === "error" && (
            <>
              <Button variant="outline" onClick={() => setDialogState("form")}>
                Back
              </Button>
              <Button onClick={handleSubmit}>Retry</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
