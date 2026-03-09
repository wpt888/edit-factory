"use client";

import { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Type } from "lucide-react";
import {
  SubtitleSettings,
  SubtitleLine,
  FONT_OPTIONS,
  COLOR_PRESETS,
  VideoInfo,
  CAPTION_PRESETS,
  CaptionPreset,
} from "@/types/video-processing";

// Bug #126: stable default to avoid invalidating useMemo on every render
const DEFAULT_VIDEO_INFO: VideoInfo = { width: 1080, height: 1920, duration: 0, fps: 30, aspect_ratio: "9:16", is_vertical: true };

interface SubtitleEditorProps {
  /** Current subtitle settings */
  settings: SubtitleSettings;
  /** Called when settings change */
  onSettingsChange: (settings: SubtitleSettings) => void;
  /** Subtitle lines (SRT parsed) */
  subtitleLines?: SubtitleLine[];
  /** Called when subtitle lines change */
  onLinesChange?: (lines: SubtitleLine[]) => void;
  /** Show live preview */
  showPreview?: boolean;
  /** Preview height in pixels */
  previewHeight?: number;
  /** Video info for correct aspect ratio preview */
  videoInfo?: VideoInfo;
  /** Loading state for video info */
  isLoadingVideoInfo?: boolean;
  /** Custom class name */
  className?: string;
  /** Compact mode (no preview, minimal spacing) */
  compact?: boolean;
}

