"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarClock,
  Loader2,
  Clock,
  Send,
  CalendarDays,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import { PostizMonthlyCalendar } from "@/components/PostizMonthlyCalendar";

/* ---------- Types ---------- */

interface CompletedClip {
  clip_id: string;
  variant_index: number;
  final_video_path: string;
  thumbnail_path?: string;
}

interface Integration {
  id: string;
  name: string;
  type: string;
  picture?: string;
}

interface PipelineScheduleProps {
  completedClips: CompletedClip[];
  initialCaptions?: Record<string, string>;  // clip_id -> AI-generated caption
}

const TIMEZONES = [
  "Europe/Bucharest", "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney",
];

/* ---------- Module-level integrations cache (survives remounts) ---------- */

let _integrationsCache: Integration[] | undefined;
let _integrationsFetchPromise: Promise<void> | null = null;

/* ---------- Component ---------- */

export function PipelineSchedule({ completedClips, initialCaptions }: PipelineScheduleProps) {
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // Schedule form state — use cache if available to avoid loading flash on remount
  const [integrations, setIntegrations] = useState<Integration[]>(_integrationsCache || []);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<Set<string>>(
    () => new Set((_integrationsCache || []).map(i => i.id))
  );
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [scheduleDate, setScheduleDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [postTime, setPostTime] = useState("09:00");
  const [timezone, setTimezone] = useState("Europe/Bucharest");
  const [caption, setCaption] = useState("");
  const [perVariantCaptions, setPerVariantCaptions] = useState<Record<string, string>>({});
  const [captionMode, setCaptionMode] = useState<"shared" | "individual">("individual");
  const [scheduling, setScheduling] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(_integrationsCache === undefined);

  // Auto-select all completed clips
  useEffect(() => {
    setSelectedClipIds(new Set(completedClips.map(c => c.clip_id)));
  }, [completedClips]);

  // Merge AI-generated captions into per-variant captions (only for empty fields)
  const manuallyEditedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!initialCaptions || Object.keys(initialCaptions).length === 0) return;
    setPerVariantCaptions(prev => {
      const merged = { ...prev };
      for (const [clipId, caption] of Object.entries(initialCaptions)) {
        if (!manuallyEditedRef.current.has(clipId)) {
          merged[clipId] = caption;
        }
      }
      return merged;
    });
    // Switch to individual mode when AI captions arrive
    setCaptionMode("individual");
  }, [initialCaptions]);

  /* ---------- Fetch ---------- */

  const applyCache = useCallback((intgs: Integration[]) => {
    setIntegrations(intgs);
    setSelectedIntegrationIds(new Set(intgs.map(i => i.id)));
    setLoadingIntegrations(false);
  }, []);

  const fetchIntegrations = useCallback(async () => {
    // If cache exists, skip fetch entirely
    if (_integrationsCache) {
      applyCache(_integrationsCache);
      return;
    }

    // If another instance is already fetching, wait for it
    if (_integrationsFetchPromise) {
      await _integrationsFetchPromise;
      if (isMountedRef.current && _integrationsCache) {
        applyCache(_integrationsCache);
      }
      return;
    }

    setLoadingIntegrations(true);

    _integrationsFetchPromise = (async () => {
      try {
        const res = await apiGet("/postiz/integrations", { timeout: 5000 });
        const data = await res.json();
        _integrationsCache = Array.isArray(data) ? data : data.integrations || [];
      } catch {
        _integrationsCache = [];
      } finally {
        _integrationsFetchPromise = null;
      }
    })();

    await _integrationsFetchPromise;

    if (isMountedRef.current && _integrationsCache) {
      applyCache(_integrationsCache);
    }
  }, [applyCache]);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  /* ---------- Handlers ---------- */

  const toggleIntegration = (id: string) => {
    setSelectedIntegrationIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleClip = (clipId: string) => {
    setSelectedClipIds(prev => {
      const next = new Set(prev);
      next.has(clipId) ? next.delete(clipId) : next.add(clipId);
      return next;
    });
  };

  const updatePerVariantCaption = (clipId: string, value: string) => {
    manuallyEditedRef.current.add(clipId);
    setPerVariantCaptions(prev => ({ ...prev, [clipId]: value }));
  };

  // Compute per-variant schedule dates: variant 1 = selected date, variant N = +24h * (N-1)
  const variantSchedules = useMemo(() => {
    const selectedClips = completedClips.filter(c => selectedClipIds.has(c.clip_id));
    return selectedClips.map((clip, idx) => {
      const base = new Date(`${scheduleDate}T${postTime}:00`);
      base.setDate(base.getDate() + idx);
      return {
        clip,
        date: base,
        dateStr: base.toISOString().split("T")[0],
        timeStr: postTime,
      };
    });
  }, [completedClips, selectedClipIds, scheduleDate, postTime]);

  const handleSchedule = async () => {
    if (selectedClipIds.size === 0) { toast.error("Select at least one clip"); return; }
    if (selectedIntegrationIds.size === 0) { toast.error("Select at least one integration"); return; }

    setScheduling(true);
    try {
      const scheduleDatetime = `${scheduleDate}T${postTime}:00`;

      // Build per-clip captions map if in individual mode
      const captions: Record<string, string> | undefined =
        captionMode === "individual"
          ? Object.fromEntries(
              completedClips
                .filter(c => selectedClipIds.has(c.clip_id))
                .map(c => [c.clip_id, perVariantCaptions[c.clip_id] || ""])
            )
          : undefined;

      const res = await apiPost("/postiz/bulk-publish", {
        clip_ids: [...selectedClipIds],
        caption: captionMode === "shared" ? caption : "",
        captions,
        integration_ids: [...selectedIntegrationIds],
        schedule_date: scheduleDatetime,
        schedule_interval_minutes: 1440, // 24 hours between each variant
        timezone,
      });
      const data = await res.json();
      toast.success(data.message || `Scheduled ${selectedClipIds.size} clip(s)!`);
    } catch (err) {
      console.error("Schedule failed:", err);
      toast.error("Failed to schedule clips");
    } finally {
      if (isMountedRef.current) setScheduling(false);
    }
  };

  const hasCompletedClips = completedClips.length > 0;

  /* ---------- Render ---------- */

  return (
    <div className="space-y-6 mt-8">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <CalendarClock className="size-6 text-primary" />
        <div>
          <h3 className="text-lg font-semibold">Schedule & Publish</h3>
          <p className="text-sm text-muted-foreground">
            View your Postiz calendar and schedule rendered clips for publishing
          </p>
        </div>
      </div>

      {/* ===== Monthly Calendar ===== */}
      <PostizMonthlyCalendar />

      {/* ===== Quick Schedule Form ===== */}
      {hasCompletedClips && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="size-4" />
              Schedule Clips
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Clip selection */}
            <div className="space-y-2">
              <Label>Clips to schedule</Label>
              <div className="flex flex-wrap gap-2 border rounded-md p-2">
                {completedClips.map((clip) => (
                  <label
                    key={clip.clip_id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={selectedClipIds.has(clip.clip_id)}
                      onCheckedChange={() => toggleClip(clip.clip_id)}
                    />
                    <span>Variant {clip.variant_index + 1}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Date / Time / Timezone */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pipe-sched-date">First Post Date</Label>
                <input
                  id="pipe-sched-date"
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pipe-sched-time">Post Time</Label>
                <input
                  id="pipe-sched-time"
                  type="time"
                  value={postTime}
                  onChange={(e) => setPostTime(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Per-variant schedule preview */}
            {variantSchedules.length > 1 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <CalendarDays className="size-4" />
                  Schedule Preview (1 post per day)
                </Label>
                <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                  {variantSchedules.map(({ clip, dateStr, timeStr }) => (
                    <div key={clip.clip_id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">Variant {clip.variant_index + 1}</span>
                      <span className="text-muted-foreground">
                        {new Date(dateStr + "T00:00:00").toLocaleDateString("ro-RO", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}{" "}
                        at {timeStr}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Integrations */}
            {loadingIntegrations ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading integrations...
              </div>
            ) : integrations.length > 0 ? (
              <div className="space-y-2">
                <Label>Postiz Integrations</Label>
                <div className="flex flex-wrap gap-2 border rounded-md p-2">
                  {integrations.map((integ) => (
                    <label
                      key={integ.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selectedIntegrationIds.has(integ.id)}
                        onCheckedChange={() => toggleIntegration(integ.id)}
                      />
                      {integ.picture && (
                        <img src={integ.picture} alt="" className="size-5 rounded-full" />
                      )}
                      <span>{integ.name}</span>
                      <Badge variant="outline" className="text-xs">{integ.type}</Badge>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No Postiz integrations configured. Connect your social accounts in Postiz first.
              </p>
            )}

            {/* Caption Mode Toggle */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Caption</Label>
                {completedClips.length > 1 && (
                  <div className="flex gap-1 rounded-lg border p-0.5">
                    <button
                      type="button"
                      onClick={() => setCaptionMode("shared")}
                      className={`px-3 py-1 text-xs rounded-md transition-colors ${
                        captionMode === "shared"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Same for all
                    </button>
                    <button
                      type="button"
                      onClick={() => setCaptionMode("individual")}
                      className={`px-3 py-1 text-xs rounded-md transition-colors ${
                        captionMode === "individual"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Per variant
                    </button>
                  </div>
                )}
              </div>

              {captionMode === "shared" ? (
                <Textarea
                  id="pipe-sched-caption"
                  placeholder="Write a caption for all clips..."
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={3}
                />
              ) : (
                <div className="space-y-3">
                  {completedClips
                    .filter(c => selectedClipIds.has(c.clip_id))
                    .map((clip) => (
                      <div key={clip.clip_id} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Variant {clip.variant_index + 1}
                        </Label>
                        <Textarea
                          placeholder={`Caption for Variant ${clip.variant_index + 1}...`}
                          value={perVariantCaptions[clip.clip_id] || ""}
                          onChange={(e) => updatePerVariantCaption(clip.clip_id, e.target.value)}
                          rows={2}
                        />
                      </div>
                    ))}
                  {selectedClipIds.size === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Select clips above to add captions.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Schedule button */}
            <div className="flex justify-end">
              <Button
                onClick={handleSchedule}
                disabled={scheduling || selectedClipIds.size === 0 || selectedIntegrationIds.size === 0}
                className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-none hover:from-pink-600 hover:to-purple-600"
              >
                {scheduling ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Send className="size-4 mr-2" />
                )}
                Schedule {selectedClipIds.size} Clip{selectedClipIds.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
