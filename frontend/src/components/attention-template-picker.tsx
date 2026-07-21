"use client";

import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Images, Replace, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AttentionAssetPickerDialog } from "@/components/dialogs/attention-asset-picker-dialog";
import { InspectorField } from "@/components/ui/inspector";
import { apiGet } from "@/lib/api";
import type { AttentionTemplate } from "@/types/attention-template";
import { normalizeAttentionTemplate } from "@/types/attention-template";

export type AttentionSelection = {
  templateId: string;
  assetUrls: string[];
  /** Seconds added per variant so image bursts never land on the same second twice (0 = off). */
  staggerSeconds: number;
};

export const EMPTY_ATTENTION_SELECTION: AttentionSelection = {
  templateId: "",
  assetUrls: [],
  staggerSeconds: 1,
};

/** Tolerant read of a persisted selection. Old pipeline-template bundles carry
 *  `maxVariants` (now dropped) — ignore unknown fields instead of crashing. */
export function normalizeAttentionSelection(raw: unknown): AttentionSelection {
  const record = (raw ?? {}) as {
    templateId?: unknown;
    assetUrls?: unknown;
    staggerSeconds?: unknown;
  };
  const assetUrls = Array.isArray(record.assetUrls)
    ? record.assetUrls.filter((url): url is string => typeof url === "string" && url.length > 0)
    : [];
  return {
    templateId: typeof record.templateId === "string" ? record.templateId : "",
    assetUrls,
    staggerSeconds: typeof record.staggerSeconds === "number" ? record.staggerSeconds : 1,
  };
}

type AttentionTemplatePickerProps = {
  selection: AttentionSelection;
  onSelectionChange: (selection: AttentionSelection) => void;
  /** Render target, used only to warn when the template aspect ratio differs. */
  outputWidth?: number;
  outputHeight?: number;
};

/** Attention-template pick used inside the Step 3 inspector card: choose a
 *  layout template, then fill its numbered slots with image content. The
 *  pipeline applies the assets to each variant's timeline. */
