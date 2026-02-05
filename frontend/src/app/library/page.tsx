"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";

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
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  Upload,
  Loader2,
  CheckCircle2,
  Clock,
  Instagram,
  Youtube,
  Scissors,
  Tag,
  Video,
  Pencil,
  Share2,
  Calendar,
  Volume2,
  VolumeX,
  FileText,
  Wand2,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { VideoSegmentPlayer } from "@/components/video-segment-player";
import { SimpleSegmentPopup } from "@/components/simple-segment-popup";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { DEFAULT_SUBTITLE_SETTINGS } from "@/types/video-processing";
import {
  VideoEnhancementControls,
  VideoFilters,
  defaultVideoFilters,
} from "@/components/video-enhancement-controls";

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
  // Postiz publishing status
  postiz_status?: "not_sent" | "scheduled" | "sent";
  postiz_post_id?: string;
  postiz_scheduled_at?: string;
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

// Segment types
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
  created_at: string;
  source_video_name?: string;
}

interface PostizIntegration {
  id: string;
  name: string;
  type: string;
  identifier?: string;
  picture?: string;
  disabled: boolean;
}

function LibraryPageContent() {
  // URL routing
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [clipContent, setClipContent] = useState<ClipContent | null>(null);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("instagram_reels");
  const [videoFilters, setVideoFilters] = useState<VideoFilters>(defaultVideoFilters);

  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [rendering, setRendering] = useState(false);

  // Generation tracking
  const generationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Progress tracking
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [generationProgress, setGenerationProgress] = useState<{
    percentage: number;
    currentStep: string | null;
    estimatedRemaining: number | null;
  } | null>(null);

  // Timer ref - păstrează intervalul între renderuri
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Timer SIMPLU - pornește când generating devine true
  useEffect(() => {
    if (generating) {
      // Oprește orice timer existent
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      // Reset și pornește
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    } else {
      // Oprește timer-ul
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    // Cleanup la unmount
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [generating]);

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

  // Delete confirmation
  const [clipToDelete, setClipToDelete] = useState<Clip | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  // Clip rename state
  const [renamingClipId, setRenamingClipId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Segment mode state
  const [showSegmentModal, setShowSegmentModal] = useState(false);
  const [sourceVideos, setSourceVideos] = useState<SourceVideo[]>([]);
  const [selectedSourceVideo, setSelectedSourceVideo] = useState<SourceVideo | null>(null);
  const [modalSegments, setModalSegments] = useState<Segment[]>([]);
  const [pendingSegment, setPendingSegment] = useState<{start: number; end: number} | null>(null);
  const [showKeywordPopup, setShowKeywordPopup] = useState(false);
  const [projectSegments, setProjectSegments] = useState<Segment[]>([]);
  const [generationMode, setGenerationMode] = useState<"ai" | "segments">("ai");
  const [selectionMode, setSelectionMode] = useState<"random" | "sequential" | "weighted">("random");
  const [assignedSegmentsCount, setAssignedSegmentsCount] = useState(0);

  // Postiz publishing state
  const [showPostizModal, setShowPostizModal] = useState(false);
  const [postizIntegrations, setPostizIntegrations] = useState<PostizIntegration[]>([]);
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>([]);
  const [postizCaption, setPostizCaption] = useState("");
  const [postizScheduleDate, setPostizScheduleDate] = useState("");
  const [postizScheduleTime, setPostizScheduleTime] = useState("");
  const [postizPublishing, setPostizPublishing] = useState(false);
  const [postizClipToPublish, setPostizClipToPublish] = useState<Clip | null>(null);
  const [postizBulkMode, setPostizBulkMode] = useState(false);

  // ============== WORKFLOW STEPS STATE ==============
  // Script & TTS workflow
  const [workflowMode, setWorkflowMode] = useState<"video_only" | "with_audio">("video_only");
  const [scriptText, setScriptText] = useState("");
  const [generateTts, setGenerateTts] = useState(false);
  const [muteSourceVoice, setMuteSourceVoice] = useState(true); // Default true: mute source voice for professional output
  const [ttsPreviewDuration, setTtsPreviewDuration] = useState<number | null>(null);
  const [generatingTtsPreview, setGeneratingTtsPreview] = useState(false);

  // Duration control - auto (from TTS) or manual (slider)
  const [durationMode, setDurationMode] = useState<"auto" | "manual">("manual");
  const [manualDuration, setManualDuration] = useState(20);

  // Computed target duration
  const targetDuration = durationMode === "auto" && ttsPreviewDuration
    ? ttsPreviewDuration
    : manualDuration;

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
  const urlInitialized = useRef(false);

  // ============== URL TRACKING ==============
  // Helper to update URL without full page reload
  const updateUrl = useCallback((params: Record<string, string | null>) => {
    const current = new URLSearchParams(searchParams.toString());

    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        current.delete(key);
      } else {
        current.set(key, value);
      }
    });

    const newUrl = current.toString() ? `${pathname}?${current.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [searchParams, pathname, router]);

  // Sync URL when selectedProject changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!urlInitialized.current) return;
    updateUrl({
      project: selectedProject?.id || null,
      clip: null, // Reset clip when project changes
    });
  }, [selectedProject?.id]);

  // Sync URL when selectedClip changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!urlInitialized.current) return;
    if (selectedClip) {
      updateUrl({ clip: selectedClip.id });
    }
  }, [selectedClip?.id]);

  // Sync URL when generationMode changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!urlInitialized.current) return;
    updateUrl({ mode: generationMode });
  }, [generationMode]);

  // ============== URL → STATE SYNC (on page load) ==============
  // Restore state from URL params after projects are loaded
  useEffect(() => {
    // Only run once when projects are loaded
    if (urlInitialized.current || projects.length === 0) return;

    const projectId = searchParams.get("project");
    const clipId = searchParams.get("clip");
    const mode = searchParams.get("mode");

    // Set generation mode from URL
    if (mode === "ai" || mode === "segments") {
      setGenerationMode(mode);
    }

    // Find and select project from URL
    if (projectId) {
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        setSelectedProject(project);
        // Clips will be fetched by the selectedProject effect
        // Store clipId to select after clips load
        if (clipId) {
          // We need to wait for clips to load, so store in ref
          pendingClipId.current = clipId;
        }
      }
    }

    // Mark URL as initialized (prevents state → URL sync during initial load)
    urlInitialized.current = true;
  }, [projects, searchParams]);

  // Ref to store pending clip ID to select after clips load
  const pendingClipId = useRef<string | null>(null);

  // Select clip from URL after clips are loaded
  useEffect(() => {
    if (pendingClipId.current && clips.length > 0) {
      const clip = clips.find((c) => c.id === pendingClipId.current);
      if (clip) {
        setSelectedClip(clip);
      }
      pendingClipId.current = null;
    }
  }, [clips]);

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

      // Workflow settings
      if (config.workflowMode) setWorkflowMode(config.workflowMode);
      if (config.scriptText) setScriptText(config.scriptText);
      if (config.generateTts !== undefined) setGenerateTts(config.generateTts);
      if (config.muteSourceVoice !== undefined) setMuteSourceVoice(config.muteSourceVoice);
      if (config.durationMode) setDurationMode(config.durationMode);
      if (config.manualDuration) setManualDuration(config.manualDuration);
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
      // Workflow settings
      workflowMode,
      scriptText,
      generateTts,
      muteSourceVoice,
      durationMode,
      manualDuration,
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
    // Workflow settings
    workflowMode,
    scriptText,
    generateTts,
    muteSourceVoice,
    durationMode,
    manualDuration,
  ]);

  // Load projects on mount
  useEffect(() => {
    fetchProjects();
    fetchPresets();
  }, []);

  // Polling când proiectul e în "generating" - SIMPLU
  useEffect(() => {
    if (selectedProject?.status === "generating" && !generationIntervalRef.current) {
      setGenerating(true);
      const projectId = selectedProject.id;

      // Poll la fiecare 2 secunde
      const pollInterval = setInterval(async () => {
        try {
          const [projectRes, progressRes] = await Promise.all([
            fetch(`${API_URL}/library/projects/${projectId}`),
            fetch(`${API_URL}/library/projects/${projectId}/progress`)
          ]);

          if (projectRes.ok) {
            const project = await projectRes.json();
            setSelectedProject(project);
            setProjects(prev => prev.map(p => p.id === project.id ? project : p));

            // Generare completă sau eșuată
            if (project.status === "ready_for_triage" || project.status === "failed") {
              clearInterval(pollInterval);
              generationIntervalRef.current = null;
              setGenerating(false);
              setGenerationProgress(null);
              if (project.status === "ready_for_triage") {
                fetchClips(projectId);
              }
            }
          }

          if (progressRes.ok) {
            const progress = await progressRes.json();
            setGenerationProgress({
              percentage: progress.percentage || 0,
              currentStep: progress.current_step,
              estimatedRemaining: progress.estimated_remaining
            });
          }
        } catch (error) {
          console.error("Poll error:", error);
        }
      }, 2000);

      generationIntervalRef.current = pollInterval;
    }

    return () => {
      if (selectedProject?.status !== "generating" && generationIntervalRef.current) {
        clearInterval(generationIntervalRef.current);
        generationIntervalRef.current = null;
      }
    };
  }, [selectedProject?.id, selectedProject?.status]);

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

  // Request delete project (show confirmation dialog)
  const requestDeleteProject = (project: Project) => {
    setProjectToDelete(project);
  };

  // Actually delete project after confirmation
  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      const res = await fetch(`${API_URL}/library/projects/${projectToDelete.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setProjects(projects.filter((p) => p.id !== projectToDelete.id));
        if (selectedProject?.id === projectToDelete.id) {
          setSelectedProject(null);
          setClips([]);
        }
      }
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setProjectToDelete(null);
    }
  };

  // Generate raw clips - SIMPLU
  const generateRawClips = async () => {
    if (!selectedProject || (!uploadVideo && !localVideoPath)) return;

    setGenerating(true);
    setGenerationProgress({
      percentage: 0,
      currentStep: "Inițializare...",
      estimatedRemaining: null
    });

    try {
      const formData = new FormData();
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
        // Update status - useEffect-ul va porni polling-ul automat
        setSelectedProject({
          ...selectedProject,
          status: "generating"
        });
      } else {
        setGenerating(false);
        setGenerationProgress(null);
      }
    } catch (error) {
      console.error("Failed to generate clips:", error);
      setGenerating(false);
      setGenerationProgress(null);
    }
  };

  // Cancel generation - SIMPLU
  const cancelGeneration = async () => {
    // Stop polling
    if (generationIntervalRef.current) {
      clearInterval(generationIntervalRef.current);
      generationIntervalRef.current = null;
    }

    // Call backend to cancel
    if (selectedProject) {
      try {
        await fetch(`${API_URL}/library/projects/${selectedProject.id}/cancel`, {
          method: "POST"
        });
      } catch (error) {
        console.error("Failed to cancel generation:", error);
      }

      // Refresh project status
      const projectRes = await fetch(`${API_URL}/library/projects/${selectedProject.id}`);
      if (projectRes.ok) {
        const project = await projectRes.json();
        setSelectedProject(project);
        setProjects(prev => prev.map(p => p.id === project.id ? project : p));
      }
    }

    setGenerating(false); // Asta va opri și timer-ul automat (din useEffect)
    setGenerationProgress(null);
    setElapsedTime(0);
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
        const newClips = clips.filter((c) => c.id !== clipId);
        setClips(newClips);
        if (selectedClip?.id === clipId) {
          setSelectedClip(null);
        }

        // Refresh project data to update counts
        if (selectedProject) {
          const projectRes = await fetch(`${API_URL}/library/projects/${selectedProject.id}`);
          if (projectRes.ok) {
            const updatedProject = await projectRes.json();
            setSelectedProject(updatedProject);
            // Also update in projects list
            setProjects(projects.map(p =>
              p.id === updatedProject.id ? updatedProject : p
            ));
          }
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

      // Video enhancement filters (Phase 9)
      formData.append("enable_denoise", videoFilters.enableDenoise.toString());
      formData.append("denoise_strength", videoFilters.denoiseStrength.toString());
      formData.append("enable_sharpen", videoFilters.enableSharpen.toString());
      formData.append("sharpen_amount", videoFilters.sharpenAmount.toString());
      formData.append("enable_color", videoFilters.enableColor.toString());
      formData.append("brightness", videoFilters.brightness.toString());
      formData.append("contrast", videoFilters.contrast.toString());
      formData.append("saturation", videoFilters.saturation.toString());

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
        return "bg-primary text-primary-foreground";
      case "processing":
        return "bg-secondary text-secondary-foreground";
      case "failed":
        return "bg-destructive text-destructive-foreground";
      case "pending":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  // Get Postiz publishing status badge
  const getPostizStatusBadge = (clip: Clip) => {
    const status = clip.postiz_status || "not_sent";
    switch (status) {
      case "sent":
        return {
          color: "bg-green-500 text-white",
          label: "Trimis",
          icon: <CheckCircle2 className="h-3 w-3 mr-1" />
        };
      case "scheduled":
        return {
          color: "bg-blue-500 text-white",
          label: "Programat",
          icon: <Clock className="h-3 w-3 mr-1" />
        };
      case "not_sent":
      default:
        return {
          color: "bg-muted text-muted-foreground",
          label: "Netrimis",
          icon: null  // No icon for "not sent" status
        };
    }
  };

  // Rename clip function
  const renameClip = async (clipId: string, newName: string) => {
    try {
      const res = await fetch(`${API_URL}/library/clips/${clipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant_name: newName }),
      });
      if (res.ok) {
        // Update local state
        setClips(prev => prev.map(c =>
          c.id === clipId ? { ...c, variant_name: newName } : c
        ));
        setRenamingClipId(null);
        setRenameValue("");
      }
    } catch (error) {
      console.error("Failed to rename clip:", error);
    }
  };

  // Get preset icon
  const getPresetIcon = (name: string) => {
    if (name.includes("instagram")) return <Instagram className="h-4 w-4" />;
    if (name.includes("youtube")) return <Youtube className="h-4 w-4" />;
    if (name.includes("tiktok")) return <Film className="h-4 w-4" />;
    return <Film className="h-4 w-4" />;
  };

  // ============== SEGMENT FUNCTIONS ==============

  // Fetch source videos for segment modal
  const fetchSourceVideos = async () => {
    try {
      const res = await fetch(`${API_URL}/segments/source-videos`);
      if (res.ok) {
        const data = await res.json();
        setSourceVideos(data);
      }
    } catch (error) {
      console.error("Failed to fetch source videos:", error);
    }
  };

  // Fetch segments for selected source video
  const fetchModalSegments = async (videoId: string) => {
    try {
      const res = await fetch(`${API_URL}/segments/source-videos/${videoId}/segments`);
      if (res.ok) {
        const data = await res.json();
        setModalSegments(data);
      }
    } catch (error) {
      console.error("Failed to fetch segments:", error);
    }
  };

  // Fetch segments assigned to project
  const fetchProjectSegments = async (projectId: string) => {
    try {
      const res = await fetch(`${API_URL}/segments/projects/${projectId}/segments`);
      if (res.ok) {
        const data = await res.json();
        setProjectSegments(data);
        setAssignedSegmentsCount(data.length);
        if (data.length > 0) {
          setGenerationMode("segments");
        }
      }
    } catch (error) {
      console.error("Failed to fetch project segments:", error);
    }
  };

  // Open segment modal
  const openSegmentModal = async () => {
    await fetchSourceVideos();
    if (selectedProject) {
      await fetchProjectSegments(selectedProject.id);
    }
    setShowSegmentModal(true);
  };

  // Select source video in modal
  const selectSourceVideo = async (video: SourceVideo) => {
    setSelectedSourceVideo(video);
    await fetchModalSegments(video.id);
  };

  // Handle segment create (from player)
  const handleSegmentCreate = (start: number, end: number) => {
    setPendingSegment({ start, end });
    setShowKeywordPopup(true);
  };

  // Save new segment
  const handleSaveSegment = async (keywords: string[], notes: string) => {
    if (!selectedSourceVideo || !pendingSegment) return;

    try {
      const res = await fetch(
        `${API_URL}/segments/source-videos/${selectedSourceVideo.id}/segments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start_time: pendingSegment.start,
            end_time: pendingSegment.end,
            keywords,
            notes,
          }),
        }
      );

      if (res.ok) {
        const newSegment = await res.json();
        newSegment.source_video_name = selectedSourceVideo.name;
        setModalSegments((prev) => [...prev, newSegment].sort((a, b) => a.start_time - b.start_time));
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

  // Add segment to project selection
  const addSegmentToProject = (segment: Segment) => {
    if (!projectSegments.find((s) => s.id === segment.id)) {
      setProjectSegments((prev) => [...prev, segment]);
    }
  };

  // Remove segment from project selection
  const removeSegmentFromProject = (segmentId: string) => {
    setProjectSegments((prev) => prev.filter((s) => s.id !== segmentId));
  };

  // Save project segments to backend
  const saveProjectSegments = async () => {
    if (!selectedProject) return;

    try {
      const formData = new FormData();
      projectSegments.forEach((seg) => {
        formData.append("segment_ids", seg.id);
      });

      const res = await fetch(
        `${API_URL}/segments/projects/${selectedProject.id}/assign`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (res.ok) {
        setShowSegmentModal(false);
        setAssignedSegmentsCount(projectSegments.length);
        // Auto-switch to segments mode after saving segments
        setGenerationMode("segments");
      }
    } catch (error) {
      console.error("Failed to save project segments:", error);
    }
  };

  // Generate video from pre-assigned segments
  const generateFromSegments = async () => {
    if (!selectedProject) return;

    if (assignedSegmentsCount === 0) {
      alert("Trebuie să asignezi segmente mai întâi!");
      return;
    }

    try {
      setGenerating(true);

      // Build request body as JSON
      const requestBody: Record<string, unknown> = {
        variant_count: variantCount,
        selection_mode: selectionMode,
        target_duration: targetDuration,
        mute_source_voice: muteSourceVoice, // ALWAYS send this, regardless of workflow mode
      };

      // Add TTS/Script data if workflow mode is with_audio
      if (workflowMode === "with_audio" && scriptText.trim()) {
        requestBody.tts_text = scriptText;
        requestBody.generate_tts = generateTts;
      }

      const res = await fetch(
        `${API_URL}/library/projects/${selectedProject.id}/generate-from-segments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (res.ok) {
        const data = await res.json();
        console.log("Generation started:", data);

        // Update project status to trigger polling
        setSelectedProject({
          ...selectedProject,
          status: "generating",
        });
      } else {
        const error = await res.json();
        const errorMsg = typeof error === 'object' ? (error.detail || JSON.stringify(error)) : String(error);
        alert(`Eroare: ${errorMsg}`);
        setGenerating(false);
      }
    } catch (error) {
      console.error("Failed to generate from segments:", error);
      setGenerating(false);
    }
  };

  // Format time as mm:ss
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // ============== POSTIZ FUNCTIONS ==============

  // Fetch Postiz integrations
  const fetchPostizIntegrations = async () => {
    try {
      const res = await fetch(`${API_URL}/postiz/integrations`);
      if (res.ok) {
        const data = await res.json();
        setPostizIntegrations(data);
      }
    } catch (error) {
      console.error("Failed to fetch Postiz integrations:", error);
    }
  };

  // Open Postiz modal for single clip
  const openPostizModal = (clip: Clip) => {
    setPostizClipToPublish(clip);
    setPostizBulkMode(false);
    setSelectedIntegrations([]);
    setPostizCaption("");
    setPostizScheduleDate("");
    setPostizScheduleTime("");
    fetchPostizIntegrations();
    setShowPostizModal(true);
  };

  // Open Postiz modal for bulk publish
  const openBulkPostizModal = () => {
    setPostizClipToPublish(null);
    setPostizBulkMode(true);
    setSelectedIntegrations([]);
    setPostizCaption("");
    setPostizScheduleDate("");
    setPostizScheduleTime("");
    fetchPostizIntegrations();
    setShowPostizModal(true);
  };

  // Publish to Postiz
  const publishToPostiz = async () => {
    if (selectedIntegrations.length === 0) {
      alert("Selecteaza cel putin o platforma!");
      return;
    }

    setPostizPublishing(true);

    try {
      // Build schedule datetime if both date and time are set
      let scheduleDate: string | null = null;
      if (postizScheduleDate && postizScheduleTime) {
        scheduleDate = `${postizScheduleDate}T${postizScheduleTime}:00`;
      }

      if (postizBulkMode) {
        // Bulk publish selected clips
        const selectedClipIds = clips
          .filter(c => c.is_selected && c.final_video_path)
          .map(c => c.id);

        const res = await fetch(`${API_URL}/postiz/bulk-publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clip_ids: selectedClipIds,
            caption: postizCaption,
            integration_ids: selectedIntegrations,
            schedule_date: scheduleDate,
            schedule_interval_minutes: 30
          })
        });

        if (res.ok) {
          const data = await res.json();
          alert(`Publicare in curs! Job ID: ${data.job_id}`);
          setShowPostizModal(false);
        } else {
          const error = await res.json();
          alert(`Eroare: ${error.detail}`);
        }
      } else if (postizClipToPublish) {
        // Single clip publish
        const res = await fetch(`${API_URL}/postiz/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clip_id: postizClipToPublish.id,
            caption: postizCaption,
            integration_ids: selectedIntegrations,
            schedule_date: scheduleDate
          })
        });

        if (res.ok) {
          const data = await res.json();
          alert(scheduleDate
            ? `Programat cu succes! Job ID: ${data.job_id}`
            : `Publicat cu succes! Job ID: ${data.job_id}`
          );
          setShowPostizModal(false);
        } else {
          const error = await res.json();
          alert(`Eroare: ${error.detail}`);
        }
      }
    } catch (error) {
      console.error("Failed to publish:", error);
      alert("Eroare la publicare. Verifica conexiunea.");
    } finally {
      setPostizPublishing(false);
    }
  };

  // Toggle integration selection
  const toggleIntegration = (integrationId: string) => {
    setSelectedIntegrations(prev =>
      prev.includes(integrationId)
        ? prev.filter(id => id !== integrationId)
        : [...prev, integrationId]
    );
  };

  // Get platform icon
  const getPlatformIcon = (type: string) => {
    const icons: Record<string, string> = {
      instagram: "📸",
      tiktok: "🎵",
      youtube: "▶️",
      facebook: "👤",
      linkedin: "💼",
      x: "𝕏",
      twitter: "𝕏",
      bluesky: "🦋",
      threads: "🧵"
    };
    return icons[type.toLowerCase()] || "🌐";
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
                        fetchProjectSegments(project.id);
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
                            requestDeleteProject(project);
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
                        <Badge variant="outline" className="text-xs">
                          {project.selected_count} selectate
                        </Badge>
                      </div>
                      <Badge
                        className={`mt-2 text-xs ${
                          project.status === "ready_for_triage"
                            ? "bg-primary text-primary-foreground"
                            : project.status === "generating"
                            ? "bg-secondary text-secondary-foreground"
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
                      {/* Segment mode button */}
                      <Button
                        onClick={openSegmentModal}
                        variant="outline"
                        className="border-primary text-primary hover:bg-primary/10"
                      >
                        <Scissors className="h-4 w-4 mr-2" />
                        Segmente
                        {projectSegments.length > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {projectSegments.length}
                          </Badge>
                        )}
                      </Button>
                      <Button
                        onClick={openBulkPostizModal}
                        disabled={clips.filter((c) => c.final_video_path).length === 0}
                        variant="outline"
                        className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-none hover:from-pink-600 hover:to-purple-600"
                      >
                        <Share2 className="h-4 w-4 mr-2" />
                        Postiz ({clips.filter((c) => c.final_video_path).length})
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedProject.status === "draft" && (
                    <div className="border-2 border-dashed border-border rounded-lg p-8">
                      {/* Generation Mode Toggle */}
                      <div className="flex justify-center mb-6">
                        <div className="inline-flex rounded-lg border border-border p-1 bg-muted/50">
                          <button
                            onClick={() => setGenerationMode("ai")}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                              generationMode === "ai"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Film className="h-4 w-4 inline-block mr-2" />
                            Video + AI
                          </button>
                          <button
                            onClick={() => setGenerationMode("segments")}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                              generationMode === "segments"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Scissors className="h-4 w-4 inline-block mr-2" />
                            Din Segmente
                          </button>
                        </div>
                      </div>

                      {/* AI Mode - Upload Video */}
                      {generationMode === "ai" && (
                        <div className="text-center">
                          <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                          <p className="text-foreground mb-4">
                            Încarcă un video sursă pentru a genera clipuri
                          </p>
                          <div className="flex flex-col items-center gap-4">
                            <Input
                              type="file"
                              accept="video/*"
                              onChange={(e) => setUploadVideo(e.target.files?.[0] || null)}
                              className="max-w-md bg-muted/50"
                            />
                            <div className="flex items-center gap-4 w-full max-w-md">
                              <div className="flex-1 h-px bg-border" />
                              <span className="text-muted-foreground text-sm">SAU</span>
                              <div className="flex-1 h-px bg-border" />
                            </div>
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

                      {/* Segments Mode - Use Pre-defined Segments */}
                      {generationMode === "segments" && (
                        <div className="space-y-6">
                          {/* Header with instructions */}
                          <div className="text-center border-b pb-4">
                            <div className="flex items-center justify-center gap-2 mb-2">
                              <Scissors className="h-6 w-6 text-primary" />
                              <h3 className="text-lg font-semibold">Generare din Segmente</h3>
                            </div>
                            <p className="text-muted-foreground text-sm">
                              Pașii: 1. Selectează segmente → 2. Alege opțiuni → 3. Generează
                            </p>
                          </div>

                          {/* Selected Segments List */}
                          <div className="bg-muted/30 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-medium flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-primary" />
                                Segmente Selectate ({projectSegments.length})
                              </h4>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={openSegmentModal}
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Adaugă
                                </Button>
                                {projectSegments.length > 0 && (
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => {
                                      setProjectSegments([]);
                                      setAssignedSegmentsCount(0);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 mr-1" />
                                    Șterge Tot
                                  </Button>
                                )}
                              </div>
                            </div>

                            {projectSegments.length === 0 ? (
                              <div className="text-center py-6 border-2 border-dashed border-muted-foreground/30 rounded-lg">
                                <Scissors className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                                <p className="text-muted-foreground">Niciun segment selectat</p>
                                <Button
                                  variant="link"
                                  onClick={openSegmentModal}
                                  className="mt-2"
                                >
                                  Click pentru a selecta segmente →
                                </Button>
                              </div>
                            ) : (
                              <div className="max-h-48 overflow-y-auto space-y-2">
                                {projectSegments.map((segment) => (
                                  <div
                                    key={segment.id}
                                    className="flex items-center justify-between p-2 bg-background rounded border"
                                  >
                                    <div className="flex items-center gap-3">
                                      <Film className="h-4 w-4 text-muted-foreground" />
                                      <div>
                                        <p className="text-sm font-medium">{segment.source_video_name || "Video"}</p>
                                        <p className="text-xs text-muted-foreground font-mono">
                                          {formatTime(segment.start_time)} - {formatTime(segment.end_time)} ({segment.duration?.toFixed(1)}s)
                                        </p>
                                      </div>
                                      {segment.keywords && segment.keywords.length > 0 && (
                                        <div className="flex gap-1">
                                          {segment.keywords.slice(0, 2).map((kw) => (
                                            <Badge key={kw} variant="secondary" className="text-xs">
                                              {kw}
                                            </Badge>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                      onClick={() => {
                                        removeSegmentFromProject(segment.id);
                                        setAssignedSegmentsCount(prev => Math.max(0, prev - 1));
                                      }}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                        </div>
                      )}
                    </div>
                  )}

                  {(selectedProject.status === "generating" || generating) && (
                    <div className="py-8 px-4">
                      <div className="max-w-md mx-auto space-y-6">
                        {/* Spinner și titlu */}
                        <div className="text-center">
                          <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
                          <p className="text-foreground font-medium text-lg">Se generează clipurile...</p>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Progress</span>
                            <span className="font-mono">{generationProgress?.percentage || 0}%</span>
                          </div>
                          <Progress value={generationProgress?.percentage || 0} className="h-3" />
                        </div>

                        {/* Current step */}
                        {generationProgress?.currentStep && (
                          <div className="bg-muted/50 rounded-lg p-3">
                            <p className="text-sm text-muted-foreground">Pas curent:</p>
                            <p className="text-foreground font-medium truncate">
                              {generationProgress.currentStep}
                            </p>
                          </div>
                        )}

                        {/* Timer */}
                        <div className="grid grid-cols-2 gap-4 text-center">
                          <div className="bg-muted/50 rounded-lg p-3">
                            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mb-1">
                              <Clock className="h-4 w-4" />
                              <span>Timp trecut</span>
                            </div>
                            <p className="text-foreground font-mono text-xl">
                              {formatTime(elapsedTime)}
                            </p>
                          </div>
                          <div className="bg-muted/50 rounded-lg p-3">
                            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mb-1">
                              <Clock className="h-4 w-4" />
                              <span>Timp estimat</span>
                            </div>
                            <p className="text-foreground font-mono text-xl">
                              {generationProgress?.estimatedRemaining
                                ? formatTime(generationProgress.estimatedRemaining)
                                : "--:--"}
                            </p>
                          </div>
                        </div>

                        {/* Cancel button */}
                        <div className="text-center pt-2">
                          <Button
                            variant="outline"
                            onClick={cancelGeneration}
                            className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                          >
                            <X className="h-4 w-4 mr-2" />
                            Oprește Generarea
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Empty state - option to reset to draft for new generation */}
                  {clips.length === 0 && !generating && selectedProject.status !== "draft" && (
                    <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                      <Film className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-foreground mb-2">
                        Nu există clipuri în acest proiect
                      </p>
                      <p className="text-muted-foreground text-sm mb-4">
                        Toate clipurile au fost șterse. Resetează proiectul pentru a genera clipuri noi.
                      </p>
                      <Button
                        onClick={async () => {
                          try {
                            const res = await fetch(`${API_URL}/library/projects/${selectedProject.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "draft" })
                            });
                            if (res.ok) {
                              const updated = await res.json();
                              setSelectedProject(updated);
                              setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
                            }
                          } catch (error) {
                            console.error("Failed to reset project:", error);
                          }
                        }}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Resetează pentru Generare Nouă
                      </Button>
                    </div>
                  )}

                  {(selectedProject.status === "ready_for_triage" ||
                    selectedProject.status === "processing_finals" ||
                    selectedProject.status === "completed" ||
                    selectedProject.status === "failed" ||
                    selectedProject.status === "draft") && clips.length > 0 && !generating && (
                    <div className="grid grid-cols-3 gap-4 max-h-[calc(100vh-350px)] overflow-y-auto">
                      {clips.map((clip) => (
                        <div
                          key={clip.id}
                          onClick={() => {
                            setSelectedClip(clip);
                            fetchClipContent(clip.id);
                            setVideoFilters(defaultVideoFilters); // Reset filters when selecting new clip
                          }}
                          className={`relative rounded-lg overflow-hidden cursor-pointer transition-all ${
                            selectedClip?.id === clip.id
                              ? "ring-2 ring-primary"
                              : "hover:ring-1 hover:ring-border"
                          } ${clip.is_selected ? "ring-2 ring-primary" : ""}`}
                        >
                          {/* Thumbnail or placeholder */}
                          <div className="aspect-[9/16] bg-muted relative">
                            {clip.thumbnail_path ? (
                              <img
                                src={`${API_URL}/library/files/${encodeURIComponent(clip.thumbnail_path)}?v=${clip.id}`}
                                alt={clip.variant_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Film className="h-12 w-12 text-muted-foreground" />
                              </div>
                            )}

                            {/* Selection checkbox - only show when selected */}
                            {clip.is_selected && (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleClipSelection(clip.id, false);
                                }}
                                className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer bg-primary text-primary-foreground shadow-md"
                              >
                                <Check className="h-4 w-4" />
                              </div>
                            )}

                            {/* Postiz publishing status badge */}
                            {(() => {
                              const postizBadge = getPostizStatusBadge(clip);
                              return (
                                <Badge className={`absolute top-2 right-2 ${postizBadge.color}`}>
                                  {postizBadge.icon}
                                  {postizBadge.label}
                                </Badge>
                              );
                            })()}

                            {/* Duration */}
                            {clip.duration && (
                              <span className="absolute bottom-2 right-2 bg-background/80 text-foreground text-xs px-2 py-1 rounded">
                                {Math.floor(clip.duration)}s
                              </span>
                            )}

                            {/* Actions overlay - INSIDE thumbnail div so it doesn't cover clip info */}
                            <div className="absolute inset-0 bg-background/60 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const videoPath = clip.final_video_path || clip.raw_video_path;
                                  if (videoPath) {
                                    window.open(
                                      `${API_URL}/library/files/${encodeURIComponent(videoPath)}?v=${clip.id}`,
                                      "_blank"
                                    );
                                  }
                                }}
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                              {clip.final_video_path && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(
                                        `${API_URL}/library/files/${encodeURIComponent(clip.final_video_path || "")}?download=true&v=${clip.id}`,
                                        "_blank"
                                      );
                                    }}
                                  >
                                    <Download className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-none hover:from-pink-600 hover:to-purple-600"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPostizModal(clip);
                                    }}
                                  >
                                    <Share2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setClipToDelete(clip);
                                  setShowDeleteDialog(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {/* Clip info with rename - OUTSIDE thumbnail div, not covered by overlay */}
                          <div className="p-2 bg-card">
                            {renamingClipId === clip.id ? (
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <Input
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  className="h-6 text-xs"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      renameClip(clip.id, renameValue);
                                    } else if (e.key === "Escape") {
                                      setRenamingClipId(null);
                                      setRenameValue("");
                                    }
                                  }}
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  onClick={() => renameClip(clip.id, renameValue)}
                                >
                                  <Check className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  onClick={() => {
                                    setRenamingClipId(null);
                                    setRenameValue("");
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <div
                                className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingClipId(clip.id);
                                  setRenameValue(clip.variant_name || `Varianta ${clip.variant_index}`);
                                }}
                                title="Click pentru a redenumi"
                              >
                                <p className="text-foreground text-sm truncate flex-1">
                                  {clip.variant_name || `Varianta ${clip.variant_index}`}
                                </p>
                                <Pencil className="h-3 w-3 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ============== WORKFLOW STEPS PANEL ============== */}
                  {/* Show when: has segments, not generating (clips optional - needed for pre-generation config) */}
                  {projectSegments.length > 0 && !generating && selectedProject.status !== "generating" && (
                    <div className="mt-6 border-t pt-6 space-y-4">
                      {/* STEP 1: Script & Audio */}
                      <div className="bg-secondary/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-secondary/50 flex items-center justify-center">
                              <FileText className="h-4 w-4 text-secondary-foreground" />
                            </div>
                            <div>
                              <h4 className="font-medium text-foreground text-sm">Pas 1: Script & Audio</h4>
                              <p className="text-xs text-muted-foreground">Opțional - pentru voiceover sincronizat</p>
                            </div>
                          </div>
                          {/* Audio controls - grouped together on the right */}
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              <Label htmlFor="workflow-mode" className="text-xs">Cu Audio</Label>
                              <Switch
                                id="workflow-mode"
                                checked={workflowMode === "with_audio"}
                                onCheckedChange={(checked) => {
                                  setWorkflowMode(checked ? "with_audio" : "video_only");
                                  if (checked) {
                                    setDurationMode("auto");
                                  } else {
                                    setDurationMode("manual");
                                  }
                                }}
                              />
                            </div>
                            {/* Mute Source Voice - ALWAYS VISIBLE */}
                            <div className="flex items-center gap-2 border-l pl-3 border-border/50">
                              <VolumeX className="h-4 w-4 text-orange-400" />
                              <Label htmlFor="mute-source" className="text-xs cursor-pointer whitespace-nowrap">
                                Elimină vocea sursă
                              </Label>
                              <Switch
                                id="mute-source"
                                checked={muteSourceVoice}
                                onCheckedChange={setMuteSourceVoice}
                              />
                            </div>
                          </div>
                        </div>

                        {workflowMode === "with_audio" && (
                          <div className="space-y-3 mt-3">
                            {/* Script textarea */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-xs text-muted-foreground">Script pentru voiceover</Label>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs"
                                  disabled
                                  title="Coming soon"
                                >
                                  <Wand2 className="h-3 w-3 mr-1" />
                                  Generează cu AI
                                </Button>
                              </div>
                              <Textarea
                                value={scriptText}
                                onChange={(e) => setScriptText(e.target.value)}
                                placeholder="Scrie textul pentru voiceover aici..."
                                className="min-h-[80px] text-sm resize-y"
                              />
                              <div className="flex items-center justify-between mt-1">
                                <span className="text-xs text-muted-foreground">
                                  {scriptText.length} caractere
                                  {scriptText.length > 0 && (
                                    <span className="text-primary ml-1">
                                      (~{Math.ceil(scriptText.length / 150)}s audio)
                                    </span>
                                  )}
                                </span>
                                {scriptText.length > 0 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-xs"
                                    onClick={() => {
                                      const estimatedDuration = Math.ceil(scriptText.length / 150);
                                      setTtsPreviewDuration(estimatedDuration);
                                      setDurationMode("auto");
                                    }}
                                  >
                                    <Timer className="h-3 w-3 mr-1" />
                                    Setează durată auto
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* TTS options */}
                            <div className="flex flex-wrap items-center gap-4 p-2 bg-background/50 rounded">
                              <div className="flex items-center gap-2">
                                <Volume2 className="h-4 w-4 text-muted-foreground" />
                                <Label htmlFor="generate-tts" className="text-xs cursor-pointer">
                                  Generează TTS
                                </Label>
                                <Switch
                                  id="generate-tts"
                                  checked={generateTts}
                                  onCheckedChange={setGenerateTts}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* STEP 2: Duration Control */}
                      <div className="bg-secondary/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-secondary/50 flex items-center justify-center">
                              <Timer className="h-4 w-4 text-secondary-foreground" />
                            </div>
                            <div>
                              <h4 className="font-medium text-foreground text-sm">Pas 2: Durată Video</h4>
                              <p className="text-xs text-muted-foreground">
                                {durationMode === "auto" ? "Determinată de audio" : "Setată manual"}
                              </p>
                            </div>
                          </div>
                          <Badge variant={durationMode === "auto" ? "default" : "secondary"} className="text-xs">
                            {targetDuration}s
                          </Badge>
                        </div>

                        <div className="space-y-3">
                          {/* Duration mode toggle */}
                          <ToggleGroup
                            type="single"
                            value={durationMode}
                            onValueChange={(value) => {
                              if (value) setDurationMode(value as "auto" | "manual");
                            }}
                            variant="outline"
                            size="sm"
                            spacing={0}
                          >
                            <ToggleGroupItem value="manual" className="text-xs">
                              Manual
                            </ToggleGroupItem>
                            <ToggleGroupItem
                              value="auto"
                              disabled={!scriptText || scriptText.length === 0}
                              className="text-xs"
                            >
                              Auto (din script)
                            </ToggleGroupItem>
                          </ToggleGroup>

                          {/* Manual slider */}
                          {durationMode === "manual" && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs">Durată țintă</Label>
                                <span className="text-sm font-mono">{manualDuration}s</span>
                              </div>
                              <Slider
                                value={[manualDuration]}
                                onValueChange={([v]) => setManualDuration(v)}
                                min={5}
                                max={120}
                                step={1}
                                className="w-full"
                              />
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>5s</span>
                                <span>120s</span>
                              </div>
                            </div>
                          )}

                          {/* Auto duration info */}
                          {durationMode === "auto" && ttsPreviewDuration && (
                            <div className="p-2 bg-primary/10 rounded text-xs text-primary">
                              Video-ul va fi tăiat la {ttsPreviewDuration}s pentru a se potrivi cu audio-ul
                            </div>
                          )}
                        </div>
                      </div>

                      {/* STEP 3: Segment Generation Panel */}
                      <div className="bg-secondary/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                              <Scissors className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                              <h4 className="font-medium text-foreground text-sm">Pas 3: Generare Video</h4>
                              <p className="text-xs text-muted-foreground">
                                {projectSegments.length} segmente • Durată țintă: {targetDuration}s
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={openSegmentModal}
                          >
                            <Settings className="h-4 w-4 mr-1" />
                            Editează
                          </Button>
                        </div>

                        {/* Segment list preview */}
                        <div className="mb-4 max-h-32 overflow-y-auto space-y-1">
                          {projectSegments.slice(0, 5).map((seg) => (
                            <div key={seg.id} className="flex items-center justify-between text-sm p-2 bg-background/50 rounded">
                              <span className="truncate">{seg.source_video_name}</span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {formatTime(seg.start_time)} - {formatTime(seg.end_time)}
                              </span>
                            </div>
                          ))}
                          {projectSegments.length > 5 && (
                            <p className="text-xs text-muted-foreground text-center">
                              ... și încă {projectSegments.length - 5} segmente
                            </p>
                          )}
                        </div>

                        {/* Generation options */}
                        <div className="flex flex-wrap items-center gap-4 mb-4">
                          <div className="flex items-center gap-2">
                            <Label className="text-sm">Variante:</Label>
                            <Input
                              type="number"
                              min={1}
                              max={10}
                              value={variantCount}
                              onChange={(e) => setVariantCount(parseInt(e.target.value) || 6)}
                              className="w-16 h-8"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-sm">Mod:</Label>
                            <Select
                              value={selectionMode}
                              onValueChange={(v) => setSelectionMode(v as "random" | "sequential" | "weighted")}
                            >
                              <SelectTrigger className="w-28 h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="random">Aleator</SelectItem>
                                <SelectItem value="sequential">Secvențial</SelectItem>
                                <SelectItem value="weighted">Ponderat</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Generate button */}
                        <Button
                          onClick={generateFromSegments}
                          size="lg"
                          variant="default"
                          className="w-full font-semibold py-6 shadow-md hover:shadow-lg transition-shadow"
                        >
                          <Play className="h-5 w-5 mr-2" />
                          GENEREAZĂ {variantCount} VARIANTE DIN SEGMENTE
                        </Button>
                      </div>
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
                      {/* SRT Content Editor */}
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

                      {/* Shared SubtitleEditor Component */}
                      <SubtitleEditor
                        settings={{
                          ...DEFAULT_SUBTITLE_SETTINGS,
                          ...editingSubtitleSettings,
                        }}
                        onSettingsChange={(newSettings) => {
                          setEditingSubtitleSettings({
                            fontSize: newSettings.fontSize,
                            fontFamily: newSettings.fontFamily,
                            textColor: newSettings.textColor,
                            outlineColor: newSettings.outlineColor,
                            outlineWidth: newSettings.outlineWidth,
                            positionY: newSettings.positionY,
                          });
                        }}
                        showPreview={true}
                        previewHeight={300}
                        compact={true}
                      />
                    </TabsContent>
                  </Tabs>

                  {/* Video Enhancement Filters */}
                  <div className="mb-4">
                    <Label className="text-sm mb-2 block">Video Enhancement (optional):</Label>
                    <VideoEnhancementControls
                      filters={videoFilters}
                      onFilterChange={setVideoFilters}
                      disabled={rendering}
                    />
                  </div>

                  {/* Platform Selector */}
                  <div className="mb-4">
                    <Label className="text-sm mb-2 block">Export for:</Label>
                    <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select platform" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tiktok">
                          <span className="flex items-center gap-2">
                            <Video className="h-4 w-4" />
                            TikTok
                          </span>
                        </SelectItem>
                        <SelectItem value="instagram_reels">
                          <span className="flex items-center gap-2">
                            <Instagram className="h-4 w-4" />
                            Instagram Reels
                          </span>
                        </SelectItem>
                        <SelectItem value="youtube_shorts">
                          <span className="flex items-center gap-2">
                            <Youtube className="h-4 w-4" />
                            YouTube Shorts
                          </span>
                        </SelectItem>
                        <SelectItem value="generic">
                          <span className="flex items-center gap-2">
                            <Film className="h-4 w-4" />
                            Generic
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={saveClipContent} className="flex-1" variant="secondary">
                      Salvează
                    </Button>
                    <Button
                      onClick={() => renderFinalClip(selectedClip.id)}
                      disabled={rendering}
                      className="flex-1"
                      variant="default"
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmare Ștergere</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Ești sigur că vrei să ștergi clipul &quot;{clipToDelete?.variant_name || `Varianta ${clipToDelete?.variant_index}`}&quot;?
              Această acțiune nu poate fi anulată.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setClipToDelete(null);
              }}
            >
              Anulează
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (clipToDelete) {
                  deleteClip(clipToDelete.id);
                }
                setShowDeleteDialog(false);
                setClipToDelete(null);
              }}
            >
              Șterge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Segment Selection Modal */}
      {showSegmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80"
            onClick={() => setShowSegmentModal(false)}
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSegmentModal(false)}
                >
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
                      Niciun video. <Link href="/segments" className="text-primary hover:underline">Încarcă unul</Link>
                    </p>
                  ) : (
                    sourceVideos.map((video) => {
                      // Check if all segments from this video are selected
                      const videoSegmentsSelected = projectSegments.filter(
                        (s) => s.source_video_id === video.id
                      ).length;
                      const allSelected = video.segments_count > 0 && videoSegmentsSelected === video.segments_count;
                      const someSelected = videoSegmentsSelected > 0 && videoSegmentsSelected < video.segments_count;

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
                                // Fetch segments for this video if not already loaded
                                try {
                                  const res = await fetch(`${API_URL}/segments/source-videos/${video.id}/segments`);
                                  if (res.ok) {
                                    const segments = await res.json();
                                    if (e.target.checked) {
                                      // Add all segments from this video
                                      segments.forEach((seg: Segment) => {
                                        if (!projectSegments.find((s) => s.id === seg.id)) {
                                          seg.source_video_name = video.name;
                                          addSegmentToProject(seg);
                                        }
                                      });
                                    } else {
                                      // Remove all segments from this video
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
                    {/* Select All / Deselect All buttons */}
                    {modalSegments.length > 0 && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs"
                          onClick={() => {
                            // Add all segments from current source video
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
                            // Remove all segments from current source video
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
                    <Badge variant="default">
                      {projectSegments.length}
                    </Badge>
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
      )}

      {/* Keyword popup for new segments in modal */}
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

      {/* Project delete confirmation dialog */}
      {projectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80"
            onClick={() => setProjectToDelete(null)}
          />

          {/* Modal */}
          <div className="relative z-10 bg-background border border-border rounded-lg shadow-lg w-full max-w-md mx-4 animate-in fade-in-0 zoom-in-95">
            {/* Header */}
            <div className="p-6 pb-4">
              <div className="flex items-center gap-2 text-lg font-semibold text-destructive">
                <Trash2 className="h-5 w-5" />
                Confirmare Ștergere
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Sigur vrei să ștergi proiectul <strong>{projectToDelete.name}</strong> și toate clipurile asociate?
                Această acțiune nu poate fi anulată.
              </p>

              {/* Close button */}
              <button
                onClick={() => setProjectToDelete(null)}
                className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 p-6 pt-4 border-t">
              <Button variant="outline" onClick={() => setProjectToDelete(null)}>
                Anulează
              </Button>
              <Button variant="destructive" onClick={confirmDeleteProject}>
                <Trash2 className="h-4 w-4 mr-2" />
                Șterge
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Postiz Publish Modal */}
      {showPostizModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/80"
            onClick={() => setShowPostizModal(false)}
          />
          <div className="relative z-10 bg-background border border-border rounded-lg shadow-lg w-full max-w-lg mx-4 animate-in fade-in-0 zoom-in-95">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <Share2 className="h-5 w-5 text-pink-500" />
                <h2 className="text-lg font-semibold">
                  {postizBulkMode
                    ? `Publica ${clips.filter(c => c.is_selected && c.final_video_path).length} clipuri`
                    : "Publica pe Social Media"
                  }
                </h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowPostizModal(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Platform Selection */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Selecteaza platformele
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {postizIntegrations.length === 0 ? (
                    <p className="col-span-2 text-sm text-muted-foreground text-center py-4">
                      Nu sunt platforme conectate. Configureaza in Postiz.
                    </p>
                  ) : (
                    postizIntegrations.map((integration) => (
                      <div
                        key={integration.id}
                        onClick={() => toggleIntegration(integration.id)}
                        className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedIntegrations.includes(integration.id)
                            ? "border-pink-500 bg-pink-500/10"
                            : "border-border hover:border-muted-foreground"
                        }`}
                      >
                        <span className="text-xl">{getPlatformIcon(integration.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{integration.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {integration.identifier || integration.type}
                          </p>
                        </div>
                        {selectedIntegrations.includes(integration.id) && (
                          <Check className="h-4 w-4 text-pink-500 flex-shrink-0" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Caption */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Caption / Descriere
                </Label>
                <Textarea
                  value={postizCaption}
                  onChange={(e) => setPostizCaption(e.target.value)}
                  placeholder="Scrie caption-ul pentru postare..."
                  className="min-h-[100px]"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {postizCaption.length} caractere
                </p>
              </div>

              {/* Schedule */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Programare (optional)
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={postizScheduleDate}
                    onChange={(e) => setPostizScheduleDate(e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    type="time"
                    value={postizScheduleTime}
                    onChange={(e) => setPostizScheduleTime(e.target.value)}
                    className="w-32"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Lasa gol pentru a publica imediat
                </p>
              </div>

              {postizBulkMode && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    <strong>Mod bulk:</strong> Clipurile vor fi publicate la interval de 30 minute,
                    incepand cu ora selectata.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 p-4 border-t">
              <Button
                variant="outline"
                onClick={() => setShowPostizModal(false)}
              >
                Anuleaza
              </Button>
              <Button
                onClick={publishToPostiz}
                disabled={postizPublishing || selectedIntegrations.length === 0}
                className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
              >
                {postizPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Se publica...
                  </>
                ) : postizScheduleDate && postizScheduleTime ? (
                  <>
                    <Calendar className="h-4 w-4 mr-2" />
                    Programeaza
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4 mr-2" />
                    Publica Acum
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapper with Suspense for useSearchParams
export default function LibraryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
        </div>
      </div>
    }>
      <LibraryPageContent />
    </Suspense>
  );
}
