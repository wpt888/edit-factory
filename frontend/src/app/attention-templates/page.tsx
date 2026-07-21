"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, CopyPlus, Film, ImagePlus, Layers3, Library, Loader2,
  Maximize2, Music, Pause, Play, Plus, Save, ShieldCheck, Trash2,
  Upload, Volume2, Waves,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { MusicAssetPickerDialog } from "@/components/dialogs/music-asset-picker-dialog";
import { EditorHeader } from "@/components/editor-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InspectorField, InspectorSection } from "@/components/ui/inspector";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MultiTrackTimeline,
  TIMELINE_END_GUTTER,
  TIMELINE_LABEL_WIDTH,
  TIMELINE_MAX_ZOOM,
  TIMELINE_MIN_WIDTH,
  TIMELINE_MIN_ZOOM,
} from "@/components/timeline/multi-track-timeline";
import { TimelineClipShell, TimelineWaveform } from "@/components/timeline/timeline-primitives";
import { TimelineTrackControls } from "@/components/timeline/timeline-track-controls";
import { apiDelete, apiGetWithRetry, apiPost, apiPut } from "@/lib/api";
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
  const [audioPickerTarget, setAudioPickerTarget] = useState<{ imageId: string; track: number } | null>(null);
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
      const response = await apiGetWithRetry("/attention-templates", { cache: "no-store" });
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
  const addVideoTrack = () => {
    if (draft.tracks.length >= 10) return;
    setTracks([...draft.tracks, []]);
  };
  const removeVideoTrack = (trackIndex: number) => {
    if (
      draft.tracks.length <= 1
      || trackIndex !== draft.tracks.length - 1
      || draft.tracks[trackIndex]?.length > 0
    ) return;
    const removedIds = new Set(draft.tracks[trackIndex]?.map(image => image.id));
    setTracks(draft.tracks.filter((_, index) => index !== trackIndex));
    if (removedIds.has(selectedImageId)) setSelectedImageId("");
  };
  const addAudioTrack = () => setDraft(current => ({
    ...current,
    audioTrackCount: Math.min(10, current.audioTrackCount + 1),
  }));
  const removeAudioTrack = (trackIndex: number) => setDraft(current => {
    if (current.audioTrackCount <= 1 || trackIndex !== current.audioTrackCount) return current;
    if (current.tracks.flat().some(image => image.sfxTrack === trackIndex)) return current;
    return { ...current, audioTrackCount: current.audioTrackCount - 1 };
  });
  const chooseSoundEffect = (imageId: string, track: number) => {
    updateImage(imageId, { sfxTrack: track });
    setSelectedImageId(imageId);
    setAudioPickerTarget({ imageId, track });
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

      <div className="grid min-h-0 flex-1 grid-cols-[clamp(280px,22vw,320px)_minmax(0,1fr)] gap-px bg-border">
        <aside className="min-h-0 min-w-0 overflow-y-auto bg-card" data-testid="attention-template-inspector">
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Template settings</p><p className="mt-0.5 text-[11px] text-muted-foreground">Reusable layout and timing</p></div>{isSystem && <Badge variant="outline" className="border-primary/30 text-primary"><ShieldCheck className="mr-1 size-3" />System</Badge>}</div>
          </div>
          <fieldset disabled={!editable || saving} className="min-w-0 divide-y divide-border/70 disabled:opacity-55">
            <InspectorSection title="Template" defaultOpen>
              <Field label="Name"><Input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} className="h-8 px-2 text-xs" /></Field>
              <Field label="Subtitle layer"><Select value={draft.zone} onValueChange={value => setDraft(current => ({ ...current, zone: value as AttentionTemplatePayload["zone"] }))}><SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="behind">Captions over images</SelectItem><SelectItem value="front">Images over captions</SelectItem></SelectContent></Select></Field>
              <Field label="Animation"><Select value={draft.animation} onValueChange={value => setDraft(current => ({ ...current, animation: value as AttentionAnimationPreset }))}><SelectTrigger size="sm" className="w-full text-xs capitalize"><SelectValue /></SelectTrigger><SelectContent>{ANIMATIONS.map(animation => <SelectItem key={animation} value={animation} className="capitalize">{animation}</SelectItem>)}</SelectContent></Select></Field>
              <NumberField label="Variant start gap" value={draft.variantGapMs / 1000} unit="s" step={.1} onChange={value => setDraft(current => ({ ...current, variantGapMs: clamp(Math.round(value * 1000), 0, 30000) }))} />
              <p className="text-[11px] leading-relaxed text-muted-foreground">Variant 1 uses the authored timing. Each following variant starts another {formatGap(draft.variantGapMs)} later.</p>
            </InspectorSection>
            <InspectorSection title="Image slot" summary={selectedImage ? "Selected" : "No selection"} defaultOpen>
              {selectedImage ? <>
                <div className="grid grid-cols-2 gap-2"><NumberField label="Position X" value={selectedImage.x * 100} unit="%" onChange={value => updateImage(selectedImage.id, { x: clamp(value / 100, 0, 1) })} /><NumberField label="Position Y" value={selectedImage.y * 100} unit="%" onChange={value => updateImage(selectedImage.id, { y: clamp(value / 100, 0, 1) })} /><NumberField label="Width" value={selectedImage.width * 100} unit="%" onChange={value => updateImage(selectedImage.id, { width: clamp(value / 100, .01, 1) })} /><NumberField label="Height" value={selectedImage.height * 100} unit="%" onChange={value => updateImage(selectedImage.id, { height: clamp(value / 100, .01, 1) })} /></div>
                <Field label="Media fit"><Select value={selectedImage.fit} onValueChange={value => updateImage(selectedImage.id, { fit: value as AttentionTemplateImage["fit"] })}><SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contain">Contain · show the whole image</SelectItem><SelectItem value="cover">Cover · fill and crop</SelectItem></SelectContent></Select></Field>
                <p className="text-[11px] leading-relaxed text-muted-foreground">The pipeline supplies the real image. Contain safely handles portrait and landscape media; Cover fills the slot and may crop it.</p>
                <Field label={`Opacity · ${Math.round(selectedImage.opacity * 100)}%`}><Slider min={0} max={100} step={1} value={[Math.round(selectedImage.opacity * 100)]} onValueChange={([value]) => updateImage(selectedImage.id, { opacity: value / 100 })} /></Field>
                <div className="grid grid-cols-2 gap-2"><NumberField label="Start" value={selectedImage.startMs / 1000} unit="s" step={.1} onChange={value => { const ms = Math.max(0, Math.round(value * 1000)); updateImage(selectedImage.id, { startMs: ms }); setPreviewMs(ms); }} /><NumberField label="Duration" value={selectedImage.durationMs / 1000} unit="s" step={.1} onChange={value => updateImage(selectedImage.id, { durationMs: Math.max(100, Math.round(value * 1000)) })} /></div>
                <div className="border-t border-border/70 pt-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium"><Waves className="size-3.5 text-amber-300" />Optional sound effect</div>
                  <div className="space-y-3">
                    <Field label="Audio track">
                      <Select value={String(selectedImage.sfxTrack)} onValueChange={value => updateImage(selectedImage.id, { sfxTrack: Number(value) })}>
                        <SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{Array.from({ length: draft.audioTrackCount }, (_, index) => <SelectItem key={index + 1} value={String(index + 1)}>A{index + 1}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-8 flex-1 text-xs" onClick={() => chooseSoundEffect(selectedImage.id, selectedImage.sfxTrack)}><Music className="mr-1.5 size-3.5" />{selectedImage.sfxUrl || selectedImage.sfxAssetId ? "Change effect" : "Choose effect"}</Button>
                      {(selectedImage.sfxUrl || selectedImage.sfxAssetId) && <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={() => updateImage(selectedImage.id, { sfxUrl: undefined, sfxAssetId: undefined, sfxLabel: undefined })}>Clear</Button>}
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{selectedImage.sfxLabel || selectedImage.sfxUrl || selectedImage.sfxAssetId || "No sound effect assigned. Choose one to add it to the audio track."}</p>
                    <Field label={`Effect volume · ${selectedImage.sfxVolumeDb > 0 ? "+" : ""}${selectedImage.sfxVolumeDb.toFixed(0)} dB`}><Slider min={-60} max={12} step={1} value={[selectedImage.sfxVolumeDb]} onValueChange={([value]) => updateImage(selectedImage.id, { sfxVolumeDb: value })} /></Field>
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="w-full border-destructive/30 text-destructive" onClick={() => removeImage(selectedImage.id)}><Trash2 className="mr-2 size-3.5" />Remove slot</Button>
              </> : <p className="py-3 text-center text-[11px] text-muted-foreground">Add or select a slot on the timeline to edit its layout and timing.</p>}
            </InspectorSection>
            <InspectorSection title="Canvas" summary={canvasLabel} defaultOpen>
              <Field label="Video format">
                <Select
                  value={canvasPreset ? `${canvasPreset.width}x${canvasPreset.height}` : "custom"}
                  onValueChange={value => {
                    const preset = CANVAS_PRESETS.find(option => `${option.width}x${option.height}` === value);
                    if (preset) setDraft(current => ({ ...current, canvasWidth: preset.width, canvasHeight: preset.height }));
                  }}
                >
                  <SelectTrigger size="sm" className="w-full text-xs" data-testid="attention-canvas-preset"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CANVAS_PRESETS.map(option => <SelectItem key={`${option.width}x${option.height}`} value={`${option.width}x${option.height}`}>{option.label} · {option.width}×{option.height}</SelectItem>)}
                    <SelectItem value="custom">Custom dimensions</SelectItem>
                  </SelectContent>
                </Select>
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

        <main className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(300px,1fr)_300px] bg-card">
          <section className="flex min-h-0 flex-col border-b border-border" aria-label="Program monitor">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4"><p className="flex items-center gap-2 text-xs font-semibold"><Film className="size-3.5" />Program monitor</p><div className="flex items-center gap-1"><span className="rounded bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">{canvasLabel} · {(previewMs / 1000).toFixed(2)}s</span><Button variant="ghost" size="icon" className="size-7 text-muted-foreground"><Maximize2 className="size-3.5" /></Button></div></div>
            {/* Program-monitor video stage stays dark in both themes — a preview canvas is theme-independent, like any video player. */}
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#060706] p-4" style={{ containerType: "size" }}>
              <div ref={previewCanvasRef} className="relative isolate overflow-hidden border border-white/15 bg-[#171a17] shadow-2xl" style={{ aspectRatio: `${draft.canvasWidth} / ${draft.canvasHeight}`, width: `min(100cqw, calc(100cqh * ${draft.canvasWidth / draft.canvasHeight}))`, height: `min(100cqh, calc(100cqw * ${draft.canvasHeight / draft.canvasWidth}))` }} data-testid="attention-template-preview" onPointerDown={event => { if (event.target === event.currentTarget || !(event.target as HTMLElement).closest("[data-preview-image]")) setSelectedImageId(""); }}>
                {videoUrl ? <video src={videoUrl} muted loop autoPlay className="pointer-events-none absolute inset-0 size-full object-cover" /> : <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(45deg,#171a17_25%,#121412_25%,#121412_50%,#171a17_50%,#171a17_75%,#121412_75%)] bg-[length:18px_18px]"><div className="absolute inset-0 flex flex-col items-center justify-center text-white/25"><Film className="mb-2 size-7" /><span className="text-[10px] uppercase tracking-[.18em]">Reference video</span></div></div>}
                {previewImages.map(({ image, trackIndex, active }) => <div key={image.id} data-preview-image data-active={active ? "true" : "false"} className={`group absolute cursor-move touch-none ${selectedImageId === image.id ? "z-50" : ""}`} style={{ left: `${image.x * 100}%`, top: `${image.y * 100}%`, width: `${image.width * 100}%`, height: `${image.height * 100}%`, zIndex: selectedImageId === image.id ? 70 : (active ? (draft.zone === "front" ? 40 : 10) : 2) + trackIndex }} onPointerDown={event => beginCanvasInteraction(event, image, "move")}><div className={`absolute inset-0 overflow-hidden ${active ? "bg-[#252b25] shadow-xl" : "border border-dashed border-white/25 bg-transparent"} ${selectedImageId === image.id ? "ring-2 ring-primary" : active ? "ring-1 ring-white/35 group-hover:ring-primary/80" : "group-hover:border-primary/70"}`} style={{ opacity: active ? image.opacity : selectedImageId === image.id ? .45 : .18 }}>{active ? <div className="flex size-full flex-col items-center justify-center gap-1 bg-[linear-gradient(135deg,#333a33,#1b201b)] text-white/35"><ImagePlus className="size-7" /><span className="text-[9px] font-medium uppercase tracking-wider">Pipeline image slot</span><span className="absolute bottom-2 right-2 bg-black/60 px-1.5 py-0.5 text-[9px]">V{trackIndex + 2} · {image.fit}</span></div> : <span className="absolute left-1 top-1 rounded bg-black/65 px-1 py-0.5 text-[8px] text-white/70">V{trackIndex + 2} · inactive</span>}</div>{(["nw", "ne", "sw", "se"] as const).map(corner => <button key={corner} type="button" aria-label={`Resize image slot from ${corner} corner`} className={`absolute size-3 rounded-full border-2 border-[#0b0d0b] bg-primary shadow transition-opacity ${selectedImageId === image.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"} ${corner === "nw" ? "-left-1.5 -top-1.5 cursor-nwse-resize" : corner === "ne" ? "-right-1.5 -top-1.5 cursor-nesw-resize" : corner === "sw" ? "-bottom-1.5 -left-1.5 cursor-nesw-resize" : "-bottom-1.5 -right-1.5 cursor-nwse-resize"}`} onPointerDown={event => beginCanvasInteraction(event, image, corner)} />)}</div>)}
                {slotCount > 0 && activeImages.length === 0 && <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[90] rounded bg-black/70 px-2 py-1.5 text-center text-[9px] text-white/65">No slots active at {(previewMs / 1000).toFixed(2)}s · inactive positions are outlined</div>}
              </div>
            </div>
            <div className="flex h-10 shrink-0 items-center justify-center gap-2 border-t border-border bg-card"><Button variant="ghost" size="icon" className="size-7" onClick={() => setPreviewMs(0)}><ArrowLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8 rounded-full" onClick={() => setPlaying(value => !value)}>{playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}</Button><span className="w-24 font-mono text-[10px] text-muted-foreground">{formatMs(previewMs)} / {formatMs(endMs)}</span></div>
          </section>

          <Timeline tracks={draft.tracks} audioTrackCount={draft.audioTrackCount} endMs={endMs} previewMs={previewMs} zoom={zoom} selectedImageId={selectedImageId} editable={editable} onSeek={setPreviewMs} onSelect={id => setSelectedImageId(id)} onDeselect={() => setSelectedImageId("")} onAddSlot={addSlot} onAddVideoTrack={addVideoTrack} onRemoveVideoTrack={removeVideoTrack} onAddAudioTrack={addAudioTrack} onRemoveAudioTrack={removeAudioTrack} onChooseSoundEffect={chooseSoundEffect} onZoom={setZoom} onUpdateImage={updateImage} onNeedMoreTime={() => setTimelineRangeMs(current => Math.max(current, endMs) + TIMELINE_CHUNK_MS)} />
        </main>
      </div>

      <input ref={videoInputRef} className="hidden" type="file" accept="video/*" onChange={event => { const file = event.target.files?.[0]; if (file) setVideoUrl(URL.createObjectURL(file)); }} />
      <MusicAssetPickerDialog
        open={audioPickerTarget !== null}
        onOpenChange={open => { if (!open) setAudioPickerTarget(null); }}
        purpose="sound-effect"
        onSelect={({ url, label }) => {
          if (!audioPickerTarget) return;
          updateImage(audioPickerTarget.imageId, {
            sfxUrl: url,
            sfxAssetId: undefined,
            sfxLabel: label ?? "Sound effect",
            sfxTrack: audioPickerTarget.track,
          });
          setAudioPickerTarget(null);
        }}
      />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete personal attention template?" description={`This removes “${selectedTemplate?.name ?? "this template"}” from your profile. Existing timelines keep their applied images.`} confirmLabel="Delete template" variant="destructive" loading={deleting} onConfirm={() => void deleteTemplate()} />
    </div>
  );
}

function TemplateLibrary({ templates, selectedId, loading, onSelect, onCreate }: { templates: AttentionTemplate[]; selectedId: string; loading: boolean; onSelect: (template: AttentionTemplate) => void; onCreate: () => void }) {
  return <div className="absolute right-4 top-12 z-[80] w-80 rounded-lg border border-border bg-card p-2 shadow-2xl"><div className="flex items-center justify-between px-2 py-2"><div><p className="text-sm font-semibold">Template Library</p><p className="text-[10px] text-muted-foreground">Choose a reusable layout</p></div><Button size="icon" className="size-7" onClick={onCreate}><Plus className="size-4" /></Button></div><div className="max-h-80 space-y-1 overflow-y-auto">{loading ? <div className="flex justify-center p-8"><Loader2 className="size-5 animate-spin text-primary" /></div> : templates.length === 0 ? <p className="p-8 text-center text-xs text-muted-foreground">No saved templates yet.</p> : templates.map(template => { const config = normalizeAttentionTemplate(template); const count = config.tracks.flat().length; return <button key={template.id} onClick={() => onSelect(template)} className={`flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left ${selectedId === template.id ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-accent"}`}><div className="min-w-0"><p className="truncate text-xs font-medium">{template.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{config.tracks.length} video · {config.audioTrackCount} audio · {count} slots</p></div>{template.is_system && <ShieldCheck className="size-3.5 text-primary" />}</button>; })}</div></div>;
}

type AttentionTimelineProps = {
  tracks: AttentionTemplateImage[][];
  audioTrackCount: number;
  endMs: number;
  previewMs: number;
  zoom: number;
  selectedImageId: string;
  editable: boolean;
  onSeek: (ms: number) => void;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  onAddSlot: (track: number) => void;
  onAddVideoTrack: () => void;
  onRemoveVideoTrack: (track: number) => void;
  onAddAudioTrack: () => void;
  onRemoveAudioTrack: (track: number) => void;
  onChooseSoundEffect: (imageId: string, track: number) => void;
  onZoom: (zoom: number) => void;
  onUpdateImage: (id: string, patch: Partial<AttentionTemplateImage>) => void;
  onNeedMoreTime: () => void;
};

function Timeline({
  tracks,
  audioTrackCount,
  endMs,
  previewMs,
  zoom,
  selectedImageId,
  editable,
  onSeek,
  onSelect,
  onDeselect,
  onAddSlot,
  onAddVideoTrack,
  onRemoveVideoTrack,
  onAddAudioTrack,
  onRemoveAudioTrack,
  onChooseSoundEffect,
  onZoom,
  onUpdateImage,
  onNeedMoreTime,
}: AttentionTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [hiddenVideoTracks, setHiddenVideoTracks] = useState<Set<number>>(() => new Set());
  const [mutedAudioTracks, setMutedAudioTracks] = useState<Set<number>>(() => new Set());
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>({});

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => setViewportWidth(scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const fitLaneWidth = Math.max(
    TIMELINE_MIN_WIDTH,
    viewportWidth - TIMELINE_LABEL_WIDTH - TIMELINE_END_GUTTER,
  );
  const laneWidth = Math.round(fitLaneWidth * zoom);
  const allImages = tracks.flat();
  const selectedImage = allImages.find(image => image.id === selectedImageId);
  const slotNumberById = new Map(allImages.map((image, index) => [image.id, index + 1]));

  const seek = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("[data-timeline-block]")) return;
    onDeselect();
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(clamp((event.clientX - rect.left) / rect.width, 0, 1) * endMs);
  };
  const extendNearEdge = () => {
    const scroller = scrollRef.current;
    if (zoom > 1 && scroller && scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 500) onNeedMoreTime();
  };
  const toggleVideoTrack = (track: number) => setHiddenVideoTracks(current => {
    const next = new Set(current);
    if (next.has(track)) next.delete(track); else next.add(track);
    return next;
  });
  const toggleAudioTrack = (track: number) => setMutedAudioTracks(current => {
    const next = new Set(current);
    if (next.has(track)) next.delete(track); else next.add(track);
    return next;
  });
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

  const gridClass = "cursor-ew-resize bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:5%_100%]";
  const videoLanes = tracks.map((images, trackIndex) => {
    const trackNumber = trackIndex + 2;
    const trackId = `V${trackNumber}`;
    const hidden = hiddenVideoTracks.has(trackNumber);
    const canDelete = tracks.length > 1 && trackIndex === tracks.length - 1 && images.length === 0;
    return {
      label: trackId,
      description: `Attention image track ${trackIndex + 1}`,
      height: "h-12",
      heightPx: trackHeights[trackId] ?? 48,
      onHeightChange: (height: number) => setTrackHeights(current => ({ ...current, [trackId]: height })),
      action: (
        <TimelineTrackControls
          id={trackId}
          kind="video"
          disabled={!editable}
          monitored={!hidden}
          onMonitorChange={() => toggleVideoTrack(trackNumber)}
          addMedia={() => onAddSlot(trackIndex)}
          onAddTrack={onAddVideoTrack}
          canDelete={canDelete}
          deleteUnavailable="Only the highest empty video track can be deleted"
          onDelete={() => onRemoveVideoTrack(trackIndex)}
        />
      ),
      axisClassName: gridClass,
      axisProps: {
        onPointerDown: seek,
        "data-track-index": trackNumber,
      },
      showEndLine: true,
      content: hidden ? null : images.map(image => {
        const slotNumber = slotNumberById.get(image.id) ?? 1;
        return (
          <TimelineClipShell
            key={image.id}
            testId={`attention-slot-${image.id}`}
            className={`z-10 flex min-w-8 cursor-grab select-none items-center text-[10px] ${selectedImageId === image.id ? "border-primary bg-primary/25 ring-1 ring-primary/30" : ""}`}
            style={{ left: `${image.startMs / endMs * 100}%`, width: `${image.durationMs / endMs * 100}%` }}
            onPointerDown={event => beginDrag(event, image, "move")}
            onClick={() => { onSelect(image.id); onSeek(image.startMs); }}
            title={`Slot ${slotNumber}`}
          >
            <span className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize border-r border-primary/50 bg-primary/25 opacity-80 hover:bg-primary/70" onPointerDown={event => beginDrag(event, image, "start")} />
            <ImagePlus className="ml-3 mr-1 size-3 shrink-0" />
            <span className="truncate">Slot {slotNumber}</span>
            <span className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize border-l border-primary/50 bg-primary/25 opacity-80 hover:bg-primary/70" onPointerDown={event => beginDrag(event, image, "end")} />
          </TimelineClipShell>
        );
      }),
    };
  }).reverse();

  const baseVideoLane = {
    label: "V1",
    description: "Reference video",
    height: "h-12",
    heightPx: trackHeights.V1 ?? 48,
    onHeightChange: (height: number) => setTrackHeights(current => ({ ...current, V1: height })),
    action: (
      <TimelineTrackControls
        id="V1"
        kind="video"
        monitored={!hiddenVideoTracks.has(1)}
        onMonitorChange={() => toggleVideoTrack(1)}
        addMediaUnavailable="Load the reference video from Canvas settings"
        onAddTrack={onAddVideoTrack}
        deleteUnavailable="The reference video track is required"
        disabled={!editable}
      />
    ),
    axisClassName: gridClass,
    axisProps: { onPointerDown: seek, "data-magnetic-lane": "" },
    showEndLine: true,
    content: hiddenVideoTracks.has(1) ? null : (
      <div className="absolute inset-y-1 left-0 flex items-center gap-1.5 overflow-hidden rounded-sm border border-white/10 bg-white/5 px-2 text-white/45" style={{ width: "100%" }}>
        <Film className="size-3 shrink-0" />
        <span className="truncate">Reference video</span>
      </div>
    ),
  };

  const audioLanes = Array.from({ length: audioTrackCount }, (_, offset) => {
    const trackNumber = offset + 1;
    const trackId = `A${trackNumber}`;
    const assignedImages = allImages.filter(image =>
      image.sfxTrack === trackNumber && Boolean(image.sfxUrl || image.sfxAssetId));
    const muted = mutedAudioTracks.has(trackNumber);
    const canDelete = audioTrackCount > 1 && trackNumber === audioTrackCount && assignedImages.length === 0;
    return {
      label: trackId,
      description: trackNumber === 1 ? "Attention sound effects" : "Sound effects",
      height: "h-11",
      heightPx: trackHeights[trackId] ?? 44,
      onHeightChange: (height: number) => setTrackHeights(current => ({ ...current, [trackId]: height })),
      action: (
        <TimelineTrackControls
          id={trackId}
          kind="audio"
          disabled={!editable}
          monitored={!muted}
          onMonitorChange={() => toggleAudioTrack(trackNumber)}
          addMedia={selectedImage ? () => onChooseSoundEffect(selectedImage.id, trackNumber) : undefined}
          addMediaUnavailable="Select an image slot before choosing its sound effect"
          onAddTrack={onAddAudioTrack}
          canDelete={canDelete}
          deleteUnavailable="Only the highest empty audio track can be deleted"
          onDelete={() => onRemoveAudioTrack(trackNumber)}
        />
      ),
      axisClassName: `${gridClass} ${muted ? "opacity-55" : ""}`,
      axisProps: { onPointerDown: seek, "data-audio-track-index": trackNumber },
      showEndLine: true,
      content: assignedImages.map(image => {
        const slotNumber = slotNumberById.get(image.id) ?? 1;
        return (
          <TimelineClipShell
            key={`audio-${image.id}`}
            testId={`attention-audio-slot-${image.id}`}
            className={`z-10 flex min-w-8 cursor-grab select-none items-center border-amber-300/55 bg-amber-400/15 px-1.5 text-[9px] text-amber-100 ${selectedImageId === image.id ? "ring-1 ring-amber-300" : ""}`}
            style={{ left: `${image.startMs / endMs * 100}%`, width: `${image.durationMs / endMs * 100}%` }}
            onPointerDown={event => beginDrag(event, image, "move")}
            onClick={() => { onSelect(image.id); onSeek(image.startMs); onChooseSoundEffect(image.id, trackNumber); }}
            title={image.sfxLabel || `Sound effect for Slot ${slotNumber}`}
          >
            <TimelineWaveform peaks={[]} colorClassName="bg-amber-300/70" className="inset-y-2 opacity-35" />
            <Volume2 className="relative z-10 mr-1 size-3 shrink-0 text-amber-300" />
            <span className="relative z-10 truncate">{image.sfxLabel || `SFX · Slot ${slotNumber}`}</span>
          </TimelineClipShell>
        );
      }),
    };
  });

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-card" data-testid="attention-track-list">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Layers3 className="size-3.5 shrink-0 text-primary" />
          <span className="text-xs font-semibold">Timeline</span>
          <span className="truncate text-[10px] text-muted-foreground">Add image slots from V tracks; add optional sound effects separately on A tracks</span>
        </div>
      </div>
      <MultiTrackTimeline
        scrollRef={scrollRef}
        className="min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        containerProps={{
          "data-testid": "attention-timeline-scroll",
          "aria-label": "Attention template multi-track timeline",
          tabIndex: 0,
          onScroll: extendNearEdge,
        }}
        laneWidth={laneWidth}
        ruler={{ duration: endMs / 1000, className: "cursor-ew-resize", onPointerDown: seek }}
        playhead={{ style: { left: `${clamp(previewMs / endMs, 0, 1) * 100}%` } }}
        zoom={zoom}
        minZoom={TIMELINE_MIN_ZOOM}
        maxZoom={TIMELINE_MAX_ZOOM}
        onZoomChange={onZoom}
        onFit={() => {
          onZoom(1);
          if (scrollRef.current) scrollRef.current.scrollLeft = 0;
        }}
        lanes={[...videoLanes, baseVideoLane, ...audioLanes]}
      />
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <InspectorField label={label}>{children}</InspectorField>; }
function NumberField({ label, value, unit, step = 1, onChange }: { label: string; value: number; unit: string; step?: number; onChange: (value: number) => void }) { return <Field label={label}><div className="relative"><Input type="number" value={Number(value.toFixed(2))} step={step} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} className="h-8 pr-7 text-xs" /><span className="absolute right-2 top-2 font-mono text-[11px] tabular-nums text-muted-foreground">{unit}</span></div></Field>; }
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
