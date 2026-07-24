"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InspectorField } from "@/components/ui/inspector";
import { AttentionEffectLibrary } from "@/components/attention-effect-library";
import type { AttentionAnimationPreset } from "@/types/attention-timeline";

type AttentionEffectControlsProps = {
  animation?: AttentionAnimationPreset;
  enterMs?: number;
  applied?: {
    animation?: AttentionAnimationPreset;
    enterMs?: number;
    mixedAnimation: boolean;
    mixedEnterMs: boolean;
  };
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
  applied,
  inherited,
  onAnimationChange,
  onEnterMsChange,
  onReset,
  effectLabel = "Entrance effect",
  helper,
  testIdPrefix,
}: AttentionEffectControlsProps) {
  const resolvedAnimation = applied?.mixedAnimation
    ? undefined
    : applied?.animation ?? animation ?? inherited?.animation ?? "static";
  const resolvedEnterMs = Math.max(0, Math.min(10_000, Math.round(
    applied?.enterMs ?? enterMs ?? inherited?.enterMs ?? 250,
  )));
  const hasOverride = animation !== undefined || enterMs !== undefined;
  const isMixed = applied?.mixedAnimation === true;

  return (
    <div
      className="grid gap-3 min-[420px]:grid-cols-2"
      data-testid={`${testIdPrefix}-effect-controls`}
    >
      <InspectorField
        label={effectLabel}
        helper={helper}
        className={isMixed || resolvedAnimation === "static" ? "min-[420px]:col-span-2" : undefined}
      >
        <AttentionEffectLibrary
          value={animation}
          displayValue={applied?.animation}
          mixed={isMixed}
          inherited={inherited}
          onValueChange={onAnimationChange}
          ariaLabel={effectLabel}
          testId={`${testIdPrefix}-effect-select`}
        />
      </InspectorField>

      {isMixed ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground min-[420px]:col-span-2">
          Applied cues currently use different entrance effects. Choose one effect to update every slot in the selected scope.
        </p>
      ) : resolvedAnimation === "static" ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground min-[420px]:col-span-2">
          No entrance animation is applied. Content appears instantly at the start of its slot.
        </p>
      ) : (
        <InspectorField
          label="Entrance duration"
          helper={applied?.mixedEnterMs
            ? "Applied cues currently use different entrance durations."
            : enterMs === undefined && inherited
              ? `${inherited.label}: ${(inherited.enterMs / 1000).toFixed(2)} sec`
              : undefined}
        >
          <div className="relative">
            <Input
              type="number"
              min={0.05}
              max={10}
              step={0.05}
              value={applied?.mixedEnterMs ? "" : Number((resolvedEnterMs / 1000).toFixed(2))}
              placeholder={applied?.mixedEnterMs ? "Mixed" : undefined}
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
