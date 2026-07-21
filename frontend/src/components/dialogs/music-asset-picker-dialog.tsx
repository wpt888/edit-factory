"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, Link2, Loader2, Music, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiGet, apiUpload } from "@/lib/api";

// Reuses the same Blipost platform media library as attention images, filtered
// to kind=audio. The gallery needs a connected web account; the URL tab always
// works (any http(s) or local path the backend can read).
type CloudAudio = {
  id: string;
  displayName: string | null;
  mimeType: string;
  previewUrl: string | null;
  status: string;
};

type MediaResponse = {
  connected: boolean;
  media: CloudAudio[];
};

type MusicAssetPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: { url: string; label?: string }) => void;
  purpose?: "music" | "sound-effect";
};

export function MusicAssetPickerDialog({
  open,
  onOpenChange,
  onSelect,
  purpose = "music",
}: MusicAssetPickerDialogProps) {
  const [tab, setTab] = useState<"gallery" | "upload" | "url">("gallery");
  const [tracks, setTracks] = useState<CloudAudio[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSoundEffect = purpose === "sound-effect";

  const loadTracks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiGet("/platform/media?kind=audio&limit=100", {
        cache: "no-store",
      });
      const data = (await response.json()) as MediaResponse;
      setConnected(data.connected);
      setTracks(data.media.filter((item) => item.previewUrl));
      return data.media;
    } catch {
      setConnected(false);
      setTracks([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadTracks(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTracks, open]);

  const choose = (asset: { url: string; label?: string }) => {
    onSelect(asset);
    setUrl("");
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setUrl("");
    onOpenChange(nextOpen);
  };

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("audio/")) {
      toast.error("Choose an audio file");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await apiUpload("/platform/media/upload", form, {
        timeout: 15 * 60_000,
      });
      const { mediaId } = (await response.json()) as { mediaId: string };
      const refreshed = await loadTracks();
      const uploaded = refreshed.find((item) => item.id === mediaId);
      if (uploaded?.previewUrl) {
        choose({ url: uploaded.previewUrl, label: uploaded.displayName ?? file.name });
      } else {
        setTab("gallery");
        toast.success("Track uploaded. Select it from the library.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Audio upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{isSoundEffect ? "Choose sound effect" : "Choose background music"}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1" role="tablist" aria-label={isSoundEffect ? "Sound effect source" : "Music source"}>
          {([
            ["gallery", "Library", Cloud],
            ["upload", "Upload", Upload],
            ["url", "URL", Link2],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm transition ${
                tab === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === "gallery" && (
          <div className="min-h-48 overflow-y-auto">
            {loading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="size-7 animate-spin text-primary" />
              </div>
            ) : !connected ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Cloud className="size-8" />
                Connect Blipost to use the shared media library, or paste a URL.
              </div>
            ) : tracks.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Music className="size-8" />
                {isSoundEffect ? "No uploaded sound effects yet." : "No uploaded tracks yet."}
              </div>
            ) : (
              <ul className="divide-y divide-white/5 py-1" data-testid="music-gallery">
                {tracks.map((track) => (
                  <li key={track.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => track.previewUrl && choose({ url: track.previewUrl, label: track.displayName ?? undefined })}
                    >
                      <Music className="size-4 shrink-0 text-primary" />
                      <span className="truncate text-sm">{track.displayName ?? "Uploaded track"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "upload" && (
          <div className="flex min-h-52 flex-col items-center justify-center gap-4 rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            {uploading ? <Loader2 className="size-10 animate-spin text-primary" /> : <Upload className="size-10 text-primary" />}
            <div>
              <p className="font-medium">Upload to the shared media library</p>
              <p className="mt-1 text-sm text-muted-foreground">MP3, WAV, M4A, or another browser-supported audio file.</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadFile(file);
              }}
            />
            <Button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "Uploading..." : "Choose audio"}
            </Button>
          </div>
        )}

        {tab === "url" && (
          <form
            className="space-y-3 py-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (url.trim()) choose({ url: url.trim() });
            }}
          >
            <label className="space-y-1 text-sm font-medium">
              {isSoundEffect ? "Sound effect URL" : "Music URL"}
              <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." autoFocus />
            </label>
            <Button type="submit" disabled={!url.trim()}>{isSoundEffect ? "Use sound effect URL" : "Use music URL"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