export function SubtitleEditor({
  settings,
  onSettingsChange,
  subtitleLines = [],
  onLinesChange,
  showPreview = true,
  previewHeight = 600,
  videoInfo = DEFAULT_VIDEO_INFO,
  isLoadingVideoInfo = false,
  className = "",
  compact = false,
}: SubtitleEditorProps) {
  // Track which preset is currently selected (null = manual/custom)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // Update a single setting (manual change clears preset selection)
  const updateSetting = <K extends keyof SubtitleSettings>(
    key: K,
    value: SubtitleSettings[K]
  ) => {
    setSelectedPresetId(null);
    onSettingsChange({ ...settings, [key]: value });
  };

  // Apply a preset's settings all at once
  const applyPreset = (preset: CaptionPreset) => {
    setSelectedPresetId(preset.id);
    onSettingsChange({ ...settings, ...preset.settings });
  };

  // Update a subtitle line
  const updateSubtitleLine = (id: number, text: string) => {
    if (!onLinesChange) return;
    const updated = subtitleLines.map((line) =>
      line.id === id ? { ...line, text } : line
    );
    onLinesChange(updated);
  };

  // Preview calculations
  const previewDimensions = useMemo(() => {
    const safeWidth = videoInfo.width || 1080;
    const safeHeight = videoInfo.height || 1920;
    const aspectRatio = safeWidth / safeHeight;

    if (videoInfo.is_vertical) {
      return {
        width: previewHeight * aspectRatio,
        height: previewHeight,
      };
    }
    return {
      width: previewHeight,
      height: previewHeight / aspectRatio,
    };
  }, [videoInfo, previewHeight]);

  // Always use the ASS PlayRes reference height (1920) for scaling,
  // NOT the encoded video pixel height which may be half-res (960).
  // FontSize values are defined in a 1920-tall coordinate space.
  const ASS_REF_HEIGHT = 1920;

  const scaledFontSize = useMemo(() => {
    return (settings.fontSize / ASS_REF_HEIGHT) * previewHeight;
  }, [settings.fontSize, previewHeight]);

  const scaledOutline = useMemo(() => {
    return (settings.outlineWidth / ASS_REF_HEIGHT) * previewHeight;
  }, [settings.outlineWidth, previewHeight]);

  // Scaled shadow values for preview
  const scaledShadowDepth = useMemo(() => {
    return ((settings.shadowDepth ?? 0) / ASS_REF_HEIGHT) * previewHeight;
  }, [settings.shadowDepth, previewHeight]);

  const scaledGlowBlur = useMemo(() => {
    return ((settings.glowBlur ?? 0) / ASS_REF_HEIGHT) * previewHeight;
  }, [settings.glowBlur, previewHeight]);

  // The preview panel rendered as a standalone block
  const previewPanel = showPreview ? (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <Label className="text-base font-semibold">Live Preview</Label>
        {isLoadingVideoInfo && (
          <span className="text-xs text-muted-foreground">Loading...</span>
        )}
      </div>

      <div className="flex justify-center">
        <div
          className="relative bg-black rounded-lg overflow-hidden border-2 border-border shadow-xl"
          style={{
            width: `${previewDimensions.width}px`,
            height: `${previewDimensions.height}px`,
          }}
        >
          {/* Gradient background simulating video */}
          <div className="absolute inset-0 bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900" />

          {/* Subtitle text */}
          <div
            className="absolute left-0 right-0 text-center px-4 transition-all duration-100"
            style={{
              fontFamily: settings.fontFamily,
              fontSize: `${scaledFontSize}px`,
              color: settings.textColor,
              opacity: (settings.opacity ?? 100) / 100,
              WebkitTextStroke: `${scaledOutline}px ${settings.outlineColor}`,
              paintOrder: 'stroke fill',
              textShadow: [
                scaledShadowDepth > 0
                  ? `0 ${scaledShadowDepth}px ${scaledShadowDepth * 2}px ${settings.shadowColor ?? "rgba(0,0,0,0.8)"}`
                  : '0 1px 3px rgba(0,0,0,0.85)',
                settings.enableGlow && scaledGlowBlur > 0
                  ? `0 0 ${scaledGlowBlur}px ${settings.outlineColor}`
                  : '',
              ].filter(Boolean).join(', '),
              fontWeight: 700,
              top: `${settings.positionY}%`,
              transform: "translateY(-50%)",
              ...(settings.borderStyle === 3 ? {
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                padding: '4px 8px',
                borderRadius: '4px',
              } : {}),
            }}
          >
            {subtitleLines.length > 0 ? subtitleLines[0].text : "Sample subtitle text"}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="text-center space-y-1">
        <p className="text-xs text-muted-foreground">
          Font: {settings.fontSize}px | Outline: {settings.outlineWidth}px | Y: {settings.positionY}%
        </p>
      </div>
    </div>
  ) : null;

  // The settings controls panel
  const settingsPanel = (
    <div className={`space-y-${compact ? "3" : "4"}`}>
      {/* Style Presets Section */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-sm">Style Presets</h3>
          <p className="text-xs text-muted-foreground">Click a preset to apply</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {CAPTION_PRESETS.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            const outlineShadow = `-1px -1px 0 ${preset.settings.outlineColor}, 1px -1px 0 ${preset.settings.outlineColor}, -1px 1px 0 ${preset.settings.outlineColor}, 1px 1px 0 ${preset.settings.outlineColor}`;
            const glowShadow = preset.settings.enableGlow && preset.settings.glowBlur
              ? `, 0 0 ${preset.settings.glowBlur}px ${preset.settings.outlineColor}`
              : "";
            return (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                className={`relative h-20 rounded-lg cursor-pointer transition-all hover:opacity-90 overflow-hidden border-2 ${
                  isSelected
                    ? "ring-2 ring-primary border-primary"
                    : "border-border hover:border-muted-foreground/50"
                }`}
                style={{ backgroundColor: preset.previewStyle.backgroundColor }}
                title={preset.description}
              >
                <div className="absolute inset-0 flex items-center justify-center px-2">
                  <span
                    className="font-bold text-sm leading-tight"
                    style={{
                      fontFamily: preset.settings.fontFamily,
                      color: preset.settings.textColor,
                      textShadow: outlineShadow + glowShadow,
                    }}
                  >
                    {preset.previewStyle.textSample}
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-0.5">
                  <span className="text-[10px] text-white/80 font-medium">{preset.name}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Style Settings */}
      {!compact && (
        <div className="flex items-center gap-2">
          <Type className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">Subtitle Style</h3>
        </div>
      )}

      {/* Font Size */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label>Font Size</Label>
          <span className="text-sm text-muted-foreground">{settings.fontSize}px</span>
        </div>
        <Slider
          value={[settings.fontSize]}
          onValueChange={([value]) => updateSetting("fontSize", value)}
          min={12}
          max={200}
          step={1}
          className="w-full"
        />
      </div>

      {/* Opacity */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label>Opacity</Label>
          <span className="text-sm text-muted-foreground">{settings.opacity ?? 100}%</span>
        </div>
        <Slider
          value={[settings.opacity ?? 100]}
          onValueChange={([value]) => updateSetting("opacity", value)}
          min={0}
          max={100}
          step={5}
          className="w-full"
        />
      </div>

      {/* Font Family */}
      <div className="space-y-2">
        <Label>Font</Label>
        <Select
          value={settings.fontFamily}
          onValueChange={(value) => updateSetting("fontFamily", value)}
        >
          <SelectTrigger className="bg-muted/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_OPTIONS.map((font) => (
              <SelectItem
                key={font.value}
                value={font.value}
                style={{ fontFamily: font.value }}
              >
                {font.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Colors Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Text Color */}
        <ColorPicker
          label="Text Color"
          value={settings.textColor}
          onChange={(value) => updateSetting("textColor", value)}
        />

        {/* Outline Color */}
        <ColorPicker
          label="Outline Color"
          value={settings.outlineColor}
          onChange={(value) => updateSetting("outlineColor", value)}
        />
      </div>

      {/* Outline Width */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label>Outline Width</Label>
          <span className="text-sm text-muted-foreground">{settings.outlineWidth}px</span>
        </div>
        <Slider
          value={[settings.outlineWidth]}
          onValueChange={([value]) => updateSetting("outlineWidth", value)}
          min={0}
          max={10}
          step={1}
          className="w-full"
        />
      </div>

      {/* Position Y */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label>Vertical Position (Y)</Label>
          <span className="text-sm text-muted-foreground">{settings.positionY}%</span>
        </div>
        <Slider
          value={[settings.positionY]}
          onValueChange={([value]) => updateSetting("positionY", value)}
          min={5}
          max={95}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          0% = sus, 50% = centru, 100% = jos
        </p>
      </div>

      <Separator />

      {/* Shadow Settings */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Shadow</h4>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <Label>Shadow Depth</Label>
            <span className="text-sm text-muted-foreground">{settings.shadowDepth ?? 0}px</span>
          </div>
          <Slider
            value={[settings.shadowDepth ?? 0]}
            onValueChange={([value]) => updateSetting("shadowDepth", value)}
            min={0}
            max={4}
            step={1}
            className="w-full"
          />
        </div>

        {(settings.shadowDepth ?? 0) > 0 && (
          <ColorPicker
            label="Shadow Color"
            value={settings.shadowColor ?? "#000000"}
            onChange={(value) => updateSetting("shadowColor", value)}
          />
        )}
      </div>

      {/* Glow Settings */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Glow Effect</h4>
          <Switch
            checked={settings.enableGlow ?? false}
            onCheckedChange={(checked) => updateSetting("enableGlow", checked)}
          />
        </div>

        {settings.enableGlow && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label>Glow Blur</Label>
              <span className="text-sm text-muted-foreground">{settings.glowBlur ?? 0}px</span>
            </div>
            <Slider
              value={[settings.glowBlur ?? 0]}
              onValueChange={([value]) => updateSetting("glowBlur", value)}
              min={0}
              max={10}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Outline becomes semi-transparent for glow effect
            </p>
          </div>
        )}
      </div>

      {/* Border Style */}
      <div className="space-y-2">
        <Label>Border Style</Label>
        <Select
          value={String(settings.borderStyle ?? 1)}
          onValueChange={(value) => updateSetting("borderStyle", Number(value))}
        >
          <SelectTrigger className="bg-muted/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Outline + Shadow</SelectItem>
            <SelectItem value="3">Box Background</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Adaptive Sizing */}
      <div className="flex items-center justify-between">
        <div>
          <Label>Adaptive Sizing</Label>
          <p className="text-xs text-muted-foreground">
            Auto-reduce font for long text
          </p>
        </div>
        <Switch
          checked={settings.adaptiveSizing ?? false}
          onCheckedChange={(checked) => updateSetting("adaptiveSizing", checked)}
        />
      </div>
    </div>
  );

  return (
    <div className={className}>
      {/* Side-by-side layout: Preview (left, sticky) + Settings (right, scrollable) */}
      {showPreview && !compact ? (
        <div className="flex gap-6 items-start">
          {/* Left: Sticky preview */}
          <div className="sticky top-4 flex-shrink-0">
            {previewPanel}
          </div>

          {/* Right: Scrollable settings */}
          <div className="flex-1 min-w-0">
            {settingsPanel}
          </div>
        </div>
      ) : (
        /* Compact or no-preview: vertical stack as before */
        <div className={`space-y-${compact ? "3" : "6"}`}>
          {settingsPanel}
        </div>
      )}

      {/* Subtitle Lines Editor */}
      {onLinesChange && (
        <>
          <Separator />
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Subtitle Editor</h3>
              {subtitleLines.length > 0 && (
                <Badge variant="secondary">{subtitleLines.length} lines</Badge>
              )}
            </div>

            <SubtitleLinesEditor
              subtitleLines={subtitleLines}
              onUpdateLine={updateSubtitleLine}
            />
          </div>
        </>
      )}
    </div>
  );
}

function SubtitleLinesEditor({
  subtitleLines,
  onUpdateLine,
}: {
  subtitleLines: SubtitleLine[];
  onUpdateLine: (id: number, text: string) => void;
}) {
  const [editingLine, setEditingLine] = useState<SubtitleLine | null>(null);

  if (subtitleLines.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>Upload an SRT file to edit subtitles</p>
        <p className="text-sm mt-1">or let AI generate them automatically</p>
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-[300px] border rounded-lg">
        <div className="p-4 space-y-2">
          {subtitleLines.map((line) => (
            <div
              key={line.id}
              className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex justify-between items-start gap-2 mb-2">
                <Badge variant="outline" className="text-xs">
                  #{line.id}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {line.start} {"\u2192"} {line.end}
                </span>
              </div>
              <button
                className="w-full text-left text-sm hover:text-primary transition-colors"
                onClick={() => setEditingLine(line)}
              >
                {line.text}
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Dialog open={editingLine !== null} onOpenChange={(open) => { if (!open) setEditingLine(null); }}>
        {editingLine && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Subtitle #{editingLine.id}</DialogTitle>
              <DialogDescription>
                {editingLine.start} {"\u2192"} {editingLine.end}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={editingLine.text}
              onChange={(e) => {
                setEditingLine({ ...editingLine, text: e.target.value });
                onUpdateLine(editingLine.id, e.target.value);
              }}
              className="min-h-[100px]"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingLine(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

// Color Picker sub-component
interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start gap-2">
            <div
              className="w-5 h-5 rounded border"
              style={{ backgroundColor: value }}
            />
            {value}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <div className="space-y-3">
            <div className="grid grid-cols-5 gap-2">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  className="w-8 h-8 rounded border-2 hover:scale-110 transition-transform"
                  style={{
                    backgroundColor: color,
                    borderColor: value === color ? "hsl(var(--primary))" : "transparent",
                  }}
                  onClick={() => onChange(color)}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-12 h-10 p-1 cursor-pointer"
              />
              <Input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="flex-1"
                placeholder="#FFFFFF"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
