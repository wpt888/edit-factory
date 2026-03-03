"use client";

import { useMemo } from "react";
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
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Type } from "lucide-react";
import {
  SubtitleSettings,
  SubtitleLine,
  FONT_OPTIONS,
  COLOR_PRESETS,
  VideoInfo,
} from "@/types/video-processing";

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
  videoInfo = { width: 1080, height: 1920, duration: 0, fps: 30, aspect_ratio: "9:16", is_vertical: true },
  isLoadingVideoInfo = false,
  className = "",
  compact = false,
}: SubtitleEditorProps) {
  // Update a single setting
  const updateSetting = <K extends keyof SubtitleSettings>(
    key: K,
    value: SubtitleSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
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

  const scaledFontSize = useMemo(() => {
    const safeHeight = videoInfo.height || 1920;
    return (settings.fontSize / safeHeight) * previewHeight;
  }, [settings.fontSize, videoInfo.height, previewHeight]);

  const scaledOutline = useMemo(() => {
    const safeHeight = videoInfo.height || 1920;
    return Math.max(1, (settings.outlineWidth / safeHeight) * previewHeight);
  }, [settings.outlineWidth, videoInfo.height, previewHeight]);

  return (
    <div className={`space-y-${compact ? "3" : "6"} ${className}`}>
      {/* Style Settings Section */}
      <div className="space-y-4">
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
            max={72}
            step={1}
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
      </div>

      {/* Live Preview */}
      {showPreview && (
        <>
          <Separator />
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
                    textShadow: `
                      -${scaledOutline}px -${scaledOutline}px 0 ${settings.outlineColor},
                      ${scaledOutline}px -${scaledOutline}px 0 ${settings.outlineColor},
                      -${scaledOutline}px ${scaledOutline}px 0 ${settings.outlineColor},
                      ${scaledOutline}px ${scaledOutline}px 0 ${settings.outlineColor}
                    `,
                    fontWeight: 700,
                    top: `${settings.positionY}%`,
                    transform: "translateY(-50%)",
                  }}
                >
                  {subtitleLines.length > 0 ? subtitleLines[0].text : "Sample subtitle text"}
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">
                {videoInfo.width}x{videoInfo.height} ({videoInfo.aspect_ratio})
              </p>
              <p className="text-xs text-muted-foreground">
                Font: {settings.fontSize}px | Outline: {settings.outlineWidth}px | Y: {settings.positionY}%
              </p>
            </div>
          </div>
        </>
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

            {subtitleLines.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Upload an SRT file to edit subtitles</p>
                <p className="text-sm mt-1">or let AI generate them automatically</p>
              </div>
            ) : (
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
                          {line.start} → {line.end}
                        </span>
                      </div>
                      <Dialog>
                        <DialogTrigger asChild>
                          <button
                            className="w-full text-left text-sm hover:text-primary transition-colors"
                          >
                            {line.text}
                          </button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit Subtitle #{line.id}</DialogTitle>
                            <DialogDescription>
                              {line.start} → {line.end}
                            </DialogDescription>
                          </DialogHeader>
                          <Textarea
                            value={line.text}
                            onChange={(e) => updateSubtitleLine(line.id, e.target.value)}
                            className="min-h-[100px]"
                          />
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline">
                                Close
                              </Button>
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </>
      )}
    </div>
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
