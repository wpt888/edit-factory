"use client"

import * as React from "react"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { SubtitleSettings } from "@/types/video-processing"

interface SubtitleEnhancementControlsProps {
  settings: SubtitleSettings
  onSettingsChange: (updates: Partial<SubtitleSettings>) => void
  disabled?: boolean
}

export function SubtitleEnhancementControls({
  settings,
  onSettingsChange,
  disabled = false,
}: SubtitleEnhancementControlsProps) {
  const updateSettings = (updates: Partial<SubtitleSettings>) => {
    onSettingsChange(updates)
  }

  const shadowEnabled = (settings.shadowDepth ?? 0) > 0
  const glowEnabled = settings.enableGlow ?? false
  const adaptiveEnabled = settings.adaptiveSizing ?? false

  return (
    <div className="space-y-4">
      {/* Shadow Effect Section (SUB-01) */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-shadow"
            checked={shadowEnabled}
            onCheckedChange={(checked) => {
              if (checked) {
                updateSettings({ shadowDepth: 2 })
              } else {
                updateSettings({ shadowDepth: 0 })
              }
            }}
            disabled={disabled}
          />
          <Label
            htmlFor="enable-shadow"
            className="text-sm font-medium cursor-pointer"
          >
            Shadow Effect
          </Label>
        </div>

        {shadowEnabled && (
          <div className="ml-6 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Depth</span>
              <span>{settings.shadowDepth ?? 2}px</span>
            </div>
            <Slider
              value={[settings.shadowDepth ?? 2]}
              onValueChange={([value]) =>
                updateSettings({ shadowDepth: value })
              }
              min={1}
              max={4}
              step={1}
              disabled={disabled}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values = deeper shadow (improves readability on bright backgrounds)
            </p>
          </div>
        )}
      </div>

      {/* Glow/Outline Effect Section (SUB-02) */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-glow"
            checked={glowEnabled}
            onCheckedChange={(checked) => {
              if (checked) {
                updateSettings({ enableGlow: true, glowBlur: 3 })
              } else {
                updateSettings({ enableGlow: false, glowBlur: 0 })
              }
            }}
            disabled={disabled}
          />
          <Label
            htmlFor="enable-glow"
            className="text-sm font-medium cursor-pointer"
          >
            Glow/Outline Effect
          </Label>
        </div>

        {glowEnabled && (
          <div className="ml-6 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Intensity</span>
              <span>{settings.glowBlur ?? 3}</span>
            </div>
            <Slider
              value={[settings.glowBlur ?? 3]}
              onValueChange={([value]) =>
                updateSettings({ glowBlur: value })
              }
              min={1}
              max={10}
              step={1}
              disabled={disabled}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values = wider glow (best for busy/dark backgrounds)
            </p>
          </div>
        )}
      </div>

      {/* Adaptive Font Sizing Section (SUB-03) */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-adaptive"
            checked={adaptiveEnabled}
            onCheckedChange={(checked) => {
              updateSettings({ adaptiveSizing: !!checked })
            }}
            disabled={disabled}
          />
          <Label
            htmlFor="enable-adaptive"
            className="text-sm font-medium cursor-pointer"
          >
            Auto-size Text
          </Label>
        </div>

        {adaptiveEnabled && (
          <div className="ml-6">
            <p className="text-xs text-muted-foreground">
              Automatically reduces font size for long text (40+ characters) to prevent overflow. Base size: {settings.fontSize}px
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
