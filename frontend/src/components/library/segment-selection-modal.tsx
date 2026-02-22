"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Video,
  Tag,
  CheckCircle2,
  Scissors,
} from "lucide-react";
import Link from "next/link";
import { VideoSegmentPlayer } from "@/components/video-segment-player";
import { SimpleSegmentPopup } from "@/components/simple-segment-popup";
import { apiFetch, apiPost, API_URL } from "@/lib/api";
import { Project, Segment, SourceVideo } from "./types";

interface SegmentSelectionModalProps {
  open: boolean;
  onClose: () => void;
  selectedProject: Project | null;
  projectSegments: Segment[];
  onSegmentsChange: (segments: Segment[]) => void;
}

// Format time as mm:ss
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function SegmentSelectionModal({
  open,
  onClose,
  selectedProject,
  projectSegments,
  onSegmentsChange,
}: SegmentSelectionModalProps) {
  const [sourceVideos, setSourceVideos] = useState<SourceVideo[]>([]);
  const [selectedSourceVideo, setSelectedSourceVideo] = useState<SourceVideo | null>(null);
  const [modalSegments, setModalSegments] = useState<Segment[]>([]);
  const [pendingSegment, setPendingSegment] = useState<{ start: number; end: number } | null>(null);
  const [showKeywordPopup, setShowKeywordPopup] = useState(false);

  useEffect(() => {
    if (open) {
      fetchSourceVideos();
    }
  }, [open]);

  const fetchSourceVideos = async () => {
    try {
      const res = await apiFetch("/segments/source-videos");
      if (res.ok) {
        const data = await res.json();
        setSourceVideos(data);
      }
    } catch (error) {
      console.error("Failed to fetch source videos:", error);
    }
  };

  const fetchSegmentsForVideo = async (videoId: string) => {
    try {
      const res = await apiFetch(`/segments/source-videos/${videoId}/segments`);
      if (res.ok) {
        const data = await res.json();
        setModalSegments(data);
      }
    } catch (error) {
      console.error("Failed to fetch segments:", error);
    }
  };

  const selectSourceVideo = async (video: SourceVideo) => {
    setSelectedSourceVideo(video);
    await fetchSegmentsForVideo(video.id);
  };

  const handleSegmentCreate = (start: number, end: number) => {
    setPendingSegment({ start, end });
    setShowKeywordPopup(true);
  };

  const handleSaveSegment = async (keywords: string[], notes: string) => {
    if (!selectedSourceVideo || !pendingSegment) return;

    try {
      const res = await apiPost(
        `/segments/source-videos/${selectedSourceVideo.id}/segments`,
        {
          start_time: pendingSegment.start,
          end_time: pendingSegment.end,
          keywords,
          notes,
        }
      );

      if (res.ok) {
        const newSegment = await res.json();
        newSegment.source_video_name = selectedSourceVideo.name;
        setModalSegments((prev) =>
          [...prev, newSegment].sort((a, b) => a.start_time - b.start_time)
        );
        // Update source video segments count
        setSourceVideos((prev) =>
          prev.map((v) =>
            v.id === selectedSourceVideo.id
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

  const addSegmentToProject = (segment: Segment) => {
    if (!projectSegments.find((s) => s.id === segment.id)) {
      onSegmentsChange([...projectSegments, segment]);
    }
  };

  const removeSegmentFromProject = (segmentId: string) => {
    onSegmentsChange(projectSegments.filter((s) => s.id !== segmentId));
  };

  const saveProjectSegments = async () => {
    if (!selectedProject) return;

    try {
      const formData = new FormData();
      projectSegments.forEach((seg) => {
        formData.append("segment_ids", seg.id);
      });

      const res = await apiFetch(
        `/segments/projects/${selectedProject.id}/assign`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (res.ok) {
        onClose();
      }
    } catch (error) {
      console.error("Failed to save project segments:", error);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/80"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative z-10 bg-background border border-border rounded-lg shadow-lg w-[95vw] max-w-[1400px] h-[85vh] mx-4 animate-in fade-in-0 zoom-in-95 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <Scissors className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Selectează Segmente</h2>
              {selectedProject && (
                <Badge variant="outline">{selectedProject.name}</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link href="/segments" target="_blank">
                <Button variant="ghost" size="sm">
                  Deschide Editor Complet
                </Button>
              </Link>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Content - 3 columns */}
          <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
            {/* Left - Source Videos */}
            <div className="col-span-2 flex flex-col overflow-hidden">
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                <Video className="h-4 w-4" />
                Video-uri Sursă
              </h3>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {sourceVideos.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Niciun video.{" "}
                    <Link href="/segments" className="text-primary hover:underline">
                      Încarcă unul
                    </Link>
                  </p>
                ) : (
                  sourceVideos.map((video) => {
                    const videoSegmentsSelected = projectSegments.filter(
                      (s) => s.source_video_id === video.id
                    ).length;
                    const allSelected =
                      video.segments_count > 0 &&
                      videoSegmentsSelected === video.segments_count;
                    const someSelected =
                      videoSegmentsSelected > 0 &&
                      videoSegmentsSelected < video.segments_count;

                    return (
                      <div
                        key={video.id}
                        className={`p-2 rounded transition-colors ${
                          selectedSourceVideo?.id === video.id
                            ? "bg-primary/20 border border-primary/50"
                            : "hover:bg-muted"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {/* Checkbox for bulk selection */}
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected;
                            }}
                            onChange={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await apiFetch(
                                  `/segments/source-videos/${video.id}/segments`
                                );
                                if (res.ok) {
                                  const segments = await res.json();
                                  if (e.target.checked) {
                                    segments.forEach((seg: Segment) => {
                                      if (!projectSegments.find((s) => s.id === seg.id)) {
                                        seg.source_video_name = video.name;
                                        addSegmentToProject(seg);
                                      }
                                    });
                                  } else {
                                    segments.forEach((seg: Segment) => {
                                      removeSegmentFromProject(seg.id);
                                    });
                                  }
                                }
                              } catch (error) {
                                console.error("Failed to fetch segments:", error);
                              }
                            }}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                          />
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => selectSourceVideo(video)}
                          >
                            <p className="text-sm font-medium truncate">{video.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {videoSegmentsSelected > 0 ? (
                                <span className="text-primary">
                                  {videoSegmentsSelected}/{video.segments_count} selectate
                                </span>
                              ) : (
                                <span>{video.segments_count} segmente</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Center - Video Player */}
            <div className="col-span-6 flex flex-col overflow-hidden">
              <h3 className="text-sm font-medium mb-2">
                {selectedSourceVideo ? selectedSourceVideo.name : "Selectează un video"}
              </h3>
              {selectedSourceVideo ? (
                <div className="flex-1 overflow-hidden">
                  <VideoSegmentPlayer
                    videoUrl={`${API_URL}/segments/source-videos/${selectedSourceVideo.id}/stream`}
                    duration={selectedSourceVideo.duration || 0}
                    segments={modalSegments}
                    onSegmentCreate={handleSegmentCreate}
                    onSegmentClick={(seg) => addSegmentToProject(seg as Segment)}
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-muted/50 rounded-lg">
                  <div className="text-center text-muted-foreground">
                    <Video className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Selectează un video din stânga</p>
                  </div>
                </div>
              )}
            </div>

            {/* Right - Segments */}
            <div className="col-span-4 flex flex-col overflow-hidden">
              {/* Available segments */}
              <div className="flex-1 overflow-hidden flex flex-col mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Segmente Disponibile
                    {modalSegments.length > 0 && (
                      <Badge variant="secondary">{modalSegments.length}</Badge>
                    )}
                  </h3>
                  {modalSegments.length > 0 && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        onClick={() => {
                          modalSegments.forEach((seg) => {
                            if (!projectSegments.find((s) => s.id === seg.id)) {
                              addSegmentToProject(seg);
                            }
                          });
                        }}
                      >
                        + Toate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs text-muted-foreground"
                        onClick={() => {
                          modalSegments.forEach((seg) => {
                            removeSegmentFromProject(seg.id);
                          });
                        }}
                      >
                        - Toate
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {modalSegments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {selectedSourceVideo
                        ? "Niciun segment. Apasă C pentru a marca."
                        : "Selectează un video"}
                    </p>
                  ) : (
                    modalSegments.map((segment) => {
                      const isSelected = projectSegments.some((s) => s.id === segment.id);
                      return (
                        <div
                          key={segment.id}
                          className={`p-2 rounded-lg border transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs">
                              {formatTime(segment.start_time)} - {formatTime(segment.end_time)}
                            </span>
                            <Button
                              size="sm"
                              variant={isSelected ? "destructive" : "default"}
                              className="h-6 text-xs"
                              onClick={() =>
                                isSelected
                                  ? removeSegmentFromProject(segment.id)
                                  : addSegmentToProject(segment)
                              }
                            >
                              {isSelected ? "Elimină" : "Adaugă"}
                            </Button>
                          </div>
                          {segment.keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {segment.keywords.map((kw) => (
                                <Badge key={kw} variant="secondary" className="text-xs">
                                  {kw}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Selected for project */}
              <div className="border-t pt-4">
                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Selectate pentru Proiect
                  <Badge variant="default">{projectSegments.length}</Badge>
                </h3>
                <div className="max-h-32 overflow-y-auto space-y-1 pr-1 mb-3">
                  {projectSegments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Click pe &quot;Adaugă&quot; pentru a selecta segmente
                    </p>
                  ) : (
                    projectSegments.map((segment) => (
                      <div
                        key={segment.id}
                        className="flex items-center justify-between p-1 rounded bg-muted/50"
                      >
                        <span className="text-xs">
                          {segment.source_video_name} • {formatTime(segment.start_time)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 w-5 p-0"
                          onClick={() => removeSegmentFromProject(segment.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                <Button
                  onClick={saveProjectSegments}
                  disabled={projectSegments.length === 0}
                  variant="default"
                  className="w-full"
                >
                  Salvează Selecția ({projectSegments.length} segmente)
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyword popup for new segments */}
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
    </>
  );
}
