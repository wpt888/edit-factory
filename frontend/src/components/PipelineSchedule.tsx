"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
}

const TIMEZONES = [
  "Europe/Bucharest", "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney",
];

/* ---------- Component ---------- */

export function PipelineSchedule({ completedClips }: PipelineScheduleProps) {
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // Schedule form state
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<Set<string>>(new Set());
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [scheduleDate, setScheduleDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [postTime, setPostTime] = useState("09:00");
  const [timezone, setTimezone] = useState("Europe/Bucharest");
  const [caption, setCaption] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);

  // Auto-select all completed clips
  useEffect(() => {
    setSelectedClipIds(new Set(completedClips.map(c => c.clip_id)));
  }, [completedClips]);

  /* ---------- Fetch ---------- */

  const fetchIntegrations = useCallback(async () => {
    setLoadingIntegrations(true);
    try {
      const res = await apiGet("/postiz/integrations");
      const data = await res.json();
      const intgs = Array.isArray(data) ? data : data.integrations || [];
      if (isMountedRef.current) {
        setIntegrations(intgs);
        setSelectedIntegrationIds(new Set(intgs.map((i: Integration) => i.id)));
      }
    } catch {
      // Postiz may not be configured
    } finally {
      if (isMountedRef.current) setLoadingIntegrations(false);
    }
  }, []);

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

  const handleSchedule = async () => {
    if (selectedClipIds.size === 0) { toast.error("Select at least one clip"); return; }
    if (selectedIntegrationIds.size === 0) { toast.error("Select at least one integration"); return; }

    setScheduling(true);
    try {
      const scheduleDatetime = `${scheduleDate}T${postTime}:00`;
      const res = await apiPost("/postiz/bulk-publish", {
        clip_ids: [...selectedClipIds],
        caption,
        integration_ids: [...selectedIntegrationIds],
        schedule_date: scheduleDatetime,
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
                <Label htmlFor="pipe-sched-date">Schedule Date</Label>
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

            {/* Caption */}
            <div className="space-y-2">
              <Label htmlFor="pipe-sched-caption">Caption</Label>
              <Textarea
                id="pipe-sched-caption"
                placeholder="Write a caption for your post..."
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={3}
              />
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
