"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, handleApiError } from "@/lib/api";
import { BLIPOST_BILLING_URL } from "@/lib/api-error";
import { useProfile } from "@/contexts/profile-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_SCRIPT_AI_PROVIDER,
  DESKTOP_CODEX_AVAILABLE,
  type ScriptAiProvider,
} from "@/lib/script-ai";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
} from "lucide-react";

const MAX_IDEAS = 20;

interface BatchItem {
  idea: string;
  status: string; // queued | generating_script | generating_preview | ready_for_review | failed
  pipeline_id?: string | null;
  error?: string | null;
  status_code?: number | null;
  updated_at?: string;
}

interface BatchDetail {
  batch_id: string;
  status: string; // queued | processing | completed | completed_with_errors
  progress?: string | null;
  items: BatchItem[];
  settings?: Record<string, unknown>;
  created_at?: string;
}

interface BatchSummary {
  batch_id: string;
  status: string;
  progress?: string | null;
  item_count: number;
  created_at?: string;
}

interface RenderState {
  status: "rendering" | "completed" | "failed";
  progress: number;
  outputName?: string;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ItemStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "queued":
      return <Badge variant="secondary">queued</Badge>;
    case "generating_script":
    case "generating_preview":
      return (
        <Badge>
          <Loader2 className="size-3 mr-1 animate-spin" />
          {status.replace(/_/g, " ")}
        </Badge>
      );
    case "ready_for_review":
      return (
        <Badge className="bg-success/10 text-success border border-success/20 hover:bg-success/10">
          ready for review
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function BatchStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "queued":
      return <Badge variant="secondary">queued</Badge>;
    case "processing":
      return (
        <Badge>
          <Loader2 className="size-3 mr-1 animate-spin" />
          processing
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-success/10 text-success border border-success/20 hover:bg-success/10">
          completed
        </Badge>
      );
    case "completed_with_errors":
      return <Badge variant="destructive">completed with errors</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function BatchPage() {
  const router = useRouter();
  const { currentProfile } = useProfile();

  // Create form state
  const [ideasText, setIdeasText] = useState("");
  const [wordsPerSubtitle, setWordsPerSubtitle] = useState("2");
  const [targetDuration, setTargetDuration] = useState("");
  const [provider, setProvider] = useState<ScriptAiProvider>(
    DEFAULT_SCRIPT_AI_PROVIDER,
  );
  const [codexModel, setCodexModel] = useState(DEFAULT_CODEX_MODEL);
  const [starting, setStarting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Active batch state
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  // Bumped to restart polling (e.g. after resume re-queues the batch)
  const [pollNonce, setPollNonce] = useState(0);

  // Recent batches
  const [recentBatches, setRecentBatches] = useState<BatchSummary[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Per-pipeline render tracking (Approve & Render)
  const [renderStates, setRenderStates] = useState<Record<string, RenderState>>({});
  const renderTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const timers = renderTimersRef.current;
    return () => {
      mountedRef.current = false;
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const fetchRecentBatches = useCallback(async () => {
    try {
      const res = await apiGet("/pipeline/batch?limit=10");
      const data = await res.json();
      if (!mountedRef.current) return;
      setRecentBatches(Array.isArray(data?.batches) ? data.batches : []);
    } catch (err) {
      handleApiError(err, "Failed to load recent batches");
    } finally {
      if (mountedRef.current) setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentBatches();
  }, [fetchRecentBatches, currentProfile?.id]);

  // Poll the selected batch every 2.5s while it is queued/processing
  useEffect(() => {
    if (!selectedBatchId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await apiGet(`/pipeline/batch/${selectedBatchId}`);
        const data: BatchDetail = await res.json();
        if (cancelled) return;
        setBatch(data);
        setBatchError(null);
        if (data.status === "queued" || data.status === "processing") {
          timer = setTimeout(poll, 2500);
        } else {
          // Terminal state — refresh the recent list once
          fetchRecentBatches();
        }
      } catch (err) {
        if (cancelled) return;
        setBatchError(err instanceof Error ? err.message : "Failed to load batch");
        handleApiError(err, "Failed to load batch");
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selectedBatchId, pollNonce, fetchRecentBatches]);

  async function startBatch() {
    const ideas = ideasText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_IDEAS);

    if (ideas.length === 0) {
      setCreateError("Add at least one idea (one per line).");
      return;
    }

    const words = Math.min(6, Math.max(1, parseInt(wordsPerSubtitle, 10) || 2));
    const settings: Record<string, unknown> = {
      provider,
      codex_model: codexModel.trim() || DEFAULT_CODEX_MODEL,
      words_per_subtitle: words,
    };
    const target = parseFloat(targetDuration);
    if (!isNaN(target) && target > 0) {
      settings.target_script_duration = target;
    }

    setCreateError(null);
    setStarting(true);
    try {
      const res = await apiPost("/pipeline/batch", { ideas, settings });
      const data = await res.json();
      setIdeasText("");
      setBatch(null);
      setSelectedBatchId(data.batch_id);
      fetchRecentBatches();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to start batch");
      handleApiError(err, "Failed to start batch");
    } finally {
      setStarting(false);
    }
  }

  async function resumeBatch() {
    if (!batch) return;
    setResuming(true);
    try {
      await apiPost(`/pipeline/batch/${batch.batch_id}/resume`);
      // Restart polling — the batch is queued again
      setPollNonce((n) => n + 1);
    } catch (err) {
      handleApiError(err, "Failed to resume batch");
    } finally {
      setResuming(false);
    }
  }

  const pollRender = useCallback(async (pipelineId: string) => {
    try {
      const res = await apiGet(`/pipeline/status/${pipelineId}`);
      const data = await res.json();
      if (!mountedRef.current) return;

      const variants = Array.isArray(data?.variants) ? data.variants : [];
      const v0 =
        variants.find(
          (v: { variant_index?: number }) => v?.variant_index === 0
        ) ?? variants[0];
      const status = typeof v0?.status === "string" ? v0.status : "";
      const progress = typeof v0?.progress === "number" ? v0.progress : 0;

      if (status === "completed") {
        const path: string =
          (typeof v0?.output_path === "string" && v0.output_path) ||
          (typeof v0?.video_url === "string" && v0.video_url) ||
          "";
        const outputName = path ? path.split(/[\\/]/).pop() || path : "";
        setRenderStates((prev) => ({
          ...prev,
          [pipelineId]: { status: "completed", progress: 100, outputName },
        }));
        return;
      }
      if (status === "failed") {
        setRenderStates((prev) => ({
          ...prev,
          [pipelineId]: { status: "failed", progress },
        }));
        return;
      }

      setRenderStates((prev) => ({
        ...prev,
        [pipelineId]: { status: "rendering", progress },
      }));
      renderTimersRef.current[pipelineId] = setTimeout(
        () => pollRender(pipelineId),
        3000
      );
    } catch {
      // Transient polling error — retry on the next tick
      if (mountedRef.current) {
        renderTimersRef.current[pipelineId] = setTimeout(
          () => pollRender(pipelineId),
          3000
        );
      }
    }
  }, []);

  async function approveAndRender(pipelineId: string) {
    setRenderStates((prev) => ({
      ...prev,
      [pipelineId]: { status: "rendering", progress: 0 },
    }));
    try {
      await apiPost(`/pipeline/render/${pipelineId}`, {
        variant_indices: [0],
        preset_name: "TikTok",
      });
      renderTimersRef.current[pipelineId] = setTimeout(
        () => pollRender(pipelineId),
        3000
      );
    } catch (err) {
      handleApiError(err, "Failed to start render");
      setRenderStates((prev) => ({
        ...prev,
        [pipelineId]: { status: "failed", progress: 0 },
      }));
    }
  }

  function selectBatch(batchId: string) {
    if (batchId === selectedBatchId) {
      // Re-poll the same batch (e.g. user clicked it again after it finished)
      setPollNonce((n) => n + 1);
      return;
    }
    setBatch(null);
    setBatchError(null);
    setSelectedBatchId(batchId);
  }

  const ideaCount = ideasText.split("\n").filter((l) => l.trim()).length;
  const hasFailedItems = (batch?.items ?? []).some((it) => it.status === "failed");
  const readyCount = (batch?.items ?? []).filter(
    (it) => it.status === "ready_for_review"
  ).length;

  return (
    <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 py-8">
      {/* Header */}
      <PageHeader
        className="mb-6"
        icon={<ListChecks className="size-6 text-primary" />}
        title="Batch Pipeline"
        description="Paste ideas, get review-ready videos."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Create card */}
          <Card>
            <CardHeader>
              <CardTitle>New Batch</CardTitle>
              <CardDescription>
                One idea per line — each becomes one video, processed to
                ready-for-review in the background (max {MAX_IDEAS}).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder={"One idea per line…"}
                value={ideasText}
                onChange={(e) => setIdeasText(e.target.value)}
                rows={6}
                disabled={starting}
              />
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="batch-wps">Words per subtitle</Label>
                  <Input
                    id="batch-wps"
                    type="number"
                    min={1}
                    max={6}
                    value={wordsPerSubtitle}
                    onChange={(e) => setWordsPerSubtitle(e.target.value)}
                    className="w-28"
                    disabled={starting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="batch-duration">Target duration (s)</Label>
                  <Input
                    id="batch-duration"
                    type="number"
                    min={5}
                    max={300}
                    placeholder="auto"
                    value={targetDuration}
                    onChange={(e) => setTargetDuration(e.target.value)}
                    className="w-32"
                    disabled={starting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="batch-provider">Provider</Label>
                  <Select
                    value={provider}
                    onValueChange={(value) => setProvider(value as ScriptAiProvider)}
                    disabled={starting}
                  >
                    <SelectTrigger id="batch-provider" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini">Gemini 2.5 Flash</SelectItem>
                      <SelectItem value="claude">Claude Sonnet 4</SelectItem>
                      {DESKTOP_CODEX_AVAILABLE && (
                        <SelectItem value="codex">
                          Codex (ChatGPT subscription)
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {provider === "codex" && DESKTOP_CODEX_AVAILABLE && (
                  <div className="space-y-1.5">
                    <Label htmlFor="batch-codex-model">Codex Model</Label>
                    <Input
                      id="batch-codex-model"
                      value={codexModel}
                      onChange={(event) => setCodexModel(event.target.value)}
                      className="w-44 font-mono"
                      placeholder="gpt-5.4-mini"
                      spellCheck={false}
                      autoCapitalize="none"
                      disabled={starting}
                    />
                  </div>
                )}
                <div className="ml-auto flex items-center gap-3">
                  {ideaCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {Math.min(ideaCount, MAX_IDEAS)} idea{ideaCount === 1 ? "" : "s"}
                      {ideaCount > MAX_IDEAS ? ` (capped at ${MAX_IDEAS})` : ""}
                    </span>
                  )}
                  <Button onClick={startBatch} disabled={starting || ideaCount === 0}>
                    {starting ? (
                      <Loader2 className="size-4 mr-1 animate-spin" />
                    ) : (
                      <Rocket className="size-4 mr-1" />
                    )}
                    Start Batch
                  </Button>
                </div>
              </div>
              {createError && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="size-4 shrink-0" />
                  {createError}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Active batch card */}
          {selectedBatchId && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <CardTitle className="truncate">
                      Batch {selectedBatchId.slice(0, 8)}
                    </CardTitle>
                    {batch && <BatchStatusBadge status={batch.status} />}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {batch && hasFailedItems && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={resumeBatch}
                        disabled={resuming}
                      >
                        {resuming ? (
                          <Loader2 className="size-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4 mr-1" />
                        )}
                        Resume failed
                      </Button>
                    )}
                  </div>
                </div>
                {batch && (
                  <CardDescription>
                    {typeof batch.progress === "string" && batch.progress
                      ? batch.progress
                      : `${readyCount}/${batch.items.length} ready`}
                    {batch.created_at ? ` · started ${formatDate(batch.created_at)}` : ""}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {batchError && (
                  <p className="text-sm text-destructive flex items-center gap-1.5 mb-3">
                    <AlertTriangle className="size-4 shrink-0" />
                    {batchError}
                  </p>
                )}
                {!batch && !batchError && (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {batch && (
                  <ul className="divide-y">
                    {batch.items.map((item, idx) => {
                      const renderState = item.pipeline_id
                        ? renderStates[item.pipeline_id]
                        : undefined;
                      return (
                        <li
                          key={`${idx}-${item.pipeline_id ?? "pending"}`}
                          className="py-3 flex items-center gap-3"
                        >
                          <span className="text-xs text-muted-foreground w-6 shrink-0">
                            {idx + 1}.
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm truncate" title={item.idea}>
                              {item.idea}
                            </p>
                            {item.status === "failed" && item.error && (
                              <div className="mt-0.5 flex items-center gap-2">
                                <p
                                  className="min-w-0 truncate text-xs text-destructive"
                                  title={item.error}
                                >
                                  {item.error}
                                </p>
                                {item.status_code === 402 && (
                                  <a
                                    href={BLIPOST_BILLING_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="shrink-0 text-xs font-medium text-primary underline underline-offset-2"
                                  >
                                    Manage credits
                                  </a>
                                )}
                              </div>
                            )}
                            {renderState?.status === "rendering" && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Rendering… {Math.round(renderState.progress)}%
                              </p>
                            )}
                            {renderState?.status === "completed" && (
                              <p className="text-xs text-success mt-0.5 flex items-center gap-1 truncate">
                                <CheckCircle2 className="size-3 shrink-0" />
                                Done
                                {renderState.outputName
                                  ? ` — ${renderState.outputName}`
                                  : ""}
                              </p>
                            )}
                            {renderState?.status === "failed" && (
                              <p className="text-xs text-destructive mt-0.5">
                                Render failed
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <ItemStatusBadge status={item.status} />
                            {item.status === "ready_for_review" && item.pipeline_id && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    router.push(
                                      `/pipeline?step=3&id=${item.pipeline_id}`
                                    )
                                  }
                                >
                                  <Clapperboard className="size-4 mr-1" />
                                  Review
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => approveAndRender(item.pipeline_id!)}
                                  disabled={
                                    renderState?.status === "rendering" ||
                                    renderState?.status === "completed"
                                  }
                                >
                                  {renderState?.status === "rendering" ? (
                                    <Loader2 className="size-4 mr-1 animate-spin" />
                                  ) : (
                                    <Play className="size-4 mr-1" />
                                  )}
                                  Approve & Render
                                </Button>
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recent batches */}
        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Batches</CardTitle>
              <Button variant="ghost" size="sm" onClick={fetchRecentBatches}>
                <RefreshCw className="size-4" />
                <span className="sr-only">Refresh</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingRecent && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingRecent && recentBatches.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No batches yet.
              </p>
            )}
            {!loadingRecent && recentBatches.length > 0 && (
              <ul className="space-y-1">
                {recentBatches.map((b) => (
                  <li key={b.batch_id}>
                    <button
                      onClick={() => selectBatch(b.batch_id)}
                      className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
                        b.batch_id === selectedBatchId
                          ? "bg-accent text-accent-foreground"
                          : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs truncate">
                          {b.batch_id.slice(0, 8)}
                        </span>
                        <BatchStatusBadge status={b.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1 text-xs text-muted-foreground">
                        <span>
                          {b.item_count} item{b.item_count === 1 ? "" : "s"}
                          {typeof b.progress === "string" && b.progress
                            ? ` · ${b.progress}`
                            : ""}
                        </span>
                        <span>{formatDate(b.created_at)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
