"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// Config persistence key
const CONFIG_KEY = "editai_library_config";

// Helper to load config from localStorage
const loadConfig = () => {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

// Helper to save config to localStorage
const saveConfig = (config: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  try {
    const existing = loadConfig() || {};
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...existing, ...config }));
  } catch {
    // Ignore errors
  }
};
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FolderOpen,
  Plus,
  Trash2,
  Check,
  X,
  Play,
  Download,
  RefreshCw,
  Film,
  Mic,
  Type,
  Settings,
  ChevronLeft,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Instagram,
  Youtube,
  DollarSign,
} from "lucide-react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// Types
interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  target_duration: number;
  context_text?: string;
  variants_count: number;
  selected_count: number;
  exported_count: number;
  created_at: string;
}

interface Clip {
  id: string;
  project_id: string;
  variant_index: number;
  variant_name?: string;
  raw_video_path: string;
  thumbnail_path?: string;
  duration?: number;
  is_selected: boolean;
  is_deleted: boolean;
  final_video_path?: string;
  final_status: string;
  created_at: string;
}

interface ClipContent {
  id?: string;
  clip_id: string;
  tts_text?: string;
  srt_content?: string;
  subtitle_settings?: SubtitleSettings;
}

interface SubtitleSettings {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
  positionY: number;
}

interface ExportPreset {
  id: string;
  name: string;
  display_name: string;
  width: number;
  height: number;
  fps: number;
  video_bitrate: string;
  crf: number;
  audio_bitrate: string;
  is_default: boolean;
}

