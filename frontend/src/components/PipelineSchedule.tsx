"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

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
  RefreshCw,
  AlertCircle,
  Save,
} from "lucide-react";
import { apiGetWithRetry, apiPost } from "@/lib/api";
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
  captionSlot?: React.ReactNode;  // DEPRECATED — captions now rendered directly in pipeline page
}

const TIMEZONES = [
  "Europe/Bucharest", "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney",
];

/* ---------- Module-level integrations cache (survives remounts) ---------- */

let _integrationsCache: Integration[] | undefined;
let _integrationsFetchPromise: Promise<void> | null = null;
let _integrationsFetchFailed = false; // Track if cache is from a failed fetch

/* ---------- Draft persistence ---------- */

const DRAFT_KEY = "editai_schedule_draft";

interface ScheduleDraft {
  caption: string;
  perVariantCaptions: Record<string, string>;
  captionMode: "shared" | "individual";
  scheduleDate: string;
  postTime: string;
  timezone: string;
  selectedIntegrationIds: string[];
  savedAt: number;
}

function loadDraft(): ScheduleDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft: ScheduleDraft = JSON.parse(raw);
    // Expire drafts older than 7 days
    if (Date.now() - draft.savedAt > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

function saveDraft(draft: Omit<ScheduleDraft, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

function clearDraft() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DRAFT_KEY);
}

/* ---------- Component ---------- */

