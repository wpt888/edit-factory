"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  CalendarDays,
  Clock,
  Loader2,
  Send,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  ShieldCheck,
} from "lucide-react";
import { apiGetWithRetry, apiPost } from "@/lib/api";
import { toast } from "sonner";
import {
  ScheduleCalendarPreview,
  type ScheduleEntry,
} from "@/components/ScheduleCalendarPreview";

/* ---------- Types ---------- */

interface ClipInfo {
  id: string;
  project_id: string;
  variant_name?: string;
  variant_index: number;
  final_video_path?: string;
  raw_video_path: string;
  thumbnail_path?: string;
  project_name: string;
  srt_content?: string | null;
  tts_text?: string | null;
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

interface BulkPublishResponse {
  message?: string;
}

interface PreviewData {
  entries: ScheduleEntry[];
  total_clips: number;
  total_days: number;
  collections_used: number;
  excluded_collections: string[];
  variant_routing?: Record<string, number>;
}

interface BulkScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Clips in the order they were selected */
  clips: ClipInfo[];
  /** Called after successful scheduling so parent can update state */
  onScheduled?: (clipIds: string[]) => void;
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

/* ---------- Module-level caches (shared with PipelineSchedule if loaded) ---------- */

let _integrationsCache: Integration[] | undefined;
let _integrationsFetchPromise: Promise<void> | null = null;
let _integrationsFetchFailed = false;

let _bufferChannelsCache: BufferChannel[] | undefined;
let _bufferFetchPromise: Promise<void> | null = null;

/* ---------- Component ---------- */

export function BulkScheduleDialog({ open, onOpenChange, clips, onScheduled }: BulkScheduleDialogProps) {
  // Integrations
  const [integrations, setIntegrations] = useState<Integration[]>(_integrationsCache || []);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<Set<string>>(
    new Set((_integrationsCache || []).map(i => i.id))
  );
  const [integrationTimes, setIntegrationTimes] = useState<Record<string, string>>({});
  const [loadingIntegrations, setLoadingIntegrations] = useState(_integrationsCache === undefined);
  const [integrationError, setIntegrationError] = useState(false);

  // Buffer channels
  const [bufferChannels, setBufferChannels] = useState<BufferChannel[]>(_bufferChannelsCache || []);
  const [selectedBufferIds, setSelectedBufferIds] = useState<Set<string>>(
    new Set((_bufferChannelsCache || []).map(c => c.id))
  );
  const [loadingBuffer, setLoadingBuffer] = useState(_bufferChannelsCache === undefined);

  // Schedule form
  const [scheduleDate, setScheduleDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [timezone, setTimezone] = useState("Europe/Bucharest");
  const [jitterMinutes, setJitterMinutes] = useState(15);

  // YouTube title (shared for all clips in batch)
  const [youtubeTitle, setYoutubeTitle] = useState("");

  // Per-clip captions — pre-populated from SRT content (cleaned up as flowing text)
  const [perClipCaptions, setPerClipCaptions] = useState<Record<string, string>>({});
  const [captionsExpanded, setCaptionsExpanded] = useState(false);

  // V2 Smart Schedule state
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Legacy Buffer scheduling
  const [schedulingBuffer, setSchedulingBuffer] = useState(false);

  // Derive unique project IDs from clips
  const projectIds = useMemo(() => [...new Set(clips.map(c => c.project_id))], [clips]);

  // Smart Schedule gate: clips exist with valid projects + at least one integration selected
  const canUseSmartSchedule = projectIds.length > 0 && selectedIntegrationIds.size > 0;

  // Meta platform count (for safety indicator)
  const selectedMetaCount = useMemo(() => {
    return integrations.filter(
      (i) => selectedIntegrationIds.has(i.id) && META_PLATFORM_TYPES.has(i.type)
    ).length;
  }, [integrations, selectedIntegrationIds]);

  // Pre-populate captions from tts_text (preferred) or srt_content when dialog opens
  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    for (const clip of clips) {
      if (clip.tts_text) {
        initial[clip.id] = clip.tts_text.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
      } else if (clip.srt_content) {
        const text = clip.srt_content
          .replace(/\d+\n[\d:,\s\->]+\n/g, "")
          .replace(/\n+/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim();
        if (text) initial[clip.id] = text;
      }
    }
    setPerClipCaptions(initial);
  }, [open, clips]);

  // Reset preview when config changes
  useEffect(() => {
    setPreview(null);
  }, [scheduleDate, timezone, jitterMinutes, selectedIntegrationIds, integrationTimes]);

  /* ---------- Fetch integrations ---------- */

  const applyIntegrations = useCallback((intgs: Integration[]) => {
    setIntegrations(intgs);
    setSelectedIntegrationIds(new Set(intgs.map(i => i.id)));
    // Auto-populate default times for all integrations
    const defaultTimes: Record<string, string> = {};
    for (const integ of intgs) {
      defaultTimes[integ.id] = DEFAULT_PLATFORM_TIMES[integ.type] ?? "09:00";
    }
    setIntegrationTimes(prev => ({ ...defaultTimes, ...prev }));
    setLoadingIntegrations(false);
    setIntegrationError(false);
  }, []);

  const fetchIntegrations = useCallback(async (forceRefresh = false) => {
    if (_integrationsCache && !forceRefresh && !_integrationsFetchFailed) {
      applyIntegrations(_integrationsCache);
      return;
    }
    if (_integrationsFetchPromise && !forceRefresh) {
      await _integrationsFetchPromise;
      if (_integrationsCache) applyIntegrations(_integrationsCache);
      return;
    }

    setLoadingIntegrations(true);
    setIntegrationError(false);
    if (forceRefresh) { _integrationsCache = undefined; _integrationsFetchFailed = false; }

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

    if (_integrationsFetchFailed) {
      setIntegrationError(true);
      setLoadingIntegrations(false);
    } else if (_integrationsCache) {
      applyIntegrations(_integrationsCache);
    }
  }, [applyIntegrations]);

  /* ---------- Fetch Buffer channels ---------- */

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

  // Fetch on open
  useEffect(() => {
    if (open) {
      fetchIntegrations();
      fetchBufferChannels();
    }
  }, [open, fetchIntegrations, fetchBufferChannels]);

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
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /* ---------- V2 Smart Schedule: Preview ---------- */

  const handlePreview = async () => {
    if (projectIds.length === 0) {
      toast.error("Nu s-au putut determina proiectele pentru clipurile selectate");
      return;
    }
    if (selectedIntegrationIds.size === 0) {
      toast.error("Selectează cel puțin o platformă");
      return;
    }

    setLoadingPreview(true);
    setPreview(null);

    try {
      const platformTimes = Object.fromEntries(
        Object.entries(integrationTimes).filter(([id]) => selectedIntegrationIds.has(id))
      );

      const res = await apiPost("/schedule/preview", {
        collection_ids: projectIds,
        start_date: scheduleDate,
        post_time: "09:00",
        timezone,
        integration_ids: [...selectedIntegrationIds],
        platform_times: platformTimes,
        jitter_minutes: jitterMinutes,
        clip_ids: clips.map(c => c.id),
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
      toast.error(`Preview-ul a eșuat: ${detail}`);
    } finally {
      setLoadingPreview(false);
    }
  };

  /* ---------- V2 Smart Schedule: Confirm ---------- */

  const handleConfirm = async () => {
    if (!preview || projectIds.length === 0) return;

    setConfirming(true);
    try {
      const platformTimes = Object.fromEntries(
        Object.entries(integrationTimes).filter(([id]) => selectedIntegrationIds.has(id))
      );

      // Build per-clip captions — only non-empty entries
      const captions: Record<string, string> = {};
      for (const c of clips) {
        const txt = (perClipCaptions[c.id] || "").trim();
        if (txt) captions[c.id] = txt;
      }

      const res = await apiPost("/schedule/plans", {
        collection_ids: projectIds,
        start_date: scheduleDate,
        post_time: "09:00",
        timezone,
        integration_ids: [...selectedIntegrationIds],
        platform_times: platformTimes,
        jitter_minutes: jitterMinutes,
        caption_template: "",
        clip_ids: clips.map(c => c.id),
        captions,
        ...(hasYoutubeSelected && youtubeTitle.trim() ? { youtube_title: youtubeTitle.trim() } : {}),
      });
      const data = await res.json();

      toast.success(data.message || "Plan de programare creat cu succes!");
      setPreview(null);
      onScheduled?.(clips.map(c => c.id));
      onOpenChange(false);
    } catch (err: unknown) {
      console.error("Confirm failed:", err);
      const detail = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : String(err);
      toast.error(`Confirmarea a eșuat: ${detail}`);
    } finally {
      setConfirming(false);
    }
  };

  /* ---------- Buffer: Separate bulk-publish path ---------- */

  const handleBufferSchedule = async () => {
    if (selectedBufferIds.size === 0 || clips.length === 0) return;

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

      const captions: Record<string, string> = {};
      for (const c of clips) {
        const txt = (perClipCaptions[c.id] || "").trim();
        if (txt) captions[c.id] = txt;
      }

      const clipIds = clips.map(c => c.id);
      const results: string[] = [];

      for (const bufferChannelId of [...selectedBufferIds]) {
        const res = await apiPost("/buffer/bulk-publish", {
          clip_ids: clipIds,
          caption: "",
          captions,
          channel_id: bufferChannelId,
          schedule_date: scheduleDatetime,
          schedule_interval_minutes: 1440,
        });
        const data: BulkPublishResponse = await res.json();
        const channelName = bufferChannels.find((channel) => channel.id === bufferChannelId)?.name;
        results.push(data.message || `Buffer${channelName ? ` (${channelName})` : ""}: ${clipIds.length} clip(uri) programate`);
      }

      toast.success(results.join(" | ") || `${clipIds.length} clipuri programate via Buffer!`);
      onScheduled?.(clipIds);
      onOpenChange(false);
    } catch (err: unknown) {
      console.error("Buffer schedule failed:", err);
      const detail = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : String(err);
      toast.error(`Programarea Buffer a eșuat: ${detail}`);
    } finally {
      setSchedulingBuffer(false);
    }
  };

  const hasYoutubeSelected = useMemo(
    () => integrations.some(i => selectedIntegrationIds.has(i.id) && i.type.toLowerCase() === "youtube"),
    [integrations, selectedIntegrationIds]
  );

  const noPlatformsSelected = selectedIntegrationIds.size === 0 && selectedBufferIds.size === 0;

  /* ---------- Render ---------- */

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="size-5 text-primary" />
            Smart Schedule — {clips.length} {clips.length === 1 ? "clip" : "clipuri"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Date / Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-sched-date">Data de start</Label>
              <input
                id="bulk-sched-date"
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <Label>Fus orar</Label>
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

          {/* Postiz Integrations with per-platform time slots */}
          {loadingIntegrations ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Se încarcă integrările...
            </div>
          ) : integrationError ? (
            <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="size-4" />
                Nu s-au putut încărca integrările Postiz.
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => fetchIntegrations(true)}>
                <RefreshCw className="size-3" /> Reîncearcă
              </Button>
            </div>
          ) : integrations.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Platforme & Ore postare</Label>
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
                    {selectedIntegrationIds.size === integrations.length ? "Deselectează tot" : "Selectează tot"}
                  </button>
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => fetchIntegrations(true)}>
                    <RefreshCw className="size-3" /> Refresh
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
                        // eslint-disable-next-line @next/next/no-img-element
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
                    {selectedMetaCount} platforme Meta selectate — preview-ul va verifica maparea corectă
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Nu sunt integrări Postiz configurate. Conectează conturile sociale în Postiz mai întâi.
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => fetchIntegrations(true)}>
                <RefreshCw className="size-3" /> Refresh
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
                  max={240}
                  step={5}
                  className="flex-1"
                />
                <span className="text-sm font-medium w-16 text-right tabular-nums">{jitterMinutes} min</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {jitterMinutes > 0
                  ? `±${jitterMinutes} min offset random per postare pentru a evita detecția de bot`
                  : "Fără jitter — toate postările la orele configurate exact"}
              </p>
            </div>
          )}

          {/* Per-clip captions (collapsible) */}
          <div className="space-y-2">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors text-muted-foreground"
              onClick={() => setCaptionsExpanded(!captionsExpanded)}
            >
              {captionsExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              Caption-uri per clip (opțional)
            </button>
            {captionsExpanded && (
              <div className="space-y-3 border rounded-md p-3 max-h-[250px] overflow-y-auto">
                {clips.map((clip, idx) => (
                  <div key={clip.id} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      #{idx + 1} — {clip.variant_name || clip.project_name}
                    </Label>
                    <Textarea
                      placeholder="Caption pentru acest clip..."
                      value={perClipCaptions[clip.id] || ""}
                      onChange={(e) =>
                        setPerClipCaptions(prev => ({ ...prev, [clip.id]: e.target.value }))
                      }
                      rows={2}
                      className="text-sm resize-none"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* YouTube Title — only when YouTube is among selected integrations */}
          {hasYoutubeSelected && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="bulk-youtube-title">Titlu YouTube</Label>
                <span className="text-xs text-muted-foreground">(shared, max 100 caractere)</span>
              </div>
              <Input
                id="bulk-youtube-title"
                placeholder="Titlu SEO pentru YouTube... (gol = auto-derivat din caption)"
                value={youtubeTitle}
                onChange={(e) => setYoutubeTitle(e.target.value.slice(0, 100))}
                maxLength={100}
              />
              <div className="text-xs text-muted-foreground text-right">
                {youtubeTitle.length}/100
              </div>
            </div>
          )}

          {/* Buffer Channels */}
          {loadingBuffer ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Se încarcă canalele Buffer...
            </div>
          ) : bufferChannels.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Buffer Channels</Label>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => fetchBufferChannels(true)}>
                  <RefreshCw className="size-3" /> Refresh
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 border rounded-md p-2">
                {bufferChannels.map((ch) => (
                  <label key={ch.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer text-sm">
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

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 justify-end pt-2">
            {/* Buffer schedule button (separate path) */}
            {selectedBufferIds.size > 0 && clips.length > 0 && (
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
                disabled={loadingPreview || !canUseSmartSchedule || clips.length === 0}
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
                <Clock className="size-4" />
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

          {/* No platforms warning */}
          {noPlatformsSelected && !loadingIntegrations && !loadingBuffer && (
            <p className="text-xs text-muted-foreground text-center">
              Selectează cel puțin o platformă pentru a putea programa.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
