"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { apiGetWithRetry, apiPost, apiPut, apiDelete, API_URL } from "@/lib/api";
import { toast } from "sonner";
import { useProfile } from "@/contexts/profile-context";
import { TTSAsset, ELEVENLABS_MODELS } from "@/types/video-processing";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Pause,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  FileText,
  Copy,
  Check,
  Loader2,
  Clock,
  Music,
  ChevronDown,
  ChevronUp,
  Package,
  AlertTriangle,
} from "lucide-react";
import { AudioWaveform } from "@/components/audio-waveform";

const BASE_URL = API_URL.replace(/\/api\/v1$/, "");

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface TTSBatch {
  id: string;
  label: string;
  assets: TTSAsset[];
}

/** Group assets created within 2 minutes of each other into batches */
function groupIntoBatches(assets: TTSAsset[]): TTSBatch[] {
  if (assets.length === 0) return [];

  // Sort by created_at descending (newest first)
  const sorted = [...assets].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const batches: TTSBatch[] = [];
  let currentBatch: TTSAsset[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].created_at).getTime();
    const curr = new Date(sorted[i].created_at).getTime();
    // Within 2 minutes = same batch
    if (prev - curr < 2 * 60 * 1000) {
      currentBatch.push(sorted[i]);
    } else {
      batches.push(makeBatch(currentBatch));
      currentBatch = [sorted[i]];
    }
  }
  batches.push(makeBatch(currentBatch));
  return batches;
}

function makeBatch(assets: TTSAsset[]): TTSBatch {
  const date = formatDate(assets[0].created_at);
  const totalDuration = assets.reduce((sum, a) => sum + a.audio_duration, 0);
  return {
    id: assets.map((a) => a.id).join("-"),
    label:
      assets.length > 1
        ? `${assets.length} assets \u00B7 ${formatDuration(totalDuration)} total \u00B7 ${date}`
        : date,
    assets,
  };
}