export default function LibraryPage() {
  // State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [clipContent, setClipContent] = useState<ClipContent | null>(null);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("instagram_reels");

  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [rendering, setRendering] = useState(false);

  // New project form
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newProjectDuration, setNewProjectDuration] = useState(20);
  const [newProjectContext, setNewProjectContext] = useState("");

  // Video upload for generation
  const [uploadVideo, setUploadVideo] = useState<File | null>(null);
  const [localVideoPath, setLocalVideoPath] = useState(""); // For testing with local paths
  const [variantCount, setVariantCount] = useState(3);

  // Content editing
  const [editingTtsText, setEditingTtsText] = useState("");
  const [editingSrtContent, setEditingSrtContent] = useState("");
  const [editingSubtitleSettings, setEditingSubtitleSettings] = useState<SubtitleSettings>({
    fontSize: 48,
    fontFamily: "Montserrat",
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 3,
    positionY: 85,
  });

  // Track if initial load is done
  const configLoaded = useRef(false);

  // Load saved config on mount
  useEffect(() => {
    const config = loadConfig();
    if (config) {
      // Project form
      if (config.newProjectName) setNewProjectName(config.newProjectName);
      if (config.newProjectDescription) setNewProjectDescription(config.newProjectDescription);
      if (config.newProjectDuration) setNewProjectDuration(config.newProjectDuration);
      if (config.newProjectContext) setNewProjectContext(config.newProjectContext);

      // Generation settings
      if (config.variantCount) setVariantCount(config.variantCount);
      if (config.selectedPreset) setSelectedPreset(config.selectedPreset);
      if (config.localVideoPath) setLocalVideoPath(config.localVideoPath);

      // TTS & Subtitle defaults
      if (config.editingTtsText) setEditingTtsText(config.editingTtsText);
      if (config.editingSrtContent) setEditingSrtContent(config.editingSrtContent);
      if (config.editingSubtitleSettings) setEditingSubtitleSettings(config.editingSubtitleSettings);
    }
    configLoaded.current = true;
  }, []);

  // Auto-save config when values change
  useEffect(() => {
    if (!configLoaded.current) return;
    saveConfig({
      newProjectName,
      newProjectDescription,
      newProjectDuration,
      newProjectContext,
      variantCount,
      selectedPreset,
      localVideoPath,
      editingTtsText,
      editingSrtContent,
      editingSubtitleSettings,
    });
  }, [
    newProjectName,
    newProjectDescription,
    newProjectDuration,
    newProjectContext,
    variantCount,
    selectedPreset,
    localVideoPath,
    editingTtsText,
    editingSrtContent,
    editingSubtitleSettings,
  ]);

  // Load projects on mount
  useEffect(() => {
    fetchProjects();
    fetchPresets();
  }, []);

  // Fetch projects
  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_URL}/library/projects`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      console.error("Failed to fetch projects:", error);
    }
  };

  // Fetch export presets
  const fetchPresets = async () => {
    try {
      const res = await fetch(`${API_URL}/library/export-presets`);
      if (res.ok) {
        const data = await res.json();
        setPresets(data.presets || []);
        const defaultPreset = data.presets?.find((p: ExportPreset) => p.is_default);
        if (defaultPreset) {
          setSelectedPreset(defaultPreset.name);
        }
      }
    } catch (error) {
      console.error("Failed to fetch presets:", error);
    }
  };

  // Fetch clips for project
  const fetchClips = async (projectId: string) => {
    try {
      const res = await fetch(`${API_URL}/library/projects/${projectId}/clips`);
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips || []);
      }
    } catch (error) {
      console.error("Failed to fetch clips:", error);
    }
  };

  // Fetch clip content
  const fetchClipContent = async (clipId: string) => {
    try {
      const res = await fetch(`${API_URL}/library/clips/${clipId}`);
      if (res.ok) {
        const data = await res.json();
        setClipContent(data.content);
        if (data.content) {
          setEditingTtsText(data.content.tts_text || "");
          setEditingSrtContent(data.content.srt_content || "");
          if (data.content.subtitle_settings) {
            setEditingSubtitleSettings(data.content.subtitle_settings);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch clip content:", error);
    }
  };

  // Create new project
  const createProject = async () => {
    if (!newProjectName.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/library/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProjectName,
          description: newProjectDescription,
          target_duration: newProjectDuration,
          context_text: newProjectContext,
        }),
      });

      if (res.ok) {
        const project = await res.json();
        setProjects([project, ...projects]);
        setSelectedProject(project);
        setShowNewProject(false);
        setNewProjectName("");
        setNewProjectDescription("");
        setNewProjectContext("");
      }
    } catch (error) {
      console.error("Failed to create project:", error);
    } finally {
      setLoading(false);
    }
  };

  // Delete project
  const deleteProject = async (projectId: string) => {
    if (!confirm("Sigur vrei să ștergi acest proiect și toate clipurile asociate?")) return;

    try {
      const res = await fetch(`${API_URL}/library/projects/${projectId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setProjects(projects.filter((p) => p.id !== projectId));
        if (selectedProject?.id === projectId) {
          setSelectedProject(null);
          setClips([]);
        }
      }
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  };

  // Generate raw clips
  const generateRawClips = async () => {
    if (!selectedProject || (!uploadVideo && !localVideoPath)) return;

    setGenerating(true);
    try {
      const formData = new FormData();

      // Use uploaded file OR local path
      if (uploadVideo) {
        formData.append("video", uploadVideo);
      } else if (localVideoPath) {
        formData.append("video_path", localVideoPath);
      }

      formData.append("variant_count", variantCount.toString());

      const res = await fetch(`${API_URL}/library/projects/${selectedProject.id}/generate`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        // Poll for completion
        pollProjectStatus(selectedProject.id);
      }
    } catch (error) {
      console.error("Failed to generate clips:", error);
      setGenerating(false);
    }
  };

  // Poll project status
  const pollProjectStatus = async (projectId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/library/projects/${projectId}`);
        if (res.ok) {
          const project = await res.json();
          setSelectedProject(project);

          if (project.status === "ready_for_triage" || project.status === "failed") {
            clearInterval(interval);
            setGenerating(false);
            if (project.status === "ready_for_triage") {
              fetchClips(projectId);
            }
          }
        }
      } catch (error) {
        console.error("Failed to poll project status:", error);
      }
    }, 2000);
  };

  // Toggle clip selection
  const toggleClipSelection = async (clipId: string, selected: boolean) => {
    try {
      const res = await fetch(`${API_URL}/library/clips/${clipId}/select?selected=${selected}`, {
        method: "PATCH",
      });

      if (res.ok) {
        setClips(clips.map((c) =>
          c.id === clipId ? { ...c, is_selected: selected } : c
        ));
        // Refresh project counts
        if (selectedProject) {
          const projectRes = await fetch(`${API_URL}/library/projects/${selectedProject.id}`);
          if (projectRes.ok) {
            setSelectedProject(await projectRes.json());
          }
        }
      }
    } catch (error) {
      console.error("Failed to toggle selection:", error);
    }
  };

  // Delete clip
  const deleteClip = async (clipId: string) => {
    try {
      const res = await fetch(`${API_URL}/library/clips/${clipId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setClips(clips.filter((c) => c.id !== clipId));
        if (selectedClip?.id === clipId) {
          setSelectedClip(null);
        }
      }
    } catch (error) {
      console.error("Failed to delete clip:", error);
    }
  };

  // Save clip content
  const saveClipContent = async () => {
    if (!selectedClip) return;

    try {
      const res = await fetch(`${API_URL}/library/clips/${selectedClip.id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tts_text: editingTtsText,
          srt_content: editingSrtContent,
          subtitle_settings: editingSubtitleSettings,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setClipContent(data.content);
      }
    } catch (error) {
      console.error("Failed to save clip content:", error);
    }
  };

  // Render final clip
  const renderFinalClip = async (clipId: string) => {
    setRendering(true);
    try {
      const formData = new FormData();
      formData.append("preset_name", selectedPreset);

      const res = await fetch(`${API_URL}/library/clips/${clipId}/render`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        // Poll for completion
        pollClipStatus(clipId);
      }
    } catch (error) {
      console.error("Failed to render clip:", error);
      setRendering(false);
    }
  };

  // Render all selected clips
  const renderAllSelected = async () => {
    const selectedClips = clips.filter((c) => c.is_selected);
    if (selectedClips.length === 0) return;

    setRendering(true);
    try {
      const res = await fetch(`${API_URL}/library/clips/bulk-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_ids: selectedClips.map((c) => c.id),
          preset_name: selectedPreset,
        }),
      });

      if (res.ok) {
        // Start polling for each clip
        selectedClips.forEach((clip) => pollClipStatus(clip.id));
      }
    } catch (error) {
      console.error("Failed to render clips:", error);
      setRendering(false);
    }
  };

  // Poll clip status
  const pollClipStatus = async (clipId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/library/clips/${clipId}`);
        if (res.ok) {
          const data = await res.json();
          setClips((prevClips) =>
            prevClips.map((c) => (c.id === clipId ? data.clip : c))
          );

          if (data.clip.final_status === "completed" || data.clip.final_status === "failed") {
            clearInterval(interval);
            setRendering(false);
          }
        }
      } catch (error) {
        console.error("Failed to poll clip status:", error);
      }
    }, 2000);
  };

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "processing":
        return "bg-blue-500";
      case "failed":
        return "bg-red-500";
      case "pending":
        return "bg-gray-500";
      default:
        return "bg-gray-500";
    }
  };

  // Get preset icon
  const getPresetIcon = (name: string) => {
    if (name.includes("instagram")) return <Instagram className="h-4 w-4" />;
    if (name.includes("youtube")) return <Youtube className="h-4 w-4" />;
    if (name.includes("tiktok")) return <Film className="h-4 w-4" />;
    return <Film className="h-4 w-4" />;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left sidebar - Projects */}
          <div className="col-span-3">
            <Card className="bg-card border-border">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <FolderOpen className="h-5 w-5" />
                    Proiecte
                  </CardTitle>
                  <Button size="sm" onClick={() => setShowNewProject(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Nou
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[calc(100vh-250px)] overflow-y-auto">
                {projects.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-4">
                    Niciun proiect. Creează unul nou!
                  </p>
                ) : (
                  projects.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => {
                        setSelectedProject(project);
                        fetchClips(project.id);
                        setSelectedClip(null);
                      }}
                      className={`p-3 rounded-lg cursor-pointer transition-all ${
                        selectedProject?.id === project.id
                          ? "bg-primary/20 border border-primary"
                          : "bg-muted/50 hover:bg-accent border border-transparent"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-foreground font-medium truncate">
                          {project.name}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteProject(project.id);
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-xs">
                          {project.variants_count} clipuri
                        </Badge>
                        <Badge variant="outline" className="text-xs text-green-500">
                          {project.selected_count} selectate
                        </Badge>
                      </div>
                      <Badge
                        className={`mt-2 text-xs ${
                          project.status === "ready_for_triage"
                            ? "bg-green-500"
                            : project.status === "generating"
                            ? "bg-blue-500"
                            : "bg-muted"
                        }`}
                      >
                        {project.status}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Main content - Clips gallery */}
          <div className="col-span-6">
            {selectedProject ? (
              <Card className="bg-card border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-foreground">
                      {selectedProject.name}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                        <SelectTrigger className="w-[200px] bg-muted/50">
                          <SelectValue placeholder="Export Preset" />
                        </SelectTrigger>
                        <SelectContent>
                          {presets.map((preset) => (
                            <SelectItem key={preset.id} value={preset.name}>
                              <div className="flex items-center gap-2">
                                {getPresetIcon(preset.name)}
                                {preset.display_name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={renderAllSelected}
                        disabled={rendering || clips.filter((c) => c.is_selected).length === 0}
                        variant="default"
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {rendering ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Film className="h-4 w-4 mr-2" />
                        )}
                        Randează Selectate ({clips.filter((c) => c.is_selected).length})
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedProject.status === "draft" && (
                    <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                      <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-foreground mb-4">
                        Încarcă un video sursă pentru a genera clipuri
                      </p>
                      <div className="flex flex-col items-center gap-4">
                        {/* File upload option */}
                        <Input
                          type="file"
                          accept="video/*"
                          onChange={(e) => setUploadVideo(e.target.files?.[0] || null)}
                          className="max-w-md bg-muted/50"
                        />

                        {/* OR divider */}
                        <div className="flex items-center gap-4 w-full max-w-md">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-muted-foreground text-sm">SAU</span>
                          <div className="flex-1 h-px bg-border" />
                        </div>

                        {/* Local path option (for testing) */}
                        <div className="w-full max-w-md">
                          <Label className="text-muted-foreground text-xs mb-1 block">
                            Cale video local (pentru teste):
                          </Label>
                          <Input
                            type="text"
                            placeholder="C:\path\to\video.mp4"
                            value={localVideoPath}
                            onChange={(e) => setLocalVideoPath(e.target.value)}
                            className="bg-muted/50 text-sm"
                          />
                        </div>

                        <div className="flex items-center gap-4">
                          <Label className="text-foreground">Variante:</Label>
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={variantCount}
                            onChange={(e) => setVariantCount(parseInt(e.target.value) || 3)}
                            className="w-20 bg-muted/50"
                          />
                        </div>
                        <Button
                          onClick={generateRawClips}
                          disabled={(!uploadVideo && !localVideoPath) || generating}
                        >
                          {generating ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Generare...
                            </>
                          ) : (
                            <>
                              <Film className="h-4 w-4 mr-2" />
                              Generează Clipuri
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {selectedProject.status === "generating" && (
                    <div className="text-center py-12">
                      <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
                      <p className="text-foreground">Se generează clipurile...</p>
                    </div>
                  )}

                  {(selectedProject.status === "ready_for_triage" ||
                    selectedProject.status === "processing_finals" ||
                    selectedProject.status === "completed") && (
                    <div className="grid grid-cols-3 gap-4 max-h-[calc(100vh-350px)] overflow-y-auto">
                      {clips.map((clip) => (
                        <div
                          key={clip.id}
                          onClick={() => {
                            setSelectedClip(clip);
                            fetchClipContent(clip.id);
                          }}
                          className={`relative rounded-lg overflow-hidden cursor-pointer transition-all ${
                            selectedClip?.id === clip.id
                              ? "ring-2 ring-primary"
                              : "hover:ring-1 hover:ring-border"
                          } ${clip.is_selected ? "ring-2 ring-green-500" : ""}`}
                        >
                          {/* Thumbnail or placeholder */}
                          <div className="aspect-[9/16] bg-muted relative">
                            {clip.thumbnail_path ? (
                              <img
                                src={`${API_URL}/files/${encodeURIComponent(clip.thumbnail_path)}`}
                                alt={clip.variant_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Film className="h-12 w-12 text-muted-foreground" />
                              </div>
                            )}

                            {/* Selection checkbox */}
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleClipSelection(clip.id, !clip.is_selected);
                              }}
                              className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer ${
                                clip.is_selected
                                  ? "bg-green-500 text-white"
                                  : "bg-background/80 text-muted-foreground hover:bg-accent"
                              }`}
                            >
                              {clip.is_selected && <Check className="h-4 w-4" />}
                            </div>

                            {/* Status badge */}
                            <Badge
                              className={`absolute top-2 right-2 ${getStatusColor(clip.final_status)}`}
                            >
                              {clip.final_status === "completed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                              {clip.final_status === "processing" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                              {clip.final_status === "failed" && <XCircle className="h-3 w-3 mr-1" />}
                              {clip.final_status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                              {clip.final_status}
                            </Badge>

                            {/* Duration */}
                            {clip.duration && (
                              <span className="absolute bottom-2 right-2 bg-background/80 text-foreground text-xs px-2 py-1 rounded">
                                {Math.floor(clip.duration)}s
                              </span>
                            )}
                          </div>

                          {/* Clip info */}
                          <div className="p-2 bg-card">
                            <p className="text-foreground text-sm truncate">
                              {clip.variant_name || `Varianta ${clip.variant_index}`}
                            </p>
                          </div>

                          {/* Actions overlay */}
                          <div className="absolute inset-0 bg-background/60 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Play video
                              }}
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                            {clip.final_video_path && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(
                                    `${API_URL}/files/${encodeURIComponent(clip.final_video_path || "")}?download=true`,
                                    "_blank"
                                  );
                                }}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteClip(clip.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-card border-border h-full flex items-center justify-center">
                <div className="text-center py-12">
                  <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Selectează un proiect sau creează unul nou</p>
                </div>
              </Card>
            )}
          </div>

          {/* Right sidebar - Clip editor */}
          <div className="col-span-3">
            {selectedClip ? (
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Editare Clip
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Tabs defaultValue="tts">
                    <TabsList className="w-full bg-muted">
                      <TabsTrigger value="tts" className="flex-1">
                        <Mic className="h-4 w-4 mr-1" />
                        TTS
                      </TabsTrigger>
                      <TabsTrigger value="subtitles" className="flex-1">
                        <Type className="h-4 w-4 mr-1" />
                        Subtitrări
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="tts" className="space-y-4 mt-4">
                      <div>
                        <Label className="text-muted-foreground">Text pentru Voice-over</Label>
                        <Textarea
                          value={editingTtsText}
                          onChange={(e) => setEditingTtsText(e.target.value)}
                          placeholder="Scrie textul care va fi transformat în voce..."
                          className="mt-2 bg-muted/50 border-border min-h-[150px]"
                        />
                        <p className="text-muted-foreground text-xs mt-1">
                          {editingTtsText.length} / 5000 caractere
                        </p>
                      </div>
                    </TabsContent>

                    <TabsContent value="subtitles" className="space-y-4 mt-4">
                      <div>
                        <Label className="text-muted-foreground">Conținut SRT</Label>
                        <Textarea
                          value={editingSrtContent}
                          onChange={(e) => setEditingSrtContent(e.target.value)}
                          placeholder="1
00:00:00,000 --> 00:00:02,000
Text subtitrare..."
                          className="mt-2 bg-muted/50 border-border min-h-[100px] font-mono text-sm"
                        />
                      </div>

                      <div>
                        <Label className="text-muted-foreground">
                          Font Size: {editingSubtitleSettings.fontSize}px
                        </Label>
                        <Slider
                          value={[editingSubtitleSettings.fontSize]}
                          onValueChange={(v) =>
                            setEditingSubtitleSettings({
                              ...editingSubtitleSettings,
                              fontSize: v[0],
                            })
                          }
                          min={24}
                          max={96}
                          step={2}
                          className="mt-2"
                        />
                      </div>

                      <div>
                        <Label className="text-muted-foreground">
                          Poziție Y: {editingSubtitleSettings.positionY}%
                        </Label>
                        <Slider
                          value={[editingSubtitleSettings.positionY]}
                          onValueChange={(v) =>
                            setEditingSubtitleSettings({
                              ...editingSubtitleSettings,
                              positionY: v[0],
                            })
                          }
                          min={10}
                          max={90}
                          step={1}
                          className="mt-2"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-muted-foreground">Culoare Text</Label>
                          <Input
                            type="color"
                            value={editingSubtitleSettings.textColor}
                            onChange={(e) =>
                              setEditingSubtitleSettings({
                                ...editingSubtitleSettings,
                                textColor: e.target.value,
                              })
                            }
                            className="mt-2 h-10 bg-muted/50 border-border"
                          />
                        </div>
                        <div>
                          <Label className="text-muted-foreground">Culoare Contur</Label>
                          <Input
                            type="color"
                            value={editingSubtitleSettings.outlineColor}
                            onChange={(e) =>
                              setEditingSubtitleSettings({
                                ...editingSubtitleSettings,
                                outlineColor: e.target.value,
                              })
                            }
                            className="mt-2 h-10 bg-muted/50 border-border"
                          />
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>

                  <div className="flex gap-2">
                    <Button onClick={saveClipContent} className="flex-1 bg-blue-600 hover:bg-blue-700">
                      Salvează
                    </Button>
                    <Button
                      onClick={() => renderFinalClip(selectedClip.id)}
                      disabled={rendering}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      {rendering ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Randează"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-card border-border h-64 flex items-center justify-center">
                <div className="text-center">
                  <Settings className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground text-sm">Selectează un clip pentru editare</p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* New Project Dialog */}
      <Dialog open={showNewProject} onOpenChange={setShowNewProject}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Proiect Nou</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Creează un proiect nou pentru a genera clipuri video.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Nume Proiect *</Label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Ex: Campanie Produs Nou"
                className="mt-2 bg-muted/50 border-border"
              />
            </div>

            <div>
              <Label className="text-muted-foreground">Descriere</Label>
              <Textarea
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder="Descriere opțională..."
                className="mt-2 bg-muted/50 border-border"
              />
            </div>

            <div>
              <Label className="text-muted-foreground">Durată Țintă: {newProjectDuration}s</Label>
              <Slider
                value={[newProjectDuration]}
                onValueChange={(v) => setNewProjectDuration(v[0])}
                min={10}
                max={60}
                step={5}
                className="mt-2"
              />
            </div>

            <div>
              <Label className="text-muted-foreground">Context pentru AI</Label>
              <Textarea
                value={newProjectContext}
                onChange={(e) => setNewProjectContext(e.target.value)}
                placeholder="Descrie tipul de conținut pe care îl cauți (ex: momente dramatice, produse vizibile, etc.)"
                className="mt-2 bg-muted/50 border-border"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewProject(false)}
            >
              Anulează
            </Button>
            <Button
              onClick={createProject}
              disabled={!newProjectName.trim() || loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Creează Proiect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
