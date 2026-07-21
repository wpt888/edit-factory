import type { UserSubtitlePreset } from "@/types/video-processing";

export type SubtitleTemplateGroup = {
  id: string;
  name: string;
  presets: UserSubtitlePreset[];
};

export function getSubtitleTemplateGroups(
  presets: UserSubtitlePreset[],
): SubtitleTemplateGroup[] {
  const groups = new Map<string, SubtitleTemplateGroup>();

  for (const preset of presets) {
    const id = preset.templateId ?? preset.id;
    const group = groups.get(id) ?? {
      id,
      name: preset.templateName ?? preset.name,
      presets: [],
    };
    group.presets.push(preset);
    groups.set(id, group);
  }

  return [...groups.values()];
}

export function findMatchingSubtitleTemplateGroup(
  templateGroups: SubtitleTemplateGroup[],
  presetIds: string[],
): SubtitleTemplateGroup | undefined {
  return templateGroups.find((template) => (
    template.presets.length === presetIds.length
    && template.presets.every((preset, index) => preset.id === presetIds[index])
  ));
}

export function getAssignedSubtitleStyleCount(
  presetIds: string[],
  presets: UserSubtitlePreset[],
): number {
  const savedPresetIds = new Set(presets.map((preset) => preset.id));
  return presetIds.filter((presetId) => savedPresetIds.has(presetId)).length;
}

export function formatSubtitleStyleCount(count: number): string {
  return `${count} ${count === 1 ? "style" : "styles"}`;
}
