"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiGetWithRetry } from "@/lib/api";
import { useProfile } from "@/contexts/profile-context";
import { ChevronDown, ChevronUp, Film, Loader2 } from "lucide-react";

export interface BatchSettings {
  voiceover_mode: "quick" | "elaborate";
  tts_provider: "edge" | "elevenlabs";
  voice_id: string | null;
  ai_provider: "gemini" | "claude";
  duration_s: number;
  encoding_preset: string;
  cta_text: string;
  enable_denoise: boolean;
  enable_sharpen: boolean;
  enable_color_correction: boolean;
}

interface BatchSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (settings: BatchSettings) => void;
  productCount: number;
  loading?: boolean;
}

export function BatchSettingsDialog({
  open,
  onOpenChange,
  onConfirm,
  productCount,
  loading = false,
}: BatchSettingsDialogProps) {
  const { currentProfile } = useProfile();

  const [voiceoverMode, setVoiceoverMode] = useState<"quick" | "elaborate">("quick");
  const [ttsProvider, setTtsProvider] = useState<"edge" | "elevenlabs">("edge");
  const [voiceId, setVoiceId] = useState("");
  const [aiProvider, setAiProvider] = useState<"gemini" | "claude">("gemini");
  const [duration, setDuration] = useState<string>("30");
  const [encodingPreset, setEncodingPreset] = useState<string>("tiktok");
  const [ctaText, setCtaText] = useState("Comanda acum!");
  const [enableDenoise, setEnableDenoise] = useState(false);
  const [enableSharpen, setEnableSharpen] = useState(false);
  const [enableColorCorrection, setEnableColorCorrection] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Pre-fill CTA from profile template settings (Bug #67: cancelled flag)
  useEffect(() => {
    if (!currentProfile?.id) return;
    let cancelled = false;

    const loadProfileDefaults = async () => {
      try {
        const res = await apiGetWithRetry(`/profiles/${currentProfile.id}`);
        if (cancelled || !res.ok) return;
        const profileData = await res.json();
        const ctaFromProfile = profileData?.video_template_settings?.cta_text;
        if (ctaFromProfile) {
          setCtaText((prev) => (prev === "Comanda acum!" ? ctaFromProfile : prev));
        }
      } catch (err) {
        console.warn("Failed to load profile template defaults:", err);
      }
    };

    loadProfileDefaults();
    return () => { cancelled = true; };
  }, [currentProfile?.id]);

  const defaultVoice = ttsProvider === "edge" ? "ro-RO-EmilNeural" : "";

  const handleConfirm = () => {
    onConfirm({
      voiceover_mode: voiceoverMode,
      tts_provider: ttsProvider,
      voice_id: voiceId || defaultVoice || null,
      ai_provider: aiProvider,
      duration_s: parseInt(duration, 10) || 30,
      encoding_preset: encodingPreset,
      cta_text: ctaText,
      enable_denoise: enableDenoise,
      enable_sharpen: enableSharpen,
      enable_color_correction: enableColorCorrection,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Batch Generation Settings</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Configure settings for {productCount} product{productCount !== 1 ? "s" : ""}
          </p>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Voiceover Mode */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Voiceover Mode</Label>
            <RadioGroup
              value={voiceoverMode}
              onValueChange={(v) => setVoiceoverMode(v as "quick" | "elaborate")}
              disabled={loading}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="quick" id="batch-mode-quick" />
                <Label htmlFor="batch-mode-quick" className="cursor-pointer font-normal">
                  Quick (template)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="elaborate" id="batch-mode-elaborate" />
                <Label htmlFor="batch-mode-elaborate" className="cursor-pointer font-normal">
                  Elaborate (AI-generated)
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              {voiceoverMode === "quick"
                ? "Uses a product template for fast generation — no AI cost."
                : "Uses Gemini/Claude to write a custom voiceover script — slower but more creative."}
            </p>
          </div>

          {/* AI Provider (only for elaborate mode) */}
          {voiceoverMode === "elaborate" && (
            <div className="space-y-2">
              <Label htmlFor="batch-ai-provider" className="text-sm font-medium">
                AI Script Provider
              </Label>
              <Select
                value={aiProvider}
                onValueChange={(v) => setAiProvider(v as "gemini" | "claude")}
                disabled={loading}
              >
                <SelectTrigger id="batch-ai-provider" className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini">Gemini</SelectItem>
                  <SelectItem value="claude">Claude</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* TTS Provider */}
          <div className="space-y-2">
            <Label htmlFor="batch-tts-provider" className="text-sm font-medium">
              TTS Provider
            </Label>
            <Select
              value={ttsProvider}
              onValueChange={(v) => {
                setTtsProvider(v as "edge" | "elevenlabs");
                setVoiceId("");
              }}
              disabled={loading}
            >
              <SelectTrigger id="batch-tts-provider" className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="edge">Edge TTS (free)</SelectItem>
                <SelectItem value="elevenlabs">ElevenLabs (premium)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {ttsProvider === "edge"
                ? "Microsoft Edge TTS — free, no subtitles."
                : "ElevenLabs — premium quality with automatic subtitle generation."}
            </p>
          </div>

          {/* Voice override */}
          <div className="space-y-2">
            <Label htmlFor="batch-voice-id" className="text-sm font-medium">
              Voice{" "}
              <span className="text-muted-foreground font-normal">
                (optional — leave blank for default)
              </span>
            </Label>
            <Input
              id="batch-voice-id"
              placeholder={defaultVoice || "Default voice"}
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              disabled={loading}
              className="w-full"
            />
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label htmlFor="batch-duration" className="text-sm font-medium">
              Duration
            </Label>
            <Select
              value={duration}
              onValueChange={setDuration}
              disabled={loading}
            >
              <SelectTrigger id="batch-duration" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 seconds</SelectItem>
                <SelectItem value="30">30 seconds</SelectItem>
                <SelectItem value="45">45 seconds</SelectItem>
                <SelectItem value="60">60 seconds</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Encoding Preset */}
          <div className="space-y-2">
            <Label htmlFor="batch-encoding-preset" className="text-sm font-medium">
              Encoding Preset
            </Label>
            <Select
              value={encodingPreset}
              onValueChange={setEncodingPreset}
              disabled={loading}
            >
              <SelectTrigger id="batch-encoding-preset" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tiktok">TikTok</SelectItem>
                <SelectItem value="reels">Reels</SelectItem>
                <SelectItem value="youtube_shorts">YouTube Shorts</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* CTA Text */}
          <div className="space-y-2">
            <Label htmlFor="batch-cta-text" className="text-sm font-medium">
              CTA Text
            </Label>
            <Input
              id="batch-cta-text"
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              disabled={loading}
              className="w-full"
              placeholder="e.g. Comanda acum!"
            />
          </div>

          {/* Video Filters (collapsible) */}
          <div className="space-y-2">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
              onClick={() => setFiltersExpanded((v) => !v)}
              disabled={loading}
            >
              {filtersExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              Video Filters (optional)
            </button>
            {filtersExpanded && (
              <div className="pl-4 space-y-3 pt-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="batch-filter-denoise"
                    checked={enableDenoise}
                    onCheckedChange={(c) => setEnableDenoise(!!c)}
                    disabled={loading}
                  />
                  <Label htmlFor="batch-filter-denoise" className="cursor-pointer font-normal">
                    Denoise
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="batch-filter-sharpen"
                    checked={enableSharpen}
                    onCheckedChange={(c) => setEnableSharpen(!!c)}
                    disabled={loading}
                  />
                  <Label htmlFor="batch-filter-sharpen" className="cursor-pointer font-normal">
                    Sharpen
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="batch-filter-color"
                    checked={enableColorCorrection}
                    onCheckedChange={(c) => setEnableColorCorrection(!!c)}
                    disabled={loading}
                  />
                  <Label htmlFor="batch-filter-color" className="cursor-pointer font-normal">
                    Color Correction
                  </Label>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Film className="h-4 w-4 mr-2" />
                Generate {productCount} Videos
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
