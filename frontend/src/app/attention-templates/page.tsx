"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CopyPlus,
  Layers3,
  LayoutTemplate,
  Loader2,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { AttentionAnimationPreset } from "@/types/attention-timeline";
import {
  attentionLayoutPositions,
  DEFAULT_ATTENTION_TEMPLATE,
  normalizeAttentionTemplate,
  type AttentionTemplate,
  type AttentionTemplatePayload,
} from "@/types/attention-template";

const PREVIEW_GRADIENTS = [
  "from-lime-300 via-emerald-400 to-teal-700",
  "from-fuchsia-400 via-violet-500 to-indigo-800",
  "from-amber-300 via-orange-500 to-rose-700",
  "from-cyan-300 via-sky-500 to-blue-800",
];

const ANIMATIONS: AttentionAnimationPreset[] = [
  "static",
  "pop",
  "zoom",
  "slide",
  "spin",
  "tornado",
];

export default function AttentionTemplatesPage() {
  const [templates, setTemplates] = useState<AttentionTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<AttentionTemplatePayload>(DEFAULT_ATTENTION_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedTemplate = templates.find(template => template.id === selectedId);
  const isNew = selectedId === "new";
  const isSystem = Boolean(selectedTemplate?.is_system);
  const editable = isNew || Boolean(selectedTemplate && !selectedTemplate.is_system);

  const selectTemplate = useCallback((template: AttentionTemplate) => {
    setSelectedId(template.id);
    setDraft(normalizeAttentionTemplate(template));
  }, []);

  const loadTemplates = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const response = await apiGet("/attention-templates", { cache: "no-store" });
      const data = (await response.json()) as { templates?: AttentionTemplate[] };
      const next = data.templates ?? [];
      setTemplates(next);
      const preferred = next.find(template => template.id === preferredId) ?? next[0];
      if (preferred) selectTemplate(preferred);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load attention templates");
    } finally {
      setLoading(false);
    }
  }, [selectTemplate]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const updateDraft = <Key extends keyof AttentionTemplatePayload>(
    key: Key,
    value: AttentionTemplatePayload[Key],
  ) => setDraft(current => ({ ...current, [key]: value }));

  const beginCreate = () => {
    setSelectedId("new");
    setDraft({ ...DEFAULT_ATTENTION_TEMPLATE, name: "My attention template" });
  };

  const saveTemplate = async () => {
    if (!editable || !draft.name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...draft, name: draft.name.trim() };
      const response = isNew
        ? await apiPost("/attention-templates", payload)
        : await apiPut(`/attention-templates/${selectedId}`, payload);
      const saved = (await response.json()) as AttentionTemplate;
      await loadTemplates(saved.id);
      toast.success(isNew ? "Personal template created" : "Template saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save template");
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selectedTemplate || selectedTemplate.is_system) return;
    setDeleting(true);
    try {
      await apiDelete(`/attention-templates/${selectedTemplate.id}`);
      setDeleteOpen(false);
      await loadTemplates();
      toast.success("Personal template deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete template");
    } finally {
      setDeleting(false);
    }
  };

  const positions = useMemo(
    () => attentionLayoutPositions(draft.layers, draft.size),
    [draft.layers, draft.size],
  );

  return (
    <PageShell width="wide" className="space-y-6">
      <PageHeader
        icon={<div className="rounded-xl border border-lime-300/25 bg-lime-300/10 p-3"><LayoutTemplate className="size-6 text-lime-300" /></div>}
        title="Attention Templates"
        description="Design reusable image moments, preview their cascade, and apply them from Step 3."
        actions={(
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/pipeline"><ArrowLeft className="mr-2 size-4" />Back to Pipeline</Link>
            </Button>
            <Button onClick={beginCreate} className="bg-lime-300 text-black hover:bg-lime-200">
              <CopyPlus className="mr-2 size-4" />New personal template
            </Button>
          </div>
        )}
      />

      <div className="grid gap-5 xl:grid-cols-[18rem_minmax(28rem,1fr)_minmax(22rem,0.8fr)]">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Template library</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-3">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
            ) : templates.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">No templates available.</p>
            ) : templates.map(template => {
              const config = normalizeAttentionTemplate(template);
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => selectTemplate(template)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedId === template.id
                      ? "border-lime-300/60 bg-lime-300/10"
                      : "border-border bg-muted/20 hover:border-lime-300/30 hover:bg-muted/40"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{template.name}</span>
                    {template.is_system && <ShieldCheck className="size-3.5 shrink-0 text-lime-300" />}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {config.layers} layer{config.layers === 1 ? "" : "s"} · {Math.round(config.size * 100)}% · {config.zone}
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="gap-4 py-5" data-testid="attention-template-editor">
          <CardHeader className="border-b px-5 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{isNew ? "Create personal template" : draft.name}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isSystem ? "System templates are read-only." : "Changes are saved to your current profile."}
                </p>
              </div>
              {isSystem && <Badge variant="outline" className="border-lime-300/30 text-lime-300">System</Badge>}
              {isNew && <Badge className="bg-lime-300 text-black">New</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-5 px-5">
            <fieldset disabled={!editable || saving} className="space-y-5 disabled:opacity-65">
              <label className="space-y-1.5">
                <Label htmlFor="attention-name">Name</Label>
                <Input id="attention-name" value={draft.name} onChange={event => updateDraft("name", event.target.value)} maxLength={80} />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <Label htmlFor="attention-strategy">Strategy</Label>
                  <select id="attention-strategy" className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={draft.strategy} onChange={event => updateDraft("strategy", event.target.value as AttentionTemplatePayload["strategy"])}>
                    <option value="count">Fixed count</option>
                    <option value="everySeconds">Every N seconds</option>
                  </select>
                </label>
                {draft.strategy === "count" ? (
                  <NumberField label="Cue count" value={draft.count} min={0} max={100} step={1} onChange={value => updateDraft("count", value)} />
                ) : (
                  <NumberField label="Every seconds" value={draft.everySeconds} min={1} max={3600} step={0.5} onChange={value => updateDraft("everySeconds", value)} />
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField label="Duration ms" value={draft.durationMs} min={100} max={600000} step={100} onChange={value => updateDraft("durationMs", value)} />
                <NumberField label="Layers" value={draft.layers} min={1} max={10} step={1} onChange={value => updateDraft("layers", value)} />
                <NumberField label="Size" value={draft.size} min={0.05} max={1} step={0.05} onChange={value => updateDraft("size", value)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1.5">
                  <Label htmlFor="attention-zone">Subtitle zone</Label>
                  <select id="attention-zone" className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={draft.zone} onChange={event => updateDraft("zone", event.target.value as AttentionTemplatePayload["zone"])}>
                    <option value="behind">Behind subtitles</option>
                    <option value="front">In front of subtitles</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <Label htmlFor="attention-animation">Animation preset</Label>
                  <select id="attention-animation" className="h-9 w-full rounded-md border bg-background px-3 text-sm capitalize"
                    value={draft.animation} onChange={event => updateDraft("animation", event.target.value as AttentionAnimationPreset)}>
                    {ANIMATIONS.map(animation => <option key={animation} value={animation}>{animation}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <Label htmlFor="attention-sfx">SFX asset</Label>
                  <Input id="attention-sfx" value={draft.sfx ?? ""} onChange={event => updateDraft("sfx", event.target.value || null)} placeholder="Optional asset ID" />
                </label>
              </div>

              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timing guards</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <NumberField label="Minimum gap ms" value={draft.minimumGapMs} min={0} step={100} onChange={value => updateDraft("minimumGapMs", value)} />
                  <NumberField label="Protected start ms" value={draft.protectedStartMs} min={0} step={100} onChange={value => updateDraft("protectedStartMs", value)} />
                  <NumberField label="Protected end ms" value={draft.protectedEndMs} min={0} step={100} onChange={value => updateDraft("protectedEndMs", value)} />
                </div>
              </div>
            </fieldset>

            <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
              <Button variant="destructive" disabled={!selectedTemplate || selectedTemplate.is_system || saving}
                onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 size-4" />Delete personal template
              </Button>
              <Button disabled={!editable || saving || !draft.name.trim()} onClick={() => void saveTemplate()}
                className="bg-lime-300 text-black hover:bg-lime-200">
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                {saving ? "Saving..." : isNew ? "Create template" : "Save changes"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4 overflow-hidden border-lime-300/15 bg-[#111411] py-5 text-white">
          <CardHeader className="px-5">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Layers3 className="size-4 text-lime-300" />Live 9:16 preview
            </CardTitle>
            <p className="text-xs text-white/50">Size, diagonal cascade, stagger, and subtitle zone update as you edit.</p>
          </CardHeader>
          <CardContent className="flex justify-center px-5">
            <div className="relative aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-[1.6rem] border border-white/15 bg-gradient-to-b from-zinc-700 via-zinc-900 to-black shadow-2xl" data-testid="attention-template-preview">
              <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/10 to-transparent" />
              <div className="absolute left-4 top-5 rounded-full bg-black/35 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-white/55">Mock video</div>
              {positions.map((position, index) => (
                <div
                  key={index}
                  className={`absolute overflow-hidden rounded-lg border border-white/45 bg-gradient-to-br ${PREVIEW_GRADIENTS[index % PREVIEW_GRADIENTS.length]} shadow-xl`}
                  style={{
                    left: `${position.x * 100}%`,
                    top: `${position.y * 100}%`,
                    width: `${draft.size * 100}%`,
                    height: `${draft.size * 100}%`,
                    zIndex: (draft.zone === "front" ? 30 : 10) + index,
                    animationDelay: `${index * 120}ms`,
                  }}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_25%,rgba(255,255,255,0.55),transparent_24%)]" />
                  <span className="absolute bottom-2 right-2 rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold">IMAGE {index + 1}</span>
                </div>
              ))}
              <div className="absolute inset-x-3 top-[76%] z-20 text-center">
                <span className="inline rounded bg-black/70 px-2 py-1 text-sm font-black leading-relaxed text-white [text-shadow:0_1px_2px_black]">
                  LIVE SUBTITLE LAYER
                </span>
              </div>
              <div className="absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-white/15 bg-black/55 px-3 py-1 text-[10px] text-white/65">
                {draft.zone === "front" ? "Images over captions" : "Captions over images"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete personal attention template?"
        description={`This removes “${selectedTemplate?.name ?? "this template"}” from your profile. Existing timelines keep their already-applied cues.`}
        confirmLabel="Delete template"
        variant="destructive"
        loading={deleting}
        onConfirm={() => void deleteTemplate()}
      />
    </PageShell>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={event => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}
