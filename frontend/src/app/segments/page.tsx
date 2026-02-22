"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Video,
  Upload,
  Trash2,
  Star,
  StarOff,
  Play,
  Clock,
  Tag,
  Scissors,
  RefreshCw,
  ChevronLeft,
  Search,
  Filter,
  Edit,
  MoreHorizontal,
  X,
  Merge,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

import { VideoSegmentPlayer } from "@/components/video-segment-player";
import { SimpleSegmentPopup } from "@/components/simple-segment-popup";
import { SegmentTransformPanel } from "@/components/segment-transform-panel";
import { EditorLayout } from "@/components/editor-layout";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, API_URL } from "@/lib/api";
import { useProfile } from "@/contexts/profile-context";
import type { SegmentTransform } from "@/types/video-processing";
import { DEFAULT_SEGMENT_TRANSFORM } from "@/types/video-processing";
import { EmptyState } from "@/components/empty-state";

interface SourceVideo {
  id: string;
  name: string;
  description?: string;
  file_path: string;
  thumbnail_path?: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  segments_count: number;
  created_at: string;
}

interface Segment {
  id: string;
  source_video_id: string;
  start_time: number;
  end_time: number;
  duration: number;
  keywords: string[];
  extracted_video_path?: string;
  thumbnail_path?: string;
  usage_count: number;
  is_favorite: boolean;
  notes?: string;
  transforms?: SegmentTransform | null;
  created_at: string;
  source_video_name?: string;
}

