"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
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
  FolderOpen,
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
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { apiGet, apiPost, apiPatch, apiDelete, API_URL, handleApiError } from "@/lib/api";
import { toast } from "sonner";
import { useProfile } from "@/contexts/profile-context";
import { EmptyState } from "@/components/empty-state";

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
}


function LibrarieContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentProfile, isLoading: profileLoading } = useProfile();

  // State
  const [clips, setClips] = useState<ClipWithProject[]>([]);
  const [filteredClips, setFilteredClips] = useState<ClipWithProject[]>([]);
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

  // Rename state
  const [renameClipId, setRenameClipId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Audio removal state
  const [removingAudioClipId, setRemovingAudioClipId] = useState<string | null>(null);

  // Delete state
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);

  // Postiz upload state (simplified - just upload, no scheduling)
  const [postizClip, setPostizClip] = useState<ClipWithProject | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Multi-select state
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);

  // Update URL with filters
  const updateURL = useCallback(
    (params: Record<string, string>) => {
      const newParams = new URLSearchParams(searchParams.toString());
      Object.entries(params).forEach(([key, value]) => {
        if (value && value !== "all") {
          newParams.set(key, value);
        } else {
          newParams.delete(key);
        }
      });
      router.push(`/librarie?${newParams.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Fetch all clips
  const fetchAllClips = async () => {
    try {
      setLoading(true);
      const res = await apiGet("/library/all-clips");
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips || []);
      } else if (res.status === 401) {
        // Not authenticated, redirect to login
        window.location.href = "/login";
      }
    } catch (error) {
      handleApiError(error, "Eroare la incarcarea clipurilor");
    } finally {
      setLoading(false);
    }
  };


  // Apply filters
  useEffect(() => {
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

    setFilteredClips(result);
  }, [clips, searchQuery, filterSubtitles, filterVoiceover, filterPostiz]);

  // Initial fetch - profile-aware
  useEffect(() => {
    if (profileLoading) return; // Wait for profile context
    if (!currentProfile) return; // No profile selected
    fetchAllClips();
  }, [profileLoading, currentProfile?.id]);

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

  // Get Postiz status badge
  const getPostizBadge = (clip: ClipWithProject) => {
    const status = clip.postiz_status || "not_sent";
    switch (status) {
      case "sent":
        return {
          color: "bg-green-500 text-white",
          label: "Trimis",
          icon: <CheckCircle2 className="h-3 w-3 mr-1" />,
        };
      case "scheduled":
        return {
          color: "bg-blue-500 text-white",
          label: "Programat",
          icon: <Clock className="h-3 w-3 mr-1" />,
        };
      default:
        return {
          color: "bg-muted text-muted-foreground",
          label: "Netrimis",
          icon: null,
        };
    }
  };

  // Upload to Postiz library (simple upload, no scheduling)
  const uploadToPostiz = async (clip: ClipWithProject) => {
    if (publishing) return;

    setPublishing(true);
    setPostizClip(clip);

    try {
      const videoPath = clip.final_video_path || clip.raw_video_path;

      // Call backend endpoint that handles the upload to Postiz
      const res = await apiPost("/postiz/upload", {
        clip_id: clip.id,
        video_path: videoPath,
      });

      if (res.ok) {
        // Update clip status locally
        setClips((prev) =>
          prev.map((c) =>
            c.id === clip.id ? { ...c, postiz_status: "sent" as const } : c
          )
        );
        toast.success("Video trimis în librăria Postiz!");
      } else {
        const error = await res.json();
        toast.error(`Eroare: ${error.detail || "Upload eșuat"}`);
      }
    } catch (error) {
      handleApiError(error, "Eroare la upload");
    } finally {
      setPublishing(false);
      setPostizClip(null);
    }
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
      const res = await apiPatch(`/library/clips/${clipId}`, { variant_name: newName });
      if (res.ok) {
        setClips((prev) =>
          prev.map((c) =>
            c.id === clipId ? { ...c, variant_name: newName } : c
          )
        );
        setRenameClipId(null);
      } else {
        toast.error("Nu s-a putut redenumi clipul.");
        setRenameClipId(null);
      }
    } catch (error) {
      handleApiError(error, "Eroare la redenumirea clipului");
      setRenameClipId(null);
    }
  };

  // Remove audio from clip
  const removeAudio = async (clip: ClipWithProject) => {
    if (!confirm("Sigur vrei să scoți definitiv sunetul din acest videoclip? Această acțiune nu poate fi anulată.")) {
      return;
    }

    setRemovingAudioClipId(clip.id);
    try {
      const res = await apiPost(`/library/clips/${clip.id}/remove-audio`);

      if (res.ok) {
        const data = await res.json();
        // Update local state
        setClips((prev) =>
          prev.map((c) =>
            c.id === clip.id ? { ...c, has_audio: false, raw_video_path: data.video_path } : c
          )
        );
        toast.success("Sunetul a fost eliminat cu succes!");
      } else {
        const error = await res.json();
        toast.error(`Eroare: ${error.detail || "Nu s-a putut elimina sunetul"}`);
      }
    } catch (error) {
      handleApiError(error, "Eroare la eliminarea sunetului");
    } finally {
      setRemovingAudioClipId(null);
    }
  };

  // Delete clip permanently
  const deleteClip = async (clip: ClipWithProject) => {
    if (!confirm(`Sigur vrei să ștergi definitiv "${clip.variant_name || `Varianta ${clip.variant_index}`}"? Această acțiune nu poate fi anulată.`)) {
      return;
    }

    setDeletingClipId(clip.id);
    try {
      const res = await apiDelete(`/library/clips/${clip.id}`);

      if (res.ok) {
        // Remove from local state
        setClips((prev) => prev.filter((c) => c.id !== clip.id));
        toast.success("Clipul a fost șters cu succes!");
      } else {
        const error = await res.json();
        toast.error(`Eroare: ${error.detail || "Nu s-a putut șterge clipul"}`);
      }
    } catch (error) {
      handleApiError(error, "Eroare la stergerea clipului");
    } finally {
      setDeletingClipId(null);
    }
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

  // Bulk delete selected clips
  const bulkDeleteSelected = async () => {
    if (selectedClipIds.size === 0) return;

    if (!confirm(`Sigur vrei să ștergi definitiv ${selectedClipIds.size} clipuri selectate? Această acțiune nu poate fi anulată.`)) {
      return;
    }

    setBulkDeleting(true);
    try {
      const res = await apiPost("/library/clips/bulk-delete", {
        clip_ids: Array.from(selectedClipIds),
      });

      if (res.ok) {
        const data = await res.json();
        // Remove deleted clips from local state
        setClips((prev) => prev.filter((c) => !selectedClipIds.has(c.id)));
        setSelectedClipIds(new Set());
        toast.success(`${data.deleted_count} clipuri au fost șterse cu succes!${data.failed_count > 0 ? ` ${data.failed_count} au eșuat.` : ""}`);
      } else {
        const error = await res.json();
        toast.error(`Eroare: ${error.detail || "Nu s-au putut șterge clipurile"}`);
      }
    } catch (error) {
      handleApiError(error, "Eroare la stergerea clipurilor");
    } finally {
      setBulkDeleting(false);
    }
  };

  // Download helper for SRT/Audio files
  const downloadFile = async (url: string, filename: string) => {
    try {
      const res = await apiGet(url);
      if (!res.ok) {
        toast.error("Download eșuat");
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Eroare la descărcare");
    }
  };

  // Bulk upload to Postiz
  const bulkUploadToPostiz = async () => {
    if (selectedClipIds.size === 0) return;

    if (!confirm(`Sigur vrei să trimiți ${selectedClipIds.size} clipuri selectate către Postiz?`)) {
      return;
    }

    setBulkUploading(true);
    try {
      // Prepare clips data
      const selectedClips = clips.filter((c) => selectedClipIds.has(c.id));
      const clipsData = selectedClips.map((clip) => ({
        clip_id: clip.id,
        video_path: clip.final_video_path || clip.raw_video_path,
      }));

      const res = await apiPost("/postiz/bulk-upload", {
        clips: clipsData,
      });

      if (res.ok) {
        const data = await res.json();
        // Update postiz_status locally for uploaded clips
        const uploadedIds = new Set(data.uploaded.map((u: { clip_id: string }) => u.clip_id));
        setClips((prev) =>
          prev.map((c) =>
            uploadedIds.has(c.id) ? { ...c, postiz_status: "sent" as const } : c
          )
        );
        setSelectedClipIds(new Set());
        toast.success(`${data.uploaded_count} clipuri au fost trimise către Postiz!${data.failed_count > 0 ? ` ${data.failed_count} au eșuat.` : ""}`);
      } else {
        const error = await res.json();
        toast.error(`Eroare: ${error.detail || "Nu s-au putut trimite clipurile"}`);
      }
    } catch (error) {
      handleApiError(error, "Eroare la trimiterea clipurilor catre Postiz");
    } finally {
      setBulkUploading(false);
    }
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
      <main className="w-full max-w-[1400px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Librărie</h1>
            <p className="text-muted-foreground">
              Toate clipurile exportate din proiecte
            </p>
          </div>
          <Button onClick={fetchAllClips} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-end">
              {/* Search */}
              <div className="flex-1 min-w-[200px]">
                <Label className="text-sm text-muted-foreground mb-2 block">
                  Căutare
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Caută după proiect sau variantă..."
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
                  Subtitrări
                </Label>
                <Select value={filterSubtitles} onValueChange={handleSubtitlesFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toate</SelectItem>
                    <SelectItem value="with">Cu subtitrări</SelectItem>
                    <SelectItem value="without">Fără subtitrări</SelectItem>
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
                    <SelectItem value="all">Toate</SelectItem>
                    <SelectItem value="with">Cu voiceover</SelectItem>
                    <SelectItem value="without">Fără voiceover</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Postiz status filter */}
              <div className="w-[160px]">
                <Label className="text-sm text-muted-foreground mb-2 block">
                  <Share2 className="h-3 w-3 inline mr-1" />
                  Status Postiz
                </Label>
                <Select value={filterPostiz} onValueChange={handlePostizFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toate</SelectItem>
                    <SelectItem value="not_sent">Netrimis</SelectItem>
                    <SelectItem value="scheduled">Programat</SelectItem>
                    <SelectItem value="sent">Trimis</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Filter summary */}
            <div className="mt-4 text-sm text-muted-foreground">
              {filteredClips.length} din {clips.length} clipuri
            </div>
          </CardContent>
        </Card>

        {/* Selection Toolbar - appears when clips are selected */}
        {selectedClipIds.size > 0 && (
          <Card className="mb-6 border-primary bg-primary/5">
            <CardContent className="py-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <CheckSquare className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    {selectedClipIds.size} {selectedClipIds.size === 1 ? "clip selectat" : "clipuri selectate"}
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
                    Selectează toate ({filteredClips.length})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearSelection}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Deselectează
                  </Button>
                  <div className="w-px h-6 bg-border mx-2" />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={bulkDeleteSelected}
                    disabled={bulkDeleting || bulkUploading}
                  >
                    {bulkDeleting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Șterge selectate
                  </Button>
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-none hover:from-pink-600 hover:to-purple-600"
                    onClick={bulkUploadToPostiz}
                    disabled={bulkDeleting || bulkUploading}
                  >
                    {bulkUploading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4 mr-2" />
                    )}
                    Trimite la Postiz
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Clips grid */}
        {(profileLoading || loading) ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : filteredClips.length === 0 ? (
          <EmptyState
            icon={<Film className="h-6 w-6" />}
            title="Nicio editare"
            description={clips.length === 0 ? "Clipurile procesate vor aparea aici." : "Modifica filtrele pentru a vedea clipuri."}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filteredClips.map((clip) => {
              const postizBadge = getPostizBadge(clip);
              return (
                <Card
                  key={clip.id}
                  className={`overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all cursor-pointer ${
                    selectedClipIds.has(clip.id) ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => toggleClipSelection(clip.id)}
                >
                  {/* Thumbnail */}
                  <div className="aspect-[9/16] bg-muted relative group">
                    {clip.thumbnail_path ? (
                      <img
                        src={`${API_URL}/library/files/${encodeURIComponent(clip.thumbnail_path)}?v=${clip.id}`}
                        alt={clip.variant_name || `Variant ${clip.variant_index}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
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
                      />
                    </div>

                    {/* Postiz badge */}
                    <Badge
                      className={`absolute top-2 right-2 ${postizBadge.color}`}
                    >
                      {postizBadge.icon}
                      {postizBadge.label}
                    </Badge>

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
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            const videoPath = clip.final_video_path || clip.raw_video_path;
                            window.open(
                              `${API_URL}/library/files/${encodeURIComponent(videoPath)}?v=${clip.id}`,
                              "_blank"
                            );
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
                            title="Descarcă subtitrări SRT"
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
                            title="Descarcă audio TTS"
                          >
                            <Mic className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-none hover:from-pink-600 hover:to-purple-600"
                          disabled={publishing && postizClip?.id === clip.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            uploadToPostiz(clip);
                          }}
                          title="Trimite în Postiz"
                        >
                          {publishing && postizClip?.id === clip.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Share2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {/* Remove audio button */}
                      <Button
                        size="sm"
                        variant={clip.has_audio === false ? "secondary" : "destructive"}
                        disabled={clip.has_audio === false || removingAudioClipId === clip.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAudio(clip);
                        }}
                        className="text-xs"
                      >
                        {removingAudioClipId === clip.id ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Se procesează...
                          </>
                        ) : clip.has_audio === false ? (
                          <>
                            <VolumeX className="h-3 w-3 mr-1" />
                            Fără sunet
                          </>
                        ) : (
                          <>
                            <VolumeX className="h-3 w-3 mr-1" />
                            Elimină sunetul
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
                          deleteClip(clip);
                        }}
                        className="text-xs"
                        title="Șterge clipul definitiv"
                      >
                        {deletingClipId === clip.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Info with rename */}
                  <CardContent className="p-2">
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
                          {clip.variant_name || `Varianta ${clip.variant_index}`}
                        </p>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 shrink-0 opacity-60 hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameClipId(clip.id);
                            setRenameValue(clip.variant_name || `Varianta ${clip.variant_index}`);
                          }}
                          title="Redenumește"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      {clip.project_name}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
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
