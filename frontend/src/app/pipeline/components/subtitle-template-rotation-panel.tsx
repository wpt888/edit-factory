"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import type { SubtitleSettings, UserSubtitlePreset } from "@/types/video-processing";
import type { SubtitleTemplateRotation } from "../subtitle-template-rotation";

type Props = {
  rotation: SubtitleTemplateRotation;
  presets: UserSubtitlePreset[];
  onChange: (rotation: SubtitleTemplateRotation) => void;
  onUpdatePreset: (presetId: string, settings: SubtitleSettings, wordsPerSubtitle: number) => void;
};

export function SubtitleTemplateRotationPanel({ rotation, presets, onChange, onUpdatePreset }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingPreset = presets.find((preset) => preset.id === editingId);
  const [draftSettings, setDraftSettings] = useState<SubtitleSettings | null>(null);
  const [draftWords, setDraftWords] = useState(2);
  const unusedPresets = useMemo(
    () => presets.filter((preset) => !rotation.presetIds.includes(preset.id)),
    [presets, rotation.presetIds],
  );

  const replaceAt = (index: number, presetId: string) => {
    const presetIds = [...rotation.presetIds];
    presetIds[index] = presetId;
    onChange({ ...rotation, presetIds });
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rotation.presetIds.length) return;
    const presetIds = [...rotation.presetIds];
    [presetIds[index], presetIds[target]] = [presetIds[target], presetIds[index]];
    onChange({ ...rotation, presetIds });
  };

  const openEditor = (preset: UserSubtitlePreset) => {
    setEditingId(preset.id);
    setDraftSettings({ ...preset.settings });
    setDraftWords(preset.wordsPerSubtitle ?? 2);
  };

  return (
    <div className="space-y-3 rounded-md border border-border/70 bg-background/45 p-3" data-testid="subtitle-template-rotation">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Template rotation</p>
          <p className="text-xs text-muted-foreground">Assign these caption looks to variants in order, then repeat.</p>
        </div>
        <Switch
          aria-label="Enable subtitle template rotation"
          checked={rotation.enabled}
          onCheckedChange={(enabled) => onChange({ ...rotation, enabled })}
        />
      </div>

      {rotation.enabled && (
        <div className="space-y-2">
          {rotation.presetIds.map((presetId, index) => {
            const preset = presets.find((candidate) => candidate.id === presetId);
            return (
              <div key={`${presetId}-${index}`} className="flex items-center gap-1.5" data-testid="subtitle-rotation-row">
                <span className="w-6 shrink-0 text-center text-xs font-semibold text-primary">{index + 1}</span>
                <Select value={presetId} onValueChange={(value) => replaceAt(index, value)}>
                  <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={`Rotation template ${index + 1}`}>
                    <SelectValue placeholder="Choose template" />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((candidate) => (
                      <SelectItem
                        key={candidate.id}
                        value={candidate.id}
                        disabled={candidate.id !== presetId && rotation.presetIds.includes(candidate.id)}
                      >
                        {candidate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="w-8 text-center text-[11px] text-muted-foreground">{preset?.wordsPerSubtitle ?? 2}w</span>
                {preset && (
                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Edit ${preset.name}`} onClick={() => openEditor(preset)}>
                    <Pencil className="size-3.5" />
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Move template ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Move template ${index + 1} down`} disabled={index === rotation.presetIds.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive"
                  aria-label={`Remove template ${index + 1}`}
                  onClick={() => onChange({
                    ...rotation,
                    presetIds: rotation.presetIds.filter((_, candidateIndex) => candidateIndex !== index),
                  })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}

          {unusedPresets.length > 0 && (
            <Select
              value=""
              onValueChange={(presetId) => onChange({
                ...rotation,
                presetIds: [...rotation.presetIds, presetId],
              })}
            >
              <SelectTrigger className="h-8 w-full border-dashed text-xs" aria-label="Add subtitle template to rotation">
                <Plus className="mr-1 size-3.5" />
                <SelectValue placeholder="Add template" />
              </SelectTrigger>
              <SelectContent>
                {unusedPresets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {presets.length === 0 && (
            <p className="text-xs text-amber-500">Save at least one subtitle preset to build a rotation.</p>
          )}
        </div>
      )}

      <Dialog open={editingId !== null} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit template · {editingPreset?.name}</DialogTitle>
            <DialogDescription>Every currently assigned variant updates; variant overrides stay untouched.</DialogDescription>
          </DialogHeader>
          {draftSettings && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <Label htmlFor="template-words-per-subtitle">Words per subtitle</Label>
                <Input
                  id="template-words-per-subtitle"
                  type="number"
                  min={1}
                  max={20}
                  className="w-20"
                  value={draftWords}
                  onChange={(event) => setDraftWords(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                />
              </div>
              <SubtitleEditor
                renderMode="settings-only"
                settings={draftSettings}
                onSettingsChange={setDraftSettings}
                showPreview={false}
                compact
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
            <Button
              disabled={!editingPreset || !draftSettings}
              onClick={() => {
                if (!editingPreset || !draftSettings) return;
                onUpdatePreset(editingPreset.id, draftSettings, draftWords);
                setEditingId(null);
              }}
            >
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
