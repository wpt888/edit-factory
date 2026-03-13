"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  FolderOpen,
  Trash2,
  Star,
  StarOff,
  Clock,
  Tag,
  Scissors,
  RefreshCw,
  ChevronLeft,
  Search,
  Edit,
  X,
  Merge,
  AlertTriangle,
  Package,
  Images,
  Layers,
  Repeat1,
} from "lucide-react";
import Link from "next/link";

import { VideoSegmentPlayer } from "@/components/video-segment-player";
import { SimpleSegmentPopup } from "@/components/simple-segment-popup";
import { SegmentTransformPanel } from "@/components/segment-transform-panel";
import { EditorLayout } from "@/components/editor-layout";
import { ProductPickerDialog } from "@/components/product-picker-dialog";
import { ImagePickerDialog } from "@/components/image-picker-dialog";
import { PipOverlayPanel } from "@/components/pip-overlay-panel";
import type { AssociationResponse } from "@/components/product-picker-dialog";
import { PipConfig, DEFAULT_PIP_CONFIG } from "@/components/product-picker-dialog";
import { apiGetWithRetry, apiPost, apiPatch, apiPut, apiDelete, apiUpload, handleApiError, API_URL } from "@/lib/api";
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
  status?: string;
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
  product_group?: string | null;
  single_use: boolean;
  created_at: string;
  source_video_name?: string;
}

interface ProductGroup {
  id: string;
  source_video_id: string;
  label: string;
  start_time: number;
  end_time: number;
  color: string | null;
  segments_count: number;
  created_at: string;
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

  // Left panel
  const [videoSearchQuery, setVideoSearchQuery] = useState("");
  const [leftTab, setLeftTab] = useState<string>("videos");

  // Upload dialog
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Local file dialog (no copy, uses file path directly)
  const [showLocalDialog, setShowLocalDialog] = useState(false);
  const [localPath, setLocalPath] = useState("");
  const [localName, setLocalName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [addingLocal, setAddingLocal] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);
  const uploadPollRef = useRef<ReturnType<typeof setInterval> | null>(null); // Bug #52

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

  // Product association state
  const [associations, setAssociations] = useState<Record<string, AssociationResponse>>({});
  const [pickerSegmentId, setPickerSegmentId] = useState<string | null>(null);
  const [imagePickerAssoc, setImagePickerAssoc] = useState<AssociationResponse | null>(null);

  // PiP overlay panel state
  const [pipExpandedSegId, setPipExpandedSegId] = useState<string | null>(null);
  const [pipSaving, setPipSaving] = useState(false);

  // Undo history for segment deletes
  const undoStackRef = useRef<{ segment: Segment; videoId: string }[]>([]);

