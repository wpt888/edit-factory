"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ChevronDown, ChevronRight, CopyPlus, Film, ImagePlus,
  Layers3, Library, Loader2, Maximize2, Minus, Pause, Play, Plus,
  Save, Settings2, ShieldCheck, Trash2, Upload,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { EditorHeader } from "@/components/editor-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MultiTrackTimeline,
  TIMELINE_MAX_ZOOM,
  TIMELINE_MIN_ZOOM,
} from "@/components/timeline/multi-track-timeline";
import { TimelineClipShell } from "@/components/timeline/timeline-primitives";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { AttentionAnimationPreset } from "@/types/attention-timeline";
import {
  DEFAULT_ATTENTION_TEMPLATE, newTemplateImage, normalizeAttentionTemplate,
  templateEndMs, type AttentionTemplate, type AttentionTemplateImage,
  type AttentionTemplatePayload,
} from "@/types/attention-template";

const ANIMATIONS: AttentionAnimationPreset[] = ["static", "pop", "zoom", "slide", "spin", "tornado"];
const TIMELINE_CHUNK_MS = 10_000;
const INITIAL_TIMELINE_MS = 60_000;
const CANVAS_PRESETS = [
  { label: "Vertical 9:16", width: 1080, height: 1920 },
  { label: "Landscape 16:9", width: 1920, height: 1080 },
  { label: "Square 1:1", width: 1080, height: 1080 },
  { label: "Portrait 4:5", width: 1080, height: 1350 },
  { label: "Portrait 3:4", width: 1080, height: 1440 },
  { label: "Landscape 4:3", width: 1440, height: 1080 },
] as const;

