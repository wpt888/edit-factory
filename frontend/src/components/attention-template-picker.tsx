"use client";

import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Images, LayoutTemplate, Replace, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AttentionAssetPickerDialog } from "@/components/dialogs/attention-asset-picker-dialog";
import { apiGet } from "@/lib/api";
import type { AttentionTemplate } from "@/types/attention-template";
import { normalizeAttentionTemplate } from "@/types/attention-template";

export type AttentionSelection = {
  templateId: string;
  assetUrls: string[];
  /** Seconds added per variant so image bursts never land on the same second twice (0 = off). */
  staggerSeconds: number;
  /** Apply to the first N variants only; 0 = all variants. */
  maxVariants: number;
};

export const EMPTY_ATTENTION_SELECTION: AttentionSelection = {
  templateId: "",
  assetUrls: [],
  staggerSeconds: 1,
  maxVariants: 0,
};

type AttentionTemplatePickerProps = {
  selection: AttentionSelection;
  onSelectionChange: (selection: AttentionSelection) => void;
  outputWidth?: number;
  outputHeight?: number;
  onOutputSizeChange?: (width: number, height: number) => void;
};

const PIPELINE_FORMATS = [
  { label: "Vertical 9:16", width: 1080, height: 1920 },
  { label: "Square 1:1", width: 1080, height: 1080 },
  { label: "Landscape 16:9", width: 1920, height: 1080 },
  { label: "Portrait 4:5", width: 1080, height: 1350 },
  { label: "Portrait 3:4", width: 1080, height: 1440 },
  { label: "Landscape 4:3", width: 1440, height: 1080 },
  { label: "Cinematic 21:9", width: 2520, height: 1080 },
] as const;

/** Step 1 attention-template pick: choose template + source images upfront;
 *  the pipeline auto-applies them to each variant once previews exist. */
