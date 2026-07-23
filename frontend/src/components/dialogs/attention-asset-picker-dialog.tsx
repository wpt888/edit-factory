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
import { apiGet, apiUpload, getApiUrl } from "@/lib/api";

export type AttentionAssetType = "image" | "video";
export type AttentionAsset = { url: string; type: AttentionAssetType };

type CloudMedia = {
  id: string;
  displayName: string | null;
  mimeType: string;
  previewUrl: string | null;
  status: string;
};

type MediaResponse = {
  connected: boolean;
  media: CloudMedia[];
};

type AttentionAssetPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: AttentionAsset) => void;
};

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

function typeFromMime(mimeType: string | undefined): AttentionAssetType {
  return mimeType?.startsWith("video/") ? "video" : "image";
}

const LOCAL_ATTENTION_MEDIA = /^media\/attention\/[^/]+\/([^/]+)$/i;

/** Resolve a persisted local path to the authenticated media endpoint used by
 *  native img/video elements. Cloud and user-entered URLs pass through. */
export function attentionAssetPreviewUrl(url: string): string {
  const match = LOCAL_ATTENTION_MEDIA.exec(url);
  if (!match) return url;
  const profileId = typeof window === "undefined"
    ? ""
    : localStorage.getItem("editai_current_profile_id") || "";
  const query = profileId ? `?profile_id=${encodeURIComponent(profileId)}` : "";
  return `${getApiUrl()}/segments/attention-media/${encodeURIComponent(match[1])}${query}`;
}

/** Save an image or video in the local attention-media library. Reused by the
 *  dialog Upload tab and by Ctrl+V paste; no Blipost account is required. */
export async function uploadAttentionMedia(file: File): Promise<AttentionAsset> {
  const form = new FormData();
  form.append("file", file);
  const response = await apiUpload("/segments/attention-media", form, { timeout: 15 * 60_000 });
  const data = (await response.json()) as { asset?: AttentionAsset };
  if (!data.asset?.url) throw new Error("Upload succeeded but no local asset was returned.");
  return data.asset;
}

export function AttentionAssetPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: AttentionAssetPickerDialogProps) {
  const [tab, setTab] = useState<"gallery" | "upload" | "url">("gallery");
  const [media, setMedia] = useState<CloudMedia[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMedia = useCallback(async () => {
    setLoading(true);
    try {
      // No kind filter: attention slots take images and videos alike.
      const response = await apiGet("/platform/media?limit=100", { cache: "no-store" });
      const data = (await response.json()) as MediaResponse;
      setConnected(data.connected);
      setMedia(data.media.filter((item) => item.previewUrl));
    } catch {
      setConnected(false);
      setMedia([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadMedia(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMedia, open]);

  const choose = (asset: AttentionAsset) => {
    onSelect(asset);
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setUrl("");
    onOpenChange(nextOpen);
  };

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      toast.error("Choose an image or video file");
      return;
    }
    setUploading(true);
    try {
      const asset = await uploadAttentionMedia(file);
      choose(asset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Choose attention media</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Attention media source">
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
            ) : media.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <ImageIcon className="size-8" />
                No uploaded media yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 py-2 sm:grid-cols-4">
                {media.map((item) => {
                  const type = typeFromMime(item.mimeType);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="group relative overflow-hidden rounded-lg border bg-black/20 text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => item.previewUrl && choose({ url: item.previewUrl, type })}
                      title={item.displayName ?? "Uploaded media"}
                    >
                      {type === "video" ? (
                        <video src={item.previewUrl ?? ""} muted playsInline preload="metadata" className="aspect-square w-full object-cover" />
                      ) : (
                        <img src={item.previewUrl ?? ""} alt="" className="aspect-square w-full object-cover transition group-hover:scale-[1.03]" />
                      )}
                      {type === "video" && (
                        <span className="absolute right-1.5 top-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">Video</span>
                      )}
                      <span className="block truncate px-2 py-1.5 text-[11px] text-muted-foreground">
                        {item.displayName ?? "Uploaded media"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "upload" && (
          <div className="flex min-h-52 flex-col items-center justify-center gap-4 rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            {uploading ? <Loader2 className="size-10 animate-spin text-primary" /> : <Upload className="size-10 text-primary" />}
            <div>
              <p className="font-medium">Add from this device</p>
              <p className="mt-1 text-sm text-muted-foreground">Saved locally. Blipost connection is not required.</p>
              <p className="mt-1 text-sm text-muted-foreground">Images (PNG, JPEG, WebP, GIF) or videos (MP4, WebM, MOV).</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadFile(file);
              }}
            />
            <Button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "Uploading..." : "Choose file"}
            </Button>
          </div>
        )}

        {tab === "url" && (
          <form
            className="space-y-3 py-5"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = url.trim();
              if (trimmed) choose({ url: trimmed, type: VIDEO_EXTENSIONS.test(trimmed) ? "video" : "image" });
            }}
          >
            <label className="space-y-1 text-sm font-medium">
              Media URL
              <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." autoFocus />
            </label>
            <Button type="submit" disabled={!url.trim()}>Use media URL</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
