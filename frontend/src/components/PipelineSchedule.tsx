"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
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
  RefreshCw,
  AlertCircle,
  Save,
  ShieldCheck,
  Eye,
} from "lucide-react";
import { apiGetWithRetry, apiPost } from "@/lib/api";
import { toast } from "sonner";
import { PostizMonthlyCalendar } from "@/components/PostizMonthlyCalendar";
import {
  ScheduleCalendarPreview,
  type ScheduleEntry,
} from "@/components/ScheduleCalendarPreview";

/* ---------- Types ---------- */

interface CompletedClip {
  clip_id: string;
  variant_index: number;
  final_video_path: string;
  thumbnail_path?: string;
  visual_version?: string;
}

interface Integration {
  id: string;
  name: string;
  type: string;
  picture?: string;
}

interface BufferChannel {
  id: string;
  name: string;
  service: string;
  type: string;
  avatar?: string;
  is_disconnected: boolean;
}

interface PreviewData {
  entries: ScheduleEntry[];
  total_clips: number;
  total_days: number;
  collections_used: number;
  excluded_collections: string[];
  variant_routing?: Record<string, number>;
}

interface PipelineScheduleProps {
  completedClips: CompletedClip[];
  initialCaptions?: Record<string, string>;
  projectId?: string; // library_project_id — required for V2 smart schedule
  allLibrarySaved?: boolean; // true only when all completed clips have library_saved=true
}

const TIMEZONES = [
  "Europe/Bucharest", "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney",
];

const DEFAULT_PLATFORM_TIMES: Record<string, string> = {
  "tiktok": "09:00",
  "instagram-standalone": "12:00",
  "instagram": "12:00",
  "youtube": "15:00",
  "facebook": "18:00",
  "threads": "14:00",
  "x": "10:00",
  "twitter": "10:00",
  "bluesky": "11:00",
  "linkedin": "08:00",
  "linkedin-page": "08:00",
};

const META_PLATFORM_TYPES = new Set([
  "instagram-standalone",
  "instagram",
  "facebook",
  "threads",
]);

/* ---------- Module-level integrations cache (survives remounts) ---------- */

let _integrationsCache: Integration[] | undefined;
let _integrationsFetchPromise: Promise<void> | null = null;
let _integrationsFetchFailed = false;

/* ---------- Module-level Buffer channels cache ---------- */

let _bufferChannelsCache: BufferChannel[] | undefined;
let _bufferFetchPromise: Promise<void> | null = null;

/* ---------- Draft persistence ---------- */

const DRAFT_KEY = "editai_schedule_draft";

interface ScheduleDraft {
  perVariantCaptions: Record<string, string>;
  scheduleDate: string;
  timezone: string;
  selectedIntegrationIds: string[];
  integrationTimes: Record<string, string>;
  jitterMinutes: number;
  savedAt: number;
}

function loadDraft(): ScheduleDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft: ScheduleDraft = JSON.parse(raw);
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

