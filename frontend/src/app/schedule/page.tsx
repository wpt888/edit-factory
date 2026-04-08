"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  CalendarClock,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Play,
  Pause,
  XCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import { useProfile } from "@/contexts/profile-context";
import {
  ScheduleCalendarPreview,
  type ScheduleEntry,
} from "@/components/ScheduleCalendarPreview";
import { PostizMonthlyCalendar } from "@/components/PostizMonthlyCalendar";

/* ---------- Types ---------- */

interface Project {
  id: string;
  name: string;
  status?: string;
  clip_count?: number;
}

interface Integration {
  id: string;
  name: string;
  type: string;
  picture?: string;
}

interface PreviewData {
  entries: ScheduleEntry[];
  total_clips: number;
  total_days: number;
  collections_used: number;
  excluded_collections: string[];
  clips_per_day: Record<string, number>;
  variant_routing?: Record<string, number>;
}

interface SchedulePlan {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
  start_date: string;
  total_clips: number;
  scheduled_count: number;
  failed_count: number;
  summary?: { days_used?: number; clips_per_day?: Record<string, number>; collections_count?: number };
  created_at: string;
}

interface PlanProgress {
  percentage: number;
  step: string;
  status: string;
  items_done: number;
  items_total: number;
}


const TIMEZONES = [
  "Europe/Bucharest",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
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

/* ---------- Helpers ---------- */

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "running":
      return <Play className="size-3" />;
    case "completed":
      return <CheckCircle2 className="size-3" />;
    case "failed":
      return <XCircle className="size-3" />;
    case "paused":
      return <Pause className="size-3" />;
    default:
      return <Clock className="size-3" />;
  }
}

/* ---------- Component ---------- */

