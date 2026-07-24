"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowLeft, CopyPlus, Film, ImagePlus, Layers3, Library, Loader2,
  Maximize2, Music, Pause, Play, Plus, Save, ShieldCheck, Trash2,
  Upload, Volume2, Waves,
} from "lucide-react";
import { toast } from "sonner";

import {
  AttentionAssetPickerDialog,
  attentionAssetPreviewUrl,
} from "@/components/dialogs/attention-asset-picker-dialog";
import { AttentionEffectControls } from "@/components/attention-effect-controls";
import { AttentionEffectLibrary } from "@/components/attention-effect-library";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { MusicAssetPickerDialog } from "@/components/dialogs/music-asset-picker-dialog";
import { EditorHeader } from "@/components/editor-header";
import { WorkspacePanelHeader } from "@/components/workspace-panel-header";
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
import {
  isEditorDeleteShortcutBlocked,
  isEditorModalShortcutBlocked,
} from "@/lib/editor-keyboard";
import {
  alignedTimelineRangeEdge,
  snapTimelineRange,
  snapTimelineTime,
  timelineRangeEdges,
} from "@/lib/timeline-snapping";
import {
  attentionAnimationLabel,
  type AttentionAnimationPreset,
} from "@/types/attention-timeline";
import { AttentionEntranceOverlay } from "@/components/timeline/attention-entrance-overlay";
import {
  DEFAULT_ATTENTION_TEMPLATE, newTemplateImage, normalizeAttentionTemplate,
  templateEndMs, type AttentionTemplate, type AttentionTemplateImage,
  type AttentionTemplatePayload,
} from "@/types/attention-template";

