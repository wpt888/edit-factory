"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleDashed,
  MoveRight,
  Search,
  Sparkles,
  ZoomIn,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ATTENTION_ANIMATION_OPTIONS,
  attentionAnimationLabel,
  type AttentionAnimationPreset,
} from "@/types/attention-timeline";

const INHERIT_EFFECT_VALUE = "__inherit__";

const EFFECT_GROUPS: ReadonlyArray<{
  label: string;
  values: ReadonlyArray<AttentionAnimationPreset>;
}> = [
  { label: "Essentials", values: ["static", "fade"] },
  { label: "Motion", values: ["zoom", "slide", "slide-right", "slide-up", "slide-down"] },
  { label: "Reveals", values: ["wipe-left", "wipe-right"] },
  { label: "Stylized", values: ["pop", "bounce", "spin", "tornado"] },
];

type AttentionEffectLibraryProps = {
  value?: AttentionAnimationPreset;
  /** Optional applied-timeline value shown instead of a next-apply selection. */
  displayValue?: AttentionAnimationPreset;
  mixed?: boolean;
  inherited?: {
    animation: AttentionAnimationPreset;
    label: string;
  };
  onValueChange: (value: AttentionAnimationPreset | undefined) => void;
  ariaLabel: string;
  testId?: string;
};

/**
 * Shared, searchable effect browser used by Content Templates and Pipeline.
 * It deliberately behaves like an editor effects panel rather than a long
 * select menu, while preserving combobox/listbox semantics for keyboard and
 * automated access.
 */
export function AttentionEffectLibrary({
  value,
  displayValue,
  mixed = false,
  inherited,
  onValueChange,
  ariaLabel,
  testId,
}: AttentionEffectLibraryProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedValue = mixed
    ? "__mixed__"
    : displayValue ?? value ?? (inherited ? INHERIT_EFFECT_VALUE : "static");
  const selectedLabel = mixed
    ? "Mixed applied effects"
    : displayValue
      ? attentionAnimationLabel(displayValue)
      : value
        ? attentionAnimationLabel(value)
        : inherited
          ? `${inherited.label} · ${attentionAnimationLabel(inherited.animation)}`
          : attentionAnimationLabel("static");

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return EFFECT_GROUPS.map((group) => ({
      ...group,
      options: group.values
        .map((preset) => ATTENTION_ANIMATION_OPTIONS.find((option) => option.value === preset))
        .filter((option): option is (typeof ATTENTION_ANIMATION_OPTIONS)[number] => Boolean(option))
        .filter((option) => !normalizedQuery
          || `${option.label} ${option.description}`.toLowerCase().includes(normalizedQuery)),
    })).filter((group) => group.options.length > 0);
  }, [query]);

  const choose = (nextValue: AttentionAnimationPreset | typeof INHERIT_EFFECT_VALUE) => {
    onValueChange(nextValue === INHERIT_EFFECT_VALUE ? undefined : nextValue);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setQuery("");
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          className="w-full justify-between text-xs font-normal"
          data-testid={testId}
        >
          <span className="flex min-w-0 items-center gap-2">
            <EffectGlyph preset={displayValue ?? value ?? inherited?.animation ?? "static"} />
            <span className="truncate">{selectedLabel}</span>
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <PopoverHeader className="border-b border-border px-3 py-3">
          <PopoverTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-primary" />
            Entrance effects
          </PopoverTitle>
          <PopoverDescription className="text-[11px]">
            Search the shared Content Templates and Pipeline effect library.
          </PopoverDescription>
          <div className="relative pt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search effects..."
              className="h-8 pl-8 text-xs"
              aria-label="Search entrance effects"
            />
          </div>
        </PopoverHeader>

        <div
          role="listbox"
          aria-label="Entrance effects"
          className="max-h-[min(26rem,60vh)] overflow-y-auto p-2"
        >
          {inherited && !query.trim() && (
            <EffectOption
              label={`${inherited.label} · ${attentionAnimationLabel(inherited.animation)}`}
              description="Follow the effect saved on the selected template"
              preset={inherited.animation}
              selected={selectedValue === INHERIT_EFFECT_VALUE}
              onSelect={() => choose(INHERIT_EFFECT_VALUE)}
            />
          )}

          {filteredGroups.map((group) => (
            <div key={group.label} className="py-1">
              <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <div className="grid gap-1 sm:grid-cols-2">
                {group.options.map((option) => (
                  <EffectOption
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    preset={option.value}
                    selected={selectedValue === option.value}
                    onSelect={() => choose(option.value)}
                  />
                ))}
              </div>
            </div>
          ))}

          {filteredGroups.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No effects match “{query}”.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EffectOption({
  label,
  description,
  preset,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  preset: AttentionAnimationPreset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      role="option"
      aria-selected={selected}
      variant="ghost"
      className={cn(
        "h-auto min-w-0 justify-start gap-2 px-2 py-2 text-left",
        selected && "bg-accent",
      )}
      onClick={onSelect}
    >
      <EffectGlyph preset={preset} className="size-8" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <span className="truncate">{label}</span>
          {selected && <Check className="ml-auto size-3.5 text-primary" />}
        </span>
        <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
          {description}
        </span>
      </span>
    </Button>
  );
}

function EffectGlyph({
  preset,
  className,
}: {
  preset: AttentionAnimationPreset;
  className?: string;
}) {
  const Icon = preset === "static"
    ? CircleDashed
    : preset === "fade"
      ? CircleDashed
      : preset === "zoom" || preset === "pop"
        ? ZoomIn
        : preset.startsWith("slide") || preset.startsWith("wipe")
          ? MoveRight
          : Sparkles;
  return (
    <span className={cn(
      "grid size-5 shrink-0 place-items-center rounded border border-border bg-background text-muted-foreground",
      preset !== "static" && "text-primary",
      className,
    )}>
      <Icon className="size-3.5" />
    </span>
  );
}