export default function SchedulePage() {
  const { currentProfile, isLoading: profileLoading } = useProfile();

  // --- Config state ---
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [postTime, setPostTime] = useState("09:00"); // V1 fallback
  const [timezone, setTimezone] = useState("Europe/Bucharest");
  const [captionTemplate, setCaptionTemplate] = useState("");
  // V2 smart schedule state
  const [integrationTimes, setIntegrationTimes] = useState<Record<string, string>>({});
  const [jitterMinutes, setJitterMinutes] = useState(15);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // --- Preview state ---
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // --- Plans state ---
  const [plans, setPlans] = useState<SchedulePlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [planProgress, setPlanProgress] = useState<Record<string, PlanProgress>>({});


  // Mounted ref
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /* ---------- Fetch config data on mount ---------- */

  const fetchConfigData = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const [projRes, integRes] = await Promise.all([
        apiGet("/library/projects"),
        apiGet("/postiz/integrations").catch(() => null),
      ]);

      const projData = await projRes.json();
      if (isMountedRef.current) {
        setProjects(Array.isArray(projData) ? projData : projData.projects || []);
      }

      if (integRes) {
        const integData = await integRes.json();
        if (isMountedRef.current) {
          setIntegrations(Array.isArray(integData) ? integData : integData.integrations || []);
        }
      }
    } catch (err) {
      console.error("Failed to load config data:", err);
      toast.error("Failed to load configuration data");
    } finally {
      if (isMountedRef.current) setLoadingConfig(false);
    }
  }, []);

  const fetchPlans = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const res = await apiGet("/schedule/plans");
      const data = await res.json();
      if (isMountedRef.current) {
        setPlans(Array.isArray(data) ? data : data.plans || []);
      }
    } catch (err) {
      console.error("Failed to load plans:", err);
      // Non-critical: the endpoint may not exist yet
    } finally {
      if (isMountedRef.current) setLoadingPlans(false);
    }
  }, []);

  useEffect(() => {
    if (!profileLoading) {
      fetchConfigData();
      fetchPlans();
    }
  }, [profileLoading, currentProfile?.id, fetchConfigData, fetchPlans]);

  /* ---------- Progress polling for running plans ---------- */

  const runningPlanIds = useMemo(
    () => plans.filter((p) => p.status === "running").map((p) => p.id).join(","),
    [plans]
  );

  useEffect(() => {
    if (!runningPlanIds) return;
    const ids = runningPlanIds.split(",");

    let cancelled = false;

    const poll = async () => {
      for (const planId of ids) {
        if (cancelled) return;
        try {
          const res = await apiGet(`/schedule/plans/${planId}/progress`);
          const data: PlanProgress = await res.json();
          if (!cancelled && isMountedRef.current) {
            setPlanProgress((prev) => ({ ...prev, [planId]: data }));
            if (data.status === "completed" || data.status === "failed") {
              fetchPlans();
            }
          }
        } catch {
          // Ignore polling errors
        }
      }
    };

    poll();
    const interval = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runningPlanIds, fetchPlans]);

  /* ---------- Handlers ---------- */

  const toggleProject = (id: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreview(null);
  };

  const toggleAllProjects = () => {
    if (selectedProjectIds.size === projects.length) {
      setSelectedProjectIds(new Set());
    } else {
      setSelectedProjectIds(new Set(projects.map((p) => p.id)));
    }
    setPreview(null);
  };

  const toggleIntegration = (id: string) => {
    setSelectedIntegrationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setIntegrationTimes((prev) => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      } else {
        next.add(id);
        const integ = integrations.find((i) => i.id === id);
        const defaultTime = DEFAULT_PLATFORM_TIMES[integ?.type ?? ""] ?? "09:00";
        setIntegrationTimes((prev) => ({ ...prev, [id]: defaultTime }));
      }
      return next;
    });
  };

  const selectedMetaCount = useMemo(() => {
    return integrations.filter(
      (i) => selectedIntegrationIds.has(i.id) && META_PLATFORM_TYPES.has(i.type)
    ).length;
  }, [integrations, selectedIntegrationIds]);

  const handlePreview = async () => {
    if (selectedProjectIds.size === 0) {
      toast.error("Select at least one collection");
      return;
    }

    setLoadingPreview(true);
    setPreview(null);

    try {
      // Build V2 payload if integrations are selected with times
      const hasV2 = selectedIntegrationIds.size > 0 && Object.keys(integrationTimes).length > 0;
      const payload: Record<string, unknown> = {
        collection_ids: [...selectedProjectIds],
        start_date: startDate,
        post_time: postTime,
        timezone,
      };
      if (hasV2) {
        payload.integration_ids = [...selectedIntegrationIds];
        payload.platform_times = Object.fromEntries(
          Object.entries(integrationTimes).filter(([id]) => selectedIntegrationIds.has(id))
        );
        payload.jitter_minutes = jitterMinutes;
      }

      const res = await apiPost("/schedule/preview", payload);
      const raw = await res.json();
      // Transform backend response to match frontend interface
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
        })),
        total_clips: raw.total_clips,
        total_days: raw.days_used,
        collections_used: raw.collections_count,
        excluded_collections: (raw.excluded_collections || []).map((e: Record<string, string>) => e.name || "Unknown"),
        clips_per_day: raw.clips_per_day || {},
        variant_routing: raw.variant_routing ?? undefined,
      };
      if (isMountedRef.current) setPreview(data);
    } catch (err) {
      console.error("Preview failed:", err);
      toast.error("Failed to generate preview");
    } finally {
      if (isMountedRef.current) setLoadingPreview(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;

    setConfirming(true);
    try {
      const hasV2 = Object.keys(integrationTimes).length > 0;
      const payload: Record<string, unknown> = {
        collection_ids: [...selectedProjectIds],
        start_date: startDate,
        post_time: postTime,
        timezone,
        integration_ids: [...selectedIntegrationIds],
        caption_template: captionTemplate,
      };
      if (hasV2) {
        payload.platform_times = Object.fromEntries(
          Object.entries(integrationTimes).filter(([id]) => selectedIntegrationIds.has(id))
        );
        payload.jitter_minutes = jitterMinutes;
      }
      const res = await apiPost("/schedule/plans", payload);
      const data = await res.json();
      toast.success(data.message || "Schedule confirmed! Publishing plan created.");
      setPreview(null);
      setSelectedProjectIds(new Set());
      await fetchPlans();
      // Re-fetch after delay to catch pending→running transition
      setTimeout(() => fetchPlans(), 3000);
    } catch (err) {
      console.error("Confirm failed:", err);
      toast.error("Failed to confirm schedule");
    } finally {
      if (isMountedRef.current) setConfirming(false);
    }
  };

  const handleSyncPlan = async (planId: string) => {
    try {
      const res = await apiPost(`/schedule/plans/${planId}/sync`, {});
      const data = await res.json();
      toast.success(data.message || "Status synced");
      fetchPlans();
    } catch {
      toast.error("Failed to sync status");
    }
  };

  /* ---------- Render ---------- */

  if (profileLoading || loadingConfig) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 py-8 space-y-8">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <CalendarClock className="size-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Smart Schedule</h1>
          <p className="text-muted-foreground text-sm">
            Plan and automate publishing across your social media integrations
          </p>
        </div>
      </div>

      {/* ===== Section 1: Configuration ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Collections multi-select */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Collections</Label>
              <Button variant="ghost" size="sm" onClick={toggleAllProjects} className="text-xs h-7">
                {selectedProjectIds.size === projects.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No collections found.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto border rounded-md p-2">
                {projects.map((proj) => (
                  <label
                    key={proj.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={selectedProjectIds.has(proj.id)}
                      onCheckedChange={() => toggleProject(proj.id)}
                    />
                    <span className="truncate">{proj.name}</span>
                    {proj.clip_count != null && (
                      <Badge variant="secondary" className="ml-auto text-xs shrink-0">
                        {proj.clip_count} clips
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Date / Timezone row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPreview(null);
                }}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Integrations with per-platform time slots */}
          {integrations.length > 0 && (
            <div className="space-y-3">
              <Label>Platforms & Post Times</Label>
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
                        <img src={integ.picture} alt="" className="size-6 rounded-full shrink-0" />
                      )}
                      <span className="flex-1 min-w-0 truncate text-sm font-medium">{integ.name}</span>
                      <Badge variant={isMeta ? "default" : "outline"} className="text-xs shrink-0">
                        {integ.type}
                      </Badge>
                      {isSelected && (
                        <input
                          type="time"
                          value={integrationTimes[integ.id] ?? "09:00"}
                          onChange={(e) =>
                            setIntegrationTimes((prev) => ({ ...prev, [integ.id]: e.target.value }))
                          }
                          className="h-8 w-24 rounded-md border border-input bg-transparent px-2 text-sm shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Meta safety indicator — only confirmed after successful preview */}
              {selectedMetaCount >= 2 && preview?.variant_routing && (
                <div className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 p-2.5 text-sm">
                  <ShieldCheck className="size-4 text-green-600 dark:text-green-400 shrink-0" />
                  <span className="text-green-800 dark:text-green-300">
                    Distinct video versions confirmed for the selected Meta platforms
                  </span>
                </div>
              )}
              {selectedMetaCount >= 2 && !preview && (
                <div className="flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-2.5 text-sm">
                  <ShieldCheck className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span className="text-blue-800 dark:text-blue-300">
                    {selectedMetaCount} Meta platforms selected — preview will verify correct routing to Meta video versions
                  </span>
                </div>
              )}
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
                  ? `\u00b1${jitterMinutes} min random offset will be applied to each post to avoid bot detection`
                  : "No jitter \u2014 all posts at exact configured times"}
              </p>
            </div>
          )}

          {/* Caption template */}
          <div className="space-y-2">
            <Label htmlFor="caption-template">Caption Template</Label>
            <Textarea
              id="caption-template"
              placeholder="Use {collection_name} as a placeholder for the collection name..."
              value={captionTemplate}
              onChange={(e) => setCaptionTemplate(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Available placeholders: <code className="bg-muted px-1 rounded">{"{collection_name}"}</code>
            </p>
          </div>

          {/* Preview button */}
          <Button onClick={handlePreview} disabled={loadingPreview || selectedProjectIds.size === 0}>
            {loadingPreview && <Loader2 className="size-4 mr-2 animate-spin" />}
            Preview Schedule
          </Button>
        </CardContent>
      </Card>

      {/* ===== Section 2: Preview ===== */}
      {(loadingPreview || preview) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Schedule Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingPreview ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : preview ? (
              <>
                {/* Summary */}
                <div className="flex flex-wrap gap-4 text-sm">
                  <Badge variant="secondary" className="text-sm px-3 py-1">
                    {preview.total_clips} clips
                  </Badge>
                  <Badge variant="secondary" className="text-sm px-3 py-1">
                    {preview.total_days} days
                  </Badge>
                  <Badge variant="secondary" className="text-sm px-3 py-1">
                    {preview.collections_used} collections
                  </Badge>
                </div>

                {/* Excluded warnings */}
                {preview.excluded_collections.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700 p-3 text-sm">
                    <AlertTriangle className="size-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium">Excluded collections</span> (no publishable clips):
                      <span className="ml-1">
                        {preview.excluded_collections.join(", ")}
                      </span>
                    </div>
                  </div>
                )}

                {/* Calendar grid */}
                <ScheduleCalendarPreview entries={preview.entries} />

                {/* Confirm button */}
                <div className="flex justify-end pt-2">
                  <Button onClick={handleConfirm} disabled={confirming || preview.total_clips === 0}>
                    {confirming && <Loader2 className="size-4 mr-2 animate-spin" />}
                    Confirm & Schedule
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ===== Section 3: Postiz Calendar ===== */}
      <PostizMonthlyCalendar />

      {/* ===== Section 4: Plans History ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Schedule Plans</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingPlans ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : plans.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No schedule plans yet. Configure and preview a schedule above to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {plans.map((plan) => {
                const progress = planProgress[plan.id];
                const done = progress ? progress.items_done : (plan.scheduled_count + plan.failed_count);
                const pct = progress ? progress.percentage : plan.total_clips > 0
                  ? Math.round((done / plan.total_clips) * 100)
                  : 0;
                const scheduledCount = progress ? progress.items_done : plan.scheduled_count;
                const failedCount = plan.failed_count;

                return (
                  <div
                    key={plan.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 border rounded-lg p-4"
                  >
                    {/* Info */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{plan.name}</span>
                        <Badge variant={statusBadgeVariant(plan.status)} className="shrink-0 gap-1">
                          {statusIcon(plan.status)}
                          {plan.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          Start: {new Date(plan.start_date).toLocaleDateString()}
                          {plan.summary?.days_used ? ` (${plan.summary.days_used} days)` : ""}
                        </span>
                        <span>
                          {scheduledCount}/{plan.total_clips} scheduled
                        </span>
                        {failedCount > 0 && (
                          <span className="text-destructive">
                            {failedCount} failed
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress bar + Sync */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-full sm:w-40">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground text-right mt-0.5">{pct}%</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs shrink-0"
                        onClick={() => handleSyncPlan(plan.id)}
                        title="Sync status from Postiz"
                      >
                        <RefreshCw className="size-3 mr-1" />
                        Sync
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
