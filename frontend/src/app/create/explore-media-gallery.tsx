"use client";

/* Wikimedia Commons is intentionally rendered with native media elements:
   remote catalog hosts are not part of the app's Next Image allowlist.
   Image sources start immediately; video sources stay viewport-aware. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  ExternalLink,
  Film,
  ImageIcon,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  loadUnifiedAiMediaCatalog,
  type ExploreMediaAsset,
} from "./media-catalog";

type MediaFilter = "all" | "landscape" | "portrait" | "square";

const FILTERS: Array<{ value: MediaFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
  { value: "square", label: "Square" },
];

const VIDEO_START_GAP_MS = 160;
let nextVideoStartAt = 0;

function scheduleVideoStart(callback: () => void): number {
  const now = window.performance.now();
  const scheduledAt = Math.max(now, nextVideoStartAt);
  nextVideoStartAt = scheduledAt + VIDEO_START_GAP_MS;
  return window.setTimeout(callback, scheduledAt - now);
}

function CatalogImage({ asset }: { asset: ExploreMediaAsset }) {
  return (
    <img
      src={asset.imageUrl}
      alt=""
      aria-hidden="true"
      loading="eager"
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

function ViewportVideo({ asset }: { asset: ExploreMediaAsset }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !asset.videoUrl) return;

    let sourceAttached = false;
    let visible = false;
    let startTimer: number | null = null;
    const releaseVideo = () => {
      if (startTimer !== null) window.clearTimeout(startTimer);
      video.pause();
      video.removeAttribute("src");
      video.removeAttribute("poster");
      video.load();
      sourceAttached = false;
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.1) {
          visible = true;
          if (!sourceAttached && startTimer === null) {
            startTimer = scheduleVideoStart(() => {
              startTimer = null;
              if (!visible) return;
              video.poster = asset.posterUrl ?? "";
              video.src = asset.videoUrl ?? "";
              sourceAttached = true;
              void video.play().catch(() => undefined);
            });
          } else if (sourceAttached) {
            void video.play().catch(() => undefined);
          }
        } else {
          visible = false;
          if (startTimer !== null) {
            window.clearTimeout(startTimer);
            startTimer = null;
          }
          if (sourceAttached) video.pause();
        }
      },
      { threshold: [0, 0.1, 0.5] },
    );

    observer.observe(video);
    return () => {
      observer.disconnect();
      releaseVideo();
    };
  }, [asset.posterUrl, asset.videoUrl]);

  return (
    <video
      ref={videoRef}
      aria-label={asset.title}
      className="absolute inset-0 h-full w-full object-cover"
      autoPlay
      muted
      loop
      playsInline
      preload="none"
    />
  );
}

function MediaTile({ asset }: { asset: ExploreMediaAsset }) {
  return (
    <figure
      data-testid="explore-media-item"
      data-media-id={asset.id}
      data-media-kind={asset.kind}
      data-orientation={asset.orientation}
      className="group relative mb-3 break-inside-avoid overflow-hidden rounded-lg border border-border/70 bg-black focus-within:ring-2 focus-within:ring-ring"
      style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
    >
      {asset.kind === "video" ? (
        <ViewportVideo asset={asset} />
      ) : (
        <CatalogImage asset={asset} />
      )}

      <div
        data-testid="media-hover-overlay"
        className="pointer-events-none absolute inset-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/80 via-black/15 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span className="min-w-0 text-white">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            {asset.kind === "video" ? (
              <Film className="size-3.5" aria-hidden="true" />
            ) : (
              <ImageIcon className="size-3.5" aria-hidden="true" />
            )}
            {asset.ratioLabel}
          </span>
          <span className="mt-1 flex items-center gap-1 text-[11px] text-white/80">
            <BadgeCheck className="size-3" aria-hidden="true" />
            AI-generated · {asset.licenseName}
          </span>
          <span className="mt-0.5 block max-w-48 truncate text-[11px] text-white/70">
            {asset.attribution}
          </span>
        </span>
        <Button
          asChild
          variant="secondary"
          size="icon"
          className="pointer-events-auto size-8 shrink-0 bg-black/65 text-white hover:bg-black/85"
        >
          <a
            href={asset.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open verified source for ${asset.title}`}
          >
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>

      <figcaption className="sr-only">
        {asset.title}. AI-generated {asset.kind}, {asset.ratioLabel}. Licensed as{" "}
        {asset.licenseName}; attribution: {asset.attribution}. Source: {asset.sourceName}.
      </figcaption>
    </figure>
  );
}

export function ExploreMediaGallery() {
  const [catalog, setCatalog] = useState<ExploreMediaAsset[]>([]);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setHasError(false);
    setIsLoading(true);
    void loadUnifiedAiMediaCatalog(controller.signal)
      .then((nextCatalog) => {
        setCatalog(nextCatalog);
        setIsLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setHasError(true);
        setIsLoading(false);
      });
    return () => controller.abort();
  }, [reloadVersion]);

  const filteredCatalog = useMemo(() => {
    return catalog.filter(
      (asset) => filter === "all" || asset.orientation === filter,
    );
  }, [catalog, filter]);

  return (
    <section
      data-catalog-source={
        hasError ? "error" : isLoading ? "loading" : "wikimedia-commons"
      }
      data-media-feed="mixed"
      className="space-y-4"
      aria-labelledby="explore-media-heading"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="explore-media-heading" className="font-heading text-lg font-semibold">
              Explore AI media
            </h2>
            <p className="text-sm text-muted-foreground">
              AI provenance and Public Domain/CC0 rights verified per item.
            </p>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {isLoading
              ? "Verifying media…"
              : `${filteredCatalog.length} of ${catalog.length} materials`}
          </p>
        </div>

        {!hasError && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter media">
            {FILTERS.map((candidate) => (
              <Button
                key={candidate.value}
                variant={filter === candidate.value ? "secondary" : "outline"}
                size="sm"
                aria-pressed={filter === candidate.value}
                onClick={() => setFilter(candidate.value)}
              >
                {candidate.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {isLoading && catalog.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          Verifying AI provenance and reuse rights…
        </div>
      ) : hasError ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            Verified AI media could not be loaded. Unverified stock is never used as a fallback.
          </p>
          <Button variant="outline" size="sm" onClick={() => setReloadVersion((value) => value + 1)}>
            <RefreshCw className="size-4" />
            Retry verification
          </Button>
        </div>
      ) : filteredCatalog.length > 0 ? (
        <div
          data-testid="explore-media-grid"
          className="columns-2 gap-3 md:columns-3 xl:columns-4"
        >
          {filteredCatalog.map((asset) => (
            <MediaTile key={asset.id} asset={asset} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
          No verified media matches this filter.
        </div>
      )}
    </section>
  );
}
