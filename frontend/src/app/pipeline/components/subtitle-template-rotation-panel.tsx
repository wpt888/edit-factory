"use client";

import { useMemo, useState, type Ref } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_SUBTITLE_SETTINGS,
  type SubtitleSettings,
  type UserSubtitlePreset,
} from "@/types/video-processing";
import {
  NO_SUBTITLES_PRESET_ID,
  type SubtitleTemplateRotation,
} from "../subtitle-template-rotation";
import {
  formatSubtitleStyleCount,
  getAssignedSubtitleStyleCount,
} from "../subtitle-template-collections";

type Props = {
  rotation: SubtitleTemplateRotation;
  presets: UserSubtitlePreset[];
  onChange: (rotation: SubtitleTemplateRotation) => void;
  onSaveStyles?: (styles: UserSubtitlePreset[]) => Promise<boolean>;
  panelRef?: Ref<HTMLDivElement>;
};

function copyPreset(preset: UserSubtitlePreset): UserSubtitlePreset {
  return {
    ...preset,
    settings: { ...preset.settings },
    settingsA: preset.settingsA ? { ...preset.settingsA } : undefined,
    settingsB: preset.settingsB ? { ...preset.settingsB } : undefined,
  };
}

export function SubtitleTemplateRotationPanel({
  rotation,
  presets,
  onChange,
  onSaveStyles,
  panelRef,
}: Props) {
  const [draftPreset, setDraftPreset] = useState<UserSubtitlePreset | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserSubtitlePreset | null>(null);
  const assignedStyleCount = useMemo(
    () => getAssignedSubtitleStyleCount(rotation.presetIds, presets),
    [presets, rotation.presetIds],
  );
  const templateStyles = useMemo(
    () => rotation.presetIds.flatMap((presetId) => {
      const preset = presets.find((candidate) => candidate.id === presetId);
      return preset ? [preset] : [];
    }),
    [presets, rotation.presetIds],
  );

  const beginAdd = () => {
    setDraftPreset({
      id: `new-${Date.now()}`,
      name: `Style ${templateStyles.length + 1}`,
      created_at: "",
      settings: { ...DEFAULT_SUBTITLE_SETTINGS },
      wordsPerSubtitle: 2,
      templateId: templateStyles[0]?.templateId,
      templateName: templateStyles[0]?.templateName,
    });
  };

  const saveDraft = async () => {
    if (!draftPreset || !onSaveStyles) return;
    const name = draftPreset.name.trim();
    if (!name) {
      toast.error("Style name cannot be empty");
      return;
    }

    const exists = templateStyles.some((style) => style.id === draftPreset.id);
    const nextStyles = exists
      ? templateStyles.map((style) => style.id === draftPreset.id ? { ...copyPreset(draftPreset), name } : style)
      : [...templateStyles, { ...copyPreset(draftPreset), name }];

    setSaving(true);
    const saved = await onSaveStyles(nextStyles);
    setSaving(false);
    if (saved) {
      setDraftPreset(null);
      toast.success(exists ? "Subtitle style updated" : "Subtitle style added");
    }
  };

  const deleteStyle = async () => {
    if (!deleteTarget || !onSaveStyles || templateStyles.length <= 1) return;
    setSaving(true);
    const saved = await onSaveStyles(templateStyles.filter((style) => style.id !== deleteTarget.id));
    setSaving(false);
    if (saved) {
      setDeleteTarget(null);
      toast.success("Subtitle style deleted");
    }
  };

  return (
    <div
      id="subtitle-template-rotation-panel"
      ref={panelRef}
      tabIndex={-1}
      className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="subtitle-template-rotation"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Automatic rotation</p>
          <p className="text-[11px] text-muted-foreground" data-testid="subtitle-rotation-summary">
            {rotation.enabled
              ? "Template styles follow their saved order, then repeat."
              : `${formatSubtitleStyleCount(assignedStyleCount)} ready · off`}
          </p>
        </div>
        <Switch
          aria-label="Enable subtitle template rotation"
          checked={rotation.enabled}
          onCheckedChange={(enabled) => onChange({ ...rotation, enabled })}
        />
      </div>

      {rotation.presetIds.length > 0 && (
        <div className="divide-y divide-border/70" role="list" aria-label="Template style order">
          {rotation.presetIds.map((presetId, index) => {
            const preset = presets.find((candidate) => candidate.id === presetId);
            const label = presetId === NO_SUBTITLES_PRESET_ID
              ? "No subtitles"
              : preset?.name ?? "Unavailable style";
            const words = presetId === NO_SUBTITLES_PRESET_ID
              ? "Off"
              : `${preset?.wordsPerSubtitle ?? 2}w`;

            return (
              <div
                key={`${presetId}-${index}`}
                className="flex min-h-8 items-center gap-1 py-1"
                role="listitem"
                data-testid="subtitle-rotation-row"
              >
                <span className="w-6 shrink-0 text-center text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs" title={label}>{label}</span>
                <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground">{words}</span>
                {preset && onSaveStyles && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      aria-label={`Edit ${preset.name}`}
                      onClick={() => setDraftPreset(copyPreset(preset))}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Delete ${preset.name}`}
                      title={templateStyles.length <= 1 ? "A template must keep at least one style" : `Delete ${preset.name}`}
                      disabled={templateStyles.length <= 1}
                      onClick={() => setDeleteTarget(preset)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {onSaveStyles && (
        <Button type="button" variant="outline" size="sm" className="h-8 w-full border-dashed text-xs" onClick={beginAdd}>
          <Plus className="size-3.5" />
          Add style
        </Button>
      )}

      {rotation.presetIds.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          This template has no styles yet.
        </p>
      )}

      <Dialog open={draftPreset !== null} onOpenChange={(open) => { if (!open && !saving) setDraftPreset(null); }}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {draftPreset && templateStyles.some((style) => style.id === draftPreset.id)
                ? "Edit subtitle style"
                : "Add subtitle style"}
            </DialogTitle>
            <DialogDescription>
              Changes stay inside the selected template and update its automatic rotation.
            </DialogDescription>
          </DialogHeader>
          {draftPreset && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="rotation-style-name" className="text-xs text-muted-foreground">Style name</Label>
                  <Input
                    id="rotation-style-name"
                    className="h-8 text-xs"
                    value={draftPreset.name}
                    onChange={(event) => setDraftPreset((current) => current ? { ...current, name: event.target.value } : current)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rotation-style-words" className="text-xs text-muted-foreground">Words per subtitle</Label>
                  <Input
                    id="rotation-style-words"
                    type="number"
                    min={1}
                    max={20}
                    className="h-8 text-xs"
                    value={draftPreset.wordsPerSubtitle ?? 2}
                    onChange={(event) => {
                      const wordsPerSubtitle = Math.max(1, Math.min(20, Number(event.target.value) || 1));
                      setDraftPreset((current) => current ? { ...current, wordsPerSubtitle } : current);
                    }}
                  />
                </div>
              </div>
              <SubtitleEditor
                renderMode="settings-only"
                settings={draftPreset.settings as SubtitleSettings}
                onSettingsChange={(settings) => setDraftPreset((current) => current ? { ...current, settings } : current)}
                showPreview={false}
                compact
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setDraftPreset(null)}>Cancel</Button>
            <Button type="button" disabled={saving || !draftPreset?.name.trim()} onClick={() => void saveDraft()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save style
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !saving) setDeleteTarget(null); }}
        title="Delete subtitle style?"
        description={`This permanently removes “${deleteTarget?.name ?? "this style"}” from the selected template.`}
        confirmLabel="Delete style"
        variant="destructive"
        loading={saving}
        onConfirm={() => void deleteStyle()}
      />
    </div>
  );
}
