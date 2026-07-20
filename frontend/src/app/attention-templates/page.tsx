"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CopyPlus,
  ImagePlus,
  Layers3,
  LayoutTemplate,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
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
  DEFAULT_ATTENTION_TEMPLATE,
  newTemplateImage,
  normalizeAttentionTemplate,
  templateEndMs,
  type AttentionTemplate,
  type AttentionTemplateImage,
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
  const [selectedImageId, setSelectedImageId] = useState<string>("");
  const [previewMs, setPreviewMs] = useState(0);
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
    setSelectedImageId("");
    setPreviewMs(0);
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

  const beginCreate = () => {
    setSelectedId("new");
    setDraft({ ...DEFAULT_ATTENTION_TEMPLATE, name: "My attention template", tracks: [[]] });
    setSelectedImageId("");
    setPreviewMs(0);
  };

  const setTracks = (tracks: AttentionTemplateImage[][]) =>
    setDraft(current => ({ ...current, tracks }));

  const addTrack = () => setTracks([...draft.tracks, []]);

  const removeTrack = (trackIndex: number) => {
    if (draft.tracks.length <= 1) return;
    setTracks(draft.tracks.filter((_, index) => index !== trackIndex));
  };

  const addImage = (trackIndex: number) => {
    const track = draft.tracks[trackIndex];
    const lastEnd = track.length
      ? Math.max(...track.map(image => image.startMs + image.durationMs))
      : 0;
    const image = newTemplateImage({ startMs: lastEnd });
    setTracks(draft.tracks.map((images, index) =>
      index === trackIndex ? [...images, image] : images));
    setSelectedImageId(image.id);
    setPreviewMs(image.startMs);
  };

  const updateImage = (imageId: string, patch: Partial<AttentionTemplateImage>) =>
    setTracks(draft.tracks.map(images =>
      images.map(image => (image.id === imageId ? { ...image, ...patch } : image))));

  const removeImage = (imageId: string) =>
    setTracks(draft.tracks.map(images => images.filter(image => image.id !== imageId)));

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

  const endMs = useMemo(() => Math.max(1000, templateEndMs(draft.tracks)), [draft.tracks]);
  const activeImages = useMemo(() =>
    draft.tracks.flatMap((images, trackIndex) =>
      images
        .filter(image => previewMs >= image.startMs && previewMs < image.startMs + image.durationMs)
        .map(image => ({ image, trackIndex }))),
    [draft.tracks, previewMs]);
  const imageCount = draft.tracks.reduce((sum, images) => sum + images.length, 0);

  return (
    <PageShell width="wide" className="space-y-6">
      <PageHeader
        icon={<div className="rounded-xl border border-lime-300/25 bg-lime-300/10 p-3"><LayoutTemplate className="size-6 text-lime-300" /></div>}
        title="Attention Templates"
        description="Stack image tracks like in Premiere: position, size, duration. Apply from Step 3."
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
              const images = config.tracks.reduce((sum, track) => sum + track.length, 0);
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
                    {config.tracks.length} track{config.tracks.length === 1 ? "" : "s"} · {images} image{images === 1 ? "" : "s"} · {config.zone}
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
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1.5 sm:col-span-1">
                  <Label htmlFor="attention-name">Name</Label>
                  <Input id="attention-name" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} maxLength={80} />
                </label>
                <label className="space-y-1.5">
                  <Label htmlFor="attention-zone">Subtitle zone</Label>
                  <select id="attention-zone" className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={draft.zone} onChange={event => setDraft(current => ({ ...current, zone: event.target.value as AttentionTemplatePayload["zone"] }))}>
                    <option value="behind">Behind subtitles</option>
                    <option value="front">In front of subtitles</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <Label htmlFor="attention-animation">Animation</Label>
                  <select id="attention-animation" className="h-9 w-full rounded-md border bg-background px-3 text-sm capitalize"
                    value={draft.animation} onChange={event => setDraft(current => ({ ...current, animation: event.target.value as AttentionAnimationPreset }))}>
                    {ANIMATIONS.map(animation => <option key={animation} value={animation}>{animation}</option>)}
                  </select>
                </label>
              </div>

              <div className="space-y-3" data-testid="attention-track-list">
                {draft.tracks.map((images, trackIndex) => (
                  <div key={trackIndex} className="space-y-2 rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Video track V{trackIndex + 2}
                      </p>
                      <div className="flex gap-1.5">
                        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs"
                          onClick={() => addImage(trackIndex)} data-testid={`add-image-track-${trackIndex}`}>
                          <ImagePlus className="size-3.5" />Add image
                        </Button>
                        {draft.tracks.length > 1 && (
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground"
                            onClick={() => removeTrack(trackIndex)} aria-label={`Remove track ${trackIndex + 1}`}>
                            <X className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {images.length === 0 ? (
                      <p className="rounded border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
                        Empty track — add an image.
                      </p>
                    ) : images.map((image, imageIndex) => (
                      <div
                        key={image.id}
                        className={`space-y-2 rounded-md border p-2 transition ${
                          selectedImageId === image.id ? "border-lime-300/60 bg-lime-300/5" : "border-border"
                        }`}
                        onClick={() => { setSelectedImageId(image.id); setPreviewMs(image.startMs); }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">Image {imageIndex + 1}</span>
                          <button type="button" className="text-muted-foreground hover:text-destructive"
                            onClick={event => { event.stopPropagation(); removeImage(image.id); }}
                            aria-label={`Remove image ${imageIndex + 1} on track ${trackIndex + 1}`}>
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                          <PercentField label="X" value={image.x} onChange={value => updateImage(image.id, { x: value })} />
                          <PercentField label="Y" value={image.y} onChange={value => updateImage(image.id, { y: value })} />
                          <PercentField label="W" min={1} value={image.width} onChange={value => updateImage(image.id, { width: value })} />
                          <PercentField label="H" min={1} value={image.height} onChange={value => updateImage(image.id, { height: value })} />
                          <MsField label="Start ms" value={image.startMs} onChange={value => updateImage(image.id, { startMs: value })} />
                          <MsField label="Duration ms" min={100} value={image.durationMs} onChange={value => updateImage(image.id, { durationMs: value })} />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addTrack} data-testid="add-track">
                  <Plus className="size-4" />Add video track
                </Button>
              </div>
            </fieldset>

            <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
              <Button variant="destructive" disabled={!selectedTemplate || selectedTemplate.is_system || saving}
                onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 size-4" />Delete personal template
              </Button>
              <Button disabled={!editable || saving || !draft.name.trim() || imageCount === 0} onClick={() => void saveTemplate()}
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
            <p className="text-xs text-white/50">Scrub the timeline to see which images are on screen.</p>
          </CardHeader>
          <CardContent className="space-y-3 px-5">
            <div className="flex justify-center">
              <div className="relative aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-[1.6rem] border border-white/15 bg-gradient-to-b from-zinc-700 via-zinc-900 to-black shadow-2xl" data-testid="attention-template-preview">
                <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/10 to-transparent" />
                <div className="absolute left-4 top-5 rounded-full bg-black/35 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-white/55">Mock video</div>
                {activeImages.map(({ image, trackIndex }) => (
                  <div
                    key={image.id}
                    className={`absolute overflow-hidden rounded-lg border shadow-xl bg-gradient-to-br ${PREVIEW_GRADIENTS[trackIndex % PREVIEW_GRADIENTS.length]} ${
                      selectedImageId === image.id ? "border-lime-300" : "border-white/45"
                    }`}
                    style={{
                      left: `${image.x * 100}%`,
                      top: `${image.y * 100}%`,
                      width: `${image.width * 100}%`,
                      height: `${image.height * 100}%`,
                      zIndex: (draft.zone === "front" ? 30 : 10) + trackIndex,
                    }}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_25%,rgba(255,255,255,0.55),transparent_24%)]" />
                    <span className="absolute bottom-2 right-2 rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold">V{trackIndex + 2}</span>
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
            </div>
            <div className="space-y-1">
              <input
                type="range"
                min={0}
                max={endMs}
                step={50}
                value={Math.min(previewMs, endMs)}
                onChange={event => setPreviewMs(Number(event.target.value))}
                className="w-full accent-lime-300"
                data-testid="attention-preview-scrub"
              />
              <p className="text-center text-[11px] text-white/50">
                {(previewMs / 1000).toFixed(2)}s / {(endMs / 1000).toFixed(2)}s · {activeImages.length} image{activeImages.length === 1 ? "" : "s"} on screen
              </p>
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

function PercentField({ label, value, min = 0, onChange }: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label} %
      <Input
        type="number"
        className="h-8 text-xs"
        value={Math.round(value * 100)}
        min={min}
        max={100}
        step={1}
        onChange={event => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(100, Math.max(min, next)) / 100);
        }}
      />
    </label>
  );
}

function MsField({ label, value, min = 0, onChange }: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <Input
        type="number"
        className="h-8 text-xs"
        value={value}
        min={min}
        max={600000}
        step={100}
        onChange={event => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.max(min, Math.round(next)));
        }}
      />
    </label>
  );
}
