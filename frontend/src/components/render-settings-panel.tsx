"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Settings2 } from "lucide-react";

export interface RenderSettings {
  encoding_mode: "crf" | "vbr_1pass" | "vbr_2pass";
  target_bitrate_kbps: number;
  audio_bitrate_kbps: number;
  video_profile: "baseline" | "main" | "high";
  video_level: string;
  force_cpu: boolean;
  preset_speed: string;
  gop_size: number;
  /** Final composition dimensions. Kept separate from the platform preset so
   *  every common ratio (and custom formats) can use the same encoder preset. */
  output_width: number;
  output_height: number;
}

export interface RenderAdjustments {
  enableColor: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  voiceVolume: number;
  audioFadeIn: number;
  audioFadeOut: number;
}

const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  encoding_mode: "vbr_2pass",
  target_bitrate_kbps: 10000,
  audio_bitrate_kbps: 320,
  video_profile: "main",
  video_level: "4.1",
  force_cpu: false,
  preset_speed: "medium",
  gop_size: 60,
  output_width: 1080,
  output_height: 1920,
};

const OUTPUT_FORMATS = [
  { label: "Vertical 9:16", width: 1080, height: 1920 },
  { label: "Square 1:1", width: 1080, height: 1080 },
  { label: "Landscape 16:9", width: 1920, height: 1080 },
  { label: "Portrait 4:5", width: 1080, height: 1350 },
  { label: "Portrait 3:4", width: 1080, height: 1440 },
  { label: "Landscape 4:3", width: 1440, height: 1080 },
  { label: "Cinematic 21:9", width: 2520, height: 1080 },
] as const;

const ENCODING_MODE_DESCRIPTIONS: Record<RenderSettings["encoding_mode"], string> = {
  crf: "Constant visual quality with a file size that varies by content.",
  vbr_1pass: "Faster bitrate-based export with a single encoding pass.",
  vbr_2pass: "Professional quality matching Adobe Premiere export; takes about twice as long.",
};

const AUDIO_FADE_OPTIONS = Array.from({ length: 11 }, (_, index) => index / 2);

interface RenderSettingsPanelProps {
  settings: RenderSettings;
  onChange: (settings: RenderSettings) => void;
  presetName: string;
  onPresetNameChange: (presetName: string) => void;
  adjustments: RenderAdjustments;
  onAdjustmentsChange: (adjustments: RenderAdjustments) => void;
}

export { DEFAULT_RENDER_SETTINGS };

