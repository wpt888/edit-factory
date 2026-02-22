"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePolling } from "@/hooks";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiGet, apiGetWithRetry, apiPost, apiPut, apiDelete, API_URL, handleApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  Plus,
  Play,
  Pause,
  Pencil,
  Trash2,
  Download,
  Volume2,
  Loader2,
  AlertCircle,
  FileText,
  Mic,
} from "lucide-react";
import type { TTSAsset } from "@/types/video-processing";
import { ELEVENLABS_MODELS } from "@/types/video-processing";

export default function TTSLibraryPage() {
  const [assets, setAssets] = useState<TTSAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createText, setCreateText] = useState("");
  const [createModel, setCreateModel] = useState("eleven_flash_v2_5");
  const [creating, setCreating] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<TTSAsset | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  // Audio playback
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Track whether any asset is currently generating (to enable polling)
  const hasGenerating = assets.some((a) => a.status === "generating");

  const fetchAssets = useCallback(async () => {
    try {
      const res = await apiGetWithRetry("/tts-library/");
      if (res.ok) {
        const data = await res.json();
        setAssets(data);
        setError(null);
      } else {
        const errData = await res.json().catch(() => ({ detail: "Failed to load assets" }));
        setError(errData.detail || "Failed to load assets");
      }
    } catch (err) {
      setError("Network error. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // Poll for generating assets via usePolling
  const { startPolling: startAssetsPolling, stopPolling: stopAssetsPolling } = usePolling<TTSAsset[]>({
    endpoint: "/tts-library/",
    interval: 2000,
    enabled: false,
    onData: (data) => {
      setAssets(data);
      const stillGenerating = data.some((a) => a.status === "generating");
      if (!stillGenerating) {
        stopAssetsPolling();
      }
    },
    onError: (err) => {
      handleApiError(err, "Eroare la biblioteca TTS");
    },
  });

  // Start/stop polling when generating status changes
  useEffect(() => {
    if (hasGenerating) {
      startAssetsPolling();
    } else {
      stopAssetsPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGenerating]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handleCreate = async () => {
    if (!createText.trim()) return;
    setCreating(true);

    try {
      const res = await apiPost("/tts-library/", {
        tts_text: createText.trim(),
        tts_model: createModel,
      });

      if (res.ok) {
        const newAsset = await res.json();
        setAssets((prev) => [newAsset, ...prev]);
        setCreateOpen(false);
        setCreateText("");
        toast.success("TTS generation started");
      } else {
        const errData = await res.json().catch(() => ({ detail: "Creation failed" }));
        toast.error(errData.detail || "Creation failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async () => {
    if (!editAsset || !editText.trim()) return;
    setSaving(true);

    try {
      const res = await apiPut(`/tts-library/${editAsset.id}`, {
        tts_text: editText.trim(),
      });

      if (res.ok) {
        const updated = await res.json();
        setAssets((prev) =>
          prev.map((a) => (a.id === editAsset.id ? { ...a, ...updated } : a))
        );
        setEditOpen(false);
        setEditAsset(null);
        toast.success("Regeneration started");
      } else {
        const errData = await res.json().catch(() => ({ detail: "Update failed" }));
        toast.error(errData.detail || "Update failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (asset: TTSAsset) => {
    if (!confirm("Delete this TTS asset? Files will be removed permanently.")) return;

    try {
      const res = await apiDelete(`/tts-library/${asset.id}`);
      if (res.ok) {
        // Stop playback if playing this asset
        if (playingId === asset.id) {
          audioRef.current?.pause();
          setPlayingId(null);
        }
        setAssets((prev) => prev.filter((a) => a.id !== asset.id));
        toast.success("Asset deleted");
      } else {
        toast.error("Failed to delete asset");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const openEdit = (asset: TTSAsset) => {
    setEditAsset(asset);
    setEditText(asset.tts_text);
    setEditOpen(true);
  };

  const togglePlay = (asset: TTSAsset) => {
    if (!asset.mp3_url) return;

    if (playingId === asset.id) {
      // Pause
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    // Stop current
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // Build URL — get profile ID from localStorage for header injection
    const profileId =
      typeof window !== "undefined"
        ? localStorage.getItem("editai_current_profile_id")
        : null;

    const audio = new Audio(`${API_URL}${asset.mp3_url.replace("/api/v1", "")}`);
    // We can't set custom headers on Audio element, so the endpoint must work without auth
    // or we need a different approach. Since endpoints require profile context via header,
    // we'll use fetch to get a blob URL instead.
    fetchAudioBlob(asset);
  };

  const fetchAudioBlob = async (asset: TTSAsset) => {
    if (!asset.mp3_url) return;

    try {
      const res = await apiGet(asset.mp3_url.replace("/api/v1", ""), {
        headers: { Accept: "audio/mpeg" } as HeadersInit,
      });

      if (!res.ok) {
        toast.error("Failed to load audio");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(url);
      audio.onended = () => {
        setPlayingId(null);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPlayingId(null);
        URL.revokeObjectURL(url);
        toast.error("Audio playback error");
      };
      audioRef.current = audio;
      audio.play();
      setPlayingId(asset.id);
    } catch {
      toast.error("Failed to load audio");
    }
  };

  const downloadFile = async (url: string, filename: string) => {
    try {
      const res = await apiGet(url.replace("/api/v1", ""));
      if (!res.ok) {
        toast.error("Download failed");
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
      toast.error("Download failed");
    }
  };

  const formatDuration = (seconds: number): string => {
    if (!seconds) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("ro-RO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const getModelLabel = (modelId: string): string => {
    const model = ELEVENLABS_MODELS.find((m) => m.id === modelId);
    return model?.name || modelId;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Volume2 className="h-8 w-8 text-primary" />
              TTS Library
            </h1>
            <p className="text-muted-foreground mt-2">
              Manage your TTS audio assets — edit text and regenerate anytime
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} size="lg">
            <Plus className="h-4 w-4 mr-2" />
            TTS Nou
          </Button>
        </div>

        {/* Error */}
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : assets.length === 0 ? (
          /* Empty state */
          <EmptyState
            icon={<Mic className="h-6 w-6" />}
            title="Niciun fisier audio"
            description="Fisierele TTS generate vor aparea aici."
            action={{ label: "TTS Nou", onClick: () => setCreateOpen(true) }}
          />
        ) : (
          /* Asset grid */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {assets.map((asset) => (
              <Card key={asset.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Status badge */}
                      {asset.status === "generating" && (
                        <Badge variant="secondary" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Generating
                        </Badge>
                      )}
                      {asset.status === "failed" && (
                        <Badge variant="destructive">Failed</Badge>
                      )}
                      {asset.status === "ready" && (
                        <Badge
                          variant={asset.is_used ? "default" : "outline"}
                          className={asset.is_used ? "bg-green-600 hover:bg-green-600" : ""}
                        >
                          {asset.is_used ? "Folosit" : "Nefolosit"}
                        </Badge>
                      )}
                      {/* Model badge */}
                      <Badge variant="outline" className="text-xs">
                        {getModelLabel(asset.tts_model)}
                      </Badge>
                    </div>
                    <CardTitle className="text-sm text-muted-foreground font-normal">
                      {formatDate(asset.created_at)}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Text preview */}
                  <p className="text-sm leading-relaxed line-clamp-3">
                    {asset.tts_text}
                  </p>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{formatDuration(asset.audio_duration)}</span>
                    <span>{asset.char_count} chars</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Play/Pause */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => togglePlay(asset)}
                      disabled={asset.status !== "ready" || !asset.mp3_url}
                    >
                      {playingId === asset.id ? (
                        <>
                          <Pause className="h-3 w-3 mr-1" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3 mr-1" />
                          Play
                        </>
                      )}
                    </Button>

                    {/* Edit */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(asset)}
                      disabled={asset.status === "generating"}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Edit
                    </Button>

                    {/* Download MP3 */}
                    {asset.mp3_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadFile(asset.mp3_url!, `tts-${asset.id.slice(0, 8)}.mp3`)}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        MP3
                      </Button>
                    )}

                    {/* Download SRT */}
                    {asset.srt_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadFile(asset.srt_url!, `tts-${asset.id.slice(0, 8)}.srt`)}
                      >
                        <FileText className="h-3 w-3 mr-1" />
                        SRT
                      </Button>
                    )}

                    {/* Delete */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive ml-auto"
                      onClick={() => handleDelete(asset)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create TTS Asset</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="create-text">Text</Label>
                <Textarea
                  id="create-text"
                  placeholder="Enter the text for TTS generation..."
                  rows={6}
                  value={createText}
                  onChange={(e) => setCreateText(e.target.value)}
                  className="resize-y"
                />
                <p className="text-xs text-muted-foreground text-right">
                  {createText.length} characters
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-model">TTS Model</Label>
                <Select value={createModel} onValueChange={setCreateModel}>
                  <SelectTrigger id="create-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ELEVENLABS_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} — {m.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!createText.trim() || creating}
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit TTS Text</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-text">Text</Label>
                <Textarea
                  id="edit-text"
                  rows={6}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="resize-y"
                />
                <p className="text-xs text-muted-foreground text-right">
                  {editText.length} characters
                </p>
              </div>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Saving will regenerate the MP3 and SRT files automatically.
                </AlertDescription>
              </Alert>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleEdit}
                disabled={!editText.trim() || saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save & Regenerate"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