const TIMELINE_CHUNK_MS = 10_000;
const INITIAL_TIMELINE_MS = 60_000;
const ATTENTION_PANEL_ORDER_STORAGE_KEY = "blipost.attention-templates.panel-order.v1";
const ATTENTION_PANEL_IDS = ["settings", "monitor", "timeline"] as const;
type AttentionPanelId = (typeof ATTENTION_PANEL_IDS)[number];
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
  const [defaultContentTarget, setDefaultContentTarget] = useState<string | null>(null);
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
      localMs: previewMs - image.startMs,
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
      toast.error(error instanceof Error ? error.message : "Could not load content templates");
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
  const beginCreate = () => {
    setSelectedId("new");
    setDraft({ ...DEFAULT_ATTENTION_TEMPLATE, name: "My content template", tracks: [[]] });
    setSelectedImageId(""); setPreviewMs(0); setTimelineRangeMs(INITIAL_TIMELINE_MS); setLibraryOpen(false);
  };
  const setTracks = (tracks: AttentionTemplateImage[][]) => setDraft(current => ({ ...current, tracks }));
  const updateImage = (id: string, patch: Partial<AttentionTemplateImage>) =>
    setDraft(current => ({
      ...current,
      tracks: current.tracks.map(track => track.map(image => image.id === id ? { ...image, ...patch } : image)),
    }));
  const moveImageToTrack = (
    id: string,
    targetTrackIndex: number,
    patch: Partial<AttentionTemplateImage>,
  ) => setDraft(current => {
    if (targetTrackIndex < 0 || targetTrackIndex >= current.tracks.length) return current;
    const image = current.tracks.flat().find(candidate => candidate.id === id);
    if (!image) return current;
    const movedImage = { ...image, ...patch };
    return {
      ...current,
      tracks: current.tracks.map((track, trackIndex) => {
        const withoutMovedImage = track.filter(candidate => candidate.id !== id);
        return trackIndex === targetTrackIndex
          ? [...withoutMovedImage, movedImage]
          : withoutMovedImage;
      }),
    };
  });
  const removeImage = useCallback((id: string) => {
    setDraft(current => ({
      ...current,
      tracks: current.tracks.map(track => track.filter(image => image.id !== id)),
    }));
    setSelectedImageId(current => current === id ? "" : current);
  }, []);
  useEffect(() => {
    const handleEditorKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedImageId("");
        return;
      }
      if (
        event.key !== "Delete"
        || event.defaultPrevented
        || event.repeat
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || !editable
        || !selectedImageId
        || isEditorDeleteShortcutBlocked(event.target)
        || isEditorModalShortcutBlocked(event.target)
      ) return;

      event.preventDefault();
      removeImage(selectedImageId);
    };
    window.addEventListener("keydown", handleEditorKeyDown);
    return () => window.removeEventListener("keydown", handleEditorKeyDown);
  }, [editable, removeImage, selectedImageId]);
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
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
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
        title="Content Templates"
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

      <AttentionPanelWorkspace
        settings={(
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-canvas" data-workspace-pane data-testid="attention-template-inspector">
          <WorkspacePanelHeader
            title="Template settings"
            data-testid="attention-panel-header-settings"
            actions={isSystem ? <Badge variant="outline" className="border-primary/30 text-primary"><ShieldCheck className="mr-1 size-3" />System</Badge> : undefined}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">Reusable layout and timing</p>
            <fieldset disabled={!editable || saving} className="min-w-0 divide-y divide-border/70 disabled:opacity-55">
            <InspectorSection title="Template" defaultOpen>
              <Field label="Name"><Input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} className="h-8 px-2 text-xs" /></Field>
              <Field label="Subtitle layer"><Select value={draft.zone} onValueChange={value => setDraft(current => ({ ...current, zone: value as AttentionTemplatePayload["zone"] }))}><SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="behind">Captions over images</SelectItem><SelectItem value="front">Images over captions</SelectItem></SelectContent></Select></Field>
              <NumberField label="Variant start gap" value={draft.variantGapMs / 1000} unit="s" step={.1} onChange={value => setDraft(current => ({ ...current, variantGapMs: clamp(Math.round(value * 1000), 0, 30000) }))} />
              <p className="text-[11px] leading-relaxed text-muted-foreground">Variant 1 uses the authored timing. Each following variant starts another {formatGap(draft.variantGapMs)} later.</p>
            </InspectorSection>
            <InspectorSection title="Template effect default" summary={draft.animation === "static" ? "None" : attentionAnimationLabel(draft.animation)} defaultOpen>
              <Field label="Default effect">
                <AttentionEffectLibrary
                  value={draft.animation}
                  onValueChange={animation => setDraft(current => ({
                    ...current,
                    animation: animation ?? "static",
                  }))}
                  ariaLabel="Default effect"
                  testId="attention-entrance-effect-select"
                />
              </Field>
              {draft.animation === "static" ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">No entrance animation is applied. Content appears instantly at the start of its slots.</p>
              ) : (
                <NumberField label="Entrance duration" value={draft.enterMs / 1000} unit="s" step={.05} onChange={value => setDraft(current => ({ ...current, enterMs: clamp(Math.round(value * 1000), 50, 10000) }))} />
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">New and inherited slots use this default. A selected slot can override both the effect and its entrance duration.</p>
            </InspectorSection>
            <InspectorSection title="Content slot" summary={selectedImage ? "Selected" : "No selection"} defaultOpen>
              {selectedImage ? <>
                <AttentionEffectControls
                  animation={selectedImage.animation}
                  enterMs={selectedImage.enterMs}
                  inherited={{
                    animation: draft.animation,
                    enterMs: draft.enterMs,
                    label: "Template default",
                  }}
                  onAnimationChange={animation => updateImage(selectedImage.id, { animation })}
                  onEnterMsChange={enterMs => updateImage(selectedImage.id, { enterMs })}
                  onReset={() => updateImage(selectedImage.id, { animation: undefined, enterMs: undefined })}
                  effectLabel="Slot entrance effect"
                  helper="Overrides only this content slot. Other slots keep their own settings."
                  testIdPrefix={`attention-slot-${selectedImage.id}`}
                />
                <div className="border-t border-border/70 pt-3" />
                <div className="grid grid-cols-2 gap-2"><NumberField label="Position X" value={selectedImage.x * 100} unit="%" onChange={value => updateImage(selectedImage.id, { x: clamp(value / 100, 0, 1) })} /><NumberField label="Position Y" value={selectedImage.y * 100} unit="%" onChange={value => updateImage(selectedImage.id, { y: clamp(value / 100, 0, 1) })} /><NumberField label="Width" value={selectedImage.width * 100} unit="%" onChange={value => updateImage(selectedImage.id, { width: clamp(value / 100, .01, 1) })} /><NumberField label="Height" value={selectedImage.height * 100} unit="%" onChange={value => updateImage(selectedImage.id, { height: clamp(value / 100, .01, 1) })} /></div>
                <Field label="Media fit"><Select value={selectedImage.fit} onValueChange={value => updateImage(selectedImage.id, { fit: value as AttentionTemplateImage["fit"] })}><SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contain">Contain · show the whole image</SelectItem><SelectItem value="cover">Cover · fill and crop</SelectItem></SelectContent></Select></Field>
                <p className="text-[11px] leading-relaxed text-muted-foreground">The pipeline supplies an image or video. Contain shows the whole asset; Cover fills the slot and may crop it.</p>
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
                <div className="border-t border-border/70 pt-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium"><ImagePlus className="size-3.5 text-primary" />Default content</div>
                  <div className="space-y-2">
                    {selectedImage.defaultAsset ? (
                      <div className="flex items-center gap-2" data-testid="attention-default-content">
                        <div className="size-12 shrink-0 overflow-hidden rounded border bg-muted/40">
                          {selectedImage.defaultAsset.type === "video"
                            ? <video src={attentionAssetPreviewUrl(selectedImage.defaultAsset.url)} muted playsInline preload="metadata" className="size-full object-cover" />
                            : <img src={attentionAssetPreviewUrl(selectedImage.defaultAsset.url)} alt="Slot default content" className="size-full object-cover" />}
                        </div>
                        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{selectedImage.defaultAsset.type === "video" ? "Video" : "Image"} · pre-fills this slot in Step 3</p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">No default. Leave empty and this slot is filled per pipeline in Step 3.</p>
                    )}
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-8 flex-1 text-xs" onClick={() => setDefaultContentTarget(selectedImage.id)}><ImagePlus className="mr-1.5 size-3.5" />{selectedImage.defaultAsset ? "Change content" : "Set default content"}</Button>
                      {selectedImage.defaultAsset && <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={() => updateImage(selectedImage.id, { defaultAsset: undefined })}>Clear</Button>}
                    </div>
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
          </div>
        </aside>
        )}
        monitor={(
          <section className="flex min-h-0 flex-col border-b border-border" data-workspace-pane aria-label="Program monitor">
            <WorkspacePanelHeader
              title="Program monitor"
              data-testid="attention-panel-header-monitor"
              actions={<><span className="rounded bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">{canvasLabel} · {(previewMs / 1000).toFixed(2)}s</span><Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Expand program monitor"><Maximize2 className="size-3.5" /></Button></>}
            />
            {/* Program-monitor video stage stays dark in both themes — a preview canvas is theme-independent, like any video player. */}
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#060706] p-4" style={{ containerType: "size" }}>
              <div ref={previewCanvasRef} className="relative isolate overflow-hidden border border-white/15 bg-[#171a17] shadow-2xl" style={{ aspectRatio: `${draft.canvasWidth} / ${draft.canvasHeight}`, width: `min(100cqw, calc(100cqh * ${draft.canvasWidth / draft.canvasHeight}))`, height: `min(100cqh, calc(100cqw * ${draft.canvasHeight / draft.canvasWidth}))` }} data-testid="attention-template-preview" onPointerDown={event => { if (event.target === event.currentTarget || !(event.target as HTMLElement).closest("[data-preview-image]")) setSelectedImageId(""); }}>
                {videoUrl ? <video src={videoUrl} muted loop autoPlay className="pointer-events-none absolute inset-0 size-full object-cover" /> : <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(45deg,#171a17_25%,#121412_25%,#121412_50%,#171a17_50%,#171a17_75%,#121412_75%)] bg-[length:18px_18px]"><div className="absolute inset-0 flex flex-col items-center justify-center text-white/25"><Film className="mb-2 size-7" /><span className="text-[10px] uppercase tracking-[.18em]">Reference video</span></div></div>}
                {previewImages.map(({ image, trackIndex, active, localMs }) => {
                  const slotAnimation = image.animation ?? draft.animation;
                  const slotEnterMs = image.enterMs ?? draft.enterMs;
                  const entranceDuration = Math.max(1, Math.min(slotEnterMs, image.durationMs));
                  return (
                    <div
                      key={image.id}
                      role="button"
                      tabIndex={editable ? 0 : -1}
                      data-preview-image
                      data-active={active ? "true" : "false"}
                      aria-label={`Edit image slot ${image.id}`}
                      aria-pressed={selectedImageId === image.id}
                      className={`group absolute cursor-move touch-none ${selectedImageId === image.id ? "z-50" : ""}`}
                      style={{ left: `${image.x * 100}%`, top: `${image.y * 100}%`, width: `${image.width * 100}%`, height: `${image.height * 100}%`, zIndex: selectedImageId === image.id ? 70 : (active ? (draft.zone === "front" ? 40 : 10) : 2) + trackIndex }}
                      onPointerDown={event => beginCanvasInteraction(event, image, "move")}
                    >
                      <div
                        className={`absolute inset-0 overflow-hidden ${active ? `attention-${playing ? slotAnimation : "static"} bg-[#252b25] shadow-xl` : "border border-dashed border-white/25 bg-transparent"} ${selectedImageId === image.id ? "ring-2 ring-primary" : active ? "ring-1 ring-white/35 group-hover:ring-primary/80" : "group-hover:border-primary/70"}`}
                        style={{
                          opacity: active ? image.opacity : selectedImageId === image.id ? .45 : .18,
                          animationDuration: `${entranceDuration}ms`,
                          animationDelay: `${-Math.min(Math.max(localMs, 0), entranceDuration)}ms`,
                          animationPlayState: "paused",
                          ["--attention-intensity" as string]: 1,
                          ["--attention-opacity" as string]: image.opacity,
                        }}
                      >
                        {active
                          ? image.defaultAsset
                            ? image.defaultAsset.type === "video"
                              ? <video src={attentionAssetPreviewUrl(image.defaultAsset.url)} muted playsInline autoPlay loop className={`pointer-events-none size-full ${image.fit === "cover" ? "object-cover" : "object-contain"}`} />
                              : <img src={attentionAssetPreviewUrl(image.defaultAsset.url)} alt="Slot default preview" className={`pointer-events-none size-full ${image.fit === "cover" ? "object-cover" : "object-contain"}`} />
                            : <div className="flex size-full flex-col items-center justify-center gap-1 bg-[linear-gradient(135deg,#333a33,#1b201b)] text-white/35"><ImagePlus className="size-7" /><span className="text-[9px] font-medium uppercase tracking-wider">Pipeline content slot</span><span className="absolute bottom-2 right-2 bg-black/60 px-1.5 py-0.5 text-[9px]">V{trackIndex + 2} · {image.fit}</span></div>
                          : <span className="absolute left-1 top-1 rounded bg-black/65 px-1 py-0.5 text-[8px] text-white/70">V{trackIndex + 2} · inactive</span>}
                      </div>
                      {(["nw", "ne", "sw", "se"] as const).map(corner => <button key={corner} type="button" aria-label={`Resize content slot from ${corner} corner`} className={`absolute size-3 rounded-full border-2 border-[#0b0d0b] bg-primary shadow transition-opacity ${selectedImageId === image.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"} ${corner === "nw" ? "-left-1.5 -top-1.5 cursor-nwse-resize" : corner === "ne" ? "-right-1.5 -top-1.5 cursor-nesw-resize" : corner === "sw" ? "-bottom-1.5 -left-1.5 cursor-nesw-resize" : "-bottom-1.5 -right-1.5 cursor-nwse-resize"}`} onPointerDown={event => beginCanvasInteraction(event, image, corner)} />)}
                    </div>
                  );
                })}
                {slotCount > 0 && activeImages.length === 0 && <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[90] rounded bg-black/70 px-2 py-1.5 text-center text-[9px] text-white/65">No slots active at {(previewMs / 1000).toFixed(2)}s · inactive positions are outlined</div>}
              </div>
            </div>
            <div className="flex h-10 shrink-0 items-center justify-center gap-2 border-t border-border bg-card"><Button variant="ghost" size="icon" className="size-7" onClick={() => setPreviewMs(0)}><ArrowLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8 rounded-full" onClick={() => setPlaying(value => !value)}>{playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}</Button><span className="w-24 font-mono text-[10px] text-muted-foreground">{formatMs(previewMs)} / {formatMs(endMs)}</span></div>
          </section>
        )}
        timeline={<Timeline tracks={draft.tracks} animation={draft.animation} enterMs={draft.enterMs} audioTrackCount={draft.audioTrackCount} endMs={endMs} previewMs={previewMs} zoom={zoom} selectedImageId={selectedImageId} editable={editable} onSeek={setPreviewMs} onSelect={id => setSelectedImageId(id)} onDeselect={() => setSelectedImageId("")} onAddSlot={addSlot} onAddVideoTrack={addVideoTrack} onRemoveVideoTrack={removeVideoTrack} onAddAudioTrack={addAudioTrack} onRemoveAudioTrack={removeAudioTrack} onChooseSoundEffect={chooseSoundEffect} onZoom={setZoom} onUpdateImage={updateImage} onMoveImageToTrack={moveImageToTrack} onNeedMoreTime={() => setTimelineRangeMs(current => Math.max(current, endMs) + TIMELINE_CHUNK_MS)} />}
      />

      <input ref={videoInputRef} className="hidden" type="file" accept="video/*" onChange={event => { const file = event.target.files?.[0]; if (file) setVideoUrl(URL.createObjectURL(file)); }} />
      <AttentionAssetPickerDialog
        open={defaultContentTarget !== null}
        onOpenChange={open => { if (!open) setDefaultContentTarget(null); }}
        onSelect={asset => {
          if (defaultContentTarget) updateImage(defaultContentTarget, { defaultAsset: asset });
          setDefaultContentTarget(null);
        }}
      />
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
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete personal content template?" description={`This removes “${selectedTemplate?.name ?? "this template"}” from your profile. Existing timelines keep their applied content.`} confirmLabel="Delete template" variant="destructive" loading={deleting} onConfirm={() => void deleteTemplate()} />
    </div>
  );
}

function isAttentionPanelId(value: string | undefined): value is AttentionPanelId {
  return ATTENTION_PANEL_IDS.includes(value as AttentionPanelId);
}

function normalizeAttentionPanelOrder(order: AttentionPanelId[]): AttentionPanelId[] {
  const normalized = [...order];
  const monitorIndex = normalized.indexOf("monitor");
  if (monitorIndex === 2) {
    [normalized[1], normalized[2]] = [normalized[2], normalized[1]];
  }
  return normalized;
}

function readAttentionPanelOrder(): AttentionPanelId[] {
  if (typeof window === "undefined") return [...ATTENTION_PANEL_IDS];
  try {
    const parsed = JSON.parse(localStorage.getItem(ATTENTION_PANEL_ORDER_STORAGE_KEY) ?? "null");
    if (
      Array.isArray(parsed)
      && parsed.length === ATTENTION_PANEL_IDS.length
      && ATTENTION_PANEL_IDS.every((panelId) => parsed.includes(panelId))
    ) {
      const normalized = normalizeAttentionPanelOrder(parsed as AttentionPanelId[]);
      if (normalized.some((panelId, index) => panelId !== parsed[index])) {
        localStorage.setItem(ATTENTION_PANEL_ORDER_STORAGE_KEY, JSON.stringify(normalized));
      }
      return normalized;
    }
  } catch {
    // Fall back to the authored layout when storage is unavailable or malformed.
  }
  return [...ATTENTION_PANEL_IDS];
}

function AttentionPanelWorkspace({
  settings,
  monitor,
  timeline,
}: Record<AttentionPanelId, ReactNode>) {
  const [panelOrder, setPanelOrder] = useState<AttentionPanelId[]>(ATTENTION_PANEL_IDS.slice());
  const panelOrderRef = useRef(panelOrder);
  const dragRef = useRef<{
    panelId: AttentionPanelId;
    startX: number;
    startY: number;
    armed: boolean;
  } | null>(null);

  useEffect(() => {
    panelOrderRef.current = panelOrder;
  }, [panelOrder]);

  useEffect(() => {
    const nextOrder = readAttentionPanelOrder();
    panelOrderRef.current = nextOrder;
    const frame = requestAnimationFrame(() => setPanelOrder(nextOrder));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const resetDrag = () => {
      dragRef.current = null;
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    };
    const panelAtPoint = (x: number, y: number): AttentionPanelId | null => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-attention-panel]");
      return isAttentionPanelId(element?.dataset.attentionPanel)
        ? element.dataset.attentionPanel
        : null;
    };
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.armed) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
        drag.armed = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      const targetId = drag?.armed ? panelAtPoint(event.clientX, event.clientY) : null;
      if (drag && targetId && targetId !== drag.panelId) {
        const nextOrder = [...panelOrderRef.current];
        const sourceIndex = nextOrder.indexOf(drag.panelId);
        const targetIndex = nextOrder.indexOf(targetId);
        [nextOrder[sourceIndex], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[sourceIndex]];
        const normalizedOrder = normalizeAttentionPanelOrder(nextOrder);
        panelOrderRef.current = normalizedOrder;
        setPanelOrder(normalizedOrder);
        try {
          localStorage.setItem(ATTENTION_PANEL_ORDER_STORAGE_KEY, JSON.stringify(normalizedOrder));
        } catch {
          // Reordering remains active for the current session.
        }
      }
      resetDrag();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) resetDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", resetDrag);
    window.addEventListener("blur", resetDrag);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", resetDrag);
      window.removeEventListener("blur", resetDrag);
      window.removeEventListener("keydown", handleKeyDown);
      resetDrag();
    };
  }, []);

  const beginPanelDrag = (
    panelId: AttentionPanelId,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [role='button'], [contenteditable='true']")) return;
    if (!target.closest('[data-slot="workspace-panel-header"]')) return;
    event.preventDefault();
    dragRef.current = {
      panelId,
      startX: event.clientX,
      startY: event.clientY,
      armed: false,
    };
  };

  const panels: Record<AttentionPanelId, ReactNode> = { settings, monitor, timeline };
  const renderPanel = (panelId: AttentionPanelId) => (
    <div
      key={panelId}
      data-attention-panel={panelId}
      className="contents"
      onPointerDown={(event) => beginPanelDrag(panelId, event)}
    >
      {panels[panelId]}
    </div>
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[clamp(280px,22vw,320px)_minmax(0,1fr)] gap-px bg-border">
      {renderPanel(panelOrder[0])}
      <main className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(300px,1fr)_300px] bg-surface-canvas">
        {renderPanel(panelOrder[1])}
        {renderPanel(panelOrder[2])}
      </main>
    </div>
  );
}