export default function SegmentsPage() {
  const { currentProfile, isLoading: profileLoading } = useProfile();

  // Source videos state
  const [sourceVideos, setSourceVideos] = useState<SourceVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<SourceVideo | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  // Segments state
  const [segments, setSegments] = useState<Segment[]>([]);
  const [allSegments, setAllSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [loadingSegments, setLoadingSegments] = useState(false);

  // Filter state
  const [viewMode, setViewMode] = useState<"current" | "all">("current");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [selectedKeywordFilter, setSelectedKeywordFilter] = useState<string | null>(null);

  // Marking state
  const [pendingSegment, setPendingSegment] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [showKeywordPopup, setShowKeywordPopup] = useState(false);
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);

  // Upload dialog
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Delete confirmation dialog
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "video" | "segment";
    id: string;
    name: string;
  } | null>(null);

  // Transform state
  const [activeTransforms, setActiveTransforms] = useState<SegmentTransform>({
    ...DEFAULT_SEGMENT_TRANSFORM,
  });

  // Overlap detection state
  const [overlapInfo, setOverlapInfo] = useState<{
    newSegment: { start: number; end: number };
    overlappingSegments: Segment[];
  } | null>(null);

  // Format time as mm:ss
  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Format time as mm:ss.ms for detailed display
  const formatTimeDetailed = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  // Check if two segments overlap
  const segmentsOverlap = (
    start1: number,
    end1: number,
    start2: number,
    end2: number
  ): boolean => {
    return start1 < end2 && end1 > start2;
  };

  // Find all segments that overlap with a given time range
  const findOverlappingSegments = (
    start: number,
    end: number,
    excludeId?: string
  ): Segment[] => {
    return segments.filter(
      (seg) =>
        seg.id !== excludeId && segmentsOverlap(start, end, seg.start_time, seg.end_time)
    );
  };

  // Fetch source videos
  const fetchSourceVideos = useCallback(async () => {
    try {
      const res = await apiGet("/segments/source-videos");
      if (res.ok) {
        const data = await res.json();
        setSourceVideos(data);
      }
    } catch (error) {
      console.error("Failed to fetch source videos:", error);
    }
  }, []);

  // Fetch segments for selected video
  const fetchSegments = useCallback(async (videoId: string) => {
    setLoadingSegments(true);
    try {
      const res = await apiGet(`/segments/source-videos/${videoId}/segments`);
      if (res.ok) {
        const data = await res.json();
        setSegments(data);
      }
    } catch (error) {
      console.error("Failed to fetch segments:", error);
    } finally {
      setLoadingSegments(false);
    }
  }, []);

  // Fetch ALL segments (for library view)
  const fetchAllSegments = useCallback(async () => {
    try {
      const res = await apiGet("/segments");
      if (res.ok) {
        const data = await res.json();
        setAllSegments(data);
      }
    } catch (error) {
      console.error("Failed to fetch all segments:", error);
    }
  }, []);

  // Filtered segments based on search and filters
  const filteredSegments = (viewMode === "all" ? allSegments : segments).filter((seg) => {
    // Favorites filter
    if (showFavoritesOnly && !seg.is_favorite) return false;

    // Keyword filter (exact match on selected keyword)
    if (selectedKeywordFilter && !seg.keywords.includes(selectedKeywordFilter)) return false;

    // Search filter (keywords or notes)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchesKeyword = seg.keywords.some((kw) => kw.toLowerCase().includes(query));
      const matchesNotes = seg.notes?.toLowerCase().includes(query);
      const matchesVideoName = seg.source_video_name?.toLowerCase().includes(query);
      if (!matchesKeyword && !matchesNotes && !matchesVideoName) return false;
    }

    return true;
  });

  // Get all unique keywords from current segments for filter dropdown
  const availableKeywords = Array.from(
    new Set(
      (viewMode === "all" ? allSegments : segments).flatMap((seg) => seg.keywords)
    )
  ).sort();

  // Initial load — re-fetch when profile changes
  useEffect(() => {
    if (profileLoading) return;
    if (!currentProfile) return;

    // Reset state when profile switches
    setSelectedVideo(null);
    setSegments([]);
    setAllSegments([]);
    setSelectedSegment(null);

    fetchSourceVideos();
    fetchAllSegments();
  }, [currentProfile?.id, profileLoading, fetchSourceVideos, fetchAllSegments]);

  // Actually delete segment
  const handleDeleteSegment = useCallback(async (segmentId: string) => {
    // Get the segment before deleting to know its source video
    const segmentToDelete = segments.find((s) => s.id === segmentId) ||
                            allSegments.find((s) => s.id === segmentId);

    try {
      const res = await apiDelete(`/segments/${segmentId}`);
      if (res.ok) {
        setSegments((prev) => prev.filter((s) => s.id !== segmentId));
        setAllSegments((prev) => prev.filter((s) => s.id !== segmentId));
        // Update source video segments count
        const videoId = segmentToDelete?.source_video_id || selectedVideo?.id;
        if (videoId) {
          setSourceVideos((prev) =>
            prev.map((v) =>
              v.id === videoId
                ? { ...v, segments_count: Math.max(0, v.segments_count - 1) }
                : v
            )
          );
        }
      } else {
        console.error("Delete segment failed:", res.status, await res.text().catch(() => ""));
      }
    } catch (error) {
      console.error("Failed to delete segment:", error);
    }
  }, [segments, allSegments, selectedVideo?.id]);

  // Delete key shortcut — delete selected segment instantly
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when typing in form elements
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedSegment) {
        e.preventDefault();
        handleDeleteSegment(selectedSegment.id);
        setSelectedSegment(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedSegment, handleDeleteSegment]);

  // Load segments when video selected
  useEffect(() => {
    if (selectedVideo) {
      fetchSegments(selectedVideo.id);
    } else {
      setSegments([]);
    }
  }, [selectedVideo, fetchSegments]);

  // Upload source video
  const handleUpload = async () => {
    if (!uploadFile || !uploadName.trim()) return;

    setUploadingVideo(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("video", uploadFile);
      formData.append("name", uploadName.trim());

      // Use raw fetch for FormData — apiFetch sets Content-Type: application/json
      // which breaks multipart uploads. We just need the profile ID header.
      const profileId = typeof window !== "undefined"
        ? localStorage.getItem("editai_current_profile_id")
        : null;
      const res = await fetch(`${API_URL}/segments/source-videos`, {
        method: "POST",
        body: formData,
        headers: {
          ...(profileId && { "X-Profile-Id": profileId }),
        },
      });

      if (res.ok) {
        const newVideo = await res.json();
        setSourceVideos((prev) => [newVideo, ...prev]);
        setSelectedVideo(newVideo);
        setShowUploadDialog(false);
        setUploadName("");
        setUploadFile(null);
        setUploadError(null);
      } else {
        const errorData = await res.json().catch(() => null);
        const message = errorData?.detail || `Upload failed (${res.status})`;
        setUploadError(message);
      }
    } catch (error) {
      console.error("Failed to upload video:", error);
      setUploadError("Failed to upload video. Check your connection and try again.");
    } finally {
      setUploadingVideo(false);
    }
  };

  // Request delete video (show confirmation)
  const requestDeleteVideo = (video: SourceVideo) => {
    setDeleteConfirm({
      type: "video",
      id: video.id,
      name: video.name,
    });
  };

  // Actually delete source video
  const handleDeleteVideo = async (videoId: string) => {
    try {
      const res = await apiDelete(`/segments/source-videos/${videoId}`);
      if (res.ok) {
        setSourceVideos((prev) => prev.filter((v) => v.id !== videoId));
        if (selectedVideo?.id === videoId) {
          setSelectedVideo(null);
        }
      }
    } catch (error) {
      console.error("Failed to delete video:", error);
    }
  };

  // Create segment (called from player)
  const handleSegmentCreate = (start: number, end: number) => {
    const overlapping = findOverlappingSegments(start, end);

    if (overlapping.length > 0) {
      // Show overlap dialog instead of keyword popup
      setOverlapInfo({
        newSegment: { start, end },
        overlappingSegments: overlapping,
      });
    } else {
      // No overlap, proceed normally
      setPendingSegment({ start, end });
      setShowKeywordPopup(true);
    }
  };

  // Handle merge segments (concatenate overlapping segments)
  const handleMergeSegments = async () => {
    if (!overlapInfo || !selectedVideo) return;

    const { newSegment, overlappingSegments } = overlapInfo;

    // Calculate merged time range (min start, max end)
    const allStarts = [newSegment.start, ...overlappingSegments.map((s) => s.start_time)];
    const allEnds = [newSegment.end, ...overlappingSegments.map((s) => s.end_time)];
    const mergedStart = Math.min(...allStarts);
    const mergedEnd = Math.max(...allEnds);

    // Combine all keywords from overlapping segments
    const combinedKeywords = Array.from(
      new Set(overlappingSegments.flatMap((s) => s.keywords))
    );

    // Delete overlapping segments first
    for (const seg of overlappingSegments) {
      try {
        await apiDelete(`/segments/${seg.id}`);
      } catch (error) {
        console.error("Failed to delete segment:", error);
      }
    }

    // Update local state to remove deleted segments
    const deletedIds = new Set(overlappingSegments.map((s) => s.id));
    setSegments((prev) => prev.filter((s) => !deletedIds.has(s.id)));
    setAllSegments((prev) => prev.filter((s) => !deletedIds.has(s.id)));

    // Update segments count
    setSourceVideos((prev) =>
      prev.map((v) =>
        v.id === selectedVideo.id
          ? { ...v, segments_count: Math.max(0, v.segments_count - overlappingSegments.length) }
          : v
      )
    );

    // Now show keyword popup with the merged segment and pre-filled keywords
    setPendingSegment({ start: mergedStart, end: mergedEnd });
    setShowKeywordPopup(true);
    setOverlapInfo(null);

    // Store combined keywords to pre-fill (we'll pass them through a ref or state)
    // For now, user will need to re-add keywords
  };

  // Handle create separate (ignore overlap warning)
  const handleCreateSeparate = () => {
    if (!overlapInfo) return;

    // Proceed with creating the segment normally
    setPendingSegment({ start: overlapInfo.newSegment.start, end: overlapInfo.newSegment.end });
    setShowKeywordPopup(true);
    setOverlapInfo(null);
  };

  // Save segment with keywords
  const handleSaveSegment = async (keywords: string[], notes: string) => {
    if (!selectedVideo || !pendingSegment) return;

    try {
      const res = await apiPost(
        `/segments/source-videos/${selectedVideo.id}/segments`,
        {
          start_time: pendingSegment.start,
          end_time: pendingSegment.end,
          keywords,
          notes,
        }
      );

      if (res.ok) {
        const newSegment = await res.json();
        // Add source video name for display
        newSegment.source_video_name = selectedVideo.name;
        setSegments((prev) => [...prev, newSegment].sort((a, b) => a.start_time - b.start_time));
        setAllSegments((prev) => [...prev, newSegment].sort((a, b) => a.start_time - b.start_time));
        // Update source video segments count
        setSourceVideos((prev) =>
          prev.map((v) =>
            v.id === selectedVideo.id
              ? { ...v, segments_count: v.segments_count + 1 }
              : v
          )
        );
      }
    } catch (error) {
      console.error("Failed to create segment:", error);
    }

    setPendingSegment(null);
    setShowKeywordPopup(false);
  };

  // Update segment (keywords)
  const handleUpdateSegment = async (keywords: string[], notes: string) => {
    if (!editingSegment) return;

    try {
      const res = await apiPatch(`/segments/${editingSegment.id}`, { keywords, notes });

      if (res.ok) {
        const updated = await res.json();
        setSegments((prev) =>
          prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
        );
        setAllSegments((prev) =>
          prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
        );
      }
    } catch (error) {
      console.error("Failed to update segment:", error);
    }

    setEditingSegment(null);
  };

  // Request delete segment (show confirmation)
  const requestDeleteSegment = (segment: Segment) => {
    setDeleteConfirm({
      type: "segment",
      id: segment.id,
      name: `${formatTime(segment.start_time)} - ${formatTime(segment.end_time)}`,
    });
  };

  // Handle confirmed delete
  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;

    if (deleteConfirm.type === "video") {
      await handleDeleteVideo(deleteConfirm.id);
    } else {
      await handleDeleteSegment(deleteConfirm.id);
    }

    setDeleteConfirm(null);
  };

  // Save transforms for selected segment
  const handleSaveTransforms = async (transforms: SegmentTransform) => {
    if (!selectedSegment) return;
    try {
      const res = await apiPut(`/segments/${selectedSegment.id}/transforms`, transforms);
      if (res.ok) {
        setSegments((prev) =>
          prev.map((s) => (s.id === selectedSegment.id ? { ...s, transforms } : s))
        );
        setAllSegments((prev) =>
          prev.map((s) => (s.id === selectedSegment.id ? { ...s, transforms } : s))
        );
        setSelectedSegment((prev) => prev ? { ...prev, transforms } : prev);
      }
    } catch (error) {
      console.error("Failed to save transforms:", error);
    }
  };

  // Sync activeTransforms when selectedSegment changes
  const handleSegmentSelect = (seg: Segment) => {
    setSelectedSegment(seg);
    setActiveTransforms(seg.transforms || { ...DEFAULT_SEGMENT_TRANSFORM });
  };

  // Toggle favorite
  const handleToggleFavorite = async (segmentId: string) => {
    try {
      const res = await apiPost(`/segments/${segmentId}/favorite`);
      if (res.ok) {
        const { is_favorite } = await res.json();
        setSegments((prev) =>
          prev.map((s) => (s.id === segmentId ? { ...s, is_favorite } : s))
        );
        setAllSegments((prev) =>
          prev.map((s) => (s.id === segmentId ? { ...s, is_favorite } : s))
        );
      }
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  };

  // Left panel content - Source Videos
  const leftPanelContent = (
    <div className="h-full flex flex-col">
      {/* Upload button */}
      <div className="p-3 border-b border-border">
        <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
          <DialogTrigger asChild>
            <Button size="sm" className="w-full">
              <Upload className="h-4 w-4 mr-1" />
              Upload Video
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Source Video</DialogTitle>
              <DialogDescription>
                Upload a video to create segments from
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="video-name">Name</Label>
                <Input
                  id="video-name"
                  placeholder="Video name"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-file">Video File</Label>
                <Input
                  id="video-file"
                  type="file"
                  accept="video/*"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
            {uploadError && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setShowUploadDialog(false); setUploadError(null); }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!uploadFile || !uploadName.trim() || uploadingVideo}
                className="min-w-[100px]"
              >
                {uploadingVideo ? "Se incarca..." : "Upload"}
              </Button>
            </DialogFooter>
            {(!uploadFile || !uploadName.trim()) && (
              <p className="text-xs text-muted-foreground mt-2">
                * Completează numele și selectează un fișier video pentru a activa butonul Upload
              </p>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Videos list */}
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {sourceVideos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No videos uploaded yet
            </p>
          ) : (
            sourceVideos.map((video) => (
              <div
                key={video.id}
                className={`group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                  selectedVideo?.id === video.id
                    ? "bg-primary/10 border border-primary/50"
                    : "hover:bg-muted"
                }`}
                onClick={() => setSelectedVideo(video)}
              >
                {/* Thumbnail */}
                <div className="w-14 h-9 bg-muted rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                  {video.thumbnail_path ? (
                    <img
                      src={`${API_URL}/segments/files/${encodeURIComponent(video.thumbnail_path)}`}
                      alt={video.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Video className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">
                    {video.name}
                  </p>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span>{formatTime(video.duration || 0)}</span>
                    <span>•</span>
                    <span>{video.segments_count} seg</span>
                  </div>
                </div>

                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestDeleteVideo(video);
                  }}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );

  // Right panel content - Segments Library
  const rightPanelContent = (
    <div className="h-full flex flex-col">
      {/* Header with count */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4" />
          <span className="text-sm font-medium">Segments</span>
          {filteredSegments.length > 0 && (
            <Badge variant="secondary" className="text-xs">{filteredSegments.length}</Badge>
          )}
        </div>
      </div>

      {/* View mode tabs */}
      <div className="flex gap-1 p-2 border-b border-border">
        <Button
          variant={viewMode === "current" ? "default" : "outline"}
          size="sm"
          className="flex-1 h-7 text-xs"
          onClick={() => setViewMode("current")}
        >
          Current
        </Button>
        <Button
          variant={viewMode === "all" ? "default" : "outline"}
          size="sm"
          className="flex-1 h-7 text-xs"
          onClick={() => setViewMode("all")}
        >
          All
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative p-2 border-b border-border">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 pl-8 text-sm"
        />
      </div>

      {/* Filter buttons */}
      <div className="flex flex-wrap gap-1 p-2 border-b border-border">
        <Button
          variant={showFavoritesOnly ? "default" : "outline"}
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
        >
          <Star className="h-3 w-3" />
          Fav
        </Button>
        {selectedKeywordFilter && (
          <Badge
            variant="secondary"
            className="pl-2 pr-1 h-6 gap-1 cursor-pointer"
            onClick={() => setSelectedKeywordFilter(null)}
          >
            {selectedKeywordFilter}
            <X className="h-3 w-3" />
          </Badge>
        )}
      </div>

      {/* Available keywords for filtering */}
      {availableKeywords.length > 0 && !selectedKeywordFilter && (
        <div className="flex flex-wrap gap-1 p-2 border-b border-border">
          {availableKeywords.slice(0, 6).map((kw) => (
            <Button
              key={kw}
              variant="ghost"
              size="sm"
              className="h-5 text-xs px-2"
              onClick={() => setSelectedKeywordFilter(kw)}
            >
              {kw}
            </Button>
          ))}
          {availableKeywords.length > 6 && (
            <span className="text-[10px] text-muted-foreground self-center">
              +{availableKeywords.length - 6}
            </span>
          )}
        </div>
      )}

      {/* Segments list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-2 p-2">
          {loadingSegments && viewMode === "current" ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Loading...
            </p>
          ) : filteredSegments.length === 0 ? (
            <EmptyState
              icon={<Scissors className="h-6 w-6" />}
              title="Niciun segment"
              description={
                viewMode === "current" && !selectedVideo
                  ? "Selecteaza un video mai intai."
                  : searchQuery || showFavoritesOnly || selectedKeywordFilter
                  ? "Niciun segment nu corespunde filtrelor."
                  : "Segmentele video selectate vor aparea aici."
              }
            />
          ) : (
            filteredSegments.map((segment) => (
              <div
                key={segment.id}
                className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                  selectedSegment?.id === segment.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border hover:border-primary/50"
                }`}
                onClick={() => handleSegmentSelect(segment)}
              >
                {/* Source video name (in All Videos mode) */}
                {viewMode === "all" && segment.source_video_name && (
                  <p className="text-[10px] text-muted-foreground mb-1 truncate">
                    <Video className="h-3 w-3 inline mr-1" />
                    {segment.source_video_name}
                  </p>
                )}

                {/* Header */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono text-xs">
                      {formatTime(segment.start_time)} - {formatTime(segment.end_time)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleToggleFavorite(segment.id)}
                  >
                    {segment.is_favorite ? (
                      <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                    ) : (
                      <StarOff className="h-3 w-3 text-muted-foreground" />
                    )}
                  </Button>
                </div>

                {/* Duration badge */}
                <Badge variant="outline" className="text-[10px] mb-1">
                  {segment.duration.toFixed(1)}s
                </Badge>

                {/* Keywords */}
                {segment.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {segment.keywords.map((kw) => (
                      <Badge key={kw} variant="secondary" className="text-[10px]">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Usage info */}
                {segment.usage_count > 0 && (
                  <p className="text-[10px] text-muted-foreground mb-1">
                    Used in {segment.usage_count} project(s)
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 pt-1 border-t border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => setEditingSegment(segment)}
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
                    onClick={() => requestDeleteSegment(segment)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Transform panel - shown when segment is selected */}
      {selectedSegment && (
        <div className="border-t border-border p-3">
          <SegmentTransformPanel
            transforms={activeTransforms}
            onChange={setActiveTransforms}
            onSave={handleSaveTransforms}
          />
        </div>
      )}
    </div>
  );

  // Center content - Video Player
  const centerContent = (
    <div className="h-full flex flex-col">
      {/* Video header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Link href="/library">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Scissors className="h-5 w-5" />
              {selectedVideo ? selectedVideo.name : "Segment Editor"}
            </h1>
            {selectedVideo ? (
              <p className="text-xs text-muted-foreground">
                {selectedVideo.width}x{selectedVideo.height} • {selectedVideo.fps}fps • {formatTime(selectedVideo.duration || 0)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Select a video to start marking segments
              </p>
            )}
          </div>
        </div>
        <Button onClick={fetchSourceVideos} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Video player */}
      <div className="flex-1 min-h-0">
        {selectedVideo ? (
          <VideoSegmentPlayer
            videoUrl={`${API_URL}/segments/source-videos/${selectedVideo.id}/stream`}
            duration={selectedVideo.duration || 0}
            segments={segments}
            onSegmentCreate={handleSegmentCreate}
            onSegmentClick={(seg) => handleSegmentSelect(seg as Segment)}
            activeTransforms={selectedSegment ? activeTransforms : undefined}
            currentSegment={selectedSegment || undefined}
            sourceVideoId={selectedVideo.id}
          />
        ) : (
          <div className="aspect-video bg-muted rounded-lg flex items-center justify-center max-h-[60vh]">
            <div className="text-center text-muted-foreground">
              <Video className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Select a video from the sidebar</p>
              <p className="text-sm">or upload a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <EditorLayout
        leftPanel={leftPanelContent}
        rightPanel={rightPanelContent}
        leftPanelTitle="Source Videos"
        rightPanelTitle="Segments Library"
      >
        {centerContent}
      </EditorLayout>

      {/* Segment keyword popup - for new segments (conditional render) */}
        {showKeywordPopup && pendingSegment && (
          <SimpleSegmentPopup
            onClose={() => {
              setShowKeywordPopup(false);
              setPendingSegment(null);
            }}
            onSave={handleSaveSegment}
            startTime={pendingSegment.start}
            endTime={pendingSegment.end}
          />
        )}

        {/* Segment edit popup (conditional render) */}
        {editingSegment && (
          <SimpleSegmentPopup
            onClose={() => setEditingSegment(null)}
            onSave={handleUpdateSegment}
            startTime={editingSegment.start_time}
            endTime={editingSegment.end_time}
            initialKeywords={editingSegment.keywords}
            initialNotes={editingSegment.notes || ""}
            isEditing={true}
          />
        )}

        {/* Delete confirmation dialog */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/80"
              onClick={() => setDeleteConfirm(null)}
            />

            {/* Modal */}
            <div className="relative z-10 bg-background border border-border rounded-lg shadow-lg w-full max-w-md mx-4 animate-in fade-in-0 zoom-in-95">
              {/* Header */}
              <div className="p-6 pb-4">
                <div className="flex items-center gap-2 text-lg font-semibold text-destructive">
                  <Trash2 className="h-5 w-5" />
                  Confirm Delete
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {deleteConfirm.type === "video" ? (
                    <>
                      Are you sure you want to delete <strong>{deleteConfirm.name}</strong> and all its segments?
                      This action cannot be undone.
                    </>
                  ) : (
                    <>
                      Are you sure you want to delete segment <strong>{deleteConfirm.name}</strong>?
                      This action cannot be undone.
                    </>
                  )}
                </p>

                {/* Close button */}
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-2 p-6 pt-4 border-t">
                <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleConfirmDelete}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Overlap detection dialog */}
        {overlapInfo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/80"
              onClick={() => setOverlapInfo(null)}
            />

            {/* Modal */}
            <div className="relative z-10 bg-background border border-border rounded-lg shadow-lg w-full max-w-lg mx-4 animate-in fade-in-0 zoom-in-95">
              {/* Header */}
              <div className="p-6 pb-4">
                <div className="flex items-center gap-2 text-lg font-semibold text-yellow-500">
                  <AlertTriangle className="h-5 w-5" />
                  Segmente suprapuse detectate
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Segmentul nou ({formatTimeDetailed(overlapInfo.newSegment.start)} → {formatTimeDetailed(overlapInfo.newSegment.end)})
                  se suprapune cu {overlapInfo.overlappingSegments.length} segment{overlapInfo.overlappingSegments.length > 1 ? "e" : ""} existent{overlapInfo.overlappingSegments.length > 1 ? "e" : ""}:
                </p>

                {/* List overlapping segments */}
                <div className="mt-3 space-y-2">
                  {overlapInfo.overlappingSegments.map((seg) => (
                    <div
                      key={seg.id}
                      className="flex items-center gap-2 p-2 bg-muted rounded-md text-sm"
                    >
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono">
                        {formatTimeDetailed(seg.start_time)} → {formatTimeDetailed(seg.end_time)}
                      </span>
                      {seg.keywords.length > 0 && (
                        <div className="flex gap-1">
                          {seg.keywords.map((kw) => (
                            <Badge key={kw} variant="secondary" className="text-xs">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Show merged result preview */}
                <div className="mt-4 p-3 border border-primary/50 rounded-md bg-primary/5">
                  <p className="text-sm font-medium text-primary flex items-center gap-2">
                    <Merge className="h-4 w-4" />
                    Dacă unești, noul segment va fi:
                  </p>
                  <p className="text-sm font-mono mt-1">
                    {formatTimeDetailed(
                      Math.min(overlapInfo.newSegment.start, ...overlapInfo.overlappingSegments.map((s) => s.start_time))
                    )}{" "}
                    →{" "}
                    {formatTimeDetailed(
                      Math.max(overlapInfo.newSegment.end, ...overlapInfo.overlappingSegments.map((s) => s.end_time))
                    )}
                  </p>
                </div>

                {/* Close button */}
                <button
                  onClick={() => setOverlapInfo(null)}
                  className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Footer */}
              <div className="flex flex-col gap-2 p-6 pt-4 border-t">
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setOverlapInfo(null)}>
                    Anulează
                  </Button>
                  <Button variant="secondary" onClick={handleCreateSeparate}>
                    Creează separat
                  </Button>
                  <Button onClick={handleMergeSegments}>
                    <Merge className="h-4 w-4 mr-2" />
                    Unește segmentele
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-right">
                  &quot;Creează separat&quot; va crea segmentul fără a modifica cele existente
                </p>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
