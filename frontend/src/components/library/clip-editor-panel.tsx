"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings, Mic, Type, Instagram, Youtube, Film, Video, Loader2 } from "lucide-react";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import {
  VideoEnhancementControls,
  VideoFilters,
} from "@/components/video-enhancement-controls";
import { SubtitleEnhancementControls } from "@/components/subtitle-enhancement-controls";
import { DEFAULT_SUBTITLE_SETTINGS, ELEVENLABS_MODELS } from "@/types/video-processing";
import { Clip, ClipContent, SubtitleSettings } from "./types";

interface ClipEditorPanelProps {
  selectedClip: Clip | null;
  clipContent: ClipContent | null;
  editingTtsText: string;
  setEditingTtsText: (v: string) => void;
  editingSrtContent: string;
  setEditingSrtContent: (v: string) => void;
  editingSubtitleSettings: SubtitleSettings;
  setEditingSubtitleSettings: (v: SubtitleSettings | ((prev: SubtitleSettings) => SubtitleSettings)) => void;
  selectedPreset: string;
  setSelectedPreset: (v: string) => void;
  selectedElevenLabsModel: string;
  setSelectedElevenLabsModel: (v: string) => void;
  videoFilters: VideoFilters;
  setVideoFilters: (v: VideoFilters) => void;
  rendering: boolean;
  onSave: () => void;
  onRender: (clipId: string) => void;
}

export function ClipEditorPanel({
  selectedClip,
  clipContent: _clipContent,
  editingTtsText,
  setEditingTtsText,
  editingSrtContent,
  setEditingSrtContent,
  editingSubtitleSettings,
  setEditingSubtitleSettings,
  selectedPreset,
  setSelectedPreset,
  selectedElevenLabsModel,
  setSelectedElevenLabsModel,
  videoFilters,
  setVideoFilters,
  rendering,
  onSave,
  onRender,
}: ClipEditorPanelProps) {
  if (!selectedClip) {
    return (
      <Card className="bg-card border-border h-64 flex items-center justify-center">
        <div className="text-center">
          <Settings className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground text-sm">Selectează un clip pentru editare</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Editare Clip
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="tts">
          <TabsList className="w-full bg-muted">
            <TabsTrigger value="tts" className="flex-1">
              <Mic className="h-4 w-4 mr-1" />
              TTS
            </TabsTrigger>
            <TabsTrigger value="subtitles" className="flex-1">
              <Type className="h-4 w-4 mr-1" />
              Subtitrări
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tts" className="space-y-4 mt-4">
            <div>
              <Label className="text-muted-foreground">Text pentru Voice-over</Label>
              <Textarea
                value={editingTtsText}
                onChange={(e) => setEditingTtsText(e.target.value)}
                placeholder="Scrie textul care va fi transformat în voce..."
                className="mt-2 bg-muted/50 border-border min-h-[150px]"
              />
              <p className="text-muted-foreground text-xs mt-1">
                {editingTtsText.length} / 5000 caractere
              </p>
            </div>
          </TabsContent>

          <TabsContent value="subtitles" className="space-y-4 mt-4">
            {/* SRT Content Editor */}
            <div>
              <Label className="text-muted-foreground">Conținut SRT</Label>
              <Textarea
                value={editingSrtContent}
                onChange={(e) => setEditingSrtContent(e.target.value)}
                placeholder="1
00:00:00,000 --> 00:00:02,000
Text subtitrare..."
                className="mt-2 bg-muted/50 border-border min-h-[100px] font-mono text-sm"
              />
            </div>

            {/* Shared SubtitleEditor Component */}
            <SubtitleEditor
              settings={{
                ...DEFAULT_SUBTITLE_SETTINGS,
                ...editingSubtitleSettings,
              }}
              onSettingsChange={(newSettings) => {
                setEditingSubtitleSettings({
                  fontSize: newSettings.fontSize,
                  fontFamily: newSettings.fontFamily,
                  textColor: newSettings.textColor,
                  outlineColor: newSettings.outlineColor,
                  outlineWidth: newSettings.outlineWidth,
                  positionY: newSettings.positionY,
                });
              }}
              showPreview={true}
              previewHeight={300}
              compact={true}
            />
          </TabsContent>
        </Tabs>

        {/* Subtitle Enhancement (Phase 11) */}
        <div className="mb-4">
          <Label className="text-sm mb-2 block">Subtitle Enhancement (optional):</Label>
          <SubtitleEnhancementControls
            settings={editingSubtitleSettings}
            onSettingsChange={(updates) => {
              setEditingSubtitleSettings((prev) => ({ ...prev, ...updates }));
            }}
            disabled={rendering}
          />
        </div>

        {/* Video Enhancement Filters */}
        <div className="mb-4">
          <Label className="text-sm mb-2 block">Video Enhancement (optional):</Label>
          <VideoEnhancementControls
            filters={videoFilters}
            onFilterChange={setVideoFilters}
            disabled={rendering}
          />
        </div>

        {/* Platform Selector */}
        <div className="mb-4">
          <Label className="text-sm mb-2 block">Export for:</Label>
          <Select value={selectedPreset} onValueChange={setSelectedPreset}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tiktok">
                <span className="flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  TikTok
                </span>
              </SelectItem>
              <SelectItem value="instagram_reels">
                <span className="flex items-center gap-2">
                  <Instagram className="h-4 w-4" />
                  Instagram Reels
                </span>
              </SelectItem>
              <SelectItem value="youtube_shorts">
                <span className="flex items-center gap-2">
                  <Youtube className="h-4 w-4" />
                  YouTube Shorts
                </span>
              </SelectItem>
              <SelectItem value="generic">
                <span className="flex items-center gap-2">
                  <Film className="h-4 w-4" />
                  Generic
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ElevenLabs Model Selection (Phase 12) */}
        <div className="mb-4">
          <Label className="text-sm mb-2 block text-zinc-400">
            TTS Model
          </Label>
          <Select
            value={selectedElevenLabsModel}
            onValueChange={setSelectedElevenLabsModel}
          >
            <SelectTrigger className="w-full bg-zinc-800 border-zinc-700">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {ELEVENLABS_MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <div className="flex items-center justify-between w-full gap-4">
                    <span>{model.name}</span>
                    <span className="text-xs text-zinc-500">
                      ${model.costPer1kChars}/1k chars · {model.latencyMs}ms
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-zinc-500 mt-1">
            {ELEVENLABS_MODELS.find((m) => m.id === selectedElevenLabsModel)?.description}
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={onSave} className="flex-1" variant="secondary">
            Salvează
          </Button>
          <Button
            onClick={() => onRender(selectedClip.id)}
            disabled={rendering}
            className="flex-1"
            variant="default"
          >
            {rendering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Randează"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
