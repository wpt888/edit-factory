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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarDays,
  Clock,
  Loader2,
  Send,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { apiGetWithRetry, apiPost } from "@/lib/api";
import { toast } from "sonner";

/* ---------- Types ---------- */

interface ClipInfo {
  id: string;
  variant_name?: string;
  variant_index: number;
  final_video_path?: string;
  raw_video_path: string;
  thumbnail_path?: string;
  project_name: string;
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
  const [postTime, setPostTime] = useState("09:00");
  const [timezone, setTimezone] = useState("Europe/Bucharest");
  const [scheduling, setScheduling] = useState(false);

  // Per-clip captions
  const [perClipCaptions, setPerClipCaptions] = useState<Record<string, string>>({});
  const [captionsExpanded, setCaptionsExpanded] = useState(false);

  /* ---------- Fetch integrations ---------- */

  const applyIntegrations = useCallback((intgs: Integration[]) => {
    setIntegrations(intgs);
    setSelectedIntegrationIds(new Set(intgs.map(i => i.id)));
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

  /* ---------- Computed schedule preview ---------- */

  const schedulePreview = useMemo(() => {
    return clips.map((clip, idx) => {
      const base = new Date(`${scheduleDate}T${postTime}:00`);
      base.setDate(base.getDate() + idx);
      return {
        clip,
        date: base,
        dateStr: base.toISOString().split("T")[0],
        timeStr: postTime,
      };
    });
  }, [clips, scheduleDate, postTime]);

  /* ---------- Handlers ---------- */

  const toggleIntegration = (id: string) => {
    setSelectedIntegrationIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
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

  const handleSchedule = async () => {
    if (clips.length === 0) { toast.error("Nu sunt clipuri selectate"); return; }
    if (selectedIntegrationIds.size === 0 && selectedBufferIds.size === 0) {
      toast.error("Selectează cel puțin o platformă");
      return;
    }

    setScheduling(true);
    try {
      // Build ISO datetime with correct timezone offset
      const refDate = new Date(`${scheduleDate}T${postTime}:00`);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        timeZoneName: "longOffset",
      }).formatToParts(refDate);
      const offsetPart = parts.find((p) => p.type === "timeZoneName");
      const offset = offsetPart?.value?.replace("GMT", "") || "+00:00";
      const scheduleDatetime = `${scheduleDate}T${postTime}:00${offset}`;

      // Build per-clip captions
      const captions: Record<string, string> = Object.fromEntries(
        clips.map(c => [c.id, perClipCaptions[c.id] || ""])
      );

      const clipIds = clips.map(c => c.id);
      const results: string[] = [];

      // Schedule via Postiz
      if (selectedIntegrationIds.size > 0) {
        const res = await apiPost("/postiz/bulk-publish", {
          clip_ids: clipIds,
          caption: "",
          captions,
          integration_ids: [...selectedIntegrationIds],
          schedule_date: scheduleDatetime,
          schedule_interval_minutes: 1440,
          timezone,
        });
        const data: BulkPublishResponse = await res.json();
        results.push(data.message || `Postiz: ${clipIds.length} clip(uri) programate`);
      }

      // Schedule via Buffer
      if (selectedBufferIds.size > 0) {
        const selectedChannelIds = [...selectedBufferIds];
        for (const bufferChannelId of selectedChannelIds) {
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
      }

      toast.success(results.join(" | ") || `${clipIds.length} clipuri programate!`);
      onScheduled?.(clipIds);
      onOpenChange(false);
    } catch (err: unknown) {
      console.error("Schedule failed:", err);
      const detail = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : String(err);
      toast.error(`Programarea a eșuat: ${detail}`);
    } finally {
      setScheduling(false);
    }
  };

  const noPlatformsSelected = selectedIntegrationIds.size === 0 && selectedBufferIds.size === 0;

  /* ---------- Render ---------- */

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="size-5 text-primary" />
            Programează {clips.length} {clips.length === 1 ? "clip" : "clipuri"} în cascadă
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Schedule preview — shows each clip with its date */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="size-4" />
              Preview programare (1 post / zi)
            </Label>
            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 max-h-[200px] overflow-y-auto">
              {schedulePreview.map(({ clip, dateStr, timeStr }, idx) => (
                <div key={clip.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                      #{idx + 1}
                    </Badge>
                    <span className="font-medium truncate">
                      {clip.variant_name || clip.project_name}
                    </span>
                  </div>
                  <span className="text-muted-foreground shrink-0 ml-3">
                    {new Date(dateStr + "T00:00:00").toLocaleDateString("ro-RO", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    la {timeStr}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Date / Time / Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-sched-date">Data primului post</Label>
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
              <Label htmlFor="bulk-sched-time">Ora postării</Label>
              <input
                id="bulk-sched-time"
                type="time"
                lang="ro"
                value={postTime}
                onChange={(e) => setPostTime(e.target.value)}
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

          {/* Postiz Integrations */}
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
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Postiz Integrations</Label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                      if (selectedIntegrationIds.size === integrations.length) {
                        setSelectedIntegrationIds(new Set());
                      } else {
                        setSelectedIntegrationIds(new Set(integrations.map(i => i.id)));
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
              <div className="flex flex-wrap gap-2 border rounded-md p-2">
                {integrations.map((integ) => (
                  <label key={integ.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer text-sm">
                    <Checkbox
                      checked={selectedIntegrationIds.has(integ.id)}
                      onCheckedChange={() => toggleIntegration(integ.id)}
                    />
                    {integ.picture && (
                      // eslint-disable-next-line @next/next/no-img-element
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
                Nu sunt integrări Postiz configurate. Conectează conturile sociale în Postiz mai întâi.
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => fetchIntegrations(true)}>
                <RefreshCw className="size-3" /> Refresh
              </Button>
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

          {/* Schedule button */}
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSchedule}
              disabled={scheduling || clips.length === 0 || noPlatformsSelected}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {scheduling ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Send className="size-4 mr-2" />
              )}
              Programează {clips.length} {clips.length === 1 ? "clip" : "clipuri"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