export function AttentionTemplatePicker({
  selection,
  onSelectionChange,
  outputWidth = 1080,
  outputHeight = 1920,
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

  const handleTemplateChange = (raw: string) => {
    const templateId = raw === "__none__" ? "" : raw;
    const template = templates.find((item) => item.id === templateId);
    const templateGapSeconds = template
      ? normalizeAttentionTemplate(template).variantGapMs / 1000
      : selection.staggerSeconds;
    onSelectionChange({ ...selection, templateId, staggerSeconds: templateGapSeconds });
  };

  return (
    <div className="space-y-3" data-testid="attention-template-picker">
      <InspectorField
        label="Layout template"
        htmlFor="step3-attention-template"
        helper={templates.length === 0 && !loading ? "Create a template in the template space first." : undefined}
      >
        <Select
          value={selection.templateId || "__none__"}
          onValueChange={handleTemplateChange}
          disabled={loading}
        >
          <SelectTrigger
            id="step3-attention-template"
            size="sm"
            className="w-full text-xs"
            aria-label="Layout template"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              {loading ? "Loading templates..." : templates.length === 0 ? "No templates available" : "No attention template"}
            </SelectItem>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}{template.is_system ? " · System" : " · Personal"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InspectorField>

      {selectedTemplate && (
        <>
          <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <span className="rounded-full border bg-background px-2 py-0.5">{config.tracks.length} track{config.tracks.length === 1 ? "" : "s"}</span>
            <span className="rounded-full border bg-background px-2 py-0.5">{templateSlots.length} slot{templateSlots.length === 1 ? "" : "s"}</span>
            <span className="rounded-full border bg-background px-2 py-0.5 capitalize">{config.zone}</span>
            <span className="rounded-full border bg-background px-2 py-0.5">{formatRatio(config.canvasWidth, config.canvasHeight)}</span>
          </div>

          {!templateMatchesOutput && (
            <p className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              This template was authored for {formatRatio(config.canvasWidth, config.canvasHeight)}, while the render is {formatRatio(outputWidth, outputHeight)}. Choose a matching template or output format.
            </p>
          )}

          <div className="flex items-center justify-center rounded-lg border bg-black/30 p-3" data-testid="attention-layout-preview">
            <div
              className="relative max-h-40 max-w-full overflow-hidden rounded-md border border-white/10 bg-gradient-to-b from-zinc-800 to-zinc-950"
              style={{
                aspectRatio: `${config.canvasWidth} / ${config.canvasHeight}`,
                height: config.canvasWidth <= config.canvasHeight ? "10rem" : "auto",
                width: config.canvasWidth > config.canvasHeight ? "100%" : "auto",
              }}
            >
              <div className="absolute inset-x-2 top-2 text-center text-[7px] uppercase tracking-[0.18em] text-white/25">Video frame</div>
              {templateSlots.map(({ image }, index) => {
                const assetUrl = selection.assetUrls.length > 0
                  ? selection.assetUrls[index % selection.assetUrls.length]
                  : undefined;
                return (
                  <div
                    key={image.id}
                    className="absolute grid place-items-center overflow-hidden rounded border border-primary/70 bg-primary/15 text-[9px] font-semibold text-primary"
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
              <div className="absolute inset-x-2 bottom-2 z-20 rounded bg-white/10 px-2 py-0.5 text-center text-[7px] text-white/50">Subtitle safe area</div>
            </div>
          </div>

          <InspectorField
            label="Delay / variant"
            htmlFor="attention-stagger-seconds"
            helper="Offsets each variant so bursts never land on the same second twice."
          >
            <div className="relative">
              <input
                id="attention-stagger-seconds"
                type="number" min={0} max={30} step={0.5}
                value={selection.staggerSeconds}
                onChange={(event) => onSelectionChange({
                  ...selection,
                  staggerSeconds: Math.min(30, Math.max(0, Number(event.target.value) || 0)),
                })}
                className="h-8 w-full rounded-md border bg-background px-2 pr-8 text-xs outline-none focus:border-primary"
                data-testid="attention-stagger-seconds"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">sec</span>
            </div>
          </InspectorField>

          <div className="space-y-2" data-testid="attention-content-slots">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Content images</p>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openAssetPicker(selection.assetUrls.length)}>
                <Images className="size-3.5" />
                Add
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: visibleSlotCount }, (_, index) => {
                const slot = templateSlots[index];
                const assetUrl = selection.assetUrls[index];
                return (
                  <div key={`${slot?.image.id ?? "extra"}-${index}`} className="group overflow-hidden rounded-lg border bg-background transition hover:border-primary/60">
                    <button type="button" className="relative block aspect-square w-full overflow-hidden bg-muted/40" onClick={() => openAssetPicker(index)}>
                      {assetUrl ? (
                        <img src={assetUrl} alt={`Attention content ${index + 1}`} className="size-full object-cover" />
                      ) : (
                        <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
                          <ImagePlus className="size-5 text-primary/80" />
                          <span className="text-[10px]">Choose</span>
                        </span>
                      )}
                      <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-black/75 text-[10px] font-semibold text-white">{index + 1}</span>
                      {assetUrl && (
                        <span className="absolute inset-0 grid place-items-center bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                          <Replace className="size-4" />
                        </span>
                      )}
                    </button>
                    {assetUrl && (
                      <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                        <span className="truncate text-[9px] text-muted-foreground">{slot ? `Slot ${index + 1}` : `Extra ${index - templateSlots.length + 1}`}</span>
                        <button type="button" onClick={() => removeAsset(index)} className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove content image ${index + 1}`}>
                          <X className="size-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Images fill the numbered slots in order. With fewer images than slots, they repeat automatically.
            </p>
          </div>
        </>
      )}

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
