"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, ImageIcon, Link2, Loader2, Upload } from "lucide-react";
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

type CloudImage = {
  id: string;
  displayName: string | null;
  mimeType: string;
  previewUrl: string | null;
  status: string;
};

type MediaResponse = {
  connected: boolean;
  media: CloudImage[];
};

type AttentionAssetPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (url: string) => void;
};

export function AttentionAssetPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: AttentionAssetPickerDialogProps) {
  const [tab, setTab] = useState<"gallery" | "upload" | "url">("gallery");
  const [images, setImages] = useState<CloudImage[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadImages = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiGet("/platform/media?kind=image&limit=100", {
        cache: "no-store",
      });
      const data = (await response.json()) as MediaResponse;
      setConnected(data.connected);
      setImages(data.media.filter((item) => item.previewUrl));
      return data.media;
    } catch {
      setConnected(false);
      setImages([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setUrl("");
      return;
    }
    void loadImages();
  }, [loadImages, open]);

  const choose = (value: string) => {
    onSelect(value);
    onOpenChange(false);
  };

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file");
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
      const refreshed = await loadImages();
      const uploaded = refreshed.find((item) => item.id === mediaId);
      if (uploaded?.previewUrl) {
        choose(uploaded.previewUrl);
      } else {
        setTab("gallery");
        toast.success("Image uploaded. Select it from the gallery.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Choose attention image</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Attention image source">
          {([
            ["gallery", "Gallery", Cloud],
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
                Connect Blipost to use the shared media gallery, or paste a URL.
              </div>
            ) : images.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <ImageIcon className="size-8" />
                No uploaded images yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 py-2 sm:grid-cols-4">
                {images.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    className="group overflow-hidden rounded-lg border bg-black/20 text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => image.previewUrl && choose(image.previewUrl)}
                    title={image.displayName ?? "Uploaded image"}
                  >
                    <img src={image.previewUrl ?? ""} alt="" className="aspect-square w-full object-cover transition group-hover:scale-[1.03]" />
                    <span className="block truncate px-2 py-1.5 text-[11px] text-muted-foreground">
                      {image.displayName ?? "Uploaded image"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "upload" && (
          <div className="flex min-h-52 flex-col items-center justify-center gap-4 rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            {uploading ? <Loader2 className="size-10 animate-spin text-primary" /> : <Upload className="size-10 text-primary" />}
            <div>
              <p className="font-medium">Upload to the shared media library</p>
              <p className="mt-1 text-sm text-muted-foreground">PNG, JPEG, WebP, GIF, or another browser-supported image.</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadFile(file);
              }}
            />
            <Button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "Uploading..." : "Choose image"}
            </Button>
          </div>
        )}

        {tab === "url" && (
          <form
            className="space-y-3 py-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (url.trim()) choose(url.trim());
            }}
          >
            <label className="space-y-1 text-sm font-medium">
              Image URL
              <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." autoFocus />
            </label>
            <Button type="submit" disabled={!url.trim()}>Use image URL</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
