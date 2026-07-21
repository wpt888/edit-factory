"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useApiUrl } from "@/hooks/use-api-url";
import {
  Clock,
  Film,
  LayoutGrid,
  List,
  Loader2,
  Scissors,
  Search,
  Upload,
  X,
} from "lucide-react";
import { formatDuration } from "../pipeline-utils";
import { WorkspacePanelHeader } from "./workspace-panel-header";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SourceVideosCard({ ctx, workspace = false }: { ctx: any; workspace?: boolean }) {
  const mediaApiUrl = useApiUrl();
  const {
    sourceVideos,
    sourceVideosLoading,
    selectedSourceIds,
    handleSelectAllSources,
    handleDeselectAllSources,
    sourceVideoSearch,
    setSourceVideoSearch,
    sourceVideoViewMode,
    setSourceVideoViewMode,
    handleSourceToggle,
  } = ctx;
  const totalAvailableSegments = sourceVideos.reduce(
    (total: number, video: { segments_count: number }) => total + video.segments_count,
    0
  );

  return (
    <Card
      variant={workspace ? "workspace" : "default"}
      className={workspace
        ? "gap-0 py-0"
        : "order-[-1] gap-0 py-0 min-[1100px]:col-start-1 min-[1100px]:row-start-2"
      }
      data-testid="source-videos-panel"
    >
      <WorkspacePanelHeader
        icon={Film}
        title="Source Videos"
        data-testid="source-videos-header"
        actions={sourceVideos.length > 1 ? (
          <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeselectAllSources}
                disabled={selectedSourceIds.size === 0}
              >
                Deselect All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAllSources}
                disabled={selectedSourceIds.size === sourceVideos.length}
              >
                Select All
              </Button>
          </div>
        ) : undefined}
      />
      <CardContent className={workspace ? "space-y-3 min-[1280px]:py-4" : "space-y-3 pt-4"}>
        <CardDescription>
          {sourceVideos.length <= 1
            ? "Source video for segment matching"
            : `Select which videos to match segments from (${selectedSourceIds.size} of ${sourceVideos.length} selected)`}
        </CardDescription>
        {sourceVideosLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading source videos...
          </div>
        ) : sourceVideos.length === 0 ? (
          <div
            className="flex flex-col items-center rounded-lg border border-dashed border-warning/50 bg-warning/5 px-5 py-8 text-center"
            data-testid="source-videos-empty-state"
          >
            <div className="mb-3 rounded-full bg-warning/10 p-3 text-warning">
              <Upload className="size-5" />
            </div>
            <p className="font-medium">Add footage before generating</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Upload a source video and mark reusable segments so scripts have visuals to match.
            </p>
            <Button asChild variant="cta" size="sm" className="mt-4">
              <Link href="/segments?action=upload">Upload & create segments</Link>
            </Button>
          </div>
        ) : totalAvailableSegments === 0 ? (
          <div
            className="flex flex-col items-center rounded-lg border border-dashed border-warning/50 bg-warning/5 px-5 py-8 text-center"
            data-testid="source-segments-empty-state"
          >
            <div className="mb-3 rounded-full bg-warning/10 p-3 text-warning">
              <Scissors className="size-5" />
            </div>
            <p className="font-medium">Create segments from your footage</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Your source videos are ready, but none contain reusable segments yet.
            </p>
            <Button asChild variant="cta" size="sm" className="mt-4">
              <Link href={sourceVideos.length === 1
                ? `/segments?video=${encodeURIComponent(sourceVideos[0].id)}`
                : "/segments"
              }>
                Open footage & segment it
              </Link>
            </Button>
          </div>
        ) : sourceVideos.length === 1 ? (
          <div
            className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
              selectedSourceIds.has(sourceVideos[0].id)
                ? "border-primary/30 bg-primary/5"
                : "hover:bg-muted/50"
            }`}
            onClick={() => handleSourceToggle(sourceVideos[0].id)}
          >
            <Checkbox
              checked={selectedSourceIds.has(sourceVideos[0].id)}
              onCheckedChange={() => handleSourceToggle(sourceVideos[0].id)}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Select ${sourceVideos[0].name}`}
            />
            {sourceVideos[0].thumbnail_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${mediaApiUrl}/segments/source-videos/${encodeURIComponent(sourceVideos[0].id)}/thumbnail`}
                alt={`Thumbnail for ${sourceVideos[0].name}`}
                className="w-20 aspect-video rounded object-cover flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-20 aspect-video rounded bg-muted flex items-center justify-center flex-shrink-0">
                <Film className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{sourceVideos[0].name}</p>
            </div>
            {sourceVideos[0].duration && (
              <Badge variant="outline" className="text-xs flex-shrink-0">
                <Clock className="size-3 mr-1" />
                {formatDuration(sourceVideos[0].duration)}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              {sourceVideos[0].segments_count} segments
            </Badge>
            <Link
              href={`/segments?video=${encodeURIComponent(sourceVideos[0].id)}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              title={`Edit segments for ${sourceVideos[0].name}`}
            >
              <Scissors className="size-3.5" />
              Edit segments
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {sourceVideos.length > 3 && (
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Search videos by name..."
                    value={sourceVideoSearch}
                    onChange={(e) => setSourceVideoSearch(e.target.value)}
                    className="pl-9 pr-9"
                  />
                  {sourceVideoSearch && (
                    <button
                      onClick={() => setSourceVideoSearch("")}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center border rounded-md">
                <button
                  onClick={() => setSourceVideoViewMode("list")}
                  className={`p-2 transition-colors ${sourceVideoViewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  title="List view"
                >
                  <List className="size-4" />
                </button>
                <button
                  onClick={() => setSourceVideoViewMode("grid")}
                  className={`p-2 transition-colors ${sourceVideoViewMode === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  title="Grid view"
                >
                  <LayoutGrid className="size-4" />
                </button>
              </div>
            </div>
            <div className="max-h-[400px] overflow-y-auto pr-1">
              {sourceVideoViewMode === "list" ? (
                <div className="space-y-2">
                  {sourceVideos
                    .filter((video: { name: string }) => !sourceVideoSearch.trim() || video.name.toLowerCase().includes(sourceVideoSearch.toLowerCase()))
                    .map((video: { id: string; name: string; thumbnail_path: string | null; duration: number | null; segments_count: number }) => (
                    <div
                      key={video.id}
                      className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                        selectedSourceIds.has(video.id)
                          ? "bg-primary/5 border-primary/30"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => handleSourceToggle(video.id)}
                    >
                      <Checkbox
                        checked={selectedSourceIds.has(video.id)}
                        onCheckedChange={() => handleSourceToggle(video.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {video.thumbnail_path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`${mediaApiUrl}/segments/source-videos/${encodeURIComponent(video.id)}/thumbnail`}
                          alt={`Thumbnail for ${video.name}`}
                          className="w-20 aspect-video rounded object-cover flex-shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-20 aspect-video rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <Film className="size-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{video.name}</p>
                      </div>
                      {video.duration && (
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          <Clock className="size-3 mr-1" />
                          {formatDuration(video.duration)}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-xs flex-shrink-0">
                        {video.segments_count} segments
                      </Badge>
                      <Link
                        href={`/segments?video=${encodeURIComponent(video.id)}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        title={`Edit segments for ${video.name}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Scissors className="size-3.5" />
                        Edit
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-2">
                  {sourceVideos
                    .filter((video: { name: string }) => !sourceVideoSearch.trim() || video.name.toLowerCase().includes(sourceVideoSearch.toLowerCase()))
                    .map((video: { id: string; name: string; thumbnail_path: string | null; duration: number | null; segments_count: number }) => (
                    <div
                      key={video.id}
                      className={`relative p-2 rounded-lg border cursor-pointer transition-colors ${
                        selectedSourceIds.has(video.id)
                          ? "bg-primary/5 border-primary/30"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => handleSourceToggle(video.id)}
                    >
                      <div className="absolute top-1 left-1 z-10">
                        <Checkbox
                          checked={selectedSourceIds.has(video.id)}
                          onCheckedChange={() => handleSourceToggle(video.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-background/80"
                        />
                      </div>
                      <div className="aspect-video rounded overflow-hidden bg-muted mb-1.5">
                        {video.thumbnail_path ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${mediaApiUrl}/segments/source-videos/${encodeURIComponent(video.id)}/thumbnail`}
                            alt={`Thumbnail for ${video.name}`}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).src = ""; (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Film className="size-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <p className="text-xs font-medium truncate">{video.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {video.duration && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {formatDuration(video.duration)}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          {video.segments_count} seg
                        </Badge>
                        <Link
                          href={`/segments?video=${encodeURIComponent(video.id)}`}
                          className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                          title={`Edit segments for ${video.name}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Scissors className="size-3" />
                          Edit
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="text-xs text-muted-foreground pt-2 border-t">
              Total segments available: {sourceVideos.filter((video: { id: string }) => selectedSourceIds.has(video.id)).reduce((sum: number, video: { segments_count: number }) => sum + video.segments_count, 0)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