export function PipelineSchedule({ completedClips, initialCaptions, captionSlot }: PipelineScheduleProps) {
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // Load draft on initial render
  const draftRef = useRef(loadDraft());
  const draft = draftRef.current;

  // Schedule form state — use cache if available to avoid loading flash on remount
  const [integrations, setIntegrations] = useState<Integration[]>(_integrationsCache || []);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<Set<string>>(() => {
    if (draft?.selectedIntegrationIds?.length) return new Set(draft.selectedIntegrationIds);
    return new Set((_integrationsCache || []).map(i => i.id));
  });
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [scheduleDate, setScheduleDate] = useState(() => {
    if (draft?.scheduleDate) {
      // Only use draft date if it's not in the past
      const today = new Date().toISOString().split("T")[0];
      if (draft.scheduleDate >= today) return draft.scheduleDate;
    }
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [postTime, setPostTime] = useState(draft?.postTime || "09:00");
  const [timezone, setTimezone] = useState(draft?.timezone || "Europe/Bucharest");
  const [perVariantCaptions, setPerVariantCaptions] = useState<Record<string, string>>(draft?.perVariantCaptions || {});
  const [scheduling, setScheduling] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(_integrationsCache === undefined);
  const [integrationError, setIntegrationError] = useState(false);
  const [draftRestored, setDraftRestored] = useState(!!draft);

  // Auto-save draft when form state changes
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(() => {
      saveDraft({
        caption: "",
        perVariantCaptions,
        captionMode: "individual",
        scheduleDate,
        postTime,
        timezone,
        selectedIntegrationIds: [...selectedIntegrationIds],
      });
    }, 500); // debounce 500ms
    return () => { if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current); };
  }, [perVariantCaptions, scheduleDate, postTime, timezone, selectedIntegrationIds]);

  // Auto-select all completed clips
  useEffect(() => {
    setSelectedClipIds(new Set(completedClips.map(c => c.clip_id)));
  }, [completedClips]);

  // Merge AI-generated captions into per-variant captions
  useEffect(() => {
    if (!initialCaptions || Object.keys(initialCaptions).length === 0) return;
    setPerVariantCaptions(prev => {
      const merged = { ...prev };
      for (const [clipId, captionText] of Object.entries(initialCaptions)) {
        merged[clipId] = captionText;
      }
      return merged;
    });
  }, [initialCaptions]);

  /* ---------- Fetch ---------- */

  const applyIntegrations = useCallback((intgs: Integration[], fromDraft: boolean) => {
    setIntegrations(intgs);
    // Only auto-select all if no draft selection exists
    if (!fromDraft || selectedIntegrationIds.size === 0) {
      setSelectedIntegrationIds(new Set(intgs.map(i => i.id)));
    }
    setLoadingIntegrations(false);
    setIntegrationError(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchIntegrations = useCallback(async (forceRefresh = false) => {
    // If cache exists and not a forced refresh, skip fetch
    if (_integrationsCache && !forceRefresh && !_integrationsFetchFailed) {
      applyIntegrations(_integrationsCache, !!draft);
      return;
    }

    // If another instance is already fetching, wait for it
    if (_integrationsFetchPromise && !forceRefresh) {
      await _integrationsFetchPromise;
      if (isMountedRef.current && _integrationsCache) {
        applyIntegrations(_integrationsCache, !!draft);
      }
      return;
    }

    setLoadingIntegrations(true);
    setIntegrationError(false);

    // Clear stale cache on force refresh
    if (forceRefresh) {
      _integrationsCache = undefined;
      _integrationsFetchFailed = false;
    }

    _integrationsFetchPromise = (async () => {
      try {
        const res = await apiGetWithRetry("/postiz/integrations", { timeout: 15000, retry: 2 });
        const data = await res.json();
        _integrationsCache = Array.isArray(data) ? data : data.integrations || [];
        _integrationsFetchFailed = false;
      } catch {
        _integrationsCache = [];
        _integrationsFetchFailed = true;
      } finally {
        _integrationsFetchPromise = null;
      }
    })();

    await _integrationsFetchPromise;

    if (isMountedRef.current) {
      if (_integrationsFetchFailed) {
        setIntegrationError(true);
        setLoadingIntegrations(false);
      } else if (_integrationsCache) {
        applyIntegrations(_integrationsCache, !!draft);
      }
    }
  }, [applyIntegrations, draft]);

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
      // Build ISO datetime with the correct timezone offset
      // Use Intl to get the UTC offset for the selected timezone
      const refDate = new Date(`${scheduleDate}T${postTime}:00`);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        timeZoneName: "longOffset",
      }).formatToParts(refDate);
      const offsetPart = parts.find((p) => p.type === "timeZoneName");
      const offset = offsetPart?.value?.replace("GMT", "") || "+00:00";
      const scheduleDatetime = `${scheduleDate}T${postTime}:00${offset}`;

      // Build per-clip captions from AI generator or manual edits
      const captions: Record<string, string> = Object.fromEntries(
        completedClips
          .filter(c => selectedClipIds.has(c.clip_id))
          .map(c => [c.clip_id, perVariantCaptions[c.clip_id] || ""])
      );

      const res = await apiPost("/postiz/bulk-publish", {
        clip_ids: [...selectedClipIds],
        caption: "",
        captions,
        integration_ids: [...selectedIntegrationIds],
        schedule_date: scheduleDatetime,
        schedule_interval_minutes: 1440, // 24 hours between each variant
        timezone,
      });
      const data = await res.json();
      toast.success(data.message || `Scheduled ${selectedClipIds.size} clip(s)!`);
      // Clear draft after successful schedule
      clearDraft();
      setDraftRestored(false);
    } catch (err: unknown) {
      console.error("Schedule failed:", err);
      const detail = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : String(err);
      toast.error(`Failed to schedule clips: ${detail}`);
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

      {/* ===== Caption slot (rendered between calendar and schedule) ===== */}
      {captionSlot}

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

            {/* Draft restored banner */}
            {draftRestored && (
              <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                  <Save className="size-4" />
                  Draft restaurat — {(() => {
                    const hasCaptions = draft && Object.values(draft.perVariantCaptions || {}).some(c => c?.trim());
                    const hasSettings = draft && (draft.scheduleDate || draft.postTime || draft.selectedIntegrationIds?.length);
                    if (hasCaptions && hasSettings) return "caption-urile și setările anterioare au fost recuperate.";
                    if (hasCaptions) return "caption-urile anterioare au fost recuperate.";
                    return "setările anterioare au fost recuperate (fără caption-uri salvate).";
                  })()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => { clearDraft(); setDraftRestored(false); }}
                >
                  Șterge draft
                </Button>
              </div>
            )}

            {/* Integrations */}
            {loadingIntegrations ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Se încarcă integrările... (poate dura câteva secunde)
              </div>
            ) : integrationError ? (
              <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="size-4" />
                  Nu s-au putut încărca integrările Postiz. Verifică conexiunea la Postiz.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => fetchIntegrations(true)}
                >
                  <RefreshCw className="size-3" />
                  Reîncearcă
                </Button>
              </div>
            ) : integrations.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Postiz Integrations</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1 text-muted-foreground"
                    onClick={() => fetchIntegrations(true)}
                  >
                    <RefreshCw className="size-3" />
                    Refresh
                  </Button>
                </div>
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
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  No Postiz integrations configured. Connect your social accounts in Postiz first.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs gap-1 text-muted-foreground"
                  onClick={() => fetchIntegrations(true)}
                >
                  <RefreshCw className="size-3" />
                  Refresh
                </Button>
              </div>
            )}

            {/* Captions are managed in the AI Caption Generator section above */}

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
