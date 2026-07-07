"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Film,
  Play,
  Download,
  Share2,
  Search,
  Clock,
  CheckCircle2,
  Subtitles,
  Mic,
  RefreshCw,
  Pencil,
  Check,
  X,
  VolumeX,
  Loader2,
  Trash2,
  CheckSquare,
  XCircle,
  User,
  FileText,
  AlertCircle,
  Link,
  Undo2,
  Tag as TagIcon,
  ImageIcon,
  Calendar,
  CalendarClock,
  Send,
  Copy,
  ShieldCheck,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { apiGet, apiGetWithRetry, apiPost, apiPatch, apiDelete, API_URL, ApiError, handleApiError } from "@/lib/api";
import { toast } from "sonner";
import { useProfile } from "@/contexts/profile-context";
import { EmptyState } from "@/components/empty-state";
import { PublishDialog } from "@/components/dialogs/publish-dialog";
import { ImageBulkPublishDialog } from "@/components/dialogs/image-bulk-publish-dialog";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { InlineVideoPlayer } from "@/components/inline-video-player";
import { ClipHoverPreview } from "@/components/clip-hover-preview";
import { ClipTagEditor } from "@/components/clip-tag-editor";
import { BulkScheduleDialog } from "@/components/dialogs/bulk-schedule-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GeneratedImage {
  id: string;
  prompt: string;
  status: string;
  image_url: string | null;
  image_local_path: string | null;
  final_image_path: string | null;
  logo_config: { x: number; y: number; scale: number } | null;
  error_message: string | null;
  template_name: string | null;
  model?: string;
  product_id: string | null;
  is_approved: boolean;
  created_at: string;
}

interface ClipWithProject {
  id: string;
  project_id: string;
  project_name: string;
  variant_index: number;
  variant_name?: string;
  raw_video_path: string;
  thumbnail_path?: string;
  duration?: number;
  final_video_path?: string;
  final_status: string;
  created_at: string;
  postiz_status?: "not_sent" | "scheduled" | "sent";
  postiz_post_id?: string;
  postiz_scheduled_at?: string;
  has_subtitles: boolean;
  has_voiceover: boolean;
  has_audio?: boolean;
  tags?: string[];
  context_text?: string | null;
  tiktok_posted?: boolean;
  instagram_posted?: boolean;
  youtube_posted?: boolean;
  facebook_posted?: boolean;
  is_downloaded_posted?: boolean;
  qc_verified?: boolean;
  srt_content?: string | null;
  tts_text?: string | null;
  _videoVersion?: number;
}


function LibrarieContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentProfile, isLoading: profileLoading } = useProfile();
  const initialTab = searchParams.get("tab") === "images" ? "images" : "videos";
  const initialViewMode = searchParams.get("view") === "trash" ? "trash" : "library";

  // State
  const [clips, setClips] = useState<ClipWithProject[]>([]);
  const clipsRef = useRef(clips);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  // filteredClips is derived via useMemo below (no useState needed)
  const [loading, setLoading] = useState(true);

  // Filters from URL
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [filterSubtitles, setFilterSubtitles] = useState<string>(
    searchParams.get("subtitles") || "all"
  );
  const [filterVoiceover, setFilterVoiceover] = useState<string>(
    searchParams.get("voiceover") || "all"
  );
  const [filterPostiz, setFilterPostiz] = useState<string>(
    searchParams.get("postiz") || "all"
  );
  const [filterTiktok, setFilterTiktok] = useState<string>(
    searchParams.get("tiktok") || "all"
  );
  const [filterSocialPosted, setFilterSocialPosted] = useState<string>(
    searchParams.get("social") || "all"
  );

  // Tag filter state
  const [filterTag, setFilterTag] = useState<string>(
    searchParams.get("tag") || ""
  );
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  // Pagination state
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false); // Synchronous guard for pagination (Bug #118)
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Rename state
  const [renameClipId, setRenameClipId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Mounted ref for async safety (Bug #119)
  const isMountedRef = useRef(true);
  useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

  // Abort controller for cancelling stale fetches on profile switch (P7-4)
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Audio removal state
  const [removingAudioClipId, setRemovingAudioClipId] = useState<string | null>(null);

  // Delete state
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);

  // Postiz connection status
  const [postizStatus, setPostizStatus] = useState<{
    configured: boolean;
    connected: boolean;
    api_url?: string;
    integrations_count: number;
    integrations: { name: string; type: string; picture?: string }[];
    error?: string;
  } | null>(null);
  // U1: whether a Blipost platform token is connected. The publish dialog is a
  // multi-source flow (Postiz + Buffer + Blipost), so the Publish button must be
  // enabled when EITHER Postiz or Blipost is connected — not Postiz-only.
  const [platformConnected, setPlatformConnected] = useState(false);
  const canPublish = Boolean(postizStatus?.connected || platformConnected);

  // Publish dialog state
  const [publishDialogClip, setPublishDialogClip] = useState<ClipWithProject | null>(null);

  // Multi-select state
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const selectedClipIdsRef = useRef(selectedClipIds);
  useEffect(() => { selectedClipIdsRef.current = selectedClipIds; }, [selectedClipIds]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false);

  // View mode (library vs trash)
  const [viewMode, setViewMode] = useState<"library" | "trash">(initialViewMode);
  const [trashClips, setTrashClips] = useState<(ClipWithProject & { days_remaining?: number; deleted_at?: string })[]>([]);
  const [loadingTrash, setLoadingTrash] = useState(false);
  const [restoringClipId, setRestoringClipId] = useState<string | null>(null);
  const [permanentlyDeletingClipId, setPermanentlyDeletingClipId] = useState<string | null>(null);
  const [emptyingTrash, setEmptyingTrash] = useState(false);

  // Images tab state
  const [activeTab, setActiveTab] = useState<"videos" | "images">(initialTab);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [bulkImageDialogOpen, setBulkImageDialogOpen] = useState(false);
  const [bulkDeletingImages, setBulkDeletingImages] = useState(false);
  const [imagePublishId, setImagePublishId] = useState<string | null>(null);
  const [imagePublishCaption, setImagePublishCaption] = useState("");
  const [imagePublishIntegrations, setImagePublishIntegrations] = useState<string[]>([]);
  const [imagePublishSchedule, setImagePublishSchedule] = useState(false);
  const [imagePublishDate, setImagePublishDate] = useState("");
  const [imagePublishing, setImagePublishing] = useState(false);
  const [availableIntegrations, setAvailableIntegrations] = useState<{ id: string; name: string; type: string; picture?: string }[]>([]);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);

  // Confirm dialog state (single shared dialog)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: "destructive" | "default";
    onConfirm: () => void;
    loading?: boolean;
  }>({ open: false, title: "", description: "", confirmLabel: "", variant: "default", onConfirm: () => {} });

  // Inline video player state
  const [playingClip, setPlayingClip] = useState<ClipWithProject | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [regeneratingVoiceoverId, setRegeneratingVoiceoverId] = useState<string | null>(null);

  // Update URL with filters
  const updateURL = useCallback(
    (params: Record<string, string>) => {
      const newParams = new URLSearchParams(searchParams.toString());
      Object.entries(params).forEach(([key, value]) => {
        const isDefaultValue =
          !value ||
          value === "all" ||
          (key === "tab" && value === "videos") ||
          (key === "view" && value === "library");
        if (!isDefaultValue) {
          newParams.set(key, value);
        } else {
          newParams.delete(key);
        }
      });
      const query = newParams.toString();
      router.push(query ? `/librarie?${query}` : "/librarie", { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    setSearchQuery(searchParams.get("search") || "");
    setFilterSubtitles(searchParams.get("subtitles") || "all");
    setFilterVoiceover(searchParams.get("voiceover") || "all");
    setFilterPostiz(searchParams.get("postiz") || "all");
    setFilterTiktok(searchParams.get("tiktok") || "all");
    setFilterSocialPosted(searchParams.get("social") || "all");
    setFilterTag(searchParams.get("tag") || "");
    setActiveTab(searchParams.get("tab") === "images" ? "images" : "videos");
    setViewMode(searchParams.get("view") === "trash" ? "trash" : "library");
  }, [searchParams]);

  // Fetch all clips — supports cursor-based pagination (Bug #46: wrapped in useCallback)
  const fetchAllClips = useCallback(async (cursor?: string | null, tagFilter?: string, signal?: AbortSignal) => {
    try {
      if (cursor) {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      const activeTag = tagFilter !== undefined ? tagFilter : filterTag;
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (activeTag) params.set("tag", activeTag);
      const paramStr = params.toString();
      const url = `/library/all-clips${paramStr ? `?${paramStr}` : ""}`;
      const res = await apiGetWithRetry(url, { signal });
      if (signal?.aborted) return;
      const data = await res.json();
      if (cursor) {
        // Append to existing clips — deduplicate by id (lte cursor may overlap)
        setClips((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const newClips = (data.clips || []).filter((c: ClipWithProject) => !existingIds.has(c.id));
          return [...prev, ...newClips];
        });
      } else {
        // Replace clips (first page load or refresh) — reset pagination
        setClips(data.clips || []);
      }
      setNextCursor(data.next_cursor ?? null);
      setHasMore(data.has_more ?? false);
    } catch (error) {
      if (signal?.aborted) return; // Stale fetch cancelled by profile switch
      if (error instanceof ApiError && error.status === 401) {
        router.push("/login");
        return;
      }
      handleApiError(error, "Error loading clips");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTag]);

  // Load next page via cursor
  const fetchNextPage = useCallback(() => {
    if (!hasMore || loading || loadingMoreRef.current) return; // Guard against initial load race
    fetchAllClips(nextCursor, filterTag);
  }, [hasMore, loading, nextCursor, filterTag, fetchAllClips]);

  // Keep a stable ref to fetchNextPage so the IntersectionObserver callback never goes stale
  const fetchNextPageRef = useRef(fetchNextPage);
  useEffect(() => { fetchNextPageRef.current = fetchNextPage; }, [fetchNextPage]);

  // IntersectionObserver — callback ref so it reconnects when sentinel mounts/unmounts
  const sentinelObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
    // Disconnect previous observer
    if (sentinelObserverRef.current) {
      sentinelObserverRef.current.disconnect();
      sentinelObserverRef.current = null;
    }
    if (!node) return;
    // Also store in sentinelRef for any other usage
    (sentinelRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          fetchNextPageRef.current();
        }
      },
      { threshold: 0.01, rootMargin: "0px 0px 400px 0px" }
    );
    observer.observe(node);
    sentinelObserverRef.current = observer;
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when focused on an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selectedClipIds.size === 1) {
          const clipId = Array.from(selectedClipIds)[0];
          const clip = clips.find((c) => c.id === clipId);
          if (clip) openDeleteConfirm(clip);
        } else if (selectedClipIds.size > 1) {
          openBulkDeleteConfirm();
        }
      } else if (e.key === "Escape") {
        if (playingClip) {
          setPlayingClip(null);
        } else if (confirmDialog.open) {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
        } else if (selectedClipIds.size > 0) {
          setSelectedClipIds(new Set());
        }
      } else if (e.key === " ") {
        if (playingClip && videoRef.current) {
          e.preventDefault();
          if (videoRef.current.paused) {
            videoRef.current.play().catch(() => {});
          } else {
            videoRef.current.pause();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedClipIds, clips, playingClip, confirmDialog.open]); // eslint-disable-line react-hooks/exhaustive-deps


  // Apply filters (derived via useMemo — no extra state/effect needed)
  const filteredClips = useMemo(() => {
    let result = [...clips];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (clip) =>
          clip.project_name.toLowerCase().includes(query) ||
          clip.variant_name?.toLowerCase().includes(query)
      );
    }

    // Subtitles filter
    if (filterSubtitles === "with") {
      result = result.filter((clip) => clip.has_subtitles);
    } else if (filterSubtitles === "without") {
      result = result.filter((clip) => !clip.has_subtitles);
    }

    // Voiceover filter
    if (filterVoiceover === "with") {
      result = result.filter((clip) => clip.has_voiceover);
    } else if (filterVoiceover === "without") {
      result = result.filter((clip) => !clip.has_voiceover);
    }

    // Postiz status filter
    if (filterPostiz !== "all") {
      result = result.filter((clip) => clip.postiz_status === filterPostiz);
    }

    // TikTok posted filter
    if (filterTiktok === "posted") {
      result = result.filter((clip) => clip.tiktok_posted);
    } else if (filterTiktok === "not_posted") {
      result = result.filter((clip) => !clip.tiktok_posted);
    }

    // Social posted filter
    if (filterSocialPosted === "any_posted") {
      result = result.filter((clip) => clip.tiktok_posted || clip.instagram_posted || clip.youtube_posted || clip.facebook_posted);
    } else if (filterSocialPosted === "none_posted") {
      result = result.filter((clip) => !clip.tiktok_posted && !clip.instagram_posted && !clip.youtube_posted && !clip.facebook_posted);
    }

    // Tag filter (client-side; server already filters, this keeps it in sync)
    if (filterTag) {
      result = result.filter((clip) => (clip.tags || []).includes(filterTag));
    }

    return result;
  }, [clips, searchQuery, filterSubtitles, filterVoiceover, filterPostiz, filterTiktok, filterSocialPosted, filterTag]);

  // Ordered selected clips for bulk schedule dialog (preserves selection order from Set)
  const orderedSelectedClips = useMemo(() => {
    const clipMap = new Map(clips.map(c => [c.id, c]));
    return Array.from(selectedClipIds)
      .map(id => clipMap.get(id))
      .filter((c): c is ClipWithProject => !!c);
  }, [clips, selectedClipIds]);

  const orderedSelectedImages = useMemo(() => {
    const imageMap = new Map(generatedImages.map((image) => [image.id, image]));
    return Array.from(selectedImageIds)
      .map((id) => imageMap.get(id))
      .filter((image): image is GeneratedImage => !!image);
  }, [generatedImages, selectedImageIds]);

  // Fetch Postiz connection status
  const fetchPostizStatus = async () => {
    try {
      const res = await apiGet("/postiz/status");
      const data = await res.json();
      setPostizStatus(data);
    } catch {
      setPostizStatus({ configured: false, connected: false, integrations_count: 0, integrations: [] });
    }
  };

  // U1: fetch Blipost platform connection state so the publish button can enable
  // even when Postiz isn't configured.
  const fetchPlatformStatus = async () => {
    try {
      const res = await apiGet("/platform/me");
      const data = await res.json();
      setPlatformConnected(Boolean(data.connected));
    } catch {
      setPlatformConnected(false);
    }
  };

  // Fetch available tags for the filter dropdown
  const fetchAvailableTags = async () => {
    try {
      const res = await apiGet("/library/tags");
      const data = await res.json();
      setAvailableTags(data.tags || []);
    } catch {
      // Non-critical — tag filter still works, just won't show dropdown options
    }
  };

  // Initial fetch - profile-aware
  const profileId = currentProfile?.id;
  useEffect(() => {
    if (profileLoading) return; // Wait for profile context
    if (!profileId) return; // No profile selected
    // Abort any in-flight fetch from previous profile (P7-4)
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    // Reset clips on profile switch to avoid stale data from previous profile (Bug #75)
    setClips([]);
    setNextCursor(null);
    setHasMore(true);
    fetchAllClips(null, undefined, controller.signal);
    fetchPostizStatus();
    fetchPlatformStatus();
    fetchAvailableTags();
    return () => { controller.abort(); };
  }, [profileLoading, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle filter changes with URL update
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    updateURL({ search: value });
  };

  const handleSubtitlesFilter = (value: string) => {
    setFilterSubtitles(value);
    updateURL({ subtitles: value });
  };

  const handleVoiceoverFilter = (value: string) => {
    setFilterVoiceover(value);
    updateURL({ voiceover: value });
  };

  const handlePostizFilter = (value: string) => {
    setFilterPostiz(value);
    updateURL({ postiz: value });
  };

  const handleTagFilter = (value: string) => {
    if (!currentProfile) return;
    const newTag = value === "all" ? "" : value;
    setFilterTag(newTag);
    updateURL({ tag: newTag });
    // Abort any in-flight tag fetch to prevent out-of-order responses
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    // Reset clip list and re-fetch with the new tag filter
    setClips([]);
    setNextCursor(null);
    setHasMore(true);
    fetchAllClips(null, newTag, controller.signal);
  };

  // Update clip tags — saves to backend and updates local state optimistically
  const updateClipTags = async (clipId: string, newTags: string[]) => {
    // Store previous tags for rollback (Bug #47)
    const previousTags = clips.find((c) => c.id === clipId)?.tags ?? [];
    // Optimistic update
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, tags: newTags } : c))
    );
    try {
      await apiPatch(`/library/clips/${clipId}`, { tags: newTags });
      // Refresh available tags to include any newly added tags
      fetchAvailableTags();
    } catch (error) {
      handleApiError(error, "Error saving tags");
      // Revert to previous tags (Bug #47)
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, tags: previousTags } : c))
      );
    }
  };

  // Toggle TikTok posted status
  const toggleTiktokPosted = async (clipId: string) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    const newValue = !clip.tiktok_posted;
    // Optimistic update
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, tiktok_posted: newValue } : c))
    );
    try {
      await apiPatch(`/library/clips/${clipId}`, { tiktok_posted: newValue });
      toast.success(newValue ? "Marked as posted on TikTok" : "Unmarked TikTok post");
    } catch (error) {
      handleApiError(error, "Error updating TikTok status");
      // Revert
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, tiktok_posted: !newValue } : c))
      );
    }
  };

  // Toggle downloaded & posted status
  const toggleDownloadedPosted = async (clipId: string) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    const newValue = !clip.is_downloaded_posted;
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, is_downloaded_posted: newValue } : c))
    );
    try {
      await apiPatch(`/library/clips/${clipId}`, { is_downloaded_posted: newValue });
    } catch (error) {
      handleApiError(error, "Error updating status");
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, is_downloaded_posted: !newValue } : c))
      );
    }
  };

  // Toggle QC verified status
  const toggleQcVerified = async (clipId: string) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    const newValue = !clip.qc_verified;
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, qc_verified: newValue } : c))
    );
    try {
      await apiPatch(`/library/clips/${clipId}`, { qc_verified: newValue });
      toast.success(newValue ? "Marked as QC verified" : "QC verification cleared");
    } catch (error) {
      handleApiError(error, "Error updating QC status");
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, qc_verified: !newValue } : c))
      );
    }
  };

  // Toggle social media posted status (generic)
  const toggleSocialPosted = async (clipId: string, platform: "instagram_posted" | "youtube_posted" | "facebook_posted") => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    const newValue = !clip[platform];
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, [platform]: newValue } : c))
    );
    const platformLabel = platform.replace("_posted", "").replace(/^./, (c) => c.toUpperCase());
    try {
      await apiPatch(`/library/clips/${clipId}`, { [platform]: newValue });
      toast.success(newValue ? `Marked as posted on ${platformLabel}` : `Unmarked ${platformLabel} post`);
    } catch (error) {
      handleApiError(error, `Error updating ${platformLabel} status`);
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, [platform]: !newValue } : c))
      );
    }
  };

  // Regenerate voice-over (re-render clip with fresh TTS)
  const regenerateVoiceover = async (clipId: string) => {
    setRegeneratingVoiceoverId(clipId);
    try {
      await apiPost(`/library/clips/${clipId}/regenerate-voiceover`);
      toast.info("Regenerating voice-over...", { duration: 5000 });
      // Update clip status to processing
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, final_status: "processing" } : c))
      );
      if (playingClip?.id === clipId) {
        setPlayingClip((prev) => prev ? { ...prev, final_status: "processing" } : null);
      }
      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const res = await apiGet(`/library/clips/${clipId}`);
          const data = await res.json();
          const clip = data.clip;
          if (clip && clip.final_status !== "processing") {
            clearInterval(pollInterval);
            setRegeneratingVoiceoverId((prev) => prev === clipId ? null : prev);
            // Update clip in list with new data
            setClips((prev) =>
              prev.map((c) => c.id === clipId ? {
                ...c,
                final_status: clip.final_status,
                final_video_path: clip.final_video_path,
                _videoVersion: Date.now(),
              } : c)
            );
            if (clip.final_status === "completed" || clip.final_video_path) {
              toast.success("Voice-over regenerated successfully! The video has been updated.");
              // Update playing clip if it's still open
              setPlayingClip((prev) => {
                if (!prev || prev.id !== clipId) return prev;
                return { ...prev, final_status: clip.final_status, final_video_path: clip.final_video_path, _videoVersion: Date.now() };
              });
            } else {
              toast.error("Voice-over regeneration failed.");
            }
          }
        } catch {
          // Ignore poll errors, keep polling
        }
      }, 3000);
      // Safety: stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setRegeneratingVoiceoverId((prev) => prev === clipId ? null : prev);
      }, 300000);
    } catch (error) {
      handleApiError(error, "Eroare la regenerarea voice-over");
      setRegeneratingVoiceoverId(null);
    }
  };

  const [scriptDialogClip, setScriptDialogClip] = useState<ClipWithProject | null>(null);
  const [loadingScriptId, setLoadingScriptId] = useState<string | null>(null);
  const [captionDialogClip, setCaptionDialogClip] = useState<ClipWithProject | null>(null);

  // Get Postiz status badge
  const getPostizBadge = (clip: ClipWithProject) => {
    const status = clip.postiz_status || "not_sent";
    switch (status) {
      case "sent":
        return {
          color: "bg-green-500 text-white",
          label: "Sent",
          icon: <CheckCircle2 className="h-3 w-3 mr-1" />,
        };
      case "scheduled":
        return {
          color: "bg-amber-500 text-white",
          label: "Scheduled",
          icon: <Clock className="h-3 w-3 mr-1" />,
        };
      default:
        return {
          color: "bg-muted text-muted-foreground",
          label: "Not sent",
          icon: null,
        };
    }
  };

  // Open publish dialog for a clip
  const openPublishDialog = (clip: ClipWithProject) => {
    setPublishDialogClip(clip);
  };

  // Format duration
  const formatDuration = (seconds?: number) => {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Rename clip
  const renameClip = async (clipId: string, newName: string) => {
    try {
      await apiPatch(`/library/clips/${clipId}`, { variant_name: newName });
      setClips((prev) =>
        prev.map((c) =>
          c.id === clipId ? { ...c, variant_name: newName } : c
        )
      );
      setRenameClipId(null);
    } catch (error) {
      handleApiError(error, "Error renaming clip");
      setRenameClipId(null);
    }
  };

  const loadClipContent = useCallback(async (clipId: string) => {
    setLoadingScriptId(clipId);
    try {
      const res = await apiGet(`/library/clips/${clipId}`);
      const data = await res.json();
      const content = data?.content || data?.clip?.editai_clip_content || null;
      if (!content) return null;

      setClips((prev) =>
        prev.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                tts_text: content.tts_text ?? clip.tts_text ?? null,
                srt_content: content.srt_content ?? clip.srt_content ?? null,
                has_subtitles: Boolean(content.srt_content) || clip.has_subtitles,
                has_voiceover: Boolean(content.tts_audio_path) || clip.has_voiceover,
                has_audio: content.tts_audio_path ? true : clip.has_audio,
              }
            : clip
        )
      );

      return content;
    } catch (error) {
      handleApiError(error, "Error loading clip script");
      return null;
    } finally {
      setLoadingScriptId((current) => (current === clipId ? null : current));
    }
  }, []);

  const openScriptDialog = useCallback(async (clip: ClipWithProject) => {
    if (!clip.tts_text) {
      const content = await loadClipContent(clip.id);
      if (!content?.tts_text) {
        toast.error("Script not available for this clip");
        return;
      }
      setScriptDialogClip({ ...clip, tts_text: content.tts_text });
    } else {
      setScriptDialogClip(clip);
    }
  }, [loadClipContent]);

  const openCaptionDialog = useCallback(async (clip: ClipWithProject) => {
    if (!clip.srt_content) {
      const content = await loadClipContent(clip.id);
      if (!content?.srt_content) {
        toast.error("Caption not available for this clip");
        return;
      }
      setCaptionDialogClip({ ...clip, srt_content: content.srt_content });
    } else {
      setCaptionDialogClip(clip);
    }
  }, [loadClipContent]);

  // Remove audio from clip — opens confirm dialog
  const openRemoveAudioConfirm = (clip: ClipWithProject) => {
    setConfirmDialog({
      open: true,
      title: "Remove Audio",
      description: "Are you sure you want to permanently remove audio from this clip? This action cannot be undone.",
      confirmLabel: "Remove Audio",
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }));
        setRemovingAudioClipId(clip.id);
        try {
          const res = await apiPost(`/library/clips/${clip.id}/remove-audio`);
          if (!isMountedRef.current) return;
          const data = await res.json();
          setClips((prev) =>
            prev.map((c) =>
              c.id === clip.id ? { ...c, has_audio: false, raw_video_path: data.video_path, ...(c.final_video_path ? { final_video_path: data.video_path } : {}) } : c
            )
          );
          toast.success("Audio removed successfully!");
        } catch (error) {
          handleApiError(error, "Error removing audio");
        } finally {
          setRemovingAudioClipId(null);
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
        }
      },
    });
  };

  // Delete clip permanently — opens confirm dialog
  const openDeleteConfirm = (clip: ClipWithProject) => {
    setConfirmDialog({
      open: true,
      title: "Delete Clip",
      description: `Are you sure you want to delete "${clip.variant_name || `Variant ${clip.variant_index}`}"? The clip will be moved to trash and can be restored within 30 days.`,
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }));
        setDeletingClipId(clip.id);
        try {
          await apiDelete(`/library/clips/${clip.id}`);
          if (!isMountedRef.current) return;
          setClips((prev) => prev.filter((c) => c.id !== clip.id));
          toast.success("Clip deleted successfully!");
        } catch (error) {
          handleApiError(error, "Error deleting clip");
        } finally {
          setDeletingClipId(null);
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
        }
      },
    });
  };

  // Multi-select handlers
  const toggleClipSelection = (clipId: string) => {
    setSelectedClipIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(clipId)) {
        newSet.delete(clipId);
      } else {
        newSet.add(clipId);
      }
      return newSet;
    });
  };

  const selectAllVisible = () => {
    const allIds = filteredClips.map((c) => c.id);
    setSelectedClipIds(new Set(allIds));
  };

  const clearSelection = () => {
    setSelectedClipIds(new Set());
  };

  // Bulk delete selected clips — opens confirm dialog
  const openBulkDeleteConfirm = () => {
    if (selectedClipIds.size === 0) return;
    const count = selectedClipIds.size;
    setConfirmDialog({
      open: true,
      title: "Delete Selected Clips",
      description: `Are you sure you want to delete ${count} selected clips? They will be moved to trash and can be restored within 30 days.`,
      confirmLabel: `Delete ${count} clips`,
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }));
        setBulkDeleting(true);
        try {
          const ids = selectedClipIdsRef.current;
          const res = await apiPost("/library/clips/bulk-delete", {
            clip_ids: Array.from(ids),
          });
          const data = await res.json();
          setClips((prev) => prev.filter((c) => !ids.has(c.id)));
          setSelectedClipIds(new Set());
          toast.success(`${data.deleted_count} clips deleted successfully!${data.failed_count > 0 ? ` ${data.failed_count} failed.` : ""}`);
        } catch (error) {
          handleApiError(error, "Error deleting clips");
        } finally {
          setBulkDeleting(false);
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
        }
      },
    });
  };

  // Download helper for SRT/Audio files
  const downloadFile = async (url: string, filename: string) => {
    let blobUrl: string | null = null;
    try {
      const res = await apiGet(url);
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      toast.error("Download error");
    } finally {
      if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl!), 1000);
    }
  };

  // Bulk upload to Postiz — opens confirm dialog
  const openBulkUploadConfirm = () => {
    if (selectedClipIds.size === 0) return;
    const count = selectedClipIds.size;
    setConfirmDialog({
      open: true,
      title: "Send to Postiz",
      description: `Are you sure you want to send ${count} selected clips to Postiz?`,
      confirmLabel: `Send ${count} clips`,
      variant: "default",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }));
        setBulkUploading(true);
        try {
          // Prepare clips data
          const selectedClips = clipsRef.current.filter((c) => selectedClipIdsRef.current.has(c.id));
          const clipsData = selectedClips.map((clip) => ({
            clip_id: clip.id,
            video_path: clip.final_video_path || clip.raw_video_path,
          }));

          const res = await apiPost("/postiz/bulk-upload", {
            clips: clipsData,
          });
          const data = await res.json();
          const uploadedIds = new Set(data.uploaded.map((u: { clip_id: string }) => u.clip_id));
          setClips((prev) =>
            prev.map((c) =>
              uploadedIds.has(c.id) ? { ...c, postiz_status: "sent" as const } : c
            )
          );
          setSelectedClipIds(new Set());
          toast.success(`${data.uploaded_count} clips sent to Postiz!${data.failed_count > 0 ? ` ${data.failed_count} failed.` : ""}`);
        } catch (error) {
          handleApiError(error, "Error sending clips to Postiz");
        } finally {
          setBulkUploading(false);
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
        }
      },
    });
  };

  // Fetch trash clips
  const fetchTrash = async () => {
    setLoadingTrash(true);
    try {
      const res = await apiGet("/library/trash");
      const data = await res.json();
      setTrashClips(data.clips || []);
    } catch (error) {
      handleApiError(error, "Error loading trash");
    } finally {
      setLoadingTrash(false);
    }
  };

  // Fetch generated images
  const fetchImages = useCallback(async () => {
    setLoadingImages(true);
    try {
      const res = await apiGet("/image-gen/history?limit=50");
      const data = await res.json();
      setGeneratedImages(data.images || []);
    } catch (error) {
      console.error("Failed to fetch images:", error);
    } finally {
      setLoadingImages(false);
    }
  }, []);

  const handleTabChange = (tab: "videos" | "images") => {
    setActiveTab(tab);
    setSelectedClipIds(new Set());
    setSelectedImageIds(new Set());
    updateURL(
      tab === "images"
        ? { tab: "images", view: "" }
        : { tab: "videos", view: viewMode }
    );
  };

  const handleViewModeChange = (mode: "library" | "trash") => {
    setViewMode(mode);
    updateURL({ tab: "videos", view: mode });
  };

  // Fetch images when tab switches to "images"
  useEffect(() => {
    if (activeTab === "images") {
      fetchImages();
    }
  }, [activeTab, fetchImages]);

  // Fetch integrations for image publish
  const fetchIntegrations = async () => {
    try {
      const res = await apiGet("/postiz/integrations");
      const data = await res.json();
      setAvailableIntegrations(Array.isArray(data) ? data : data.integrations || []);
    } catch (error) {
      console.error("Failed to fetch integrations:", error);
    }
  };

  // Open image publish panel
  const openImagePublish = (imageId: string) => {
    setImagePublishId(imageId);
    setImagePublishCaption("");
    setImagePublishIntegrations([]);
    setImagePublishSchedule(false);
    setImagePublishDate("");
    fetchIntegrations();
  };

  // Toggle integration selection for image publish
  const toggleImageIntegration = (integrationId: string) => {
    setImagePublishIntegrations((prev) =>
      prev.includes(integrationId)
        ? prev.filter((id) => id !== integrationId)
        : [...prev, integrationId]
    );
  };

  // Publish image
  const publishImage = async () => {
    if (!imagePublishId || imagePublishIntegrations.length === 0) {
      toast.error("Select at least one platform");
      return;
    }
    setImagePublishing(true);
    try {
      await apiPost("/image-gen/publish-image", {
        image_id: imagePublishId,
        integration_ids: imagePublishIntegrations,
        caption: imagePublishCaption,
        schedule: imagePublishSchedule,
        scheduled_at: imagePublishSchedule ? imagePublishDate : undefined,
      });
      toast.success("Image published successfully!");
      setImagePublishId(null);
    } catch (error) {
      handleApiError(error, "Error publishing image");
    } finally {
      setImagePublishing(false);
    }
  };

  const toggleImageSelection = (imageId: string) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  };

  const clearImageSelection = () => {
    setSelectedImageIds(new Set());
  };

  const selectAllImages = () => {
    setSelectedImageIds(new Set(generatedImages.map((image) => image.id)));
  };

  // Delete generated image
  const deleteImage = async (imageId: string) => {
    setDeletingImageId(imageId);
    try {
      await apiDelete(`/image-gen/${imageId}`);
      setGeneratedImages((prev) => prev.filter((img) => img.id !== imageId));
      setSelectedImageIds((prev) => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
      toast.success("Image deleted!");
    } catch (error) {
      handleApiError(error, "Error deleting image");
    } finally {
      setDeletingImageId(null);
    }
  };

  // Toggle image approval
  const toggleApproveImage = async (imageId: string) => {
    try {
      const res = await apiPatch(`/image-gen/${imageId}/approve`);
      if (res.ok) {
        const data = await res.json();
        setGeneratedImages((prev) =>
          prev.map((img) => img.id === imageId ? { ...img, is_approved: data.is_approved } : img)
        );
        toast.success(data.is_approved ? "Image approved!" : "Approval removed");
      }
    } catch (error) {
      handleApiError(error, "Error toggling approval");
    }
  };

  const openBulkDeleteImagesConfirm = () => {
    const imagesToDelete = orderedSelectedImages;
    if (imagesToDelete.length === 0) return;

    setConfirmDialog({
      open: true,
      title: "Delete Selected Images",
      description: `Are you sure you want to delete ${imagesToDelete.length} selected ${imagesToDelete.length === 1 ? "image" : "images"}?`,
      confirmLabel: "Delete Selected",
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }));
        setBulkDeletingImages(true);
        try {
          await Promise.all(imagesToDelete.map((image) => apiDelete(`/image-gen/${image.id}`)));
          const deletedIds = new Set(imagesToDelete.map((image) => image.id));
          setGeneratedImages((prev) => prev.filter((image) => !deletedIds.has(image.id)));
          setSelectedImageIds(new Set());
          toast.success(`${imagesToDelete.length} ${imagesToDelete.length === 1 ? "image deleted" : "images deleted"}!`);
        } catch (error) {
          handleApiError(error, "Error deleting selected images");
        } finally {
          setBulkDeletingImages(false);
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
        }
      },
    });
  };

  // Restore clip from trash
  const restoreClip = async (clipId: string) => {
    setRestoringClipId(clipId);
    try {
      await apiPost(`/library/clips/${clipId}/restore`);
      setTrashClips((prev) => prev.filter((c) => c.id !== clipId));
      toast.success("Clip restored successfully!");
    } catch (error) {
      handleApiError(error, "Error restoring clip");
    } finally {
      setRestoringClipId(null);
    }
  };

  // Permanently delete clip — opens confirm dialog
  const openPermanentDeleteConfirm = (clip: ClipWithProject & { days_remaining?: number }) => {
    setConfirmDialog({
      open: true,
      title: "Permanently Delete Clip",
      description: `Are you sure you want to permanently delete "${clip.variant_name || `Variant ${clip.variant_index}`}"? This will remove the files and cannot be undone.`,
      confirmLabel: "Delete Permanently",
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }));
        setPermanentlyDeletingClipId(clip.id);
        try {
          await apiDelete(`/library/clips/${clip.id}/permanent`);
          setTrashClips((prev) => prev.filter((c) => c.id !== clip.id));
          toast.success("Clip permanently deleted.");
        } catch (error) {
          handleApiError(error, "Error permanently deleting clip");
        } finally {
          setPermanentlyDeletingClipId(null);
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
        }
      },
    });
  };

  // Empty all trash — opens confirm dialog
  const emptyAllTrash = () => {
    setConfirmDialog({
      open: true,
      title: "Empty Trash",
      description: `Are you sure you want to permanently delete all ${trashClips.length} clip(s) in trash? This will remove all files and cannot be undone.`,
      confirmLabel: "Empty Trash",
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }));
        setEmptyingTrash(true);
        try {
          await apiDelete("/library/trash/empty");
          setTrashClips([]);
          toast.success("Trash emptied successfully.");
        } catch (error) {
          handleApiError(error, "Error emptying trash");
        } finally {
          setEmptyingTrash(false);
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
        }
      },
    });
  };

  // Handle no profile selected
  if (!profileLoading && !currentProfile) {
    return (
      <div className="min-h-screen bg-background">
        <main className="w-full max-w-[1400px] mx-auto px-6 py-8">
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <User className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Profile Selected</h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              Create a profile to get started. Use the profile dropdown in the navbar to create your first profile.
            </p>
            <p className="text-sm text-muted-foreground">
              Look for the profile dropdown in the top navigation bar
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className={`w-full max-w-[1400px] mx-auto px-6 py-8 ${(viewMode === "library" && selectedClipIds.size > 0) || (activeTab === "images" && selectedImageIds.size > 0) ? "pb-24" : ""}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Library</h1>
            <p className="text-muted-foreground">
              All exported clips from projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "videos" && (
              <>
                {/* Library/Trash toggle */}
                <Button
                  variant={viewMode === "library" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleViewModeChange("library")}
                >
                  Library
                </Button>
                <Button
                  variant={viewMode === "trash" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { handleViewModeChange("trash"); fetchTrash(); }}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Trash
                </Button>
                <Button onClick={() => viewMode === "library" ? fetchAllClips() : fetchTrash()} variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit mb-6">
          <Button
            variant={activeTab === "videos" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleTabChange("videos")}
          >
            <Film className="size-4 mr-2" /> Video Clips
          </Button>
          <Button
            variant={activeTab === "images" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleTabChange("images")}
          >
            <ImageIcon className="size-4 mr-2" /> Imagini
          </Button>
        </div>

        {/* === IMAGES TAB === */}
        {activeTab === "images" && (
          <div className="space-y-4">
            {postizStatus && (
              <div>
                {postizStatus.connected ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="outline" className="border-green-500 text-green-600 gap-1">
                      <Link className="h-3 w-3" />
                      {postizStatus.api_url?.replace(/^https?:\/\//, "").replace(/\/+$/, "")} - {postizStatus.integrations_count} {postizStatus.integrations_count === 1 ? "account" : "accounts"}
                    </Badge>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="destructive" className="gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Postiz not configured
                    </Badge>
                    <a href="/settings" className="text-xs text-muted-foreground hover:underline">
                      Configure in Settings
                    </a>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {generatedImages.length} generated images
              </p>
              <Button onClick={fetchImages} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>

            {selectedImageIds.size > 0 && (
              <Card className="border-primary bg-primary/5">
                <CardContent className="py-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <CheckSquare className="h-5 w-5 text-primary" />
                      <span className="font-medium">
                        {selectedImageIds.size} {selectedImageIds.size === 1 ? "image selected" : "images selected"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={selectAllImages}
                        disabled={selectedImageIds.size === generatedImages.length}
                      >
                        <CheckSquare className="h-4 w-4 mr-2" />
                        Select all ({generatedImages.length})
                      </Button>
                      <Button variant="outline" size="sm" onClick={clearImageSelection}>
                        <XCircle className="h-4 w-4 mr-2" />
                        Deselect
                      </Button>
                      <Button
                        size="sm"
                        className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        onClick={() => setBulkImageDialogOpen(true)}
                        disabled={bulkDeletingImages || !postizStatus?.connected}
                      >
                        <Share2 className="h-4 w-4 mr-2" />
                        Send to Social
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
                        onClick={() => setBulkImageDialogOpen(true)}
                        disabled={bulkDeletingImages || !postizStatus?.connected}
                      >
                        <CalendarClock className="h-4 w-4 mr-2" />
                        Schedule
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={openBulkDeleteImagesConfirm}
                        disabled={bulkDeletingImages}
                      >
                        {bulkDeletingImages ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        Delete selected
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {loadingImages ? (
              <div className="flex justify-center py-12">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : generatedImages.length === 0 ? (
              <EmptyState
                icon={<ImageIcon className="h-6 w-6" />}
                title="No images yet"
                description="Generated images will appear here. Use the Image Generator to create images."
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {generatedImages.map((img) => (
                  <Card
                    key={img.id}
                    className={`overflow-hidden group cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 ${
                      selectedImageIds.has(img.id) ? "ring-2 ring-primary" : ""
                    }`}
                    onClick={() => toggleImageSelection(img.id)}
                  >
                    {/* Image thumbnail */}
                    <div className="aspect-square bg-muted relative">
                      <div
                        className={`absolute top-2 left-2 z-10 transition-opacity ${
                          selectedImageIds.has(img.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedImageIds.has(img.id)}
                          onCheckedChange={() => toggleImageSelection(img.id)}
                          className="h-5 w-5 bg-background/80 border-2"
                          aria-label={`Select image ${img.id.slice(0, 8)}`}
                        />
                      </div>

                      {img.image_url || img.final_image_path || img.image_local_path ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={img.final_image_path || img.image_local_path ? `${API_URL}/image-gen/${img.id}/file` : img.image_url || `${API_URL}/image-gen/${img.id}/file`}
                          alt={img.prompt?.slice(0, 60) || "Generated image"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="h-12 w-12 text-muted-foreground" />
                        </div>
                      )}

                      {/* Status badge */}
                      <Badge
                        className={`absolute top-2 right-2 text-xs ${
                          img.status === "completed"
                            ? "bg-green-500 text-white"
                            : img.status === "failed"
                            ? "bg-red-500 text-white"
                            : img.status === "processing"
                            ? "bg-amber-500 text-white"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {img.status === "completed" ? (
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                        ) : img.status === "failed" ? (
                          <XCircle className="h-3 w-3 mr-1" />
                        ) : img.status === "processing" ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : null}
                        {img.status}
                      </Badge>

                      {/* Approved badge */}
                      {img.is_approved && (
                        <Badge className="absolute bottom-2 left-2 text-xs bg-emerald-600 text-white">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Aprobat
                        </Badge>
                      )}

                      {/* Hover actions */}
                      <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        {img.status === "completed" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(
                                  `${API_URL}/image-gen/${img.id}/file?download=true`,
                                  "_blank"
                                );
                              }}
                              title="Download"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                              disabled={!postizStatus?.connected}
                              onClick={(e) => {
                                e.stopPropagation();
                                openImagePublish(img.id);
                              }}
                              title={postizStatus?.connected ? "Publish to Social Media" : "Postiz not configured"}
                            >
                              <Share2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deletingImageId === img.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteImage(img.id);
                          }}
                          title="Delete image"
                        >
                          {deletingImageId === img.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Info */}
                    <CardContent className="p-2">
                      <p className="text-sm font-medium truncate">
                        {img.template_name || img.model || "Image"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate" title={img.prompt}>
                        {img.prompt?.slice(0, 60) || "No prompt"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(img.created_at).toLocaleDateString("ro-RO", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>

                      {/* Approval checkbox */}
                      {img.status === "completed" && (
                        <div className="flex items-center gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            id={`approve-${img.id}`}
                            checked={img.is_approved}
                            onCheckedChange={() => toggleApproveImage(img.id)}
                          />
                          <label
                            htmlFor={`approve-${img.id}`}
                            className="text-xs cursor-pointer text-muted-foreground hover:text-foreground"
                          >
                            Aprobat
                          </label>
                        </div>
                      )}

                      {/* Inline publish panel */}
                      {imagePublishId === img.id && (
                        <div className="mt-2 p-2 border rounded-lg space-y-2" onClick={(e) => e.stopPropagation()}>
                          <p className="text-xs font-medium">Publish Image</p>

                          {/* Platform pills */}
                          <div className="flex flex-wrap gap-1">
                            {availableIntegrations.map((integ) => (
                              <button
                                key={integ.id}
                                type="button"
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${
                                  imagePublishIntegrations.includes(integ.id)
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-muted text-muted-foreground border-border hover:bg-accent"
                                }`}
                                onClick={() => toggleImageIntegration(integ.id)}
                              >
                                {integ.picture && (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={integ.picture} alt="" className="h-4 w-4 rounded-full" />
                                )}
                                {integ.name}
                              </button>
                            ))}
                            {availableIntegrations.length === 0 && (
                              <p className="text-xs text-muted-foreground">No integrations found</p>
                            )}
                          </div>

                          {/* Caption */}
                          <Input
                            placeholder="Caption..."
                            value={imagePublishCaption}
                            onChange={(e) => setImagePublishCaption(e.target.value)}
                            className="h-7 text-xs"
                          />

                          {/* Schedule toggle */}
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`schedule-${img.id}`}
                              checked={imagePublishSchedule}
                              onCheckedChange={(checked) => setImagePublishSchedule(!!checked)}
                            />
                            <label htmlFor={`schedule-${img.id}`} className="text-xs cursor-pointer flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Schedule
                            </label>
                          </div>
                          {imagePublishSchedule && (
                            <Input
                              type="datetime-local"
                              value={imagePublishDate}
                              onChange={(e) => setImagePublishDate(e.target.value)}
                              className="h-7 text-xs"
                            />
                          )}

                          {/* Action buttons */}
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              className="flex-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                              disabled={imagePublishing || imagePublishIntegrations.length === 0}
                              onClick={publishImage}
                            >
                              {imagePublishing ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <Send className="h-3 w-3 mr-1" />
                              )}
                              Publish
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs"
                              onClick={() => setImagePublishId(null)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Error message */}
                      {img.error_message && (
                        <p className="text-xs text-red-500 mt-1 truncate" title={img.error_message}>
                          {img.error_message}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === VIDEO CLIPS TAB === */}
        {activeTab === "videos" && (<>
        {/* Trash View */}
        {viewMode === "trash" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Clips in trash are permanently deleted after 30 days.
              </p>
              {trashClips.length > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={emptyingTrash}
                  onClick={emptyAllTrash}
                >
                  {emptyingTrash ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1" />
                  )}
                  Empty Trash
                </Button>
              )}
            </div>
            {loadingTrash ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" role="status" aria-label="Loading"></div>
              </div>
            ) : trashClips.length === 0 ? (
              <EmptyState
                icon={<Trash2 className="h-6 w-6" />}
                title="Trash is empty"
                description="Deleted clips will appear here for 30 days before being permanently removed."
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {trashClips.map((clip) => (
                  <Card key={clip.id} className="overflow-hidden">
                    {/* Thumbnail */}
                    <div className="aspect-[9/16] bg-muted relative">
                      {clip.thumbnail_path ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={`${API_URL}/library/files/${encodeURIComponent(clip.thumbnail_path)}?v=${clip.id}`}
                          alt={clip.variant_name || `Variant ${clip.variant_index}`}
                          className="w-full h-full object-cover opacity-60"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center opacity-60">
                          <Film className="h-12 w-12 text-muted-foreground" />
                        </div>
                      )}
                      {/* Days remaining badge */}
                      <Badge
                        className={`absolute bottom-2 left-2 text-xs ${
                          (clip.days_remaining ?? 30) <= 3
                            ? "bg-red-500 text-white"
                            : (clip.days_remaining ?? 30) <= 7
                            ? "bg-orange-500 text-white"
                            : "bg-black/70 text-white"
                        }`}
                      >
                        {clip.days_remaining ?? 30}d left
                      </Badge>
                    </div>
                    {/* Info */}
                    <CardContent className="p-2">
                      <p className="text-sm font-medium truncate">
                        {clip.variant_name || `Variant ${clip.variant_index}`}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mb-2">
                        {clip.project_name}
                      </p>
                      {/* Actions */}
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-xs"
                          disabled={restoringClipId === clip.id}
                          onClick={() => restoreClip(clip.id)}
                          title="Restore clip"
                        >
                          {restoringClipId === clip.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Undo2 className="h-3 w-3" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1 text-xs"
                          disabled={permanentlyDeletingClipId === clip.id}
                          onClick={() => openPermanentDeleteConfirm(clip)}
                          title="Permanently delete"
                        >
                          {permanentlyDeletingClipId === clip.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Postiz connection indicator */}
        {activeTab === "videos" && viewMode === "library" && postizStatus && (
          <div className="mb-4">
            {postizStatus.connected ? (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="border-green-500 text-green-600 gap-1">
                  <Link className="h-3 w-3" />
                  {postizStatus.api_url?.replace(/^https?:\/\//, "").replace(/\/+$/, "")} — {postizStatus.integrations_count} {postizStatus.integrations_count === 1 ? "account" : "accounts"}
                </Badge>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Postiz not configured
                </Badge>
                <a href="/settings" className="text-xs text-muted-foreground hover:underline">
                  Configure in Settings
                </a>
              </div>
            )}
          </div>
        )}

        {/* Filters - library mode only */}
        {activeTab === "videos" && viewMode === "library" && <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-end">
              {/* Search */}
              <div className="flex-1 min-w-[200px]">
                <Label className="text-sm text-muted-foreground mb-2 block">
                  Search
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by project or variant..."
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Subtitles filter */}
              <div className="w-[160px]">
                <Label className="text-sm text-muted-foreground mb-2 block">
                  <Subtitles className="h-3 w-3 inline mr-1" />
                  Subtitles
                </Label>
                <Select value={filterSubtitles} onValueChange={handleSubtitlesFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="with">With subtitles</SelectItem>
                    <SelectItem value="without">Without subtitles</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Voiceover filter */}
              <div className="w-[160px]">
                <Label className="text-sm text-muted-foreground mb-2 block">
                  <Mic className="h-3 w-3 inline mr-1" />
                  Voiceover
                </Label>
                <Select value={filterVoiceover} onValueChange={handleVoiceoverFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="with">With voiceover</SelectItem>
                    <SelectItem value="without">Without voiceover</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Postiz status filter */}
              <div className="w-[160px]">
                <Label className="text-sm text-muted-foreground mb-2 block">
                  <Share2 className="h-3 w-3 inline mr-1" />
                  Postiz Status
                </Label>
                <Select value={filterPostiz} onValueChange={handlePostizFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="not_sent">Not sent</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* TikTok posted filter */}
              <div className="w-[160px]">
                <Label className="text-sm text-muted-foreground mb-2 block">
                  TikTok
                </Label>
                <Select value={filterTiktok} onValueChange={(value) => {
                  setFilterTiktok(value);
                  updateURL({ tiktok: value });
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="posted">Posted</SelectItem>
                    <SelectItem value="not_posted">Not posted</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Social Posted filter */}
              <div className="w-[160px]">
                <Label className="text-sm text-muted-foreground mb-2 block">
                  Social Posted
                </Label>
                <Select value={filterSocialPosted} onValueChange={(value) => {
                  setFilterSocialPosted(value);
                  updateURL({ social: value });
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="any_posted">Any posted</SelectItem>
                    <SelectItem value="none_posted">None posted</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Tag filter */}
              <div className="w-[160px]">
                <Label className="text-sm text-muted-foreground mb-2 block">
                  <TagIcon className="h-3 w-3 inline mr-1" />
                  Tag
                </Label>
                <Select value={filterTag || "all"} onValueChange={handleTagFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Tags" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tags</SelectItem>
                    {availableTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Active tag filter badge */}
            {filterTag && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Filtered by tag:</span>
                <Badge variant="secondary" className="text-xs gap-1">
                  <TagIcon className="h-3 w-3" />
                  {filterTag}
                  <button
                    type="button"
                    className="ml-0.5 hover:text-destructive transition-colors"
                    onClick={() => handleTagFilter("all")}
                    aria-label="Clear tag filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              </div>
            )}

            {/* Filter summary */}
            <div className="mt-4 text-sm text-muted-foreground">
              {filteredClips.length} of {clips.length} clips
            </div>
          </CardContent>
        </Card>}

        {/* Selection Toolbar - appears when clips are selected (library mode only) */}
        {viewMode === "library" && selectedClipIds.size > 0 && (
          <Card className="mb-6 border-primary bg-primary/5">
            <CardContent className="py-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <CheckSquare className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    {selectedClipIds.size} {selectedClipIds.size === 1 ? "clip selected" : "clips selected"}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllVisible}
                    disabled={selectedClipIds.size === filteredClips.length}
                  >
                    <CheckSquare className="h-4 w-4 mr-2" />
                    Select all ({filteredClips.length})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearSelection}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Deselect
                  </Button>
                  <div className="w-px h-6 bg-border mx-2" />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={openBulkDeleteConfirm}
                    disabled={bulkDeleting || bulkUploading}
                  >
                    {bulkDeleting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Delete selected
                  </Button>
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    onClick={openBulkUploadConfirm}
                    disabled={bulkDeleting || bulkUploading || !postizStatus?.connected}
                    title={postizStatus?.connected ? `Send to ${postizStatus.api_url?.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : "Postiz not configured — configure in Settings"}
                  >
                    {bulkUploading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4 mr-2" />
                    )}
                    Send to Postiz
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
                    onClick={() => setBulkScheduleOpen(true)}
                    disabled={bulkDeleting || bulkUploading}
                    title="Schedule selected clips in cascade (1 post/day)"
                  >
                    <CalendarClock className="h-4 w-4 mr-2" />
                    Schedule
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Clips grid - library mode only */}
        {viewMode === "library" && ((profileLoading || loading) ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : filteredClips.length === 0 ? (
          <EmptyState
            icon={<Film className="h-6 w-6" />}
            title="No edits yet"
            description={
              clips.length === 0
                ? "Processed clips will appear here."
                : filterTag
                ? `No clips with tag "${filterTag}".`
                : "Adjust the filters to see clips."
            }
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filteredClips.map((clip) => {
              const postizBadge = getPostizBadge(clip);
              return (
                <Card
                  key={clip.id}
                  className={`overflow-hidden transition-all cursor-pointer ${
                    clip.is_downloaded_posted || clip.postiz_status === "sent"
                      ? "border-green-500 bg-green-50/50 dark:bg-green-950/20 hover:ring-2 hover:ring-green-400/50"
                      : clip.qc_verified
                        ? "border-primary bg-primary/10 hover:ring-2 hover:ring-primary/40"
                        : `hover:ring-2 hover:ring-primary/50 ${selectedClipIds.has(clip.id) ? "ring-2 ring-primary" : ""}`
                  }`}
                  onClick={() => toggleClipSelection(clip.id)}
                >
                  {/* Thumbnail with hover video preview */}
                  <ClipHoverPreview
                    thumbnailPath={clip.thumbnail_path}
                    videoPath={clip.final_video_path || clip.raw_video_path}
                    clipId={clip.id}
                    alt={clip.variant_name || `Variant ${clip.variant_index}`}
                  >
                    {/* Film icon for clips without thumbnail */}
                    {!clip.thumbnail_path && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Film className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}

                    {/* Selection checkbox */}
                    <div
                      className={`absolute top-2 left-2 z-10 transition-opacity ${
                        selectedClipIds.has(clip.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selectedClipIds.has(clip.id)}
                        onCheckedChange={() => toggleClipSelection(clip.id)}
                        className="h-5 w-5 bg-background/80 border-2"
                        aria-label={`Select clip ${clip.variant_name || clip.id.slice(0, 8)}`}
                      />
                    </div>

                    {/* Postiz badge */}
                    <Badge
                      className={`absolute top-2 right-2 ${postizBadge.color}`}
                    >
                      {postizBadge.icon}
                      {postizBadge.label}
                    </Badge>

                    {/* Social media posted badges */}
                    <div className="absolute top-8 right-2 flex flex-col gap-0.5">
                      {clip.tiktok_posted && (
                        <Badge className="bg-black text-white text-[10px] px-1.5 py-0">TikTok</Badge>
                      )}
                      {clip.instagram_posted && (
                        <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] px-1.5 py-0">Instagram</Badge>
                      )}
                      {clip.youtube_posted && (
                        <Badge className="bg-red-600 text-white text-[10px] px-1.5 py-0">YouTube</Badge>
                      )}
                      {clip.facebook_posted && (
                        <Badge className="bg-blue-600 text-white text-[10px] px-1.5 py-0">Facebook</Badge>
                      )}
                    </div>

                    {/* QC verified badge */}
                    {clip.qc_verified && !(clip.is_downloaded_posted || clip.postiz_status === "sent") && (
                      <Badge className="absolute bottom-2 left-2 bg-primary text-primary-foreground text-[10px] px-1.5 py-0 z-10">
                        <ShieldCheck className="h-3 w-3 mr-0.5" />
                        QC
                      </Badge>
                    )}

                    {/* Feature badges - positioned below checkbox */}
                    <div className="absolute top-10 left-2 flex flex-col gap-1">
                      {clip.has_subtitles && (
                        <Badge variant="secondary" className="text-xs">
                          <Subtitles className="h-3 w-3" />
                        </Badge>
                      )}
                      {clip.has_voiceover && (
                        <Badge variant="secondary" className="text-xs">
                          <Mic className="h-3 w-3" />
                        </Badge>
                      )}
                    </div>

                    {/* Duration */}
                    <Badge className="absolute bottom-2 right-2 bg-black/70 text-white">
                      {formatDuration(clip.duration)}
                    </Badge>

                    {/* Hover actions */}
                    <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                      <div className="flex flex-wrap items-center justify-center gap-2 px-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlayingClip(clip);
                          }}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            const videoPath = clip.final_video_path || clip.raw_video_path;
                            window.open(
                              `${API_URL}/library/files/${encodeURIComponent(videoPath)}?download=true&v=${clip.id}`,
                              "_blank"
                            );
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {clip.has_subtitles && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadFile(`/library/clips/${clip.id}/srt`, `clip_${clip.id.slice(0, 8)}.srt`);
                            }}
                            title="Download SRT subtitles"
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        )}
                        {clip.has_voiceover && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadFile(`/library/clips/${clip.id}/audio`, `clip_${clip.id.slice(0, 8)}.mp3`);
                            }}
                            title="Download TTS audio"
                          >
                            <Mic className="h-4 w-4" />
                          </Button>
                        )}
                        {clip.has_voiceover && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={regeneratingVoiceoverId === clip.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              regenerateVoiceover(clip.id);
                            }}
                            title="Regenerate voice-over"
                          >
                            {regeneratingVoiceoverId === clip.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          disabled={!canPublish}
                          onClick={(e) => {
                            e.stopPropagation();
                            openPublishDialog(clip);
                          }}
                          title={canPublish ? "Publish to Social Media" : "Connect Postiz or Blipost in Settings to publish"}
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {/* Remove audio button */}
                      <Button
                        size="sm"
                        variant={clip.has_audio === false ? "secondary" : "destructive"}
                        disabled={clip.has_audio === false || removingAudioClipId === clip.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          openRemoveAudioConfirm(clip);
                        }}
                        className="text-xs"
                      >
                        {removingAudioClipId === clip.id ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Processing...
                          </>
                        ) : clip.has_audio === false ? (
                          <>
                            <VolumeX className="h-3 w-3 mr-1" />
                            No audio
                          </>
                        ) : (
                          <>
                            <VolumeX className="h-3 w-3 mr-1" />
                            Remove audio
                          </>
                        )}
                      </Button>
                      {/* Delete button */}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deletingClipId === clip.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          openDeleteConfirm(clip);
                        }}
                        className="text-xs"
                        title="Delete clip permanently"
                      >
                        {deletingClipId === clip.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </ClipHoverPreview>

                  {/* Info with rename and social checkboxes */}
                  <CardContent className="p-2 space-y-1">
                    {renameClipId === clip.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="h-7 text-xs"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              renameClip(clip.id, renameValue);
                            } else if (e.key === "Escape") {
                              setRenameClipId(null);
                            }
                          }}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          onClick={() => renameClip(clip.id, renameValue)}
                        >
                          <Check className="h-3 w-3 text-green-500" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          onClick={() => setRenameClipId(null)}
                        >
                          <X className="h-3 w-3 text-red-500" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-medium truncate flex-1">
                          {clip.variant_name || `Variant ${clip.variant_index}`}
                        </p>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 shrink-0 opacity-60 hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameClipId(clip.id);
                            setRenameValue(clip.variant_name || `Variant ${clip.variant_index}`);
                          }}
                          title="Rename"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      {clip.project_name}
                    </p>
                    {/* Tag editor */}
                    <div
                      className="mt-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ClipTagEditor
                        clipId={clip.id}
                        tags={clip.tags || []}
                        onTagsChange={(newTags) => updateClipTags(clip.id, newTags)}
                      />
                    </div>
                    {/* Social media posted checkboxes */}
                    <div
                      className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Postiz status (auto-checked when uploaded/scheduled/sent) */}
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          id={`postiz-${clip.id}`}
                          checked={clip.postiz_status === "scheduled" || clip.postiz_status === "sent"}
                          disabled
                          className="h-4 w-4 border-2 border-muted-foreground/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-100"
                        />
                        <label
                          className={`text-xs select-none ${
                            clip.postiz_status === "scheduled" || clip.postiz_status === "sent"
                              ? "text-primary font-medium"
                              : "text-muted-foreground"
                          }`}
                        >
                          Postiz
                        </label>
                      </div>
                      {/* TikTok (manual) */}
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          id={`tiktok_posted-${clip.id}`}
                          checked={clip.tiktok_posted || false}
                          onCheckedChange={() => toggleTiktokPosted(clip.id)}
                          className="h-4 w-4 border-2 border-muted-foreground/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                        />
                        <label
                          htmlFor={`tiktok_posted-${clip.id}`}
                          className={`text-xs cursor-pointer select-none ${
                            clip.tiktok_posted ? "text-primary font-medium" : "text-muted-foreground"
                          }`}
                        >
                          TikTok
                        </label>
                      </div>
                    </div>
                    {/* QC Verified + Downloaded & Posted checkboxes */}
                    <div
                      className="mt-1.5 space-y-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* QC Verified */}
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          id={`qc-verified-${clip.id}`}
                          checked={clip.qc_verified || false}
                          onCheckedChange={() => toggleQcVerified(clip.id)}
                          className="h-5 w-5 border-2 border-primary data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                        />
                        <label
                          htmlFor={`qc-verified-${clip.id}`}
                          className={`text-xs cursor-pointer select-none ${
                            clip.qc_verified ? "text-primary font-medium" : "text-muted-foreground"
                          }`}
                        >
                          {clip.qc_verified ? "Verificat QC ✓" : "Verificare QC"}
                        </label>
                      </div>
                      {/* Downloaded & Posted */}
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          id={`downloaded-posted-${clip.id}`}
                          checked={clip.is_downloaded_posted || false}
                          onCheckedChange={() => toggleDownloadedPosted(clip.id)}
                          className="h-5 w-5 border-2 border-green-500 data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600"
                        />
                        <label
                          htmlFor={`downloaded-posted-${clip.id}`}
                          className={`text-xs cursor-pointer select-none ${
                            clip.is_downloaded_posted ? "text-green-600 dark:text-green-400 font-medium" : "text-muted-foreground"
                          }`}
                        >
                          {clip.is_downloaded_posted ? "Downloaded & Posted" : "Mark as downloaded & posted"}
                        </label>
                      </div>
                    </div>
                    {/* Script preview button */}
                    {(clip.tts_text || clip.project_name.startsWith("Pipeline:")) && (
                      <div
                        className="mt-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors font-medium"
                          onClick={() => void openScriptDialog(clip)}
                          disabled={loadingScriptId === clip.id}
                        >
                          {loadingScriptId === clip.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <FileText className="h-3 w-3" />
                          )}
                          {loadingScriptId === clip.id ? "Loading script..." : "Show script"}
                        </button>
                      </div>
                    )}
                    {/* Caption preview button */}
                    {(clip.srt_content || clip.project_name.startsWith("Pipeline:")) && (
                      <div
                        className="mt-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="text-xs text-emerald-500 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-1 transition-colors font-medium"
                          onClick={() => void openCaptionDialog(clip)}
                          disabled={loadingScriptId === clip.id}
                        >
                          {loadingScriptId === clip.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <FileText className="h-3 w-3" />
                          )}
                          {loadingScriptId === clip.id ? "Loading caption..." : "Show caption"}
                        </button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}
        {/* Infinite scroll sentinel and status indicators - library mode only */}
        {viewMode === "library" && !loading && clips.length > 0 && (
          <>
            {loadingMore && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading more clips...</span>
              </div>
            )}
            {!hasMore && clips.length > 0 && (
              <div className="flex items-center justify-center py-6">
                <p className="text-sm text-muted-foreground">
                  {filterTag
                    ? `${filteredClips.length} clips match filter (${clips.length} total loaded)`
                    : `All clips loaded (${clips.length} total)`
                  }
                </p>
              </div>
            )}
            <div ref={sentinelCallbackRef} className="h-4" aria-hidden="true" />
          </>
        )}
        </>)}

        {/* Publish Dialog */}
        {publishDialogClip && (
          <PublishDialog
            clipId={publishDialogClip.id}
            videoPath={publishDialogClip.final_video_path || publishDialogClip.raw_video_path}
            contextText={publishDialogClip.context_text || undefined}
            projectName={publishDialogClip.project_name}
            initialCaption={
              publishDialogClip.srt_content
                ? publishDialogClip.srt_content.replace(/\d+\n[\d:,\s->]+\n/g, "").replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim()
                : undefined
            }
            open={!!publishDialogClip}
            onOpenChange={(open) => {
              if (!open) setPublishDialogClip(null);
            }}
            onPublished={() => {
              setClips((prev) =>
                prev.map((c) =>
                  c.id === publishDialogClip.id
                    ? { ...c, postiz_status: "sent" as const }
                    : c
                )
              );
            }}
          />
        )}

        <ImageBulkPublishDialog
          open={bulkImageDialogOpen}
          onOpenChange={setBulkImageDialogOpen}
          images={orderedSelectedImages}
          onPublished={() => {
            setSelectedImageIds(new Set());
          }}
        />

        {/* Confirm Dialog */}
        <ConfirmDialog
          open={confirmDialog.open}
          onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          variant={confirmDialog.variant}
          onConfirm={confirmDialog.onConfirm}
          loading={confirmDialog.loading}
        />

        {/* Script Dialog */}
        <Dialog open={!!scriptDialogClip} onOpenChange={(open) => { if (!open) setScriptDialogClip(null); }}>
          <DialogContent className="max-w-lg max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Script — {scriptDialogClip?.variant_name || `Variant ${(scriptDialogClip?.variant_index ?? 0) + 1}`}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">{scriptDialogClip?.project_name}</p>
            </DialogHeader>
            <div className="overflow-y-auto max-h-[60vh] p-4 bg-muted/30 rounded-lg border">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {scriptDialogClip?.tts_text || "No script available"}
              </p>
            </div>
            {scriptDialogClip?.tts_text && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  navigator.clipboard.writeText(scriptDialogClip.tts_text!);
                  toast.success("Script copied to clipboard");
                }}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy script
              </Button>
            )}
          </DialogContent>
        </Dialog>

        {/* Caption Dialog */}
        <Dialog open={!!captionDialogClip} onOpenChange={(open) => { if (!open) setCaptionDialogClip(null); }}>
          <DialogContent className="max-w-lg max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-500" />
                Caption — {captionDialogClip?.variant_name || `Variant ${(captionDialogClip?.variant_index ?? 0) + 1}`}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">{captionDialogClip?.project_name}</p>
            </DialogHeader>
            <div className="overflow-y-auto max-h-[60vh] p-4 bg-muted/30 rounded-lg border">
              <p className="text-sm leading-relaxed">
                {captionDialogClip?.srt_content
                  ? captionDialogClip.srt_content.replace(/\d+\n[\d:,\s->]+\n/g, "").replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim()
                  : "No caption available"}
              </p>
            </div>
            {captionDialogClip?.srt_content && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  const cleanCaption = captionDialogClip.srt_content!.replace(/\d+\n[\d:,\s->]+\n/g, "").replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
                  navigator.clipboard.writeText(cleanCaption);
                  toast.success("Caption copied to clipboard");
                }}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy caption
              </Button>
            )}
          </DialogContent>
        </Dialog>

        {/* Inline Video Player */}
        {playingClip && (
          <InlineVideoPlayer
            open={!!playingClip}
            onOpenChange={(open) => { if (!open) setPlayingClip(null); }}
            videoUrl={`${API_URL}/library/files/${encodeURIComponent(playingClip.final_video_path || playingClip.raw_video_path)}?v=${playingClip.id}${playingClip._videoVersion ? `&t=${playingClip._videoVersion}` : ''}`}
            title={playingClip.variant_name || `Variant ${playingClip.variant_index}`}
            videoRef={videoRef}
            scriptText={playingClip.tts_text}
            qcVerified={playingClip.qc_verified}
            onToggleQc={() => {
              toggleQcVerified(playingClip.id);
              // Update playingClip locally so checkbox reflects immediately
              setPlayingClip((prev) => prev ? { ...prev, qc_verified: !prev.qc_verified } : null);
            }}
            hasVoiceover={playingClip.has_voiceover}
            onRegenerateVoiceover={() => regenerateVoiceover(playingClip.id)}
            regeneratingVoiceover={regeneratingVoiceoverId === playingClip.id}
          />
        )}

        {/* Sticky bottom action bar - appears when clips are selected */}
        {viewMode === "library" && selectedClipIds.size > 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-[0_-4px_20px_rgba(0,0,0,0.15)]">
            <div className="container mx-auto px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CheckSquare className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    {selectedClipIds.size} {selectedClipIds.size === 1 ? "clip selected" : "clips selected"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Deselect
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllVisible}
                    disabled={selectedClipIds.size === filteredClips.length}
                  >
                    <CheckSquare className="h-4 w-4 mr-2" />
                    Select all ({filteredClips.length})
                  </Button>
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    onClick={openBulkUploadConfirm}
                    disabled={bulkDeleting || bulkUploading || !postizStatus?.connected}
                    title={postizStatus?.connected ? `Send to ${postizStatus.api_url?.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : "Postiz not configured — configure in Settings"}
                  >
                    {bulkUploading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4 mr-2" />
                    )}
                    Send to Postiz
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
                    onClick={() => setBulkScheduleOpen(true)}
                    disabled={bulkDeleting || bulkUploading}
                    title="Schedule selected clips in cascade (1 post/day)"
                  >
                    <CalendarClock className="h-4 w-4 mr-2" />
                    Schedule
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={openBulkDeleteConfirm}
                    disabled={bulkDeleting || bulkUploading}
                  >
                    {bulkDeleting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Delete selected
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "images" && selectedImageIds.size > 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-[0_-4px_20px_rgba(0,0,0,0.15)]">
            <div className="container mx-auto px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CheckSquare className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    {selectedImageIds.size} {selectedImageIds.size === 1 ? "image selected" : "images selected"}
                  </span>
                  <Button variant="ghost" size="sm" onClick={clearImageSelection}>
                    <XCircle className="h-4 w-4 mr-1" />
                    Deselect
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllImages}
                    disabled={selectedImageIds.size === generatedImages.length}
                  >
                    <CheckSquare className="h-4 w-4 mr-2" />
                    Select all ({generatedImages.length})
                  </Button>
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    onClick={() => setBulkImageDialogOpen(true)}
                    disabled={bulkDeletingImages || !postizStatus?.connected}
                  >
                    <Share2 className="h-4 w-4 mr-2" />
                    Send to Social
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
                    onClick={() => setBulkImageDialogOpen(true)}
                    disabled={bulkDeletingImages || !postizStatus?.connected}
                  >
                    <CalendarClock className="h-4 w-4 mr-2" />
                    Schedule
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={openBulkDeleteImagesConfirm}
                    disabled={bulkDeletingImages}
                  >
                    {bulkDeletingImages ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Delete selected
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Schedule Dialog */}
        <BulkScheduleDialog
          open={bulkScheduleOpen}
          onOpenChange={setBulkScheduleOpen}
          clips={orderedSelectedClips}
          onScheduled={() => {
            setSelectedClipIds(new Set());
          }}
        />
      </main>
    </div>
  );
}

export default function LibrariePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    }>
      <LibrarieContent />
    </Suspense>
  );
}
