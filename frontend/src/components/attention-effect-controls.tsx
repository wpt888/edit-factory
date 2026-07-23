"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InspectorField } from "@/components/ui/inspector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ATTENTION_ANIMATION_OPTIONS,
  attentionAnimationLabel,
  type AttentionAnimationPreset,
} from "@/types/attention-timeline";

const INHERIT_EFFECT_VALUE = "__inherit__";

type AttentionEffectControlsProps = {
  animation?: AttentionAnimationPreset;
  enterMs?: number;
  inherited?: {
    animation: AttentionAnimationPreset;
    enterMs: number;
    label: string;
  };
  onAnimationChange: (animation: AttentionAnimationPreset | undefined) => void;
  onEnterMsChange: (enterMs: number | undefined) => void;
  onReset?: () => void;
  effectLabel?: string;
  helper?: string;
  testIdPrefix: string;
};

/** Shared entrance-effect grammar for authored template slots and applied
 * pipeline cues. Keeping this control in one place prevents the two editors
 * from exposing different preset names, timing ranges, or inheritance rules. */
export function AttentionEffectControls({
  animation,
  enterMs,
  inherited,
  onAnimationChange,
  onEnterMsChange,
  onReset,
  effectLabel = "Entrance effect",
  helper,
  testIdPrefix,
}: AttentionEffectControlsProps) {
  const resolvedAnimation = animation ?? inherited?.animation ?? "static";
  const resolvedEnterMs = Math.max(0, Math.min(10_000, Math.round(
    enterMs ?? inherited?.enterMs ?? 250,
  )));
  const hasOverride = animation !== undefined || enterMs !== undefined;

  return (
    <div
      className="grid gap-3 min-[420px]:grid-cols-2"
      data-testid={`${testIdPrefix}-effect-controls`}
    >
      <InspectorField
        label={effectLabel}
        helper={helper}
        className={resolvedAnimation === "static" ? "min-[420px]:col-span-2" : undefined}
      >
        <Select
          value={animation ?? (inherited ? INHERIT_EFFECT_VALUE : resolvedAnimation)}
          onValueChange={(value) => onAnimationChange(
            value === INHERIT_EFFECT_VALUE ? undefined : value as AttentionAnimationPreset,
          )}
        >
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            aria-label={effectLabel}
            data-testid={`${testIdPrefix}-effect-select`}
          >
            <SelectValue>
              {animation
                ? attentionAnimationLabel(animation)
                : inherited
                  ? `${inherited.label} · ${attentionAnimationLabel(inherited.animation)}`
                  : attentionAnimationLabel(resolvedAnimation)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {inherited && (
              <SelectItem value={INHERIT_EFFECT_VALUE}>
                {inherited.label} · {attentionAnimationLabel(inherited.animation)}
              </SelectItem>
            )}
            {ATTENTION_ANIMATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
                <span className="ml-2 text-[11px] text-muted-foreground">{option.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InspectorField>

      {resolvedAnimation === "static" ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground min-[420px]:col-span-2">
          No entrance animation is applied. The image appears instantly at the start of its slot.
        </p>
      ) : (
        <InspectorField
          label="Entrance duration"
          helper={enterMs === undefined && inherited ? `${inherited.label}: ${(inherited.enterMs / 1000).toFixed(2)} sec` : undefined}
        >
          <div className="relative">
            <Input
              type="number"
              min={0.05}
              max={10}
              step={0.05}
              value={Number((resolvedEnterMs / 1000).toFixed(2))}
              onChange={(event) => onEnterMsChange(
                Math.max(50, Math.min(10_000, Math.round((Number(event.target.value) || 0.05) * 1000))),
              )}
              className="h-8 px-2 pr-10 text-xs"
              aria-label="Entrance duration"
              data-testid={`${testIdPrefix}-enter-duration`}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">sec</span>
          </div>
        </InspectorField>
      )}

      {inherited && hasOverride && onReset && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-fit text-xs min-[420px]:col-span-2"
          onClick={onReset}
        >
          Reset to {inherited.label.toLowerCase()}
        </Button>
      )}
    </div>
  );
}