function TemplateLibrary({ templates, selectedId, loading, onSelect, onCreate }: { templates: AttentionTemplate[]; selectedId: string; loading: boolean; onSelect: (template: AttentionTemplate) => void; onCreate: () => void }) {
  return <div className="absolute right-4 top-12 z-[80] w-80 rounded-lg border border-border bg-card p-2 shadow-2xl"><div className="flex items-center justify-between px-2 py-2"><div><p className="text-sm font-semibold">Template Library</p><p className="text-[10px] text-muted-foreground">Choose a reusable layout</p></div><Button size="icon" className="size-7" onClick={onCreate}><Plus className="size-4" /></Button></div><div className="max-h-80 space-y-1 overflow-y-auto">{loading ? <div className="flex justify-center p-8"><Loader2 className="size-5 animate-spin text-primary" /></div> : templates.length === 0 ? <p className="p-8 text-center text-xs text-muted-foreground">No saved templates yet.</p> : templates.map(template => { const config = normalizeAttentionTemplate(template); const count = config.tracks.flat().length; return <button key={template.id} onClick={() => onSelect(template)} className={`flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left ${selectedId === template.id ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-accent"}`}><div className="min-w-0"><p className="truncate text-xs font-medium">{template.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{config.tracks.length} video · {config.audioTrackCount} audio · {count} slots</p></div>{template.is_system && <ShieldCheck className="size-3.5 text-primary" />}</button>; })}</div></div>;
}

type AttentionTimelineProps = {
  tracks: AttentionTemplateImage[][];
  animation: AttentionAnimationPreset;
  enterMs: number;
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
  onMoveImageToTrack: (id: string, targetTrackIndex: number, patch: Partial<AttentionTemplateImage>) => void;
  onNeedMoreTime: () => void;
};

function Timeline({
  tracks,
  animation,
  enterMs,
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
  onMoveImageToTrack,
  onNeedMoreTime,
}: AttentionTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [hiddenVideoTracks, setHiddenVideoTracks] = useState<Set<number>>(() => new Set());
  const [mutedAudioTracks, setMutedAudioTracks] = useState<Set<number>>(() => new Set());
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>({});
  const [snapGuideMs, setSnapGuideMs] = useState<number | null>(null);
  const scrubCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => setViewportWidth(scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => scrubCleanupRef.current?.(), []);

  const fitLaneWidth = Math.max(
    TIMELINE_MIN_WIDTH,
    viewportWidth - TIMELINE_LABEL_WIDTH - TIMELINE_END_GUTTER,
  );
  const laneWidth = Math.round(fitLaneWidth * zoom);
  const allImages = tracks.flat();
  const selectedImage = allImages.find(image => image.id === selectedImageId);
  const slotNumberById = new Map(allImages.map((image, index) => [image.id, index + 1]));

  const beginScrub = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-timeline-block]")) return;
    event.preventDefault();
    onDeselect();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerId = event.pointerId;
    let pendingClientX = event.clientX;
    let animationFrame: number | null = null;

    const updatePosition = (clientX: number) => {
      onSeek(clamp((clientX - rect.left) / rect.width, 0, 1) * endMs);
    };
    const flushPosition = () => {
      animationFrame = null;
      updatePosition(pendingClientX);
    };
    const cleanup = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", handleBlur);
      if (scrubCleanupRef.current === cleanup) scrubCleanupRef.current = null;
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      pendingClientX = moveEvent.clientX;
      if (animationFrame === null) animationFrame = requestAnimationFrame(flushPosition);
    };
    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      pendingClientX = endEvent.clientX;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      updatePosition(pendingClientX);
      cleanup();
    };
    const handleBlur = () => cleanup();

    scrubCleanupRef.current?.();
    scrubCleanupRef.current = cleanup;
    updatePosition(event.clientX);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", handleBlur);
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
  const beginDrag = (
    event: React.PointerEvent,
    image: AttentionTemplateImage,
    mode: "move" | "start" | "end",
    sourceTrackIndex?: number,
  ) => {
    if (!editable) return;
    (event.currentTarget as HTMLElement)
      .closest<HTMLElement>("[data-timeline-block]")
      ?.focus({ preventScroll: true });
    event.preventDefault();
    event.stopPropagation();
    onSelect(image.id);
    const originX = event.clientX;
    const originStart = image.startMs;
    const originDuration = image.durationMs;
    const snapPoints = [
      0,
      endMs,
      ...timelineRangeEdges(
        allImages.filter(candidate => candidate.id !== image.id),
        candidate => ({ start: candidate.startMs, end: candidate.startMs + candidate.durationMs }),
      ),
    ];
    const snap = (value: number, disabled: boolean) => {
      const result = snapTimelineTime(value, snapPoints, {
        duration: endMs,
        axisWidth: laneWidth,
        disabled,
      });
      setSnapGuideMs(result.snappedTo);
      return result.value;
    };
    const move = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - originX) / laneWidth * endMs;
      if (mode === "move") {
        const requestedStart = Math.round((originStart + delta) / 10) * 10;
        const snapped = snapTimelineRange(
          requestedStart,
          requestedStart + originDuration,
          snapPoints,
          {
            duration: endMs,
            axisWidth: laneWidth,
            disabled: moveEvent.altKey,
          },
        );
        const startMs = clamp(snapped.start, 0, Math.max(0, endMs - originDuration));
        const alignedEdge = moveEvent.altKey
          ? null
          : alignedTimelineRangeEdge(
              startMs,
              startMs + originDuration,
              snapPoints,
              0.5,
            );
        setSnapGuideMs(alignedEdge);
        const hoveredLane = document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest<HTMLElement>("[data-attention-template-track-index]");
        const hoveredTrackIndex = Number(hoveredLane?.dataset.attentionTemplateTrackIndex);
        if (
          sourceTrackIndex !== undefined
          && hoveredLane
          && Number.isInteger(hoveredTrackIndex)
          && hoveredTrackIndex >= 0
          && hoveredTrackIndex < tracks.length
        ) {
          onMoveImageToTrack(image.id, hoveredTrackIndex, { startMs });
        } else {
          onUpdateImage(image.id, { startMs });
        }
      }
      if (mode === "start") {
        const start = clamp(
          snap(Math.round((originStart + delta) / 10) * 10, moveEvent.altKey),
          0,
          originStart + originDuration - 100,
        );
        onUpdateImage(image.id, { startMs: start, durationMs: originDuration + originStart - start });
      }
      if (mode === "end") {
        const end = snap(
          Math.round((originStart + originDuration + delta) / 10) * 10,
          moveEvent.altKey,
        );
        onUpdateImage(image.id, { durationMs: Math.max(100, end - originStart) });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setSnapGuideMs(null);
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
        onPointerDown: beginScrub,
        "data-track-index": trackNumber,
        "data-track-kind": "video",
        "data-attention-template-track-index": trackIndex,
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
            onPointerDown={event => beginDrag(event, image, "move", trackIndex)}
            onClick={() => { onSelect(image.id); onSeek(image.startMs); }}
            title={`Slot ${slotNumber}`}
          >
            <span data-testid={`attention-video-start-handle-${image.id}`} className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize border-r border-primary/50 bg-primary/25 opacity-80 hover:bg-primary/70" onPointerDown={event => beginDrag(event, image, "start")} title="Drag to trim video start. Hold Alt to disable snapping." />
            <AttentionEntranceOverlay
              preset={image.animation ?? animation}
              enterMs={image.enterMs ?? enterMs}
              clipDurationMs={image.durationMs}
              testId={`attention-entrance-${image.id}`}
            />
            <ImagePlus className="ml-3 mr-1 size-3 shrink-0" />
            <span className="truncate">Slot {slotNumber}</span>
            <span data-testid={`attention-video-end-handle-${image.id}`} className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize border-l border-primary/50 bg-primary/25 opacity-80 hover:bg-primary/70" onPointerDown={event => beginDrag(event, image, "end")} title="Drag to trim video end. Hold Alt to disable snapping." />
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
    axisProps: { onPointerDown: beginScrub, "data-magnetic-lane": "" },
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
          addMediaUnavailable="Select a content slot before choosing its sound effect"
          onAddTrack={onAddAudioTrack}
          canDelete={canDelete}
          deleteUnavailable="Only the highest empty audio track can be deleted"
          onDelete={() => onRemoveAudioTrack(trackNumber)}
        />
      ),
      axisClassName: `${gridClass} ${muted ? "opacity-55" : ""}`,
      axisProps: { onPointerDown: beginScrub, "data-audio-track-index": trackNumber },
      showEndLine: true,
      content: assignedImages.map(image => {
        const slotNumber = slotNumberById.get(image.id) ?? 1;
        return (
          <TimelineClipShell
            key={`audio-${image.id}`}
            testId={`attention-audio-slot-${image.id}`}
            className={`z-10 flex min-w-8 cursor-grab select-none items-center border-amber-300/55 bg-amber-400/15 px-2.5 text-[9px] text-amber-100 ${selectedImageId === image.id ? "ring-1 ring-amber-300" : ""}`}
            style={{ left: `${image.startMs / endMs * 100}%`, width: `${image.durationMs / endMs * 100}%` }}
            onPointerDown={event => beginDrag(event, image, "move")}
            onClick={() => { onSelect(image.id); onSeek(image.startMs); onChooseSoundEffect(image.id, trackNumber); }}
            title={image.sfxLabel || `Sound effect for Slot ${slotNumber}`}
          >
            <span
              data-testid={`attention-audio-start-handle-${image.id}`}
              className="absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize border-r border-amber-300/45 bg-amber-300/20 hover:bg-amber-300/60"
              onPointerDown={event => beginDrag(event, image, "start")}
              onClick={event => event.stopPropagation()}
              title="Drag to trim audio start. Hold Alt to disable snapping."
            />
            <TimelineWaveform peaks={[]} colorClassName="bg-amber-300/70" className="inset-y-2 opacity-35" />
            <Volume2 className="relative z-10 mr-1 size-3 shrink-0 text-amber-300" />
            <span className="relative z-10 truncate">{image.sfxLabel || `SFX · Slot ${slotNumber}`}</span>
            <span
              data-testid={`attention-audio-end-handle-${image.id}`}
              className="absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize border-l border-amber-300/45 bg-amber-300/20 hover:bg-amber-300/60"
              onPointerDown={event => beginDrag(event, image, "end")}
              onClick={event => event.stopPropagation()}
              title="Drag to trim audio end. Hold Alt to disable snapping."
            />
          </TimelineClipShell>
        );
      }),
    };
  });

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-surface-canvas" data-workspace-pane data-testid="attention-track-list">
      <WorkspacePanelHeader
        title="Timeline"
        titleAccessory={<span className="truncate text-[11px] font-normal text-muted-foreground">Add image or video slots from V tracks; add optional sound effects separately on A tracks</span>}
        data-testid="attention-panel-header-timeline"
      />
      <MultiTrackTimeline
        scrollRef={scrollRef}
        className="min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        containerProps={{
          "data-testid": "attention-timeline-scroll",
          "aria-label": "Content template multi-track timeline",
          tabIndex: 0,
          onScroll: extendNearEdge,
        }}
        laneWidth={laneWidth}
        ruler={{ duration: endMs / 1000, className: "cursor-ew-resize touch-none", onPointerDown: beginScrub }}
        playhead={{ style: { left: `${clamp(previewMs / endMs, 0, 1) * 100}%` } }}
        snapGuide={snapGuideMs === null ? null : { time: snapGuideMs / 1000 }}
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
