"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Check, X, Share2, Loader2, Calendar } from "lucide-react";
import { apiFetch, apiPost } from "@/lib/api";
import { Clip, PostizIntegration } from "./types";

interface PostizPublishModalProps {
  open: boolean;
  onClose: () => void;
  clip: Clip | null;
  bulkMode: boolean;
  clips: Clip[];
  onPublishComplete?: () => void;
}

const getPlatformIcon = (type: string) => {
  const icons: Record<string, string> = {
    instagram: "📸",
    tiktok: "🎵",
    youtube: "▶️",
    facebook: "👤",
    linkedin: "💼",
    x: "𝕏",
    twitter: "𝕏",
    bluesky: "🦋",
    threads: "🧵",
  };
  return icons[type.toLowerCase()] || "🌐";
};

export function PostizPublishModal({
  open,
  onClose,
  clip,
  bulkMode,
  clips,
  onPublishComplete,
}: PostizPublishModalProps) {
  const [integrations, setIntegrations] = useState<PostizIntegration[]>([]);
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (open) {
      fetchIntegrations();
      setSelectedIntegrations([]);
      setCaption("");
      setScheduleDate("");
      setScheduleTime("");
    }
  }, [open]);

  const fetchIntegrations = async () => {
    try {
      const res = await apiFetch("/postiz/integrations");
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data);
      }
    } catch (error) {
      console.error("Failed to fetch Postiz integrations:", error);
    }
  };

  const toggleIntegration = (integrationId: string) => {
    setSelectedIntegrations((prev) =>
      prev.includes(integrationId)
        ? prev.filter((id) => id !== integrationId)
        : [...prev, integrationId]
    );
  };

  const publishToPostiz = async () => {
    if (selectedIntegrations.length === 0) {
      alert("Selecteaza cel putin o platforma!");
      return;
    }

    setPublishing(true);

    try {
      // Build schedule datetime if both date and time are set
      let schedDate: string | null = null;
      if (scheduleDate && scheduleTime) {
        schedDate = `${scheduleDate}T${scheduleTime}:00`;
      }

      if (bulkMode) {
        // Bulk publish selected clips
        const selectedClipIds = clips
          .filter((c) => c.is_selected && c.final_video_path)
          .map((c) => c.id);

        const res = await apiPost("/postiz/bulk-publish", {
          clip_ids: selectedClipIds,
          caption,
          integration_ids: selectedIntegrations,
          schedule_date: schedDate,
          schedule_interval_minutes: 30,
        });

        if (res.ok) {
          const data = await res.json();
          alert(`Publicare in curs! Job ID: ${data.job_id}`);
          onClose();
          onPublishComplete?.();
        } else {
          const error = await res.json();
          alert(`Eroare: ${error.detail}`);
        }
      } else if (clip) {
        // Single clip publish
        const res = await apiPost("/postiz/publish", {
          clip_id: clip.id,
          caption,
          integration_ids: selectedIntegrations,
          schedule_date: schedDate,
        });

        if (res.ok) {
          const data = await res.json();
          alert(
            schedDate
              ? `Programat cu succes! Job ID: ${data.job_id}`
              : `Publicat cu succes! Job ID: ${data.job_id}`
          );
          onClose();
          onPublishComplete?.();
        } else {
          const error = await res.json();
          alert(`Eroare: ${error.detail}`);
        }
      }
    } catch (error) {
      console.error("Failed to publish:", error);
      alert("Eroare la publicare. Verifica conexiunea.");
    } finally {
      setPublishing(false);
    }
  };

  if (!open) return null;

  const readyClipsCount = clips.filter((c) => c.is_selected && c.final_video_path).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
      />
      <div className="relative z-10 bg-background border border-border rounded-lg shadow-lg w-full max-w-lg mx-4 animate-in fade-in-0 zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-pink-500" />
            <h2 className="text-lg font-semibold">
              {bulkMode
                ? `Publica ${readyClipsCount} clipuri`
                : "Publica pe Social Media"}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Platform Selection */}
          <div>
            <Label className="text-sm font-medium mb-2 block">
              Selecteaza platformele
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {integrations.length === 0 ? (
                <p className="col-span-2 text-sm text-muted-foreground text-center py-4">
                  Nu sunt platforme conectate. Configureaza in Postiz.
                </p>
              ) : (
                integrations.map((integration) => (
                  <div
                    key={integration.id}
                    onClick={() => toggleIntegration(integration.id)}
                    className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedIntegrations.includes(integration.id)
                        ? "border-pink-500 bg-pink-500/10"
                        : "border-border hover:border-muted-foreground"
                    }`}
                  >
                    <span className="text-xl">{getPlatformIcon(integration.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{integration.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {integration.identifier || integration.type}
                      </p>
                    </div>
                    {selectedIntegrations.includes(integration.id) && (
                      <Check className="h-4 w-4 text-pink-500 flex-shrink-0" />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Caption */}
          <div>
            <Label className="text-sm font-medium mb-2 block">
              Caption / Descriere
            </Label>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Scrie caption-ul pentru postare..."
              className="min-h-[100px]"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {caption.length} caractere
            </p>
          </div>

          {/* Schedule */}
          <div>
            <Label className="text-sm font-medium mb-2 block">
              Programare (optional)
            </Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="flex-1"
              />
              <Input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-32"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Lasa gol pentru a publica imediat
            </p>
          </div>

          {bulkMode && (
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm text-muted-foreground">
                <strong>Mod bulk:</strong> Clipurile vor fi publicate la interval de 30 minute,
                incepand cu ora selectata.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Anuleaza
          </Button>
          <Button
            onClick={publishToPostiz}
            disabled={publishing || selectedIntegrations.length === 0}
            className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
          >
            {publishing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Se publica...
              </>
            ) : scheduleDate && scheduleTime ? (
              <>
                <Calendar className="h-4 w-4 mr-2" />
                Programeaza
              </>
            ) : (
              <>
                <Share2 className="h-4 w-4 mr-2" />
                Publica Acum
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