export default function TTSLibraryPage() {
  const { currentProfile } = useProfile();
  const [assets, setAssets] = useState<TTSAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<TTSAsset | null>(null);
  const [srtViewAsset, setSrtViewAsset] = useState<TTSAsset | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TTSAsset | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Create form state
  const [createText, setCreateText] = useState("");
  const [createModel, setCreateModel] = useState("eleven_flash_v2_5");
  const [creating, setCreating] = useState(false);

  // Edit form state
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  // SRT copy state
  const [copied, setCopied] = useState(false);

  // Cleanup state
  const [cleanupConfirm, setCleanupConfirm] = useState<"failed" | "duplicates" | null>(null);
  const [cleaning, setCleaning] = useState(false);

  // Expanded text tracking
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Collapsed batch tracking
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBatchCollapse(batchId: string) {
    setCollapsedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  const fetchAssets = useCallback(async () => {
    try {
      const res = await apiGetWithRetry("/tts-library/");
      const data: TTSAsset[] = await res.json();
      setAssets(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (currentProfile) fetchAssets();
  }, [currentProfile, fetchAssets]);

  // Poll when generating
  useEffect(() => {
    const hasGenerating = assets.some((a) => a.status === "generating");
    if (!hasGenerating) return;
    const interval = setInterval(async () => {
      try {
        await fetchAssets();
      } catch (err) {
        // Bug #79: don't let fetch errors stop the polling interval
        console.warn("Failed to refresh TTS assets:", err);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [assets, fetchAssets]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  function togglePlay(asset: TTSAsset) {
    if (!asset.mp3_url) return;

    if (playingId === asset.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(BASE_URL + asset.mp3_url);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    audio.play().catch(() => setPlayingId(null)); // Bug #58
    audioRef.current = audio;
    setPlayingId(asset.id);
  }

  function seekAudio(asset: TTSAsset, time: number) {
    if (!asset.mp3_url) return;

    // If not already playing this asset, start it
    if (playingId !== asset.id) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(BASE_URL + asset.mp3_url);
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => setPlayingId(null);
      audio.currentTime = time;
      audio.play().catch(() => setPlayingId(null)); // Bug #58
      audioRef.current = audio;
      setPlayingId(asset.id);
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => {}); // Bug #58
      }
    }
  }

  async function handleCreate() {
    if (!createText.trim()) return;
    setCreating(true);
    try {
      const res = await apiPost("/tts-library/", {
        tts_text: createText.trim(),
        tts_model: createModel,
      });
      const newAsset: TTSAsset = await res.json();
      setAssets((prev) => [newAsset, ...prev]);
      setCreateOpen(false);
      setCreateText("");
      setCreateModel("eleven_flash_v2_5");
    } catch (err) {
      toast.error("Failed to create TTS asset"); // Bug #59
    } finally {
      setCreating(false);
    }
  }

  async function handleEdit() {
    if (!editingAsset || !editText.trim()) return;
    setSaving(true);
    try {
      const res = await apiPut(`/tts-library/${editingAsset.id}`, {
        tts_text: editText.trim(),
      });
      const updated: TTSAsset = await res.json();
      setAssets((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a))
      );
      setEditingAsset(null);
    } catch {
      toast.error("Failed to update TTS asset"); // Bug #59
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    const id = deleteConfirm.id;
    try {
      await apiDelete(`/tts-library/${id}`);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      if (playingId === id) {
        audioRef.current?.pause();
        setPlayingId(null);
      }
    } catch {
      toast.error("Failed to delete TTS asset"); // Bug #129
    }
    setDeleteConfirm(null);
  }

  // Compute failed and duplicate IDs
  const failedAssets = assets.filter((a) => a.status === "failed");

  const duplicateIds = (() => {
    const textMap = new Map<string, TTSAsset[]>();
    for (const a of assets) {
      const key = a.tts_text.trim();
      if (!key) continue;
      const group = textMap.get(key) || [];
      group.push(a);
      textMap.set(key, group);
    }
    const ids = new Set<string>();
    for (const group of textMap.values()) {
      if (group.length <= 1) continue;
      // Sort: prefer ready over others, then newest first
      const sorted = [...group].sort((a, b) => {
        if (a.status === "ready" && b.status !== "ready") return -1;
        if (b.status === "ready" && a.status !== "ready") return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      // Mark all except the first (best) as duplicates
      for (let i = 1; i < sorted.length; i++) {
        ids.add(sorted[i].id);
      }
    }
    return ids;
  })();

  async function handleCleanup(type: "failed" | "duplicates") {
    const idsToDelete =
      type === "failed"
        ? failedAssets.map((a) => a.id)
        : Array.from(duplicateIds);

    if (idsToDelete.length === 0) return;
    setCleaning(true);
    try {
      await apiPost("/tts-library/batch-delete", { ids: idsToDelete });
      setAssets((prev) => prev.filter((a) => !idsToDelete.includes(a.id)));
      // Stop playback if deleted
      if (playingId && idsToDelete.includes(playingId)) {
        audioRef.current?.pause();
        setPlayingId(null);
      }
    } catch {
      // silent
    } finally {
      setCleaning(false);
      setCleanupConfirm(null);
    }
  }

  function openEdit(asset: TTSAsset) {
    setEditText(asset.tts_text);
    setEditingAsset(asset);
  }

  async function copySrt(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "generating":
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="size-3 animate-spin" />
            Generating
          </Badge>
        );
      case "ready":
        return <Badge className="bg-green-600 hover:bg-green-700">Ready</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const modelName = (modelId: string) =>
    ELEVENLABS_MODELS.find((m) => m.id === modelId)?.name ?? modelId;

  return (
    <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">TTS Library</h1>
          <Badge variant="outline">{assets.length} assets</Badge>
        </div>
        <div className="flex items-center gap-2">
          {failedAssets.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setCleanupConfirm("failed")}
            >
              <AlertTriangle className="size-4 mr-1" />
              Delete Failed ({failedAssets.length})
            </Button>
          )}
          {duplicateIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-orange-600 hover:text-orange-700"
              onClick={() => setCleanupConfirm("duplicates")}
            >
              <Copy className="size-4 mr-1" />
              Delete Duplicates ({duplicateIds.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={fetchAssets}>
            <RefreshCw className="size-4 mr-1" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1" />
            New TTS
          </Button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && assets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Music className="size-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">No TTS assets yet</p>
          <p className="text-sm mt-1">Create one or run a pipeline to auto-generate voiceovers.</p>
        </div>
      )}

      {/* Batched Grid */}
      {!loading && assets.length > 0 && (
        <div className="space-y-6">
          {groupIntoBatches(assets).map((batch) => {
            const isBatch = batch.assets.length > 1;
            const isCollapsed = collapsedBatches.has(batch.id);

            return (
              <div key={batch.id}>
                {/* Batch header - only show for multi-asset batches */}
                {isBatch && (
                  <button
                    onClick={() => toggleBatchCollapse(batch.id)}
                    className="flex items-center gap-2 mb-3 w-full text-left group"
                  >
                    <Package className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">
                      Batch: {batch.label}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                    {isCollapsed ? (
                      <ChevronDown className="size-4 text-muted-foreground group-hover:text-foreground" />
                    ) : (
                      <ChevronUp className="size-4 text-muted-foreground group-hover:text-foreground" />
                    )}
                  </button>
                )}

                {/* Assets grid */}
                {!isCollapsed && (
                  <div className={`grid gap-4 ${isBatch ? "md:grid-cols-2 lg:grid-cols-3 pl-6 border-l-2 border-border" : "md:grid-cols-2 lg:grid-cols-3"}`}>
                    {batch.assets.map((asset) => {
                      const isExpanded = expandedIds.has(asset.id);
                      const isLong = asset.tts_text.length > 150;

                      return (
                        <Card key={asset.id} className="relative">
                          <CardContent className="p-4 space-y-3">
                            {/* Top row: badges */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {statusBadge(asset.status)}
                              {duplicateIds.has(asset.id) && (
                                <Badge variant="outline" className="text-orange-600 border-orange-300">
                                  Duplicate
                                </Badge>
                              )}
                              {asset.is_used && (
                                <Badge variant="outline" className="text-blue-600 border-blue-300">
                                  In Use
                                </Badge>
                              )}
                              {asset.audio_duration > 0 && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="size-3" />
                                  {formatDuration(asset.audio_duration)}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground ml-auto">
                                {modelName(asset.tts_model)}
                              </span>
                            </div>

                            {/* Full text - expandable */}
                            <div>
                              <p className={`text-sm whitespace-pre-wrap ${!isExpanded && isLong ? "line-clamp-3" : ""}`}>
                                {asset.tts_text}
                              </p>
                              {isLong && (
                                <button
                                  onClick={() => toggleExpanded(asset.id)}
                                  className="text-xs text-primary hover:underline mt-1"
                                >
                                  {isExpanded ? "Show less" : "Show more..."}
                                </button>
                              )}
                            </div>

                            {/* Meta row */}
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{asset.char_count} chars</span>
                              <span>{formatDate(asset.created_at)}</span>
                            </div>

                            {/* Waveform */}
                            {asset.status === "ready" && asset.mp3_url && (
                              <AudioWaveform
                                audioUrl={BASE_URL + asset.mp3_url}
                                isPlaying={playingId === asset.id}
                                audioDuration={asset.audio_duration}
                                audioElement={playingId === asset.id ? audioRef.current : null}
                                onSeek={(time) => seekAudio(asset, time)}
                                height={48}
                              />
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-1 pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={asset.status !== "ready" || !asset.mp3_url}
                                onClick={() => togglePlay(asset)}
                              >
                                {playingId === asset.id ? (
                                  <Pause className="size-4" />
                                ) : (
                                  <Play className="size-4" />
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!asset.srt_content}
                                onClick={() => setSrtViewAsset(asset)}
                              >
                                <FileText className="size-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEdit(asset)}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="ml-auto text-destructive hover:text-destructive"
                                onClick={() => setDeleteConfirm(asset)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Collapsed summary */}
                {isBatch && isCollapsed && (
                  <div className="pl-6 border-l-2 border-border">
                    <p className="text-sm text-muted-foreground italic">
                      {batch.assets.length} assets collapsed
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New TTS Asset</DialogTitle>
            <DialogDescription>
              Enter text to generate a voiceover with ElevenLabs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Enter voiceover text..."
              value={createText}
              onChange={(e) => setCreateText(e.target.value)}
              rows={5}
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Model:</span>
              <Select value={createModel} onValueChange={setCreateModel}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ELEVENLABS_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {createText.trim().length} characters
              {createText.trim().length > 0 && (() => {
                const model = ELEVENLABS_MODELS.find((m) => m.id === createModel);
                if (!model) return null;
                const cost = (createText.trim().length / 1000) * model.costPer1kChars;
                return ` ~ $${cost.toFixed(3)} estimated`;
              })()}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !createText.trim()}
            >
              {creating && <Loader2 className="size-4 mr-1 animate-spin" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={!!editingAsset}
        onOpenChange={(open) => !open && setEditingAsset(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit TTS Asset</DialogTitle>
            <DialogDescription>
              Changing the text will regenerate the voiceover.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={5}
          />
          <p className="text-xs text-muted-foreground">
            {editText.trim().length} characters
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAsset(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEdit}
              disabled={saving || !editText.trim()}
            >
              {saving && <Loader2 className="size-4 mr-1 animate-spin" />}
              Save & Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SRT Viewer Dialog */}
      <Dialog
        open={!!srtViewAsset}
        onOpenChange={(open) => !open && setSrtViewAsset(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>SRT Subtitles</DialogTitle>
            <DialogDescription>
              Generated subtitle content for this voiceover.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <pre className="bg-muted rounded-md p-4 text-sm max-h-80 overflow-auto whitespace-pre-wrap">
              {srtViewAsset?.srt_content || "No SRT content available."}
            </pre>
            {srtViewAsset?.srt_content && (
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => copySrt(srtViewAsset.srt_content!)}
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete TTS Asset?</DialogTitle>
            <DialogDescription>
              This will permanently delete the voiceover and its subtitle file.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cleanup Confirmation */}
      <Dialog
        open={!!cleanupConfirm}
        onOpenChange={(open) => !open && setCleanupConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cleanupConfirm === "failed"
                ? `Delete ${failedAssets.length} Failed Asset${failedAssets.length !== 1 ? "s" : ""}?`
                : `Delete ${duplicateIds.size} Duplicate Asset${duplicateIds.size !== 1 ? "s" : ""}?`}
            </DialogTitle>
            <DialogDescription>
              {cleanupConfirm === "failed"
                ? "This will remove all assets that failed to generate. No audio files will be lost."
                : "This will keep the newest ready version of each text and remove older duplicates. Audio files will be deleted from disk."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCleanupConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={cleaning}
              onClick={() => cleanupConfirm && handleCleanup(cleanupConfirm)}
            >
              {cleaning && <Loader2 className="size-4 mr-1 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
