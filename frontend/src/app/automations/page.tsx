"use client";

import * as React from "react";
import {
  ArrowRight,
  Check,
  Cloud,
  Copy,
  ExternalLink,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type WorkflowNode = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  ui?: { x: number; y: number };
};

type WorkflowEdge = { from: string; to: string };

type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  definition: {
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    triggerUi?: { x: number; y: number };
  };
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AutomationsResponse = {
  connected: boolean;
  automations: Automation[];
  webUrl?: string | null;
  error?: string | null;
};

const NODE_LABELS: Record<string, string> = {
  product_source: "Products",
  sheets_source: "Google Sheets",
  http_request: "HTTP Request",
  text_input: "Text Input",
  upload_image: "Upload Image",
  image_url: "Image URL",
  ai_text: "AI Text",
  ai_image: "AI Image",
  ai_video: "AI Video",
  ai_tts: "AI Voice",
  compose_reel: "Compose Reel",
  publish_post: "Publish Post",
};

function triggerLabel(automation: Automation) {
  if (automation.triggerType === "manual") return "Manual";
  if (automation.triggerType === "webhook") return "Webhook";
  const config = automation.triggerConfig;
  if (config.mode === "daily") {
    return `Daily at ${String(config.hourUtc).padStart(2, "0")}:00 UTC`;
  }
  if (config.mode === "every" && typeof config.minutes === "number") {
    const hours = config.minutes / 60;
    return hours >= 24 ? `Every ${hours / 24} days` : `Every ${hours}h`;
  }
  return "Scheduled";
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AutomationsPage() {
  const [data, setData] = React.useState<AutomationsResponse | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [draftJson, setDraftJson] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [mutationError, setMutationError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await apiGet("/platform/automations", { cache: "no-store" });
      const next = (await response.json()) as AutomationsResponse;
      setData(next);
      setSelectedId((current) =>
        current && next.automations.some((automation) => automation.id === current)
          ? current
          : next.automations[0]?.id ?? null
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load cloud automations.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const selected = data?.automations.find((automation) => automation.id === selectedId) ?? null;
  const nodes = selected?.definition.nodes ?? [];
  const edges = selected?.definition.edges ?? [];
  const webHref =
    selected && data?.webUrl
      ? `${data.webUrl.replace(/\/$/, "")}/automations/${selected.id}`
      : null;

  const copyJson = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(draftJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  React.useEffect(() => {
    setDraftJson(selected ? JSON.stringify(selected.definition, null, 2) : "");
    setMutationError(null);
  }, [selected]);

  const createAutomation = async () => {
    setSaving(true);
    setMutationError(null);
    try {
      const response = await apiPost("/platform/automations", {
        name: "New workflow",
        triggerType: "manual",
        triggerConfig: {},
      });
      const created = (await response.json()) as Automation;
      await load();
      setSelectedId(created.id);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not create the workflow.");
    } finally {
      setSaving(false);
    }
  };

  const saveAutomation = async () => {
    if (!selected) return;
    setSaving(true);
    setMutationError(null);
    try {
      const definition = JSON.parse(draftJson) as Automation["definition"];
      await apiPatch(`/platform/automations/${selected.id}`, { definition });
      await load();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not save the workflow.");
    } finally {
      setSaving(false);
    }
  };

  const toggleAutomation = async () => {
    if (!selected) return;
    setSaving(true);
    setMutationError(null);
    try {
      await apiPatch(`/platform/automations/${selected.id}`, { enabled: !selected.enabled });
      await load();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not update the workflow.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAutomation = async () => {
    if (!selected || !window.confirm(`Delete “${selected.name}”? This also deletes it from Blipost web.`)) return;
    setSaving(true);
    setMutationError(null);
    try {
      await apiDelete(`/platform/automations/${selected.id}`);
      await load();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not delete the workflow.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-border bg-card p-2.5">
            <Workflow className="size-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-3xl font-bold tracking-tight">Automations</h1>
              <Badge variant="outline" className="gap-1">
                <Cloud className="size-3" /> Cloud sync
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              The same workflows as Blipost web, kept in sync through your signed-in account.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading || saving}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh
          </Button>
          <Button onClick={() => void createAutomation()} disabled={loading || saving || !data?.connected}>
            <Plus className="size-4" /> New automation
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {mutationError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {mutationError}
        </div>
      )}

      {!loading && data && !data.connected && (
        <Card>
          <CardHeader>
            <CardTitle>Cloud sync is temporarily unavailable</CardTitle>
            <CardDescription>
              {data.error ?? "Your desktop session is active, but the Automations workspace could not be loaded from Blipost web."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} /> Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && data?.connected && data.error && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
          {data.error}
        </div>
      )}

      {!loading && data?.connected && data.automations.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No cloud automations yet</CardTitle>
            <CardDescription>Create your first workflow in Blipost web, then refresh this mirror.</CardDescription>
          </CardHeader>
          {data.webUrl && (
            <CardContent>
              <Button asChild>
                <a href={`${data.webUrl.replace(/\/$/, "")}/automations`} target="_blank" rel="noreferrer">
                  Open Blipost web <ExternalLink className="size-4" />
                </a>
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {data?.connected && data.automations.length > 0 && (
        <div className="grid min-h-[620px] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="h-fit overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Synced workflows</CardTitle>
              <CardDescription>{data.automations.length} synced with web</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 px-3 pb-3">
              {data.automations.map((automation) => (
                <button
                  key={automation.id}
                  type="button"
                  onClick={() => setSelectedId(automation.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                    automation.id === selectedId
                      ? "border-primary/50 bg-primary/10"
                      : "border-transparent hover:bg-muted/60"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", automation.enabled ? "bg-success" : "bg-muted-foreground/40")} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{automation.name}</span>
                  </div>
                  <p className="mt-1 pl-4 text-xs text-muted-foreground">
                    {triggerLabel(automation)} · {automation.definition.nodes?.length ?? 0} nodes
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>

          {selected && (
            <div className="min-w-0 space-y-5">
              <Card>
                <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{selected.name}</CardTitle>
                      <button type="button" onClick={() => void toggleAutomation()} disabled={saving}>
                        <Badge variant={selected.enabled ? "default" : "secondary"}>
                          {selected.enabled ? "Active" : "Paused"}
                        </Badge>
                      </button>
                    </div>
                    <CardDescription className="mt-1">
                      {triggerLabel(selected)} · Updated {formatDate(selected.updatedAt)} · Last run {formatDate(selected.lastRunAt)}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="destructive" size="sm" onClick={() => void deleteAutomation()} disabled={saving}>
                      <Trash2 className="size-4" /> Delete
                    </Button>
                    {webHref && (
                      <Button asChild size="sm">
                        <a href={webHref} target="_blank" rel="noreferrer">
                          Run on web <ExternalLink className="size-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Workflow nodes</CardTitle>
                  <CardDescription>The visual sequence reflects the canonical graph shared with Blipost web.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto pb-2">
                    <div className="flex min-w-max items-center gap-2">
                      <div className="w-36 rounded-lg border border-primary/40 bg-primary/10 p-3">
                        <Zap className="mb-2 size-4" />
                        <p className="text-sm font-medium">{triggerLabel(selected)}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">Trigger</p>
                      </div>
                      {nodes.map((node) => (
                        <React.Fragment key={node.id}>
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                          <div className="w-40 rounded-lg border border-border bg-card p-3 shadow-sm">
                            <Workflow className="mb-2 size-4 text-muted-foreground" />
                            <p className="truncate text-sm font-medium">{NODE_LABELS[node.type] ?? node.type}</p>
                            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{node.id}</p>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{nodes.length} nodes</Badge>
                    <Badge variant="outline">{edges.length} connections</Badge>
                    {edges.map((edge, index) => (
                      <span key={`${edge.from}-${edge.to}-${index}`} className="rounded border border-border px-2 py-1 font-mono">
                        {edge.from} → {edge.to}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">Canonical workflow JSON</CardTitle>
                    <CardDescription>Changes save to the same workflow used by Blipost web.</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void copyJson()}>
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button size="sm" onClick={() => void saveAutomation()} disabled={saving}>
                      <Save className="size-4" /> {saving ? "Saving…" : "Save to cloud"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <textarea
                    value={draftJson}
                    onChange={(event) => setDraftJson(event.target.value)}
                    aria-label="Canonical workflow JSON"
                    spellCheck={false}
                    className="min-h-[360px] w-full resize-y rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
          <RefreshCw className="mr-2 size-4 animate-spin" /> Loading cloud automations…
        </div>
      )}
    </div>
  );
}