export default function AttentionTemplatesPage() {
  const [templates, setTemplates] = useState<AttentionTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("new");
  const [draft, setDraft] = useState<AttentionTemplatePayload>({ ...DEFAULT_ATTENTION_TEMPLATE, tracks: [[]] });
  const [selectedImageId, setSelectedImageId] = useState("");
  const [previewMs, setPreviewMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [timelineRangeMs, setTimelineRangeMs] = useState(INITIAL_TIMELINE_MS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const videoInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const previewMsRef = useRef(0);

  const selectedTemplate = templates.find(template => template.id === selectedId);
  const selectedImage = draft.tracks.flat().find(image => image.id === selectedImageId);
  const isNew = selectedId === "new";
  const isSystem = Boolean(selectedTemplate?.is_system);
  const editable = isNew || Boolean(selectedTemplate && !selectedTemplate.is_system);
  const endMs = Math.max(timelineRangeMs, timelineRangeForContent(templateEndMs(draft.tracks)));
  const slotCount = draft.tracks.reduce((sum, track) => sum + track.length, 0);
  const canvasLabel = formatCanvasLabel(draft.canvasWidth, draft.canvasHeight);
  const canvasPreset = CANVAS_PRESETS.find(option => option.width === draft.canvasWidth && option.height === draft.canvasHeight);
  const activeImages = useMemo(() => draft.tracks.flatMap((track, trackIndex) =>
    track.filter(image => previewMs >= image.startMs && previewMs < image.startMs + image.durationMs)
      .map(image => ({ image, trackIndex }))), [draft.tracks, previewMs]);
  const previewImages = useMemo(() => draft.tracks.flatMap((track, trackIndex) =>
    track.map(image => ({
      image,
      trackIndex,
      active: previewMs >= image.startMs && previewMs < image.startMs + image.durationMs,
    }))), [draft.tracks, previewMs]);

  const selectTemplate = useCallback((template: AttentionTemplate) => {
    setSelectedId(template.id);
    const normalized = normalizeAttentionTemplate(template);
    setDraft(normalized);
    setSelectedImageId("");
    setPreviewMs(0);
    setTimelineRangeMs(timelineRangeForContent(templateEndMs(normalized.tracks)));
    setLibraryOpen(false);
  }, []);

  const loadTemplates = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const response = await apiGet("/attention-templates", { cache: "no-store" });
      const data = (await response.json()) as { templates?: AttentionTemplate[] };
      const next = data.templates ?? [];
      setTemplates(next);
      const preferred = next.find(template => template.id === preferredId);
      if (preferred) selectTemplate(preferred);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load attention templates");
    } finally { setLoading(false); }
  }, [selectTemplate]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTemplates(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTemplates]);
  useEffect(() => {
    previewMsRef.current = previewMs;
  }, [previewMs]);
  useEffect(() => {
    if (!playing) return;
    const started = performance.now() - previewMsRef.current;
    let frame = 0;
    const tick = (now: number) => {
      const next = now - started;
      if (next >= endMs) { setPreviewMs(0); setPlaying(false); return; }
      setPreviewMs(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, endMs]);
  useEffect(() => {
    const clearSelection = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedImageId("");
    };
    window.addEventListener("keydown", clearSelection);
    return () => window.removeEventListener("keydown", clearSelection);
  }, []);

  const beginCreate = () => {
    setSelectedId("new");
    setDraft({ ...DEFAULT_ATTENTION_TEMPLATE, name: "My attention template", tracks: [[]] });
    setSelectedImageId(""); setPreviewMs(0); setTimelineRangeMs(INITIAL_TIMELINE_MS); setLibraryOpen(false);
  };
  const setTracks = (tracks: AttentionTemplateImage[][]) => setDraft(current => ({ ...current, tracks }));
  const updateImage = (id: string, patch: Partial<AttentionTemplateImage>) =>
    setTracks(draft.tracks.map(track => track.map(image => image.id === id ? { ...image, ...patch } : image)));
  const removeImage = (id: string) => {
    setTracks(draft.tracks.map(track => track.filter(image => image.id !== id)));
    if (selectedImageId === id) setSelectedImageId("");
  };
  const addSlot = (trackIndex: number) => {
    const image = newTemplateImage({ startMs: Math.round(previewMs / 100) * 100 });
    setTracks(draft.tracks.map((track, index) => index === trackIndex ? [...track, image] : track));
    setSelectedImageId(image.id);
  };
  const addTrack = () => setTracks([...draft.tracks, []]);
  const removeTrack = (trackIndex: number) => {
    if (draft.tracks.length <= 1) return;
    setTracks(draft.tracks.filter((_, index) => index !== trackIndex));
  };

  const saveTemplate = async () => {
    if (!editable || !draft.name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...draft, name: draft.name.trim() };
      const response = isNew ? await apiPost("/attention-templates", payload) : await apiPut(`/attention-templates/${selectedId}`, payload);
      const saved = (await response.json()) as AttentionTemplate;
      await loadTemplates(saved.id);
      toast.success(isNew ? "Personal template created" : "Template saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save template"); }
    finally { setSaving(false); }
  };
  const deleteTemplate = async () => {
    if (!selectedTemplate || selectedTemplate.is_system) return;
    setDeleting(true);
    try {
      await apiDelete(`/attention-templates/${selectedTemplate.id}`);
      setDeleteOpen(false); beginCreate(); await loadTemplates(); toast.success("Personal template deleted");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete template"); }
    finally { setDeleting(false); }
  };

  const beginCanvasInteraction = (
    event: React.PointerEvent,
    image: AttentionTemplateImage,
    mode: "move" | "nw" | "ne" | "sw" | "se",
  ) => {
    if (!editable || !previewCanvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedImageId(image.id);
    const canvas = previewCanvasRef.current.getBoundingClientRect();
    const originX = image.x * canvas.width;
    const originY = image.y * canvas.height;
    const originW = image.width * canvas.width;
    const originH = image.height * canvas.height;
    const pointerX = event.clientX;
    const pointerY = event.clientY;
    const isLeft = mode === "nw" || mode === "sw";
    const isTop = mode === "nw" || mode === "ne";
    const anchorX = isLeft ? originX + originW : originX;
    const anchorY = isTop ? originY + originH : originY;
    const cornerX = isLeft ? originX : originX + originW;
    const cornerY = isTop ? originY : originY + originH;
    const vectorX = cornerX - anchorX;
    const vectorY = cornerY - anchorY;
    const vectorLengthSquared = vectorX ** 2 + vectorY ** 2;

    const move = (moveEvent: PointerEvent) => {
      if (mode === "move") {
        const x = clamp(originX + moveEvent.clientX - pointerX, 0, canvas.width - originW);
        const y = clamp(originY + moveEvent.clientY - pointerY, 0, canvas.height - originH);
        updateImage(image.id, { x: x / canvas.width, y: y / canvas.height });
        return;
      }
      const relativeX = moveEvent.clientX - canvas.left - anchorX;
      const relativeY = moveEvent.clientY - canvas.top - anchorY;
      const projectedScale = (relativeX * vectorX + relativeY * vectorY) / vectorLengthSquared;
      const minScale = Math.max(24 / originW, 24 / originH);
      const horizontalRoom = isLeft ? anchorX / originW : (canvas.width - anchorX) / originW;
      const verticalRoom = isTop ? anchorY / originH : (canvas.height - anchorY) / originH;
      const scale = clamp(projectedScale, minScale, Math.min(horizontalRoom, verticalRoom));
      const width = originW * scale;
      const height = originH * scale;
      updateImage(image.id, {
        x: (isLeft ? anchorX - width : anchorX) / canvas.width,
        y: (isTop ? anchorY - height : anchorY) / canvas.height,
        width: width / canvas.width,
        height: height / canvas.height,
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[680px] flex-col overflow-hidden bg-background" data-testid="attention-template-editor">
      <EditorHeader
        className="relative z-50"
        icon={<Layers3 className="size-4 text-primary" />}
        title="Attention Templates"
        breadcrumb={draft.name}
        subtitle="Template editor"
        actions={<>
          <Button variant="ghost" size="sm" onClick={() => setLibraryOpen(value => !value)}><Library className="mr-2 size-4" />Template Library</Button>
          <Button variant="ghost" size="sm" onClick={beginCreate}><CopyPlus className="mr-2 size-4" />New template</Button>
          <Button variant="outline" size="sm" asChild><Link href="/pipeline"><ArrowLeft className="mr-2 size-4" />Back to Step 3</Link></Button>
          <Button size="sm" disabled={!editable || saving || !draft.name.trim() || slotCount === 0} onClick={() => void saveTemplate()}><Save className="mr-2 size-4" />{saving ? "Saving..." : "Save template"}</Button>
        </>}
      >
        {libraryOpen && <TemplateLibrary templates={templates} selectedId={selectedId} loading={loading} onSelect={selectTemplate} onCreate={beginCreate} />}
      </EditorHeader>

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-px bg-border">
        <aside className="min-h-0 overflow-y-auto bg-card" data-testid="attention-template-inspector">
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Template settings</p><p className="mt-0.5 text-[11px] text-muted-foreground">Reusable layout and timing</p></div>{isSystem && <Badge variant="outline" className="border-primary/30 text-primary"><ShieldCheck className="mr-1 size-3" />System</Badge>}</div>
          </div>
          <fieldset disabled={!editable || saving} className="disabled:opacity-55">
            <InspectorSection title="Template" open>
              <Field label="Name"><Input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} className="h-9" /></Field>
              <Field label="Subtitle layer"><select value={draft.zone} onChange={event => setDraft(current => ({ ...current, zone: event.target.value as AttentionTemplatePayload["zone"] }))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="behind">Captions over images</option><option value="front">Images over captions</option></select></Field>
              <Field label="Animation"><select value={draft.animation} onChange={event => setDraft(current => ({ ...current, animation: event.target.value as AttentionAnimationPreset }))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm capitalize">{ANIMATIONS.map(animation => <option key={animation}>{animation}</option>)}</select></Field>
              <NumberField label="Variant start gap" value={draft.variantGapMs / 1000} unit="s" step={.1} onChange={value => setDraft(current => ({ ...current, variantGapMs: clamp(Math.round(value * 1000), 0, 30000) }))} />
              <p className="text-[10px] leading-relaxed text-muted-foreground">Variant 1 uses the authored timing. Each following variant starts another {formatGap(draft.variantGapMs)} later.</p>
            </InspectorSection>
            <InspectorSection title="Image slot" value={selectedImage ? "Selected" : "No selection"} open>
              {selectedImage ? <>
                <div className="grid grid-cols-2 gap-2"><NumberField label="Position X" value={selectedImage.x * 100} unit="%" onChange={value => updateImage(selectedImage.id, { x: clamp(value / 100, 0, 1) })} /><NumberField label="Position Y" value={selectedImage.y * 100} unit="%" onChange={value => updateImage(selectedImage.id, { y: clamp(value / 100, 0, 1) })} /><NumberField label="Width" value={selectedImage.width * 100} unit="%" onChange={value => updateImage(selectedImage.id, { width: clamp(value / 100, .01, 1) })} /><NumberField label="Height" value={selectedImage.height * 100} unit="%" onChange={value => updateImage(selectedImage.id, { height: clamp(value / 100, .01, 1) })} /></div>
                <Field label="Media fit"><select value={selectedImage.fit} onChange={event => updateImage(selectedImage.id, { fit: event.target.value as AttentionTemplateImage["fit"] })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="contain">Contain · show the whole image</option><option value="cover">Cover · fill and crop</option></select></Field>
                <p className="text-[10px] leading-relaxed text-muted-foreground">The pipeline supplies the real image. Contain safely handles portrait and landscape media; Cover fills the slot and may crop it.</p>
                <Field label={`Opacity · ${Math.round(selectedImage.opacity * 100)}%`}><input type="range" min="0" max="100" value={selectedImage.opacity * 100} onChange={event => updateImage(selectedImage.id, { opacity: Number(event.target.value) / 100 })} className="w-full accent-primary" /></Field>
                <div className="grid grid-cols-2 gap-2"><NumberField label="Start" value={selectedImage.startMs / 1000} unit="s" step={.1} onChange={value => { const ms = Math.max(0, Math.round(value * 1000)); updateImage(selectedImage.id, { startMs: ms }); setPreviewMs(ms); }} /><NumberField label="Duration" value={selectedImage.durationMs / 1000} unit="s" step={.1} onChange={value => updateImage(selectedImage.id, { durationMs: Math.max(100, Math.round(value * 1000)) })} /></div>
                <Button type="button" variant="outline" size="sm" className="w-full border-destructive/30 text-destructive" onClick={() => removeImage(selectedImage.id)}><Trash2 className="mr-2 size-3.5" />Remove slot</Button>
              </> : <div className="rounded border border-dashed border-border p-5 text-center text-xs text-muted-foreground/70">Add or select a slot on the timeline to edit its layout and timing.</div>}
            </InspectorSection>
            <InspectorSection title="Canvas" value={canvasLabel} open>
              <Field label="Video format">
                <select
                  value={canvasPreset ? `${canvasPreset.width}x${canvasPreset.height}` : "custom"}
                  onChange={event => {
                    const preset = CANVAS_PRESETS.find(option => `${option.width}x${option.height}` === event.target.value);
                    if (preset) setDraft(current => ({ ...current, canvasWidth: preset.width, canvasHeight: preset.height }));
                  }}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  data-testid="attention-canvas-preset"
                >
                  {CANVAS_PRESETS.map(option => <option key={`${option.width}x${option.height}`} value={`${option.width}x${option.height}`}>{option.label} · {option.width}×{option.height}</option>)}
                  <option value="custom">Custom dimensions</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Width" value={draft.canvasWidth} unit="px" onChange={value => setDraft(current => ({ ...current, canvasWidth: clampCanvasDimension(value) }))} />
                <NumberField label="Height" value={draft.canvasHeight} unit="px" onChange={value => setDraft(current => ({ ...current, canvasHeight: clampCanvasDimension(value) }))} />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">The monitor uses a neutral canvas until you load a reference video. Reference media is only for preview and is not saved in the template.</p>
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => videoInputRef.current?.click()}><Upload className="mr-2 size-3.5" />Load reference video</Button>
            </InspectorSection>
          </fieldset>
          {!isNew && !isSystem && <div className="p-4"><Button variant="ghost" size="sm" className="w-full text-destructive hover:bg-destructive/10" onClick={() => setDeleteOpen(true)}><Trash2 className="mr-2 size-4" />Delete personal template</Button></div>}
        </aside>

        <main className="grid min-h-0 grid-rows-[minmax(300px,1fr)_300px] bg-card">
          <section className="flex min-h-0 flex-col border-b border-border" aria-label="Program monitor">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4"><p className="flex items-center gap-2 text-xs font-semibold"><Film className="size-3.5" />Program monitor</p><div className="flex items-center gap-1"><span className="rounded bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">{canvasLabel} · {(previewMs / 1000).toFixed(2)}s</span><Button variant="ghost" size="icon" className="size-7 text-muted-foreground"><Maximize2 className="size-3.5" /></Button></div></div>
            {/* Program-monitor video stage stays dark in both themes — a preview canvas is theme-independent, like any video player. */}
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#060706] p-4" style={{ containerType: "size" }}>
              <div ref={previewCanvasRef} className="relative overflow-hidden border border-white/15 bg-[#171a17] shadow-2xl" style={{ aspectRatio: `${draft.canvasWidth} / ${draft.canvasHeight}`, width: `min(100cqw, calc(100cqh * ${draft.canvasWidth / draft.canvasHeight}))`, height: `min(100cqh, calc(100cqw * ${draft.canvasHeight / draft.canvasWidth}))` }} data-testid="attention-template-preview" onPointerDown={event => { if (event.target === event.currentTarget || !(event.target as HTMLElement).closest("[data-preview-image]")) setSelectedImageId(""); }}>
                {videoUrl ? <video src={videoUrl} muted loop autoPlay className="pointer-events-none absolute inset-0 size-full object-cover" /> : <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(45deg,#171a17_25%,#121412_25%,#121412_50%,#171a17_50%,#171a17_75%,#121412_75%)] bg-[length:18px_18px]"><div className="absolute inset-0 flex flex-col items-center justify-center text-white/25"><Film className="mb-2 size-7" /><span className="text-[10px] uppercase tracking-[.18em]">Reference video</span></div></div>}
                {previewImages.map(({ image, trackIndex, active }) => <div key={image.id} data-preview-image data-active={active ? "true" : "false"} className={`group absolute cursor-move touch-none ${selectedImageId === image.id ? "z-50" : ""}`} style={{ left: `${image.x * 100}%`, top: `${image.y * 100}%`, width: `${image.width * 100}%`, height: `${image.height * 100}%`, zIndex: selectedImageId === image.id ? 70 : (active ? (draft.zone === "front" ? 40 : 10) : 2) + trackIndex }} onPointerDown={event => beginCanvasInteraction(event, image, "move")}><div className={`absolute inset-0 overflow-hidden ${active ? "bg-[#252b25] shadow-xl" : "border border-dashed border-white/25 bg-transparent"} ${selectedImageId === image.id ? "ring-2 ring-primary" : active ? "ring-1 ring-white/35 group-hover:ring-primary/80" : "group-hover:border-primary/70"}`} style={{ opacity: active ? image.opacity : selectedImageId === image.id ? .45 : .18 }}>{active ? <div className="flex size-full flex-col items-center justify-center gap-1 bg-[linear-gradient(135deg,#333a33,#1b201b)] text-white/35"><ImagePlus className="size-7" /><span className="text-[9px] font-medium uppercase tracking-wider">Pipeline image slot</span><span className="absolute bottom-2 right-2 bg-black/60 px-1.5 py-0.5 text-[9px]">V{trackIndex + 2} · {image.fit}</span></div> : <span className="absolute left-1 top-1 rounded bg-black/65 px-1 py-0.5 text-[8px] text-white/70">V{trackIndex + 2} · inactive</span>}</div>{(["nw", "ne", "sw", "se"] as const).map(corner => <button key={corner} type="button" aria-label={`Resize image slot from ${corner} corner`} className={`absolute size-3 rounded-full border-2 border-[#0b0d0b] bg-primary shadow transition-opacity ${selectedImageId === image.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"} ${corner === "nw" ? "-left-1.5 -top-1.5 cursor-nwse-resize" : corner === "ne" ? "-right-1.5 -top-1.5 cursor-nesw-resize" : corner === "sw" ? "-bottom-1.5 -left-1.5 cursor-nesw-resize" : "-bottom-1.5 -right-1.5 cursor-nwse-resize"}`} onPointerDown={event => beginCanvasInteraction(event, image, corner)} />)}</div>)}
                {slotCount > 0 && activeImages.length === 0 && <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[90] rounded bg-black/70 px-2 py-1.5 text-center text-[9px] text-white/65">No slots active at {(previewMs / 1000).toFixed(2)}s · inactive positions are outlined</div>}
              </div>
            </div>
            <div className="flex h-10 shrink-0 items-center justify-center gap-2 border-t border-border bg-card"><Button variant="ghost" size="icon" className="size-7" onClick={() => setPreviewMs(0)}><ArrowLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8 rounded-full" onClick={() => setPlaying(value => !value)}>{playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}</Button><span className="w-24 font-mono text-[10px] text-muted-foreground">{formatMs(previewMs)} / {formatMs(endMs)}</span></div>
          </section>

          <Timeline tracks={draft.tracks} endMs={endMs} previewMs={previewMs} zoom={zoom} selectedImageId={selectedImageId} editable={editable} onSeek={setPreviewMs} onSelect={id => setSelectedImageId(id)} onDeselect={() => setSelectedImageId("")} onAddSlot={addSlot} onAddTrack={addTrack} onRemoveTrack={removeTrack} onZoom={setZoom} onUpdateImage={updateImage} onNeedMoreTime={() => setTimelineRangeMs(current => Math.max(current, endMs) + TIMELINE_CHUNK_MS)} />
        </main>
      </div>

      <input ref={videoInputRef} className="hidden" type="file" accept="video/*" onChange={event => { const file = event.target.files?.[0]; if (file) setVideoUrl(URL.createObjectURL(file)); }} />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete personal attention template?" description={`This removes “${selectedTemplate?.name ?? "this template"}” from your profile. Existing timelines keep their applied images.`} confirmLabel="Delete template" variant="destructive" loading={deleting} onConfirm={() => void deleteTemplate()} />
    </div>
  );
}

function TemplateLibrary({ templates, selectedId, loading, onSelect, onCreate }: { templates: AttentionTemplate[]; selectedId: string; loading: boolean; onSelect: (template: AttentionTemplate) => void; onCreate: () => void }) {
  return <div className="absolute right-4 top-12 z-[80] w-80 rounded-lg border border-border bg-card p-2 shadow-2xl"><div className="flex items-center justify-between px-2 py-2"><div><p className="text-sm font-semibold">Template Library</p><p className="text-[10px] text-muted-foreground">Choose a reusable layout</p></div><Button size="icon" className="size-7" onClick={onCreate}><Plus className="size-4" /></Button></div><div className="max-h-80 space-y-1 overflow-y-auto">{loading ? <div className="flex justify-center p-8"><Loader2 className="size-5 animate-spin text-primary" /></div> : templates.length === 0 ? <p className="p-8 text-center text-xs text-muted-foreground">No saved templates yet.</p> : templates.map(template => { const config = normalizeAttentionTemplate(template); const count = config.tracks.flat().length; return <button key={template.id} onClick={() => onSelect(template)} className={`flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left ${selectedId === template.id ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-accent"}`}><div className="min-w-0"><p className="truncate text-xs font-medium">{template.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{config.tracks.length} video tracks · {count} slots</p></div>{template.is_system && <ShieldCheck className="size-3.5 text-primary" />}</button>; })}</div></div>;
}

function Timeline({ tracks, endMs, previewMs, zoom, selectedImageId, editable, onSeek, onSelect, onDeselect, onAddSlot, onAddTrack, onRemoveTrack, onZoom, onUpdateImage, onNeedMoreTime }: { tracks: AttentionTemplateImage[][]; endMs: number; previewMs: number; zoom: number; selectedImageId: string; editable: boolean; onSeek: (ms: number) => void; onSelect: (id: string) => void; onDeselect: () => void; onAddSlot: (track: number) => void; onAddTrack: () => void; onRemoveTrack: (track: number) => void; onZoom: (zoom: number) => void; onUpdateImage: (id: string, patch: Partial<AttentionTemplateImage>) => void; onNeedMoreTime: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const laneWidth = Math.round(endMs / 1000 * 100 * zoom);
  const secondWidth = laneWidth / (endMs / 1000);

  const seek = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("[data-timeline-block]")) return;
    onDeselect();
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(clamp((event.clientX - rect.left) / rect.width, 0, 1) * endMs);
  };
  const extendNearEdge = () => {
    const scroller = scrollRef.current;
    if (scroller && scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 500) onNeedMoreTime();
  };
  const beginDrag = (event: React.PointerEvent, image: AttentionTemplateImage, mode: "move" | "start" | "end") => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(image.id);
    const originX = event.clientX;
    const originStart = image.startMs;
    const originDuration = image.durationMs;
    const move = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - originX) / laneWidth * endMs;
      if (mode === "move") onUpdateImage(image.id, { startMs: Math.max(0, Math.round((originStart + delta) / 50) * 50) });
      if (mode === "start") {
        const start = clamp(Math.round((originStart + delta) / 50) * 50, 0, originStart + originDuration - 100);
        onUpdateImage(image.id, { startMs: start, durationMs: originDuration + originStart - start });
      }
      if (mode === "end") onUpdateImage(image.id, { durationMs: Math.max(100, Math.round((originDuration + delta) / 50) * 50) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const playhead = (
    <span
      className="pointer-events-none absolute inset-y-0 z-30 w-px bg-rose-400"
      style={{ left: `${clamp(previewMs / endMs, 0, 1) * 100}%` }}
    />
  );

  return (
    <section className="flex min-h-0 flex-col bg-card" data-testid="attention-track-list">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Settings2 className="size-3.5 text-primary" />
          <span className="text-xs font-semibold">Timeline</span>
          <span className="text-[10px] text-muted-foreground">Add slots, then drag or trim them · scroll right for more time</span>
        </div>
        <Button disabled={!editable} variant="ghost" size="sm" className="h-7 text-primary" onClick={onAddTrack}>
          <Plus className="mr-1 size-3.5" />Add track
        </Button>
      </div>
      <MultiTrackTimeline
        scrollRef={scrollRef}
        className="min-h-0 flex-1"
        containerProps={{
          "data-testid": "attention-timeline-scroll",
          onScroll: extendNearEdge,
        }}
        laneWidth={laneWidth}
        ruler={{
          duration: endMs / 1000,
          currentTime: previewMs / 1000,
          className: "cursor-ew-resize",
          onPointerDown: seek,
        }}
        zoom={zoom}
        minZoom={TIMELINE_MIN_ZOOM}
        maxZoom={TIMELINE_MAX_ZOOM}
        onZoomChange={onZoom}
        onFit={() => {
          onZoom(1);
          if (scrollRef.current) scrollRef.current.scrollLeft = 0;
        }}
        lanes={tracks.map((images, trackIndex) => ({
          label: `V${trackIndex + 2}`,
          description: `Attention image track ${trackIndex + 1}`,
          height: "h-12",
          action: (
            <div className="flex">
              <Button disabled={!editable} variant="ghost" size="icon" className="size-6 text-primary" onClick={() => onAddSlot(trackIndex)} title="Add image slot" aria-label={`Add image slot to V${trackIndex + 2}`}>
                <Plus className="size-3.5" />
              </Button>
              {tracks.length > 1 && (
                <Button disabled={!editable} variant="ghost" size="icon" className="size-6 text-muted-foreground/50 hover:text-destructive" onClick={() => onRemoveTrack(trackIndex)} title="Remove track" aria-label={`Remove V${trackIndex + 2}`}>
                  <Minus className="size-3" />
                </Button>
              )}
            </div>
          ),
          axisClassName: "cursor-ew-resize bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)]",
          axisProps: {
            style: { backgroundSize: `${secondWidth}px 100%` },
            onPointerDown: seek,
          },
          showEndLine: true,
          content: (
            <>
              {images.map((image, index) => (
                <TimelineClipShell
                  key={image.id}
                  testId={`attention-slot-${image.id}`}
                  className={`flex cursor-grab select-none items-center text-[10px] ${selectedImageId === image.id ? "border-primary bg-primary/25 ring-1 ring-primary/30" : ""}`}
                  style={{ left: `${image.startMs / endMs * 100}%`, width: `${Math.max(.3, image.durationMs / endMs * 100)}%` }}
                  onPointerDown={event => beginDrag(event, image, "move")}
                  onClick={() => { onSelect(image.id); onSeek(image.startMs); }}
                  title={`Slot ${index + 1}`}
                >
                  <span className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize border-r border-primary/50 bg-primary/25 opacity-80 hover:bg-primary/70" onPointerDown={event => beginDrag(event, image, "start")} />
                  <ImagePlus className="ml-3 mr-1 size-3 shrink-0" />
                  <span className="truncate">Slot {index + 1}</span>
                  <span className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize border-l border-primary/50 bg-primary/25 opacity-80 hover:bg-primary/70" onPointerDown={event => beginDrag(event, image, "end")} />
                </TimelineClipShell>
              ))}
              {playhead}
            </>
          ),
        }))}
      />
    </section>
  );
}

function InspectorSection({ title, value, open = false, children }: { title: string; value?: string; open?: boolean; children: React.ReactNode }) { const [expanded, setExpanded] = useState(open); return <section className="border-b border-border"><button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setExpanded(value => !value)}><span className="text-sm font-medium">{title}</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{value}{expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</span></button>{expanded && <div className="space-y-3 px-4 pb-4">{children}</div>}</section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1.5"><Label className="text-[11px] text-muted-foreground">{label}</Label>{children}</label>; }
function NumberField({ label, value, unit, step = 1, onChange }: { label: string; value: number; unit: string; step?: number; onChange: (value: number) => void }) { return <Field label={label}><div className="relative"><Input type="number" value={Number(value.toFixed(2))} step={step} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} className="h-8 pr-7 text-xs" /><span className="absolute right-2 top-2 text-[10px] text-muted-foreground/70">{unit}</span></div></Field>; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function formatMs(ms: number) { const seconds = Math.max(0, ms) / 1000; return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`; }
function formatGap(ms: number) { return `${Number((ms / 1000).toFixed(1))}s`; }
function clampCanvasDimension(value: number) { return Math.round(Math.min(8192, Math.max(64, value)) / 2) * 2; }
function formatCanvasLabel(width: number, height: number) {
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor} · ${width}×${height}`;
}
function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.max(1, Math.round(Math.abs(a)));
  let right = Math.max(1, Math.round(Math.abs(b)));
  while (right) [left, right] = [right, left % right];
  return left;
}
function timelineRangeForContent(contentEndMs: number) { return Math.max(INITIAL_TIMELINE_MS, Math.ceil((contentEndMs + TIMELINE_CHUNK_MS) / TIMELINE_CHUNK_MS) * TIMELINE_CHUNK_MS); }