export function PipelineSchedule({ completedClips, initialCaptions, projectId, allLibrarySaved }: PipelineScheduleProps) {

  const draftRef = useRef(loadDraft());
  const draft = draftRef.current;

  // Integrations state
  const [integrations, setIntegrations] = useState<Integration[]>(_integrationsCache || []);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<Set<string>>(() => {
    if (draft?.selectedIntegrationIds?.length) return new Set(draft.selectedIntegrationIds);
    return new Set((_integrationsCache || []).map(i => i.id));
  });
  const [integrationTimes, setIntegrationTimes] = useState<Record<string, string>>(
    draft?.integrationTimes || {}
  );
  const [loadingIntegrations, setLoadingIntegrations] = useState(_integrationsCache === undefined);
  const [integrationError, setIntegrationError] = useState(false);

  // Buffer channels
  const [bufferChannels, setBufferChannels] = useState<BufferChannel[]>(_bufferChannelsCache || []);
  const [selectedBufferIds, setSelectedBufferIds] = useState<Set<string>>(
    new Set((_bufferChannelsCache || []).map(c => c.id))
  );
  const [loadingBuffer, setLoadingBuffer] = useState(_bufferChannelsCache === undefined);

  // Clip selection
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());

  // Schedule config
  const [scheduleDate, setScheduleDate] = useState(() => {
    if (draft?.scheduleDate) {
      const today = new Date().toISOString().split("T")[0];
      if (draft.scheduleDate >= today) return draft.scheduleDate;
    }
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [timezone, setTimezone] = useState(draft?.timezone || "Europe/Bucharest");
  const [jitterMinutes, setJitterMinutes] = useState(draft?.jitterMinutes ?? 15);

  // Captions
  const [perVariantCaptions, setPerVariantCaptions] = useState<Record<string, string>>(draft?.perVariantCaptions || {});

  // V2 Preview + Confirm state
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Legacy bulk-publish for Buffer
  const [schedulingBuffer, setSchedulingBuffer] = useState(false);

  // Draft restored banner
  const [draftRestored, setDraftRestored] = useState(!!draft);

  // Auto-save draft
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(() => {
      saveDraft({
        perVariantCaptions,
        scheduleDate,
        timezone,
        selectedIntegrationIds: [...selectedIntegrationIds],
        integrationTimes,
        jitterMinutes,
      });
    }, 500);
    return () => { if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current); };
  }, [perVariantCaptions, scheduleDate, timezone, selectedIntegrationIds, integrationTimes, jitterMinutes]);

  // Auto-select all completed clips
  useEffect(() => {
    setSelectedClipIds(new Set(completedClips.map(c => c.clip_id)));
  }, [completedClips]);

  // Merge AI-generated captions
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

  // Reset preview when config changes
  useEffect(() => {
    setPreview(null);
  }, [scheduleDate, timezone, jitterMinutes, selectedIntegrationIds, integrationTimes]);

  /* ---------- Fetch Integrations ---------- */

  const applyIntegrations = useCallback((intgs: Integration[], fromDraft: boolean) => {
    setIntegrations(intgs);
    if (!fromDraft || selectedIntegrationIds.size === 0) {
      setSelectedIntegrationIds(new Set(intgs.map(i => i.id)));
      // Auto-populate default times for all integrations
      const defaultTimes: Record<string, string> = {};
      for (const integ of intgs) {
        defaultTimes[integ.id] = DEFAULT_PLATFORM_TIMES[integ.type] ?? "09:00";
      }
      setIntegrationTimes(prev => {
        // Keep existing draft times, fill missing with defaults
        const merged = { ...defaultTimes, ...prev };
        return merged;
      });
    }
    setLoadingIntegrations(false);
    setIntegrationError(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchIntegrations = useCallback(async (forceRefresh = false) => {
    if (_integrationsCache && !forceRefresh && !_integrationsFetchFailed) {
      applyIntegrations(_integrationsCache, !!draft);
      return;
    }
    if (_integrationsFetchPromise && !forceRefresh) {
      await _integrationsFetchPromise;
      if (_integrationsFetchFailed) {
        setIntegrationError(true);
        setLoadingIntegrations(false);
      } else if (_integrationsCache) {
        applyIntegrations(_integrationsCache, !!draft);
      }
      return;
    }

    setLoadingIntegrations(true);
    setIntegrationError(false);
    if (forceRefresh) {
      _integrationsCache = undefined;
      _integrationsFetchFailed = false;
    }

    _integrationsFetchPromise = (async () => {
      try {
        const res = await apiGetWithRetry("/postiz/integrations", { timeout: 30000, retry: 3 });
        const data = await res.json();
        _integrationsCache = Array.isArray(data) ? data : data.integrations || [];
        _integrationsFetchFailed = false;
      } catch {
        _integrationsCache = undefined;
        _integrationsFetchFailed = true;
      } finally {
        _integrationsFetchPromise = null;
      }
    })();

    await _integrationsFetchPromise;

    if (_integrationsFetchFailed) {
      setIntegrationError(true);
      setLoadingIntegrations(false);
    } else if (_integrationsCache) {
      applyIntegrations(_integrationsCache, !!draft);
    }
  }, [applyIntegrations, draft]);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  // Auto-retry with exponential backoff if integrations failed to load (max 3 retries)
  const integrationRetryCountRef = useRef(0);
  useEffect(() => {
    if (!integrationError) {
      integrationRetryCountRef.current = 0; // reset on success
      return;
    }
    if (integrationRetryCountRef.current >= 3) return; // give up after 3 retries
    const delay = 2000 * Math.pow(2, integrationRetryCountRef.current); // 2s, 4s, 8s
    const timer = setTimeout(() => {
      integrationRetryCountRef.current += 1;
      fetchIntegrations(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [integrationError, fetchIntegrations]);

  // Fetch Buffer channels
  const fetchBufferChannels = useCallback(async (forceRefresh = false) => {
    if (_bufferChannelsCache && !forceRefresh) {
      setBufferChannels(_bufferChannelsCache);
      setSelectedBufferIds(new Set(_bufferChannelsCache.map(c => c.id)));
      setLoadingBuffer(false);
      return;
    }
    if (_bufferFetchPromise && !forceRefresh) {
      await _bufferFetchPromise;
      if (_bufferChannelsCache) {
        setBufferChannels(_bufferChannelsCache);
        setSelectedBufferIds(new Set(_bufferChannelsCache.map(c => c.id)));
      }
      setLoadingBuffer(false);
      return;
    }

    setLoadingBuffer(true);
    if (forceRefresh) _bufferChannelsCache = undefined;

    _bufferFetchPromise = (async () => {
      try {
        const res = await apiGetWithRetry("/buffer/channels", { timeout: 15000, retry: 2 });
        const data = await res.json();
        _bufferChannelsCache = Array.isArray(data) ? data : [];
      } catch {
        _bufferChannelsCache = [];
      } finally {
        _bufferFetchPromise = null;
      }
    })();

    await _bufferFetchPromise;
    if (_bufferChannelsCache) {
      setBufferChannels(_bufferChannelsCache);
      setSelectedBufferIds(new Set(_bufferChannelsCache.map(c => c.id)));
    }
    setLoadingBuffer(false);
  }, []);

  useEffect(() => { fetchBufferChannels(); }, [fetchBufferChannels]);

  /* ---------- Computed ---------- */

  const selectedMetaCount = useMemo(() => {
    return integrations.filter(
      (i) => selectedIntegrationIds.has(i.id) && META_PLATFORM_TYPES.has(i.type)
    ).length;
  }, [integrations, selectedIntegrationIds]);

  const hasCompletedClips = completedClips.length > 0;
  const canUseSmartSchedule = !!projectId && allLibrarySaved !== false && selectedIntegrationIds.size > 0;

  /* ---------- Handlers ---------- */

  const toggleIntegration = (id: string) => {
    setSelectedIntegrationIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setIntegrationTimes(prev => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      } else {
        next.add(id);
        const integ = integrations.find(i => i.id === id);
        const defaultTime = DEFAULT_PLATFORM_TIMES[integ?.type ?? ""] ?? "09:00";
        setIntegrationTimes(prev => ({ ...prev, [id]: defaultTime }));
      }
      return next;
    });
  };

  const toggleBuffer = (id: string) => {
    setSelectedBufferIds(prev => {
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

  /* ---------- V2 Smart Schedule: Preview ---------- */

  const handlePreview = async () => {
    if (!projectId) {
      toast.error("Project not yet saved to library. Wait for render to complete.");
      return;
    }
    if (selectedIntegrationIds.size === 0) {
      toast.error("Select at least one platform");
      return;
    }

    setLoadingPreview(true);
    setPreview(null);

    try {
      const platformTimes = Object.fromEntries(
        Object.entries(integrationTimes).filter(([id]) => selectedIntegrationIds.has(id))
      );

      const res = await apiPost("/schedule/preview", {
        collection_ids: [projectId],
        start_date: scheduleDate,
        post_time: "09:00", // fallback — platform_times takes priority
        timezone,
        integration_ids: [...selectedIntegrationIds],
        platform_times: platformTimes,
        jitter_minutes: jitterMinutes,
        clip_ids: [...selectedClipIds],
      });
      const raw = await res.json();

      const data: PreviewData = {
        entries: (raw.assignments || []).map((a: Record<string, unknown>) => ({
          date: a.scheduled_date as string,
          clip_id: a.clip_id as string,
          clip_name: a.clip_name as string,
          collection_name: a.project_name as string,
          thumbnail_path: a.thumbnail_path as string | undefined,
          integration_id: a.integration_id as string | undefined,
          platform_type: a.platform_type as string | undefined,
          variant_index: a.variant_index as number | undefined,
          jitter_offset_minutes: a.jitter_offset_minutes as number | undefined,
          final_video_path: a.final_video_path as string | undefined,
        })),
        total_clips: raw.total_clips,
        total_days: raw.days_used,
        collections_used: raw.collections_count,
        excluded_collections: (raw.excluded_collections || []).map(
          (e: Record<string, string>) => e.name || "Unknown"
        ),
        variant_routing: raw.variant_routing ?? undefined,
      };

      setPreview(data);
    } catch (err: unknown) {
      console.error("Preview failed:", err);
      const detail = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : String(err);
      toast.error(`Failed to generate preview: ${detail}`);
    } finally {
      setLoadingPreview(false);
    }
  };

  /* ---------- V2 Smart Schedule: Confirm ---------- */

  const handleConfirm = async () => {
    if (!preview || !projectId) return;

    setConfirming(true);
    try {
      const platformTimes = Object.fromEntries(
        Object.entries(integrationTimes).filter(([id]) => selectedIntegrationIds.has(id))
      );

      const res = await apiPost("/schedule/plans", {
        collection_ids: [projectId],
        start_date: scheduleDate,
        post_time: "09:00",
        timezone,
        integration_ids: [...selectedIntegrationIds],
        platform_times: platformTimes,
        jitter_minutes: jitterMinutes,
        caption_template: "",
        clip_ids: [...selectedClipIds],
      });
      const data = await res.json();

      toast.success(data.message || "Schedule confirmed! Publishing plan created.");
      setPreview(null);
      clearDraft();
      setDraftRestored(false);
    } catch (err: unknown) {
      console.error("Confirm failed:", err);
      const detail = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : String(err);
      toast.error(`Failed to confirm schedule: ${detail}`);
    } finally {
      setConfirming(false);
    }
  };

  /* ---------- Buffer: Separate bulk-publish path ---------- */

  const handleBufferSchedule = async () => {
    if (selectedBufferIds.size === 0 || selectedClipIds.size === 0) return;

    setSchedulingBuffer(true);
    try {
      const refDate = new Date(`${scheduleDate}T09:00:00`);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        timeZoneName: "longOffset",
      }).formatToParts(refDate);
      const offsetPart = parts.find((p) => p.type === "timeZoneName");
      const offset = offsetPart?.value?.replace("GMT", "") || "+00:00";
      const scheduleDatetime = `${scheduleDate}T09:00:00${offset}`;

      const captions: Record<string, string> = Object.fromEntries(
        completedClips
          .filter(c => selectedClipIds.has(c.clip_id))
          .map(c => [c.clip_id, perVariantCaptions[c.clip_id] || ""])
      );

      const bufferChannelId = [...selectedBufferIds][0];
      const res = await apiPost("/buffer/bulk-publish", {
        clip_ids: [...selectedClipIds],
        captions,
        channel_id: bufferChannelId,
        schedule_date: scheduleDatetime,
        schedule_interval_minutes: 1440,
      });
      const data = await res.json();
      toast.success(data.message || `Buffer: ${selectedClipIds.size} clip(s) scheduled`);
    } catch (err: unknown) {
      console.error("Buffer schedule failed:", err);
      const detail = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : String(err);
      toast.error(`Buffer scheduling failed: ${detail}`);
    } finally {
      setSchedulingBuffer(false);
    }
  };

  /* ---------- Render ---------- */

  return (
    <div className="space-y-6 mt-8">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <CalendarClock className="size-6 text-primary" />
        <div>
          <h3 className="text-lg font-semibold">Smart Schedule & Publish</h3>
          <p className="text-sm text-muted-foreground">
            Schedule rendered clips with different variants per platform and optimized posting times
          </p>
        </div>
      </div>

      {/* ===== Monthly Calendar ===== */}
      <PostizMonthlyCalendar />

      {/* ===== Smart Schedule Form ===== */}
      {hasCompletedClips && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="size-4" />
              Smart Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Clip selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Clips to schedule</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    if (selectedClipIds.size === completedClips.length) {
                      setSelectedClipIds(new Set());
                    } else {
                      setSelectedClipIds(new Set(completedClips.map(c => c.clip_id)));
                    }
                  }}
                >
                  {selectedClipIds.size === completedClips.length ? "Deselect All" : "Select All"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 border rounded-md p-2">
                {completedClips.map((clip, clipIdx) => (
                  <label
                    key={`${clip.clip_id}-${clipIdx}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={selectedClipIds.has(clip.clip_id)}
                      onCheckedChange={() => toggleClip(clip.clip_id)}
                    />
                    <span className="truncate max-w-[220px]" title={clip.final_video_path?.split(/[/\\]/).pop() || ""}>
                      Variant {clip.variant_index + 1}
                      {clip.visual_version && ` ${clip.visual_version}`}
                      {clip.final_video_path && (
                        <span className="ml-1 text-muted-foreground text-xs">
                          ({clip.final_video_path.split(/[/\\]/).pop()?.replace(/\.(mp4|mov|webm)$/i, "")})
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Date / Timezone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pipe-sched-date">Start Date</Label>
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

            {/* Draft restored banner */}
            {draftRestored && (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Save className="size-4" />
                  Draft restaurat — setările anterioare au fost recuperate.
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

            {/* Integrations with per-platform time slots */}
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
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Platforms & Post Times</Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (selectedIntegrationIds.size === integrations.length) {
                          setSelectedIntegrationIds(new Set());
                          setIntegrationTimes({});
                        } else {
                          setSelectedIntegrationIds(new Set(integrations.map(i => i.id)));
                          const defaultTimes: Record<string, string> = {};
                          for (const integ of integrations) {
                            defaultTimes[integ.id] = DEFAULT_PLATFORM_TIMES[integ.type] ?? "09:00";
                          }
                          setIntegrationTimes(prev => ({ ...defaultTimes, ...prev }));
                        }
                      }}
                    >
                      {selectedIntegrationIds.size === integrations.length ? "Deselect All" : "Select All"}
                    </button>
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
                </div>
                <div className="border rounded-md divide-y">
                  {integrations.map((integ) => {
                    const isSelected = selectedIntegrationIds.has(integ.id);
                    const isMeta = META_PLATFORM_TYPES.has(integ.type);
                    return (
                      <div
                        key={integ.id}
                        className={`flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 transition-colors ${isSelected ? "bg-accent/30" : ""}`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleIntegration(integ.id)}
                        />
                        {integ.picture && (
                          <img src={integ.picture} alt="" className="size-5 rounded-full shrink-0" />
                        )}
                        <span className="flex-1 min-w-0 truncate text-sm font-medium">{integ.name}</span>
                        <Badge variant={isMeta ? "default" : "outline"} className="text-xs shrink-0">
                          {integ.type}
                        </Badge>
                        {isSelected && (
                          <input
                            type="time"
                            lang="ro"
                            value={integrationTimes[integ.id] ?? "09:00"}
                            onChange={(e) =>
                              setIntegrationTimes(prev => ({ ...prev, [integ.id]: e.target.value }))
                            }
                            className="h-8 w-28 rounded-md border border-input bg-transparent px-2 text-sm shrink-0 text-foreground [color-scheme:dark] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Meta safety indicator */}
                {selectedMetaCount >= 2 && preview?.variant_routing && (
                  <div className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 p-2.5 text-sm">
                    <ShieldCheck className="size-4 text-green-600 dark:text-green-400 shrink-0" />
                    <span className="text-green-800 dark:text-green-300">
                      Versiuni video distincte confirmate pentru platformele Meta selectate
                    </span>
                  </div>
                )}
                {selectedMetaCount >= 2 && !preview && (
                  <div className="flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-2.5 text-sm">
                    <ShieldCheck className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-blue-800 dark:text-blue-300">
                      {selectedMetaCount} platforme Meta selectate — preview-ul va verifica maparea corectă către versiunile video Meta
                    </span>
                  </div>
                )}
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

            {/* Jitter slider */}
            {selectedIntegrationIds.size > 0 && (
              <div className="space-y-3">
                <Label>Random Jitter</Label>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[jitterMinutes]}
                    onValueChange={([val]) => setJitterMinutes(val)}
                    min={0}
                    max={30}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium w-16 text-right tabular-nums">{jitterMinutes} min</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {jitterMinutes > 0
                    ? `±${jitterMinutes} min random offset per postare pentru a evita detecția de bot`
                    : "Fără jitter — toate postările la orele configurate exact"}
                </p>
              </div>
            )}

            {/* Buffer channels */}
            {loadingBuffer ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Se încarcă canalele Buffer...
              </div>
            ) : bufferChannels.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Buffer Channels</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1 text-muted-foreground"
                    onClick={() => fetchBufferChannels(true)}
                  >
                    <RefreshCw className="size-3" />
                    Refresh
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 border rounded-md p-2">
                  {bufferChannels.map((ch) => (
                    <label
                      key={ch.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selectedBufferIds.has(ch.id)}
                        onCheckedChange={() => toggleBuffer(ch.id)}
                      />
                      {ch.avatar && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ch.avatar} alt="" className="size-5 rounded-full" />
                      )}
                      <span>{ch.name}</span>
                      <Badge variant="outline" className="text-xs">{ch.service}</Badge>
                      <Badge variant="outline" className="text-xs text-blue-400 border-blue-400/50">Buffer</Badge>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Library save in progress warning — only show when save genuinely incomplete */}
            {allLibrarySaved === false && completedClips.length > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800 p-2.5 text-sm">
                <AlertCircle className="size-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
                <span className="text-yellow-800 dark:text-yellow-300">
                  Unele clipuri nu au fost salvate încă în librărie. Smart Schedule va fi disponibil după finalizare.
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3 justify-end">
              {/* Buffer schedule button (separate path) */}
              {selectedBufferIds.size > 0 && selectedClipIds.size > 0 && (
                <Button
                  variant="outline"
                  onClick={handleBufferSchedule}
                  disabled={schedulingBuffer}
                >
                  {schedulingBuffer ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="size-4 mr-2" />
                  )}
                  Schedule via Buffer
                </Button>
              )}

              {/* V2 Smart Schedule: Preview button */}
              {!preview && (
                <Button
                  onClick={handlePreview}
                  disabled={loadingPreview || !canUseSmartSchedule || selectedClipIds.size === 0}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {loadingPreview ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="size-4 mr-2" />
                  )}
                  Preview Schedule
                </Button>
              )}
            </div>

            {/* ===== V2 Schedule Preview ===== */}
            {(loadingPreview || preview) && (
              <div className="space-y-4 pt-4 border-t">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <CalendarClock className="size-4" />
                  Schedule Preview
                </h4>

                {loadingPreview ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                ) : preview ? (
                  <>
                    {/* Summary badges */}
                    <div className="flex flex-wrap gap-3 text-sm">
                      <Badge variant="secondary" className="text-sm px-3 py-1">
                        {preview.total_clips} clips
                      </Badge>
                      <Badge variant="secondary" className="text-sm px-3 py-1">
                        {preview.total_days} {preview.total_days === 1 ? "zi" : "zile"}
                      </Badge>
                      <Badge variant="secondary" className="text-sm px-3 py-1">
                        {preview.collections_used} {preview.collections_used === 1 ? "colecție" : "colecții"}
                      </Badge>
                    </div>

                    {/* Calendar grid */}
                    <ScheduleCalendarPreview entries={preview.entries} />

                    {/* Confirm + Cancel */}
                    <div className="flex gap-3 justify-end">
                      <Button
                        variant="outline"
                        onClick={() => setPreview(null)}
                        disabled={confirming}
                      >
                        Modifică
                      </Button>
                      <Button
                        onClick={handleConfirm}
                        disabled={confirming || preview.total_clips === 0}
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {confirming ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="size-4 mr-2" />
                        )}
                        Confirm & Schedule
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
