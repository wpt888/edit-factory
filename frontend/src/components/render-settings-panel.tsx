"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RenderSettings {
  encoding_mode: "crf" | "vbr_1pass" | "vbr_2pass";
  target_bitrate_kbps: number;
  audio_bitrate_kbps: number;
  video_profile: "baseline" | "main" | "high";
  video_level: string;
  force_cpu: boolean;
  preset_speed: string;
  gop_size: number;
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
};

interface RenderSettingsPanelProps {
  settings: RenderSettings;
  onChange: (settings: RenderSettings) => void;
}

export { DEFAULT_RENDER_SETTINGS };

export function RenderSettingsPanel({ settings, onChange }: RenderSettingsPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = (partial: Partial<RenderSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const isVbr = settings.encoding_mode !== "crf";
  const is2Pass = settings.encoding_mode === "vbr_2pass";

  return (
    <Card className="border-muted">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Render Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Encoding Mode */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">Encoding Mode</Label>
          <RadioGroup
            value={settings.encoding_mode}
            onValueChange={(v) => update({ encoding_mode: v as RenderSettings["encoding_mode"] })}
            className="flex gap-3"
          >
            <div className="flex items-center space-x-1.5">
              <RadioGroupItem value="crf" id="enc-crf" />
              <Label htmlFor="enc-crf" className="text-xs cursor-pointer">CRF</Label>
            </div>
            <div className="flex items-center space-x-1.5">
              <RadioGroupItem value="vbr_1pass" id="enc-vbr1" />
              <Label htmlFor="enc-vbr1" className="text-xs cursor-pointer">VBR 1-Pass</Label>
            </div>
            <div className="flex items-center space-x-1.5">
              <RadioGroupItem value="vbr_2pass" id="enc-vbr2" />
              <Label htmlFor="enc-vbr2" className="text-xs cursor-pointer">VBR 2-Pass</Label>
            </div>
          </RadioGroup>
          {is2Pass && (
            <p className="text-[10px] text-muted-foreground">
              Professional quality — matches Adobe Premiere export. Takes ~2x longer.
            </p>
          )}
        </div>

        {/* Target Bitrate (only for VBR modes) */}
        {isVbr && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-xs font-medium text-muted-foreground">Target Bitrate</Label>
              <span className="text-xs font-mono tabular-nums">
                {(settings.target_bitrate_kbps / 1000).toFixed(0)} Mbps
              </span>
            </div>
            <Slider
              min={1000}
              max={20000}
              step={500}
              value={[settings.target_bitrate_kbps]}
              onValueChange={([v]) => update({ target_bitrate_kbps: v })}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1 Mbps</span>
              <span>20 Mbps</span>
            </div>
          </div>
        )}

        {/* Audio Quality */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">Audio Quality</Label>
          <Select
            value={String(settings.audio_bitrate_kbps)}
            onValueChange={(v) => update({ audio_bitrate_kbps: Number(v) })}
          >
            <SelectTrigger className="h-8 text-xs">
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

        {/* GPU Encoding toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">GPU Encoding</Label>
            {is2Pass && (
              <p className="text-[10px] text-muted-foreground">Disabled for VBR 2-pass</p>
            )}
          </div>
          <Switch
            checked={!settings.force_cpu && !is2Pass}
            onCheckedChange={(checked) => update({ force_cpu: !checked })}
            disabled={is2Pass}
          />
        </div>

        {/* Advanced section */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs text-muted-foreground h-7 px-0"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          Advanced
          {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>

        {showAdvanced && (
          <div className="space-y-4 pt-1">
            {/* Profile */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">H.264 Profile</Label>
              <Select
                value={settings.video_profile}
                onValueChange={(v) => update({ video_profile: v as RenderSettings["video_profile"] })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baseline">Baseline</SelectItem>
                  <SelectItem value="main">Main</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Level */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">H.264 Level</Label>
              <Select
                value={settings.video_level}
                onValueChange={(v) => update({ video_level: v })}
              >
                <SelectTrigger className="h-8 text-xs">
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

            {/* Encoding Speed */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Encoding Speed</Label>
              <Select
                value={settings.preset_speed}
                onValueChange={(v) => update({ preset_speed: v })}
              >
                <SelectTrigger className="h-8 text-xs">
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

            {/* GOP Size */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs font-medium text-muted-foreground">GOP Size</Label>
                <span className="text-xs font-mono tabular-nums">{settings.gop_size}</span>
              </div>
              <Slider
                min={15}
                max={120}
                step={15}
                value={[settings.gop_size]}
                onValueChange={([v]) => update({ gop_size: v })}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