  // Product group state
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [groupLabel, setGroupLabel] = useState("");
  const [groupStartTime, setGroupStartTime] = useState(0);
  const [groupEndTime, setGroupEndTime] = useState(0);
  const [editingGroup, setEditingGroup] = useState<ProductGroup | null>(null);

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
      const res = await apiGetWithRetry("/segments/source-videos");
      if (res.ok) {
        const data = await res.json();
        setSourceVideos(data);
      }
    } catch (error) {
      handleApiError(error, "Error loading source videos");
    }
  }, []);

  // Fetch product groups for a video
  const fetchProductGroups = useCallback(async (videoId: string) => {
    try {
      const res = await apiGetWithRetry(`/segments/source-videos/${videoId}/product-groups`);
      if (res.ok) {
        const data = await res.json();
        setProductGroups(data);
      }
    } catch {
      // Silently ignore — groups are optional
    }
  }, []);

  // Fetch segments for selected video
  const fetchSegments = useCallback(async (videoId: string) => {
    setLoadingSegments(true);
    try {
      const res = await apiGetWithRetry(`/segments/source-videos/${videoId}/segments`);
      if (res.ok) {
        const data = await res.json();
        setSegments(data);
      }
    } catch (error) {
      handleApiError(error, "Error loading segments");
    } finally {
      setLoadingSegments(false);
    }
  }, []);

  // Fetch ALL segments (for library view)
  const fetchAllSegments = useCallback(async () => {
    try {
      const res = await apiGetWithRetry("/segments/");
      if (res.ok) {
        const data = await res.json();
        setAllSegments(data);
      }
    } catch (error) {
      handleApiError(error, "Error loading all segments");
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
  const profileId = currentProfile?.id;
  useEffect(() => {
    if (profileLoading) return;
    if (!profileId) return;

    // Reset state when profile switches
    setSelectedVideo(null);
    setSegments([]);
    setAllSegments([]);
    setSelectedSegment(null);

    fetchSourceVideos();
    fetchAllSegments();
  }, [profileId, profileLoading, fetchSourceVideos, fetchAllSegments]);

  // Actually delete segment (pushes to undo stack)
  const handleDeleteSegment = useCallback(async (segmentId: string) => {
    // Get the segment before deleting to know its source video
    const segmentToDelete = segments.find((s) => s.id === segmentId) ||
                            allSegments.find((s) => s.id === segmentId);

    try {
      const res = await apiDelete(`/segments/${segmentId}`);
      if (res.ok) {
        // Push to undo stack
        if (segmentToDelete) {
          const videoId = segmentToDelete.source_video_id || selectedVideo?.id || "";
          undoStackRef.current.push({ segment: { ...segmentToDelete }, videoId });
        }
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
      }
    } catch (error) {
      handleApiError(error, "Error deleting segment");
    }
  }, [segments, allSegments, selectedVideo?.id]);

  // Undo last deleted segment (Ctrl+Z)
  const handleUndo = useCallback(async () => {
    const last = undoStackRef.current.pop();
    if (!last) return;

    const { segment, videoId } = last;
    try {
      const res = await apiPost(
        `/segments/source-videos/${videoId}/segments`,
        {
          start_time: segment.start_time,
          end_time: segment.end_time,
          keywords: segment.keywords,
          notes: segment.notes || "",
        }
      );
      if (res.ok) {
        const restored = await res.json();
        restored.source_video_name = segment.source_video_name;
        setSegments((prev) => [...prev, restored].sort((a, b) => a.start_time - b.start_time));
        setAllSegments((prev) => [...prev, restored].sort((a, b) => a.start_time - b.start_time));
        setSourceVideos((prev) =>
          prev.map((v) =>
            v.id === videoId
              ? { ...v, segments_count: v.segments_count + 1 }
              : v
          )
        );
      }
    } catch (error) {
      handleApiError(error, "Error restoring segment");
    }
  }, []);

  // Refs for keyboard handler to avoid re-registering listener on every callback change
  const handleDeleteSegmentRef = useRef(handleDeleteSegment);
  handleDeleteSegmentRef.current = handleDeleteSegment;
  const handleUndoRef = useRef(handleUndo);
  handleUndoRef.current = handleUndo;
  const selectedSegmentRef = useRef(selectedSegment);
  selectedSegmentRef.current = selectedSegment;

  // Keyboard shortcuts: Delete selected segment, Ctrl+Z undo, Escape deselect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedSegmentRef.current) {
        e.preventDefault();
        handleDeleteSegmentRef.current(selectedSegmentRef.current.id);
        setSelectedSegment(null);
      } else if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelectedSegment(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Load segments and product groups when video selected
  useEffect(() => {
    if (selectedVideo) {
      fetchSegments(selectedVideo.id);
      fetchProductGroups(selectedVideo.id);
    } else {
      setSegments([]);
      setProductGroups([]);
    }
  }, [selectedVideo, fetchSegments, fetchProductGroups]);

  // Upload source video
  // Drag and drop handlers for the left panel
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Safety net: reset drag state on document-level dragend/drop (Bug #126)
  useEffect(() => {
    const resetDrag = () => { dragCounterRef.current = 0; setIsDraggingOver(false); };
    document.addEventListener("dragend", resetDrag);
    document.addEventListener("drop", resetDrag);
    return () => {
      document.removeEventListener("dragend", resetDrag);
      document.removeEventListener("drop", resetDrag);
    };
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    const videoFile = files.find((f) => f.type.startsWith("video/"));
    if (videoFile) {
      setUploadFile(videoFile);
      // Auto-fill name from filename (without extension)
      const nameWithoutExt = videoFile.name.replace(/\.[^/.]+$/, "");
      setUploadName(nameWithoutExt);
      setUploadError(null);
      setShowUploadDialog(true);
    }
  }, []);

  const handleUpload = async () => {
    if (!uploadFile || !uploadName.trim()) return;

    setUploadingVideo(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("video", uploadFile);
      formData.append("name", uploadName.trim());

      const res = await apiUpload("/segments/source-videos", formData, { timeout: 600000 });

      if (res.ok) {
        const newVideo = await res.json() as SourceVideo;
        setSourceVideos((prev) => [newVideo, ...prev]);
        setSelectedVideo(newVideo);
        setShowUploadDialog(false);
        setUploadName("");
        setUploadFile(null);
        setUploadError(null);

        // Poll until background processing finishes (Bug #52: store in ref for cleanup)
        // Clear any existing poll before starting new one (Bug #99)
        if (uploadPollRef.current) {
          clearInterval(uploadPollRef.current);
          uploadPollRef.current = null;
        }
        if (newVideo.status === "processing") {
          uploadPollRef.current = setInterval(async () => {
            try {
              const pollRes = await apiGetWithRetry(`/segments/source-videos/${newVideo.id}`);
              if (!pollRes.ok) { if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null; } return; }
              const updated: SourceVideo = await pollRes.json();
              if (updated.status === "ready" || updated.status === "error") {
                if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null; }
                setSourceVideos((prev) =>
                  prev.map((v) => (v.id === updated.id ? updated : v))
                );
                setSelectedVideo((prev) =>
                  prev?.id === updated.id ? updated : prev
                );
                if (updated.status === "error") {
                  setUploadError("Video processing failed. Try re-uploading.");
                }
              }
            } catch {
              if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null; }
            }
          }, 2000);
        }
      } else {
        const errorData = await res.json().catch(() => null);
        const message = errorData?.detail || `Upload failed (${res.status})`;
        setUploadError(message);
      }
    } catch (error) {
      handleApiError(error, "Error loading video");
      setUploadError("Failed to upload video. Check your connection and try again.");
    } finally {
      setUploadingVideo(false);
    }
  };

  // Add local video by path (no upload/copy)
  const handleAddLocal = async () => {
    if (!localPath.trim()) return;

    setAddingLocal(true);
    setLocalError(null);
    try {
      const res = await apiPost("/segments/source-videos/local", {
        file_path: localPath.trim(),
        name: localName.trim() || undefined,
      });

      if (res.ok) {
        const newVideo = await res.json() as SourceVideo;
        setSourceVideos((prev) => [newVideo, ...prev]);
        setSelectedVideo(newVideo);
        setShowLocalDialog(false);
        setLocalPath("");
        setLocalName("");
        setLocalError(null);

        // Poll until background processing finishes
        if (uploadPollRef.current) {
          clearInterval(uploadPollRef.current);
          uploadPollRef.current = null;
        }
        if (newVideo.status === "processing") {
          uploadPollRef.current = setInterval(async () => {
            try {
              const pollRes = await apiGetWithRetry(`/segments/source-videos/${newVideo.id}`);
              if (!pollRes.ok) { if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null; } return; }
              const updated: SourceVideo = await pollRes.json();
              if (updated.status === "ready" || updated.status === "error") {
                if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null; }
                setSourceVideos((prev) =>
                  prev.map((v) => (v.id === updated.id ? updated : v))
                );
                setSelectedVideo((prev) =>
                  prev?.id === updated.id ? updated : prev
                );
                if (updated.status === "error") {
                  setLocalError("Video processing failed.");
                }
              }
            } catch {
              if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null; }
            }
          }, 2000);
        }
      } else {
        const errorData = await res.json().catch(() => null);
        const message = errorData?.detail || `Failed to add video (${res.status})`;
        setLocalError(message);
      }
    } catch (error) {
      handleApiError(error, "Error adding local video");
      setLocalError("Failed to add video. Check the path and try again.");
    } finally {
      setAddingLocal(false);
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
      handleApiError(error, "Error deleting video");
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

    // Delete overlapping segments first
    for (const seg of overlappingSegments) {
      try {
        await apiDelete(`/segments/${seg.id}`);
      } catch (error) {
        handleApiError(error, "Error deleting segment during merge");
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

  // Save segment with keywords (Bug #125: keep popup open until API success)
  const handleSaveSegment = async (keywords: string[], notes: string) => {
    if (!selectedVideo || !pendingSegment) return;

    const segmentToSave = { ...pendingSegment };
    const videoId = selectedVideo.id;

    try {
      const res = await apiPost(
        `/segments/source-videos/${videoId}/segments`,
        {
          start_time: segmentToSave.start,
          end_time: segmentToSave.end,
          keywords,
          notes,
        }
      );

      if (res.ok) {
        const newSegment = await res.json();
        newSegment.source_video_name = selectedVideo.name;
        setSegments((prev) => [...prev, newSegment].sort((a, b) => a.start_time - b.start_time));
        setAllSegments((prev) => [...prev, newSegment].sort((a, b) => a.start_time - b.start_time));
        setSourceVideos((prev) =>
          prev.map((v) =>
            v.id === videoId
              ? { ...v, segments_count: v.segments_count + 1 }
              : v
          )
        );
        // Close popup only after API success
        setPendingSegment(null);
        setShowKeywordPopup(false);
      }
    } catch (error) {
      handleApiError(error, "Error creating segment");
    }
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
      handleApiError(error, "Error updating segment");
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
      handleApiError(error, "Error saving transformations");
    }
  };

  // Sync activeTransforms when selectedSegment changes
  const handleSegmentSelect = (seg: Segment) => {
    setSelectedSegment(seg);
    setActiveTransforms(seg.transforms || { ...DEFAULT_SEGMENT_TRANSFORM });
    setLeftTab("transform");
  };

  // Fetch product associations for a batch of segment IDs
  const fetchedAssocIdsRef = useRef<Set<string>>(new Set());
  const fetchAssociations = useCallback(async (segmentIds: string[]) => {
    const unfetched = segmentIds.filter(id => !fetchedAssocIdsRef.current.has(id));
    if (unfetched.length === 0) return;
    unfetched.forEach(id => fetchedAssocIdsRef.current.add(id));
    try {
      const params = new URLSearchParams();
      params.set("segment_ids", unfetched.join(","));
      const res = await apiGetWithRetry(`/associations/segments?${params}`);
      if (res.ok) {
        const json = await res.json();
        // Backend returns { associations: { segment_id: association | null } }
        const assocMap = json.associations || json;
        const map: Record<string, AssociationResponse> = {};
        for (const [segId, assoc] of Object.entries(assocMap)) {
          if (assoc) {
            map[segId] = assoc as AssociationResponse;
          }
        }
        setAssociations(prev => ({ ...prev, ...map }));
      }
    } catch (error) {
      handleApiError(error, "Failed to load product associations");
    }
  }, []);

  // Fetch associations when allSegments changes (covers both filtered and full lists)
  useEffect(() => {
    const ids = allSegments.map(s => s.id);
    if (ids.length > 0) fetchAssociations(ids);
  }, [allSegments, fetchAssociations]);

  // Cleanup upload poll on unmount (Bug #52)
  useEffect(() => {
    return () => { if (uploadPollRef.current) clearInterval(uploadPollRef.current); };
  }, []);

  // Association handler callbacks
  const handleProductSelected = (association: AssociationResponse) => {
    setAssociations(prev => ({ ...prev, [association.segment_id]: association }));
    setPickerSegmentId(null);
  };

  const handleImagesUpdated = (updatedAssociation: AssociationResponse) => {
    setAssociations(prev => ({ ...prev, [updatedAssociation.segment_id]: updatedAssociation }));
    setImagePickerAssoc(null);
  };

  const handleRemoveAssociation = async (segmentId: string) => {
    try {
      const res = await apiDelete(`/associations/segment/${segmentId}`);
      if (res.ok) {
        setAssociations(prev => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    } catch (error) {
      handleApiError(error, "Failed to remove product association");
    }
  };

  // Save PiP config for an association
  const handleSavePipConfig = async (associationId: string, segmentId: string, config: PipConfig) => {
    setPipSaving(true);
    try {
      const res = await apiPatch(`/associations/${associationId}/pip-config`, config);
      if (res.ok) {
        const updated = await res.json();
        setAssociations(prev => ({ ...prev, [segmentId]: updated }));
      }
    } catch (error) {
      handleApiError(error, "Failed to save PiP config");
    } finally {
      setPipSaving(false);
    }
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
      handleApiError(error, "Error toggling favorite");
    }
  };

  // Toggle single use
  const handleToggleSingleUse = async (segmentId: string) => {
    try {
      const res = await apiPost(`/segments/${segmentId}/single-use`);
      if (res.ok) {
        const { single_use } = await res.json();
        setSegments((prev) =>
          prev.map((s) => (s.id === segmentId ? { ...s, single_use } : s))
        );
        setAllSegments((prev) =>
          prev.map((s) => (s.id === segmentId ? { ...s, single_use } : s))
        );
      }
    } catch (error) {
      handleApiError(error, "Error toggling single use");
    }
  };

  // Product group handlers
  const handleCreateGroup = async () => {
    if (!selectedVideo || !groupLabel.trim()) return;
    try {
      const res = await apiPost(`/segments/source-videos/${selectedVideo.id}/product-groups`, {
        label: groupLabel.trim(),
        start_time: groupStartTime,
        end_time: groupEndTime,
      });
      if (res.ok) {
        setShowGroupDialog(false);
        setGroupLabel("");
        setEditingGroup(null);
        await fetchProductGroups(selectedVideo.id);
        await fetchSegments(selectedVideo.id);
      }
    } catch (error) {
      handleApiError(error, "Error creating product group");
    }
  };

  const handleUpdateGroup = async () => {
    if (!editingGroup || !selectedVideo) return;
    try {
      const res = await apiPatch(`/segments/product-groups/${editingGroup.id}`, {
        label: groupLabel.trim() || undefined,
        start_time: groupStartTime,
        end_time: groupEndTime,
      });
      if (res.ok) {
        setShowGroupDialog(false);
        setGroupLabel("");
        setEditingGroup(null);
        await fetchProductGroups(selectedVideo.id);
        await fetchSegments(selectedVideo.id);
      }
    } catch (error) {
      handleApiError(error, "Error updating group");
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!selectedVideo) return;
    try {
      const res = await apiDelete(`/segments/product-groups/${groupId}`);
      if (res.ok) {
        await fetchProductGroups(selectedVideo.id);
        await fetchSegments(selectedVideo.id);
      }
    } catch (error) {
      handleApiError(error, "Error deleting group");
    }
  };

  // Called from timeline G key — pre-fills start/end and opens label dialog
  const handleGroupCreateFromTimeline = (start: number, end: number) => {
    setEditingGroup(null);
    setGroupLabel("");
    setGroupStartTime(parseFloat(start.toFixed(2)));
    setGroupEndTime(parseFloat(end.toFixed(2)));
    setShowGroupDialog(true);
  };

  const openGroupDialog = (group?: ProductGroup) => {
    if (group) {
      setEditingGroup(group);
      setGroupLabel(group.label);
      setGroupStartTime(group.start_time);
      setGroupEndTime(group.end_time);
    } else {
      setEditingGroup(null);
      setGroupLabel("");
      setGroupStartTime(0);
      setGroupEndTime(selectedVideo?.duration || 0);
    }
    setShowGroupDialog(true);
  };

  // Left panel content - Source Videos
  const filteredSourceVideos = videoSearchQuery.trim()
    ? sourceVideos.filter((v) => v.name.toLowerCase().includes(videoSearchQuery.toLowerCase()))
    : sourceVideos;

  const leftPanelContent = (
    <div
      className="h-full flex flex-col relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Upload className="h-8 w-8 text-primary mx-auto mb-2" />
            <p className="text-sm font-medium text-primary">Drop video here</p>
          </div>
        </div>
      )}

      <Tabs value={leftTab} onValueChange={setLeftTab} className="flex flex-col h-full">
        <TabsList className="mx-2 mt-2 grid w-auto grid-cols-2 h-8">
          <TabsTrigger value="videos" className="text-xs h-7">Videos</TabsTrigger>
          <TabsTrigger value="transform" className="text-xs h-7">
            Transform
            {selectedSegment && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-primary inline-block" />}
          </TabsTrigger>
        </TabsList>

        {/* Videos tab */}
        <TabsContent value="videos" className="flex-1 flex flex-col min-h-0 mt-0">
          {/* Upload / Add Local buttons */}
          <div className="p-2 border-b border-border flex gap-1.5">
            <Dialog open={showLocalDialog} onOpenChange={setShowLocalDialog}>
              <DialogTrigger asChild>
                <Button size="sm" className="flex-1 h-7 text-xs">
                  <FolderOpen className="h-3.5 w-3.5 mr-1" />
                  Add Local
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Local Video</DialogTitle>
                  <DialogDescription>
                    Use a video directly from your computer — no copy, instant
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="local-path">File Path</Label>
                    <Input
                      id="local-path"
                      placeholder="D:\Videos\my-video.mp4"
                      value={localPath}
                      onChange={(e) => {
                        setLocalPath(e.target.value);
                        if (!localName.trim() && e.target.value) {
                          const filename = e.target.value.split(/[/\\]/).pop() || "";
                          setLocalName(filename.replace(/\.[^/.]+$/, ""));
                        }
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Paste the full path to the video file
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="local-name">Name (optional)</Label>
                    <Input
                      id="local-name"
                      placeholder="Auto-filled from filename"
                      value={localName}
                      onChange={(e) => setLocalName(e.target.value)}
                    />
                  </div>
                </div>
                {localError && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{localError}</span>
                  </div>
                )}
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => { setShowLocalDialog(false); setLocalError(null); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddLocal}
                    disabled={!localPath.trim() || addingLocal}
                    className="min-w-[100px]"
                  >
                    {addingLocal ? "Adding..." : "Add Video"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs px-2" title="Upload video (copies file)">
                  <Upload className="h-3.5 w-3.5" />
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
                    <Label>Video File</Label>
                    <div
                      className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                        uploadFile
                          ? "border-primary/50 bg-primary/5"
                          : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
                      }`}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("video/"));
                        if (file) {
                          setUploadFile(file);
                          if (!uploadName.trim()) {
                            setUploadName(file.name.replace(/\.[^/.]+$/, ""));
                          }
                        }
                      }}
                      onClick={() => document.getElementById("video-file-input")?.click()}
                    >
                      <input
                        id="video-file-input"
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          setUploadFile(file);
                          if (file && !uploadName.trim()) {
                            setUploadName(file.name.replace(/\.[^/.]+$/, ""));
                          }
                        }}
                      />
                      {uploadFile ? (
                        <div className="flex items-center justify-center gap-2">
                          <Video className="h-5 w-5 text-primary" />
                          <span className="text-sm font-medium truncate max-w-[200px]">{uploadFile.name}</span>
                          <button
                            type="button"
                            className="ml-1 p-0.5 rounded hover:bg-muted"
                            onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}
                          >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">
                            Drag & drop or <span className="text-primary font-medium">click to browse</span>
                          </p>
                          <p className="text-xs text-muted-foreground/70 mt-1">MP4, MOV, AVI, MKV</p>
                        </>
                      )}
                    </div>
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
                    {uploadingVideo ? "Uploading..." : "Upload"}
                  </Button>
                </DialogFooter>
                {(!uploadFile || !uploadName.trim()) && (
                  <p className="text-xs text-muted-foreground mt-2">
                    * Fill in the name and select a video file to enable the Upload button
                  </p>
                )}
              </DialogContent>
            </Dialog>
          </div>

          {/* Video search */}
          <div className="relative px-2 py-1.5 border-b border-border">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search videos..."
              value={videoSearchQuery}
              onChange={(e) => setVideoSearchQuery(e.target.value)}
              className="h-7 pl-7 text-xs"
            />
            {videoSearchQuery && (
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                {filteredSourceVideos.length}/{sourceVideos.length}
              </span>
            )}
          </div>

          {/* Videos list - full height */}
          <ScrollArea className="flex-1">
            <div className="space-y-1 p-2">
              {filteredSourceVideos.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {videoSearchQuery ? "No matching videos" : "No videos uploaded yet"}
                  </p>
                  {!videoSearchQuery && (
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      Drag & drop a video here or click Upload
                    </p>
                  )}
                </div>
              ) : (
                filteredSourceVideos.map((video) => (
                  <div
                    key={video.id}
                    className={`group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedVideo?.id === video.id
                        ? "bg-primary/10 border border-primary/50"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => video.status !== "processing" && setSelectedVideo(video)}
                  >
                    {/* Thumbnail */}
                    <div className="w-14 h-9 bg-muted rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                      {video.thumbnail_path ? (
                        // eslint-disable-next-line @next/next/no-img-element
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
                      {video.status === "processing" ? (
                        <div className="flex items-center gap-1 text-[10px] text-amber-500">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          <span>Processing...</span>
                        </div>
                      ) : video.status === "error" ? (
                        <div className="flex items-center gap-1 text-[10px] text-red-500">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Error</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span>{formatTime(video.duration || 0)}</span>
                          <span>•</span>
                          <span>{video.segments_count} seg</span>
                        </div>
                      )}
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
        </TabsContent>

        {/* Transform tab */}
        <TabsContent value="transform" className="flex-1 flex flex-col min-h-0 mt-0">
          {selectedSegment ? (
            <div className="p-3 flex-1 overflow-auto">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-mono">
                  {formatTime(selectedSegment.start_time)} - {formatTime(selectedSegment.end_time)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => { setSelectedSegment(null); setLeftTab("videos"); }}
                  title="Close (Esc)"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <SegmentTransformPanel
                transforms={activeTransforms}
                onChange={setActiveTransforms}
                onSave={handleSaveTransforms}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <p className="text-sm text-muted-foreground text-center">
                Select a segment to edit transforms
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
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

      {/* Product Groups */}
      {selectedVideo && viewMode === "current" && (
        <div className="px-2 py-1.5 border-b border-border">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <Layers className="h-3 w-3" />
              Product Groups
              {productGroups.length > 0 && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1">{productGroups.length}</Badge>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] px-1"
              onClick={() => openGroupDialog()}
            >
              + Add
            </Button>
          </div>
          {productGroups.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {productGroups.map((group) => (
                <div
                  key={group.id}
                  className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-white cursor-pointer hover:opacity-80"
                  style={{ backgroundColor: group.color || "#4ECDC4" }}
                  onClick={() => openGroupDialog(group)}
                  title={`${formatTime(group.start_time)} - ${formatTime(group.end_time)} (${group.segments_count} segments)\nClick to edit`}
                >
                  <span className="font-medium">{group.label}</span>
                  <span className="opacity-70">({group.segments_count})</span>
                  <button
                    className="ml-0.5 opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteGroup(group.id);
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Segments list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-1 p-1.5">
          {loadingSegments && viewMode === "current" ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Loading...
            </p>
          ) : filteredSegments.length === 0 ? (
            <EmptyState
              icon={<Scissors className="h-6 w-6" />}
              title="No segments"
              description={
                viewMode === "current" && !selectedVideo
                  ? "Select a video first."
                  : searchQuery || showFavoritesOnly || selectedKeywordFilter
                  ? "No segments match your filters."
                  : "Selected video segments will appear here."
              }
            />
          ) : (
            filteredSegments.map((segment) => (
              <div
                key={segment.id}
                className={`px-2 py-1.5 rounded-md border transition-colors cursor-pointer ${
                  selectedSegment?.id === segment.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border hover:border-primary/50"
                }`}
                onClick={() => handleSegmentSelect(segment)}
              >
                {/* Source video name (in All Videos mode) */}
                {viewMode === "all" && segment.source_video_name && (
                  <p className="text-[10px] text-muted-foreground truncate mb-0.5">
                    <Video className="h-3 w-3 inline mr-0.5" />
                    {segment.source_video_name}
                  </p>
                )}

                {/* Row 1: Time range + duration + favorite */}
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <span className="font-mono text-xs">
                    {formatTime(segment.start_time)}-{formatTime(segment.end_time)}
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                    {segment.duration.toFixed(1)}s
                  </Badge>
                  {segment.product_group && (() => {
                    const group = productGroups.find(g => g.label === segment.product_group);
                    return (
                      <Badge
                        className="text-[10px] text-white px-1 py-0 h-4"
                        style={{ backgroundColor: group?.color || "#4ECDC4" }}
                      >
                        {segment.product_group}
                      </Badge>
                    );
                  })()}
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 flex-shrink-0"
                    title={segment.single_use ? "Folosit o singură dată (activ)" : "Click pentru utilizare unică"}
                    onClick={(e) => { e.stopPropagation(); handleToggleSingleUse(segment.id); }}
                  >
                    <Repeat1 className={`h-3 w-3 ${segment.single_use ? "text-orange-500" : "text-muted-foreground"}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(segment.id); }}
                  >
                    {segment.is_favorite ? (
                      <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                    ) : (
                      <StarOff className="h-3 w-3 text-muted-foreground" />
                    )}
                  </Button>
                </div>

                {/* Row 2: Keywords (inline) */}
                {segment.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-0.5">
                    {segment.keywords.map((kw) => (
                      <Badge key={kw} variant="secondary" className="text-[10px] px-1 py-0 h-4">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Row 3: Product association + actions (compact single row) */}
                <div className="flex items-center gap-1 mt-1">
                  {associations[segment.id] ? (
                    <>
                      {associations[segment.id].product_image && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={associations[segment.id].product_image!}
                          alt=""
                          className="w-5 h-5 rounded object-cover flex-shrink-0"
                        />
                      )}
                      <span className="text-[10px] truncate" title={associations[segment.id].product_title || ""}>
                        {associations[segment.id].product_title || "Product"}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 flex-shrink-0"
                        title="Select images"
                        onClick={(e) => { e.stopPropagation(); setImagePickerAssoc(associations[segment.id]); }}
                      >
                        <Images className="h-2.5 w-2.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 flex-shrink-0 text-destructive"
                        title="Remove product"
                        onClick={(e) => { e.stopPropagation(); handleRemoveAssociation(segment.id); }}
                      >
                        <X className="h-2.5 w-2.5" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] px-1.5 text-muted-foreground"
                      onClick={(e) => { e.stopPropagation(); setPickerSegmentId(segment.id); }}
                    >
                      <Package className="h-3 w-3 mr-0.5" />
                      Product
                    </Button>
                  )}
                  <div className="flex-1" />
                  {/* Usage count inline */}
                  {segment.usage_count > 0 && (
                    <span className="text-[10px] text-muted-foreground">{segment.usage_count}x</span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 flex-shrink-0"
                    title="Edit segment"
                    onClick={(e) => { e.stopPropagation(); setEditingSegment(segment); }}
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 flex-shrink-0 text-destructive hover:text-destructive"
                    title="Delete segment"
                    onClick={(e) => { e.stopPropagation(); requestDeleteSegment(segment); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                {/* PiP Overlay controls — only for associated segments */}
                {associations[segment.id] && (
                  <div className="mt-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 text-[10px] w-full justify-start px-1"
                      onClick={(e) => { e.stopPropagation(); setPipExpandedSegId(prev => prev === segment.id ? null : segment.id); }}
                    >
                      <Layers className="h-3 w-3 mr-0.5" />
                      PiP {associations[segment.id].pip_config?.enabled ? "✓" : ""}
                    </Button>
                    {pipExpandedSegId === segment.id && (
                      <PipOverlayPanel
                        config={associations[segment.id].pip_config || DEFAULT_PIP_CONFIG}
                        onChange={(config) => {
                          setAssociations(prev => ({
                            ...prev,
                            [segment.id]: { ...prev[segment.id], pip_config: config }
                          }));
                        }}
                        onSave={(config) => handleSavePipConfig(associations[segment.id].id, segment.id, config)}
                        isSaving={pipSaving}
                      />
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

    </div>
  );

  // Center content - Video Player
  const centerContent = (
    <div className="h-full flex flex-col">
      {/* Video header - compact single line */}
      <div className="flex items-center gap-2 mb-1 h-9">
        <Link href="/librarie">
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-base font-semibold flex items-center gap-1.5 truncate">
          <Scissors className="h-4 w-4 flex-shrink-0" />
          {selectedVideo ? selectedVideo.name : "Segment Editor"}
        </h1>
        {selectedVideo && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {selectedVideo.width}x{selectedVideo.height} {selectedVideo.fps}fps {formatTime(selectedVideo.duration || 0)}
          </span>
        )}
        {!selectedVideo && (
          <span className="text-xs text-muted-foreground">Select a video</span>
        )}
        <div className="flex-1" />
        <Button onClick={fetchSourceVideos} variant="outline" size="sm" className="h-7 text-xs">
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Video player */}
      <div className="flex-1 min-h-0">
        {selectedVideo ? (
          <VideoSegmentPlayer
            videoUrl={`${API_URL}/segments/source-videos/${selectedVideo.id}/stream${currentProfile ? `?profile_id=${currentProfile.id}` : ''}`}
            duration={selectedVideo.duration || 0}
            segments={segments}
            onSegmentCreate={handleSegmentCreate}
            onSegmentClick={(seg) => handleSegmentSelect(seg as Segment)}
            onGroupCreate={handleGroupCreateFromTimeline}
            activeTransforms={selectedSegment ? activeTransforms : undefined}
            currentSegment={selectedSegment || undefined}
            sourceVideoId={selectedVideo.id}
            profileId={currentProfile?.id}
            productGroups={productGroups}
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

        {/* Product Group dialog */}
        {showGroupDialog && (
          <Dialog open={showGroupDialog} onOpenChange={setShowGroupDialog}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editingGroup ? "Edit Product Group" : "New Product Group"}</DialogTitle>
                <DialogDescription>
                  Define a time range on the video timeline to group segments by product.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="group-label">Label</Label>
                  <Input
                    id="group-label"
                    value={groupLabel}
                    onChange={(e) => setGroupLabel(e.target.value)}
                    placeholder="e.g., Product A"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && groupLabel.trim() && groupEndTime > groupStartTime) {
                        e.preventDefault();
                        editingGroup ? handleUpdateGroup() : handleCreateGroup();
                      }
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="group-start">Start Time (s)</Label>
                    <Input
                      id="group-start"
                      type="number"
                      step="0.1"
                      min={0}
                      value={groupStartTime}
                      onChange={(e) => setGroupStartTime(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="group-end">End Time (s)</Label>
                    <Input
                      id="group-end"
                      type="number"
                      step="0.1"
                      min={0}
                      value={groupEndTime}
                      onChange={(e) => setGroupEndTime(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowGroupDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={editingGroup ? handleUpdateGroup : handleCreateGroup}
                  disabled={!groupLabel.trim() || groupEndTime <= groupStartTime}
                >
                  {editingGroup ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
                    If you merge, the new segment will be:
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
                    Cancel
                  </Button>
                  <Button variant="secondary" onClick={handleCreateSeparate}>
                    Create separately
                  </Button>
                  <Button onClick={handleMergeSegments}>
                    <Merge className="h-4 w-4 mr-2" />
                    Merge segments
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-right">
                  &quot;Create separately&quot; will create the segment without modifying existing ones
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Product Picker Dialog */}
        {pickerSegmentId && (
          <ProductPickerDialog
            open={!!pickerSegmentId}
            onOpenChange={(open) => { if (!open) setPickerSegmentId(null); }}
            segmentId={pickerSegmentId}
            onProductSelected={handleProductSelected}
          />
        )}

        {/* Image Picker Dialog */}
        {imagePickerAssoc && (
          <ImagePickerDialog
            open={!!imagePickerAssoc}
            onOpenChange={(open) => { if (!open) setImagePickerAssoc(null); }}
            associationId={imagePickerAssoc.id}
            catalogProductId={imagePickerAssoc.catalog_product_id}
            currentSelectedUrls={imagePickerAssoc.selected_image_urls}
            productTitle={imagePickerAssoc.product_title}
            onImagesUpdated={handleImagesUpdated}
          />
        )}
    </div>
  );
}