export function RenderSettingsPanel({
  settings,
  onChange,
  presetName,
  onPresetNameChange,
  adjustments,
  onAdjustmentsChange,
}: RenderSettingsPanelProps) {
  const [showVideoAdjustments, setShowVideoAdjustments] = useState(false);
  const [showAudioAdjustments, setShowAudioAdjustments] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = (partial: Partial<RenderSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const updateAdjustments = (partial: Partial<RenderAdjustments>) => {
    onAdjustmentsChange({ ...adjustments, ...partial });
  };

  const isVbr = settings.encoding_mode !== "crf";
  const is2Pass = settings.encoding_mode === "vbr_2pass";
  const fadeSummary = `${adjustments.audioFadeIn.toFixed(1)}s in / ${adjustments.audioFadeOut.toFixed(1)}s out`;
  const outputWidth = settings.output_width || 1080;
  const outputHeight = settings.output_height || 1920;
  const knownOutputFormat = OUTPUT_FORMATS.find(
    (format) => format.width === outputWidth && format.height === outputHeight,
  );
  const outputFormatValue = knownOutputFormat
    ? `${knownOutputFormat.width}x${knownOutputFormat.height}`
    : "custom";

  return (
    <Card className="border-muted" data-testid="step3-render-settings">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Settings2 className="size-4" />
          Render Settings
        </CardTitle>
        <CardDescription>
          Output format, encoding quality, and final video or audio adjustments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="render-export-preset" className="text-xs font-medium text-muted-foreground">
              Export Preset
            </Label>
            <Select value={presetName} onValueChange={onPresetNameChange}>
              <SelectTrigger id="render-export-preset" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TikTok">TikTok (1080x1920)</SelectItem>
                <SelectItem value="Instagram Reels">Instagram Reels (1080x1920)</SelectItem>
                <SelectItem value="YouTube Shorts">YouTube Shorts (1080x1920)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="render-output-format" className="text-xs font-medium text-muted-foreground">
              Video Format
            </Label>
            <Select
              value={outputFormatValue}
              onValueChange={(value) => {
                if (value === "custom") return;
                const [width, height] = value.split("x").map(Number);
                update({ output_width: width, output_height: height });
              }}
            >
              <SelectTrigger id="render-output-format" className="h-8 text-xs" data-testid="render-output-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTPUT_FORMATS.map((format) => (
                  <SelectItem key={`${format.width}x${format.height}`} value={`${format.width}x${format.height}`}>
                    {format.label} ({format.width}x{format.height})
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom dimensions</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="render-encoding-mode" className="text-xs font-medium text-muted-foreground">
              Encoding Mode
            </Label>
            <Select
              value={settings.encoding_mode}
              onValueChange={(value) => update({
                encoding_mode: value as RenderSettings["encoding_mode"],
              })}
            >
              <SelectTrigger id="render-encoding-mode" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="crf">CRF (Constant Quality)</SelectItem>
                <SelectItem value="vbr_1pass">VBR 1-Pass</SelectItem>
                <SelectItem value="vbr_2pass">VBR 2-Pass</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="render-audio-quality" className="text-xs font-medium text-muted-foreground">
              Audio Quality
            </Label>
            <Select
              value={String(settings.audio_bitrate_kbps)}
              onValueChange={(value) => update({ audio_bitrate_kbps: Number(value) })}
            >
              <SelectTrigger id="render-audio-quality" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="128">128 kbps</SelectItem>
                <SelectItem value="192">192 kbps</SelectItem>
                <SelectItem value="256">256 kbps</SelectItem>
                <SelectItem value="320">320 kbps (Studio)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid max-w-md grid-cols-2 gap-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="render-output-width" className="text-xs text-muted-foreground">Width</Label>
              <input
                id="render-output-width"
                type="number"
                min={240}
                max={7680}
                step={2}
                value={outputWidth}
                onChange={(event) => update({ output_width: normalizeOutputDimension(Number(event.target.value)) })}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="render-output-height" className="text-xs text-muted-foreground">Height</Label>
              <input
                id="render-output-height"
                type="number"
                min={240}
                max={7680}
                step={2}
                value={outputHeight}
                onChange={(event) => update({ output_height: normalizeOutputDimension(Number(event.target.value)) })}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              />
            </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {ENCODING_MODE_DESCRIPTIONS[settings.encoding_mode]}
        </p>

        {isVbr && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">Target Bitrate</Label>
              <span className="font-mono text-xs tabular-nums">
                {(settings.target_bitrate_kbps / 1000).toFixed(1)} Mbps
              </span>
            </div>
            <Slider
              min={1000}
              max={20000}
              step={500}
              value={[settings.target_bitrate_kbps]}
              onValueChange={([value]) => update({ target_bitrate_kbps: value })}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1 Mbps</span>
              <span>20 Mbps</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
          <div>
            <Label htmlFor="render-gpu-encoding" className="text-xs font-medium text-muted-foreground">
              GPU Encoding
            </Label>
            {is2Pass && (
              <p className="text-[10px] text-muted-foreground">Disabled for VBR 2-pass</p>
            )}
          </div>
          <Switch
            id="render-gpu-encoding"
            checked={!settings.force_cpu && !is2Pass}
            onCheckedChange={(checked) => update({ force_cpu: !checked })}
            disabled={is2Pass}
          />
        </div>

        <Collapsible
          open={showVideoAdjustments}
          onOpenChange={setShowVideoAdjustments}
          className="rounded-lg border"
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-between rounded-lg px-3 py-2.5"
              data-testid="render-video-adjustments-trigger"
            >
              <span className="text-left">
                <span className="block text-xs font-medium">Video adjustments</span>
                <span className="block text-[10px] font-normal text-muted-foreground">
                  Color correction {adjustments.enableColor ? "on" : "off"}
                </span>
              </span>
              <ChevronDown className={`size-4 transition-transform ${showVideoAdjustments ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t">
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="render-color-correction" className="text-xs font-medium">
                    Color correction
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    Burn brightness, contrast, and saturation into the final video.
                  </p>
                </div>
                <Switch
                  id="render-color-correction"
                  checked={adjustments.enableColor}
                  onCheckedChange={(checked) => updateAdjustments({ enableColor: checked })}
                />
              </div>

              {adjustments.enableColor && (
                <div className="grid gap-4 xl:grid-cols-3">
                  {([
                    { key: "brightness", label: "Brightness", min: -0.3, max: 0.3, step: 0.01 },
                    { key: "contrast", label: "Contrast", min: 0.5, max: 1.5, step: 0.01 },
                    { key: "saturation", label: "Saturation", min: 0, max: 2, step: 0.05 },
                  ] as const).map(({ key, label, min, max, step }) => (
                    <div key={key} className="space-y-2 rounded-md bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs">{label}</Label>
                        <span className="w-10 text-right font-mono text-xs tabular-nums">
                          {adjustments[key].toFixed(2)}
                        </span>
                      </div>
                      <Slider
                        min={min}
                        max={max}
                        step={step}
                        value={[adjustments[key]]}
                        onValueChange={([value]) => updateAdjustments({ [key]: value })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={showAudioAdjustments}
          onOpenChange={setShowAudioAdjustments}
          className="rounded-lg border"
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-between rounded-lg px-3 py-2.5"
              data-testid="render-audio-adjustments-trigger"
            >
              <span className="text-left">
                <span className="block text-xs font-medium">Audio adjustments</span>
                <span className="block text-[10px] font-normal text-muted-foreground">
                  Volume {Math.round(adjustments.voiceVolume * 100)}% · {fadeSummary}
                </span>
              </span>
              <ChevronDown className={`size-4 transition-transform ${showAudioAdjustments ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t">
            <div className="space-y-4 p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-xs font-medium">Voice volume</Label>
                    <p className="text-[10px] text-muted-foreground">100% keeps the voiceover unchanged.</p>
                  </div>
                  <span className="font-mono text-xs tabular-nums">
                    {Math.round(adjustments.voiceVolume * 100)}%
                  </span>
                </div>
                <Slider
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={[adjustments.voiceVolume]}
                  onValueChange={([value]) => updateAdjustments({ voiceVolume: value })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {([
                  { key: "audioFadeIn", label: "Fade in" },
                  { key: "audioFadeOut", label: "Fade out" },
                ] as const).map(({ key, label }) => (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={`render-${key}`} className="text-xs font-medium text-muted-foreground">
                      {label}
                    </Label>
                    <Select
                      value={String(adjustments[key])}
                      onValueChange={(value) => updateAdjustments({ [key]: Number(value) })}
                    >
                      <SelectTrigger id={`render-${key}`} className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUDIO_FADE_OPTIONS.map((seconds) => (
                          <SelectItem key={seconds} value={String(seconds)}>
                            {seconds === 0 ? "None" : `${seconds.toFixed(1)} seconds`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced} className="rounded-lg border">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full justify-between rounded-lg px-3 text-xs text-muted-foreground"
            >
              Advanced encoding
              <ChevronDown className={`size-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t">
            <div className="space-y-4 p-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="render-video-profile" className="text-xs font-medium text-muted-foreground">
                    H.264 Profile
                  </Label>
                  <Select
                    value={settings.video_profile}
                    onValueChange={(value) => update({
                      video_profile: value as RenderSettings["video_profile"],
                    })}
                  >
                    <SelectTrigger id="render-video-profile" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baseline">Baseline</SelectItem>
                      <SelectItem value="main">Main</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="render-video-level" className="text-xs font-medium text-muted-foreground">
                    H.264 Level
                  </Label>
                  <Select value={settings.video_level} onValueChange={(value) => update({ video_level: value })}>
                    <SelectTrigger id="render-video-level" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3.1">3.1</SelectItem>
                      <SelectItem value="4.0">4.0</SelectItem>
                      <SelectItem value="4.1">4.1</SelectItem>
                      <SelectItem value="5.0">5.0</SelectItem>
                      <SelectItem value="5.1">5.1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="render-encoding-speed" className="text-xs font-medium text-muted-foreground">
                    Encoding Speed
                  </Label>
                  <Select value={settings.preset_speed} onValueChange={(value) => update({ preset_speed: value })}>
                    <SelectTrigger id="render-encoding-speed" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ultrafast">Ultrafast</SelectItem>
                      <SelectItem value="superfast">Superfast</SelectItem>
                      <SelectItem value="veryfast">Very Fast</SelectItem>
                      <SelectItem value="faster">Faster</SelectItem>
                      <SelectItem value="fast">Fast</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="slow">Slow</SelectItem>
                      <SelectItem value="slower">Slower</SelectItem>
                      <SelectItem value="veryslow">Very Slow</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">GOP Size</Label>
                  <span className="font-mono text-xs tabular-nums">{settings.gop_size}</span>
                </div>
                <Slider
                  min={15}
                  max={120}
                  step={15}
                  value={[settings.gop_size]}
                  onValueChange={([value]) => update({ gop_size: value })}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function normalizeOutputDimension(value: number): number {
  return Math.round(Math.max(240, Math.min(7680, value || 240)) / 2) * 2;
}
