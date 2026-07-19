"use client";

import { useEffect, useState } from "react";
import { Images, LayoutTemplate } from "lucide-react";

import { Button } from "@/components/ui/button";
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
};

/** Step 1 attention-template pick: choose template + source images upfront;
 *  the pipeline auto-applies them to each variant once previews exist. */
export function AttentionTemplatePicker({
  selection,
  onSelectionChange,
}: AttentionTemplatePickerProps) {
  const [templates, setTemplates] = useState<AttentionTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="attention-template-picker">
      <div className="flex items-center gap-2">
        <LayoutTemplate className="size-4 text-primary" />
        <div>
          <p className="text-sm font-medium">Attention template</p>
          <p className="text-[11px] text-muted-foreground">
            Pick a template and images now — they are applied automatically when previews are built.
          </p>
        </div>
      </div>

      <label className="block space-y-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Template
        <select
          value={selection.templateId}
          onChange={(event) => onSelectionChange({ ...selection, templateId: event.target.value })}
          disabled={loading}
          className="h-9 w-full rounded-md border bg-background px-2 text-xs normal-case tracking-normal outline-none focus:border-primary"
        >
          <option value="">{templates.length === 0 ? "No templates available" : "No attention template"}</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}{template.is_system ? " · System" : " · Personal"}
            </option>
          ))}
        </select>
      </label>

      {selectedTemplate && (
        <div className="grid grid-cols-3 gap-1.5 text-[10px] text-muted-foreground">
          <span className="rounded bg-muted px-2 py-1">{config.layers} layer{config.layers === 1 ? "" : "s"}</span>
          <span className="rounded bg-muted px-2 py-1">{Math.round(config.size * 100)}% size</span>
          <span className="rounded bg-muted px-2 py-1 capitalize">{config.zone}</span>
        </div>
      )}

      {selection.templateId && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Stagger / variant (s)
            <input
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={selection.staggerSeconds}
              onChange={(event) => onSelectionChange({
                ...selection,
                staggerSeconds: Math.min(30, Math.max(0, Number(event.target.value) || 0)),
              })}
              className="h-9 w-full rounded-md border bg-background px-2 text-xs normal-case tracking-normal outline-none focus:border-primary"
              data-testid="attention-stagger-seconds"
            />
          </label>
          <label className="block space-y-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Variants (0 = all)
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={selection.maxVariants}
              onChange={(event) => onSelectionChange({
                ...selection,
                maxVariants: Math.min(100, Math.max(0, Math.round(Number(event.target.value) || 0))),
              })}
              className="h-9 w-full rounded-md border bg-background px-2 text-xs normal-case tracking-normal outline-none focus:border-primary"
              data-testid="attention-max-variants"
            />
          </label>
          <p className="col-span-2 text-[10px] text-muted-foreground">
            Variant 1 keeps the template timing, variant 2 shifts +{selection.staggerSeconds}s, variant 3 +{(selection.staggerSeconds * 2).toFixed(1).replace(/\.0$/, "")}s, and so on.
          </p>
        </div>
      )}

      {selection.templateId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Source images</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setPickerOpen(true)}
            >
              <Images className="size-3.5" />
              Gallery / Upload
            </Button>
          </div>
          {selection.assetUrls.length === 0 ? (
            <p className="rounded border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
              Add at least one image. Three images make the stacked templates easiest to see.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {selection.assetUrls.map((url, index) => (
                <div key={url} className="group relative overflow-hidden rounded border bg-muted">
                  <img src={url} alt="" className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded bg-black/75 px-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => onSelectionChange({
                      ...selection,
                      assetUrls: selection.assetUrls.filter((_, itemIndex) => itemIndex !== index),
                    })}
                    aria-label={`Remove source image ${index + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AttentionAssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(url) => {
          if (!selection.assetUrls.includes(url)) {
            onSelectionChange({ ...selection, assetUrls: [...selection.assetUrls, url] });
          }
        }}
      />
    </div>
  );
}
