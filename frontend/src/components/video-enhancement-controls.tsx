"use client"

import * as React from "react"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

export interface VideoFilters {
  enableDenoise: boolean
  denoiseStrength: number
  enableSharpen: boolean
  sharpenAmount: number
  enableColor: boolean
  brightness: number
  contrast: number
  saturation: number
}

interface VideoEnhancementControlsProps {
  filters: VideoFilters
  onFilterChange: (filters: VideoFilters) => void
  disabled?: boolean
}

export const defaultVideoFilters: VideoFilters = {
  enableDenoise: false,
  denoiseStrength: 2.0,
  enableSharpen: false,
  sharpenAmount: 0.5,
  enableColor: false,
  brightness: 0.0,
  contrast: 1.0,
  saturation: 1.0,
}

export function VideoEnhancementControls({
  filters,
  onFilterChange,
  disabled = false,
}: VideoEnhancementControlsProps) {
  const updateFilters = (updates: Partial<VideoFilters>) => {
    onFilterChange({ ...filters, ...updates })
  }

  return (
    <div className="space-y-4">
      {/* Denoise Section */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-denoise"
            checked={filters.enableDenoise}
            onCheckedChange={(checked) =>
              updateFilters({ enableDenoise: !!checked })
            }
            disabled={disabled}
          />
          <Label
            htmlFor="enable-denoise"
            className="text-sm font-medium cursor-pointer"
          >
            Denoise (reduce grain)
          </Label>
        </div>

        {filters.enableDenoise && (
          <div className="ml-6 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Strength</span>
              <span>{filters.denoiseStrength.toFixed(1)}</span>
            </div>
            <Slider
              value={[filters.denoiseStrength]}
              onValueChange={([value]) =>
                updateFilters({ denoiseStrength: value })
              }
              min={1.0}
              max={4.0}
              step={0.1}
              disabled={disabled}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher = stronger noise reduction (may blur details)
            </p>
          </div>
        )}
      </div>

      {/* Sharpen Section */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-sharpen"
            checked={filters.enableSharpen}
            onCheckedChange={(checked) =>
              updateFilters({ enableSharpen: !!checked })
            }
            disabled={disabled}
          />
          <Label
            htmlFor="enable-sharpen"
            className="text-sm font-medium cursor-pointer"
          >
            Sharpen (enhance clarity)
          </Label>
        </div>

        {filters.enableSharpen && (
          <div className="ml-6 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Amount</span>
              <span>{filters.sharpenAmount.toFixed(2)}</span>
            </div>
            <Slider
              value={[filters.sharpenAmount]}
              onValueChange={([value]) =>
                updateFilters({ sharpenAmount: value })
              }
              min={0.2}
              max={1.0}
              step={0.05}
              disabled={disabled}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher = sharper edges (may create halos if too high)
            </p>
          </div>
        )}
      </div>

      {/* Color Correction Section */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-color"
            checked={filters.enableColor}
            onCheckedChange={(checked) =>
              updateFilters({ enableColor: !!checked })
            }
            disabled={disabled}
          />
          <Label
            htmlFor="enable-color"
            className="text-sm font-medium cursor-pointer"
          >
            Color Correction
          </Label>
        </div>

        {filters.enableColor && (
          <div className="ml-6 space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Brightness</span>
                <span>
                  {filters.brightness > 0 ? "+" : ""}
                  {filters.brightness.toFixed(2)}
                </span>
              </div>
              <Slider
                value={[filters.brightness]}
                onValueChange={([value]) =>
                  updateFilters({ brightness: value })
                }
                min={-0.2}
                max={0.2}
                step={0.01}
                disabled={disabled}
                className="w-full"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Contrast</span>
                <span>{filters.contrast.toFixed(2)}x</span>
              </div>
              <Slider
                value={[filters.contrast]}
                onValueChange={([value]) => updateFilters({ contrast: value })}
                min={0.8}
                max={1.3}
                step={0.05}
                disabled={disabled}
                className="w-full"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Saturation</span>
                <span>{filters.saturation.toFixed(2)}x</span>
              </div>
              <Slider
                value={[filters.saturation]}
                onValueChange={([value]) =>
                  updateFilters({ saturation: value })
                }
                min={0.8}
                max={1.2}
                step={0.05}
                disabled={disabled}
                className="w-full"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
