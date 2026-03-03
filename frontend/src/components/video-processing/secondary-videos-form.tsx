"use client";

import { useRef } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, X, Video, Tag } from "lucide-react";
import { SecondaryVideo } from "@/types/video-processing";

interface SecondaryVideosFormProps {
  /** Array of secondary videos (typically 3) */
  videos: SecondaryVideo[];
  /** Called when videos change */
  onVideosChange: (videos: SecondaryVideo[]) => void;
  /** Segment duration for inserted clips (0.5-5 seconds) */
  segmentDuration: number;
  /** Called when segment duration changes */
  onDurationChange: (duration: number) => void;
  /** Maximum number of secondary videos */
  maxVideos?: number;
  /** Disable all inputs */
  disabled?: boolean;
  /** Custom class name */
  className?: string;
}

export function SecondaryVideosForm({
  videos,
  onVideosChange,
  segmentDuration,
  onDurationChange,
  maxVideos = 3,
  disabled = false,
  className = "",
}: SecondaryVideosFormProps) {
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Update a specific video slot
  const updateVideo = (index: number, updates: Partial<SecondaryVideo>) => {
    const updated = [...videos];
    updated[index] = { ...updated[index], ...updates };
    onVideosChange(updated);
  };

  // Handle file selection
  const handleFileChange = (index: number, file: File | null) => {
    updateVideo(index, { file });
  };

  // Clear a video slot
  const clearVideo = (index: number) => {
    updateVideo(index, { file: null, keywords: "" });
    if (fileInputRefs.current[index]) {
      fileInputRefs.current[index]!.value = "";
    }
  };

  // Count configured videos
  const configuredCount = videos.filter(
    (v) => v.file && v.keywords.trim()
  ).length;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4 text-muted-foreground" />
          <Label className="font-medium">Secondary Videos (Multi-Video)</Label>
        </div>
        {configuredCount > 0 && (
          <Badge variant="secondary">{configuredCount} configured</Badge>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground">
        Add videos that will be automatically inserted when certain keywords appear in the subtitles.
      </p>

      {/* Video slots */}
      <div className="space-y-3">
        {videos.slice(0, maxVideos).map((video, index) => (
          <Card key={index} className={video.file ? "border-primary/50" : ""}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Video {index + 1}</span>
                {video.file && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => clearVideo(index)}
                    disabled={disabled}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* File input */}
              <div className="space-y-2">
                <input
                  type="file"
                  ref={(el) => {
                    fileInputRefs.current[index] = el;
                  }}
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => handleFileChange(index, e.target.files?.[0] || null)}
                  disabled={disabled}
                />

                {video.file ? (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
                    <Video className="h-4 w-4 text-primary" />
                    <span className="text-sm truncate flex-1">{video.file.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {(video.file.size / (1024 * 1024)).toFixed(1)} MB
                    </Badge>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full justify-center gap-2"
                    onClick={() => fileInputRefs.current[index]?.click()}
                    disabled={disabled}
                  >
                    <Upload className="h-4 w-4" />
                    Select Video
                  </Button>
                )}
              </div>

              {/* Keywords input */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Tag className="h-3 w-3 text-muted-foreground" />
                  <Label className="text-xs">Keywords (comma-separated)</Label>
                </div>
                <Input
                  type="text"
                  placeholder="product, quality, premium..."
                  value={video.keywords}
                  onChange={(e) => updateVideo(index, { keywords: e.target.value })}
                  disabled={disabled || !video.file}
                  className="text-sm"
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Segment Duration slider */}
      <div className="space-y-3 pt-2">
        <div className="flex justify-between items-center">
          <Label>Inserted Segment Duration</Label>
          <span className="text-sm text-muted-foreground">{segmentDuration}s</span>
        </div>
        <Slider
          value={[segmentDuration]}
          onValueChange={([value]) => onDurationChange(value)}
          min={0.5}
          max={5}
          step={0.5}
          disabled={disabled}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          How long the secondary clip will be shown when a keyword appears
        </p>
      </div>

      {/* Info message */}
      {configuredCount > 0 && (
        <div className="text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-3 py-2 rounded">
          <strong>Note:</strong> An SRT file is required to detect the moments
          when keywords appear. Upload or generate subtitles before processing.
        </div>
      )}
    </div>
  );
}
