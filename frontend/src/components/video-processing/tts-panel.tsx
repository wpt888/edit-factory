"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Volume2, VolumeX, Mic } from "lucide-react";

interface TTSPanelProps {
  /** Script text for TTS */
  scriptText: string;
  /** Called when script text changes */
  onScriptChange: (text: string) => void;
  /** Whether to generate audio immediately with video */
  generateAudio: boolean;
  /** Called when generate audio toggle changes */
  onGenerateAudioChange: (value: boolean) => void;
  /** Whether to mute source voice (VAD) */
  muteSourceVoice: boolean;
  /** Called when mute source voice toggle changes */
  onMuteSourceVoiceChange: (value: boolean) => void;
  /** Disable all inputs */
  disabled?: boolean;
  /** Show advanced options (mute source) */
  showAdvanced?: boolean;
  /** Custom class name */
  className?: string;
  /** Placeholder text */
  placeholder?: string;
}

export function TTSPanel({
  scriptText,
  onScriptChange,
  generateAudio,
  onGenerateAudioChange,
  muteSourceVoice,
  onMuteSourceVoiceChange,
  disabled = false,
  showAdvanced = true,
  className = "",
  placeholder = "Write the voice-over text here. This text will be converted to audio using ElevenLabs TTS...",
}: TTSPanelProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header with badge */}
      <div className="flex items-center gap-2">
        <Mic className="h-4 w-4 text-muted-foreground" />
        <Label className="font-medium">Text-to-Speech (ElevenLabs)</Label>
        <Badge variant="secondary" className="text-xs">
          Premium
        </Badge>
      </div>

      {/* Script textarea */}
      <div className="space-y-2">
        <Textarea
          value={scriptText}
          onChange={(e) => onScriptChange(e.target.value)}
          placeholder={placeholder}
          className="min-h-[120px] resize-y"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          {scriptText.length} characters
          {scriptText.length > 0 && (
            <> (~{Math.ceil(scriptText.length / 150)} seconds audio, estimate)</>
          )}
        </p>
      </div>

      {/* Generate audio toggle */}
      <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <Label htmlFor="generate-audio" className="cursor-pointer">
              Generate audio automatically
            </Label>
            <p className="text-xs text-muted-foreground">
              Voice-over added directly to video
            </p>
          </div>
        </div>
        <Switch
          id="generate-audio"
          checked={generateAudio}
          onCheckedChange={onGenerateAudioChange}
          disabled={disabled}
        />
      </div>

      {/* Mute source voice toggle (advanced) */}
      {showAdvanced && (
        <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <VolumeX className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label htmlFor="mute-source" className="cursor-pointer">
                Remove source voice
              </Label>
              <p className="text-xs text-muted-foreground">
                Detect and mute original voice (VAD)
              </p>
            </div>
          </div>
          <Switch
            id="mute-source"
            checked={muteSourceVoice}
            onCheckedChange={onMuteSourceVoiceChange}
            disabled={disabled}
          />
        </div>
      )}

      {/* Info message */}
      {!generateAudio && scriptText.length > 0 && (
        <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded">
          The voice-over will be generated separately after creating variants.
          You will be able to choose which variants to add audio to.
        </p>
      )}
    </div>
  );
}