export function AttentionTemplatePicker({
  selection,
  onSelectionChange,
  outputWidth = 1080,
  outputHeight = 1920,
  onOutputSizeChange,
}: AttentionTemplatePickerProps) {
  const [templates, setTemplates] = useState<AttentionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet("/attention-templates")
      .then(async (response) => {
        const data = (await response.json()) as { templates?: AttentionTemplate[] };
        if (!cancelled) setTemplates(data.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedTemplate = templates.find((template) => template.id === selection.templateId);
  const config = normalizeAttentionTemplate(selectedTemplate);
  const templateSlots = useMemo(() => config.tracks.flatMap((track, trackIndex) =>
    track.map((image) => ({ image, trackIndex }))), [config.tracks]);
  const visibleSlotCount = Math.max(templateSlots.length, selection.assetUrls.length);
  const outputFormat = PIPELINE_FORMATS.find(
    (format) => format.width === outputWidth && format.height === outputHeight,
  );
  const templateMatchesOutput = !selectedTemplate
    || config.canvasWidth * outputHeight === config.canvasHeight * outputWidth;

  const openAssetPicker = (slotIndex: number) => {
    setActiveSlot(slotIndex);
    setPickerOpen(true);
  };

  const removeAsset = (slotIndex: number) => {
    onSelectionChange({
      ...selection,
      assetUrls: selection.assetUrls.filter((_, index) => index !== slotIndex),
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card/40" data-testid="attention-template-picker">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <div className="rounded-lg border bg-primary/10 p-2 text-primary">
            <LayoutTemplate className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Attention images</p>
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              The template controls position and timing. You choose the image content here in Idea.
            </p>
          </div>
        </div>
        {selectedTemplate && (
          <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <span className="rounded-full border bg-background px-2 py-1">{config.tracks.length} track{config.tracks.length === 1 ? "" : "s"}</span>
            <span className="rounded-full border bg-background px-2 py-1">{templateSlots.length} slot{templateSlots.length === 1 ? "" : "s"}</span>
            <span className="rounded-full border bg-background px-2 py-1 capitalize">{config.zone}</span>
            <span className="rounded-full border bg-background px-2 py-1">
              {formatRatio(config.canvasWidth, config.canvasHeight)}
            </span>
          </div>
        )}
      </div>

      <div className={selectedTemplate ? "grid min-[900px]:grid-cols-[minmax(15rem,0.72fr)_minmax(24rem,1.35fr)]" : "p-4"}>
        <div className={selectedTemplate ? "space-y-4 border-b p-4 min-[900px]:border-b-0 min-[900px]:border-r" : ""}>
          {onOutputSizeChange && (
            <label className="block space-y-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Output video format
              <Select
                value={outputFormat ? `${outputFormat.width}x${outputFormat.height}` : "custom"}
                onValueChange={(value) => {
                  const format = PIPELINE_FORMATS.find(
                    (item) => `${item.width}x${item.height}` === value,
                  );
                  if (format) onOutputSizeChange(format.width, format.height);
                }}
              >
                <SelectTrigger size="sm" className="w-full text-xs font-medium normal-case tracking-normal" data-testid="pipeline-output-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_FORMATS.map((format) => (
                    <SelectItem key={`${format.width}x${format.height}`} value={`${format.width}x${format.height}`}>
                      {format.label} · {format.width}x{format.height}
                    </SelectItem>
                  ))}
                  {!outputFormat && <SelectItem value="custom">Custom · {outputWidth}x{outputHeight}</SelectItem>}
                </SelectContent>
              </Select>
            </label>
          )}
          <label className="block space-y-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Layout template
            <Select
              value={selection.templateId || "__none__"}
              onValueChange={(raw) => {
                const templateId = raw === "__none__" ? "" : raw;
                const template = templates.find(item => item.id === templateId);
                const templateGapSeconds = template
                  ? normalizeAttentionTemplate(template).variantGapMs / 1000
                  : selection.staggerSeconds;
                onSelectionChange({ ...selection, templateId, staggerSeconds: templateGapSeconds });
              }}
              disabled={loading}
            >
              <SelectTrigger size="sm" className="w-full text-xs font-medium normal-case tracking-normal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{loading ? "Loading templates..." : templates.length === 0 ? "No templates available" : "No attention template"}</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}{template.is_system ? " · System" : " · Personal"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {selectedTemplate && (
            <>
              {!templateMatchesOutput && (
                <p className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  This template was authored for {formatRatio(config.canvasWidth, config.canvasHeight)}, while the pipeline is {formatRatio(outputWidth, outputHeight)}. Choose a matching template or output format before rendering.
                </p>
              )}
              <div className="flex min-h-52 items-center justify-center rounded-lg border bg-black/30 p-4" data-testid="attention-layout-preview">
                <div
                  className="relative max-h-48 max-w-full overflow-hidden rounded-md border border-white/10 bg-gradient-to-b from-zinc-800 to-zinc-950 shadow-inner"
                  style={{
                    aspectRatio: `${config.canvasWidth} / ${config.canvasHeight}`,
                    height: config.canvasWidth <= config.canvasHeight ? "12rem" : "auto",
                    width: config.canvasWidth > config.canvasHeight ? "100%" : "auto",
                  }}
                >
                  <div className="absolute inset-x-3 top-3 text-center text-[7px] uppercase tracking-[0.18em] text-white/25">Video frame</div>
                  {templateSlots.map(({ image }, index) => {
                    const assetUrl = selection.assetUrls.length > 0
                      ? selection.assetUrls[index % selection.assetUrls.length]
                      : undefined;
                    return (
                      <div
                        key={image.id}
                        className="absolute grid place-items-center overflow-hidden rounded border border-primary/70 bg-primary/15 text-[9px] font-semibold text-primary shadow-lg"
                        style={{
                          left: `${image.x * 100}%`, top: `${image.y * 100}%`,
                          width: `${image.width * 100}%`, height: `${image.height * 100}%`,
                          opacity: image.opacity,
                          zIndex: index + 1,
                        }}
                      >
                        {assetUrl ? <img src={assetUrl} alt="" className="size-full object-cover" /> : index + 1}
                      </div>
                    );
                  })}
                  <div className="absolute inset-x-3 bottom-3 z-20 rounded bg-white/10 px-2 py-1 text-center text-[7px] text-white/50">Subtitle safe area</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Delay / variant
                  <div className="relative">
                    <input
                      type="number" min={0} max={30} step={0.5}
                      value={selection.staggerSeconds}
                      onChange={(event) => onSelectionChange({
                        ...selection,
                        staggerSeconds: Math.min(30, Math.max(0, Number(event.target.value) || 0)),
                      })}
                      className="h-9 w-full rounded-md border bg-background px-2 pr-7 text-xs normal-case tracking-normal outline-none focus:border-primary"
                      data-testid="attention-stagger-seconds"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-normal normal-case text-muted-foreground">sec</span>
                  </div>
                </label>
                <label className="block space-y-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Apply to variants
                  <input
                    type="number" min={0} max={100} step={1}
                    value={selection.maxVariants}
                    onChange={(event) => onSelectionChange({
                      ...selection,
                      maxVariants: Math.min(100, Math.max(0, Math.round(Number(event.target.value) || 0))),
                    })}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs normal-case tracking-normal outline-none focus:border-primary"
                    data-testid="attention-max-variants"
                    aria-label="Apply to first number of variants, zero means all"
                  />
                  <span className="block font-normal normal-case tracking-normal">0 means all</span>
                </label>
              </div>
            </>
          )}
        </div>

        {selectedTemplate && (
          <div className="space-y-3 p-4" data-testid="attention-content-slots">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Content images</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Images fill the numbered template slots in order. Select a card to add or replace its content.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => openAssetPicker(selection.assetUrls.length)}>
                <Images className="size-3.5" />
                Add image
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: visibleSlotCount }, (_, index) => {
                const slot = templateSlots[index];
                const assetUrl = selection.assetUrls[index];
                return (
                  <div key={`${slot?.image.id ?? "extra"}-${index}`} className="group overflow-hidden rounded-lg border bg-background transition hover:border-primary/60">
                    <button type="button" className="relative block aspect-square w-full overflow-hidden bg-muted/40" onClick={() => openAssetPicker(index)}>
                      {assetUrl ? (
                        <img src={assetUrl} alt={`Attention content ${index + 1}`} className="size-full object-cover transition group-hover:scale-[1.02]" />
                      ) : (
                        <span className="flex size-full flex-col items-center justify-center gap-2 border-b border-dashed text-muted-foreground">
                          <ImagePlus className="size-6 text-primary/80" />
                          <span className="text-[11px]">Choose image</span>
                        </span>
                      )}
                      <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-black/75 text-[11px] font-semibold text-white">{index + 1}</span>
                      {assetUrl && (
                        <span className="absolute inset-0 grid place-items-center bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                          <Replace className="size-5" />
                        </span>
                      )}
                    </button>
                    <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium">{slot ? `Slot ${index + 1}` : `Extra image ${index - templateSlots.length + 1}`}</p>
                        <p className="truncate text-[9px] text-muted-foreground">
                          {slot ? `Track ${slot.trackIndex + 1} · ${(slot.image.startMs / 1000).toFixed(1)}s` : "Rotates through later slots"}
                        </p>
                      </div>
                      {assetUrl && (
                        <button type="button" onClick={() => removeAsset(index)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove content image ${index + 1}`}>
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {selection.assetUrls.length === 0 && (
              <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                Choose at least one image before generating. If the template has more slots, selected images repeat automatically.
              </p>
            )}
          </div>
        )}
      </div>

      <AttentionAssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(url) => {
          const slotIndex = activeSlot ?? selection.assetUrls.length;
          const nextAssets = [...selection.assetUrls];
          nextAssets[slotIndex] = url;
          onSelectionChange({ ...selection, assetUrls: nextAssets.filter(Boolean) });
          setActiveSlot(null);
        }}
      />
    </div>
  );
}

function formatRatio(width: number, height: number): string {
  const left = Math.max(1, Math.round(width));
  const right = Math.max(1, Math.round(height));
  let a = left;
  let b = right;
  while (b) [a, b] = [b, a % b];
  return `${left / a}:${right / a}`;
}
