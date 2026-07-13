"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Cloud,
  FileAudio,
  FileImage,
  FileVideo,
  RefreshCw,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MediaItem = {
  id: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: number;
  status: string;
  origin: string;
  previewUrl: string | null;
  createdAt: string;
};

const ORIGINS = [
  "all",
  "clipping",
  "pipeline",
  "ai",
  "upload",
  "automation",
  "caption",
  "import",
] as const;
const KINDS = ["all", "video", "image", "audio"] as const;

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaLibraryPage() {
  const [origin, setOrigin] = React.useState<(typeof ORIGINS)[number]>("all");
  const [kind, setKind] = React.useState<(typeof KINDS)[number]>("all");
  const [items, setItems] = React.useState<MediaItem[]>([]);
  const [connected, setConnected] = React.useState<boolean | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "100" });
    if (origin !== "all") params.set("origin", origin);
    if (kind !== "all") params.set("kind", kind);
    try {
      const response = await apiGet(`/platform/media?${params}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        connected: boolean;
        media: MediaItem[];
      };
      setConnected(data.connected);
      setItems(data.media);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load the cloud library.",
      );
    } finally {
      setLoading(false);
    }
  }, [kind, origin]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-3xl font-bold tracking-tight">
              Media Library
            </h1>
            <Badge variant="outline" className="gap-1">
              <Cloud className="size-3" /> Shared cloud
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            The same assets created on web or desktop, grouped by how they were
            produced.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />{" "}
          Refresh
        </Button>
      </div>
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}
      {!loading && connected === false && (
        <Card>
          <CardHeader>
            <CardTitle>Connect your Blipost account</CardTitle>
            <CardDescription>
              The shared library is stored with your web account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/settings">Open Settings</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {connected && (
        <>
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <FilterRow
              label="Source"
              values={ORIGINS}
              value={origin}
              onChange={setOrigin}
            />
            <FilterRow
              label="Type"
              values={KINDS}
              value={kind}
              onChange={setKind}
            />
          </div>
          {items.length === 0 && !loading ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No media matches these filters.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => (
                <Card key={item.id} className="overflow-hidden">
                  <div className="relative flex aspect-video items-center justify-center bg-muted">
                    {item.previewUrl && item.mimeType.startsWith("image/") ? (
                      <Image
                        src={item.previewUrl}
                        alt={item.displayName ?? "Media"}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    ) : item.previewUrl &&
                      item.mimeType.startsWith("video/") ? (
                      <video
                        src={item.previewUrl}
                        controls
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    ) : item.mimeType.startsWith("video/") ? (
                      <FileVideo className="size-8 text-muted-foreground" />
                    ) : item.mimeType.startsWith("audio/") ? (
                      <FileAudio className="size-8 text-muted-foreground" />
                    ) : (
                      <FileImage className="size-8 text-muted-foreground" />
                    )}
                  </div>
                  <CardContent className="space-y-2 p-3">
                    <p
                      className="truncate text-sm font-medium"
                      title={item.displayName ?? item.id}
                    >
                      {item.displayName ?? item.id}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.origin}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(item.sizeBytes)} ·{" "}
                        {item.status.replaceAll("_", " ")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterRow<T extends readonly string[]>({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: T;
  value: T[number];
  onChange: (value: T[number]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {values.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
            item === value
              ? "border-primary/50 bg-primary/10 text-primary"
              : "hover:bg-muted",
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
