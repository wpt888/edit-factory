"use client";

import { useState, useEffect, useCallback, useRef, Suspense, useMemo } from "react";
import { usePolling } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Trash2, Loader2, X } from "lucide-react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { VideoFilters, defaultVideoFilters } from "@/components/video-enhancement-controls";
import { apiFetch, apiPost, apiPatch, apiDelete, handleApiError } from "@/lib/api";
import { toast } from "sonner";

import {
  Project,
  Clip,
  ClipContent,
  SubtitleSettings,
  Segment,
  loadConfig,
  saveConfig,
} from "@/components/library/types";
import { ProjectSidebar } from "@/components/library/project-sidebar";
import { ClipGallery } from "@/components/library/clip-gallery";
import { ClipEditorPanel } from "@/components/library/clip-editor-panel";
import { SegmentSelectionModal } from "@/components/library/segment-selection-modal";
import { PostizPublishModal } from "@/components/library/postiz-publish-modal";

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
  const [selectedPreset, setSelectedPreset] = useState<string>("instagram_reels");
  const [selectedElevenLabsModel, setSelectedElevenLabsModel] = useState("eleven_flash_v2_5");
  const [videoFilters, setVideoFilters] = useState<VideoFilters>(defaultVideoFilters);

  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [rendering, setRendering] = useState(false);

  // Rendering clip tracking — replaces raw setInterval pollClipStatus
  const [renderingClipIds, setRenderingClipIds] = useState<string[]>([]);

  // Generation tracking — projectId being polled
  const [pollingProjectId, setPollingProjectId] = useState<string | null>(null);

  // Progress tracking
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [generationProgress, setGenerationProgress] = useState<{
    percentage: number;
    currentStep: string | null;
    estimatedRemaining: number | null;
  } | null>(null);

  // Timer ref — keeps interval between renders
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Timer SIMPLE — starts when generating becomes true
  useEffect(() => {
    if (generating) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
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
  const [localVideoPath, setLocalVideoPath] = useState("");
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
  const [projectSegments, setProjectSegments] = useState<Segment[]>([]);
  const [generationMode, setGenerationMode] = useState<"ai" | "segments">("ai");
  const [selectionMode, setSelectionMode] = useState<"random" | "sequential" | "weighted">("random");
  const [assignedSegmentsCount, setAssignedSegmentsCount] = useState(0);

  // Postiz publishing state
  const [showPostizModal, setShowPostizModal] = useState(false);
  const [postizClipToPublish, setPostizClipToPublish] = useState<Clip | null>(null);
  const [postizBulkMode, setPostizBulkMode] = useState(false);

  // Workflow steps state
  const [workflowMode, setWorkflowMode] = useState<"video_only" | "with_audio">("video_only");
  const [scriptText, setScriptText] = useState("");
  const [generateTts, setGenerateTts] = useState(false);
  const [muteSourceVoice, setMuteSourceVoice] = useState(true);
  const [ttsPreviewDuration, setTtsPreviewDuration] = useState<number | null>(null);

  // Duration control
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
      clip: null,
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

  // ============== URL → STATE SYNC ==============
  const pendingClipId = useRef<string | null>(null);

  useEffect(() => {
    if (urlInitialized.current || projects.length === 0) return;

    const projectId = searchParams.get("project");
    const clipId = searchParams.get("clip");
    const mode = searchParams.get("mode");

    if (mode === "ai" || mode === "segments") {
      setGenerationMode(mode);
    }

    if (projectId) {
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        setSelectedProject(project);
        if (clipId) {
          pendingClipId.current = clipId;
        }
      }
    }

    urlInitialized.current = true;
  }, [projects, searchParams]);

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
      if (config.newProjectName) setNewProjectName(config.newProjectName);
      if (config.newProjectDescription) setNewProjectDescription(config.newProjectDescription);
      if (config.newProjectDuration) setNewProjectDuration(config.newProjectDuration);
      if (config.newProjectContext) setNewProjectContext(config.newProjectContext);
      if (config.variantCount) setVariantCount(config.variantCount);
      if (config.selectedPreset) setSelectedPreset(config.selectedPreset);
      if (config.selectedElevenLabsModel) setSelectedElevenLabsModel(config.selectedElevenLabsModel);
      if (config.localVideoPath) setLocalVideoPath(config.localVideoPath);
      if (config.editingTtsText) setEditingTtsText(config.editingTtsText);
      if (config.editingSrtContent) setEditingSrtContent(config.editingSrtContent);
      if (config.editingSubtitleSettings) setEditingSubtitleSettings(config.editingSubtitleSettings);
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
      selectedElevenLabsModel,
      localVideoPath,
      editingTtsText,
      editingSrtContent,
      editingSubtitleSettings,
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
    selectedElevenLabsModel,
    localVideoPath,
    editingTtsText,
    editingSrtContent,
    editingSubtitleSettings,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start polling when project is generating
  useEffect(() => {
    if (selectedProject?.status === "generating") {
      setGenerating(true);
      setPollingProjectId(selectedProject.id);
    } else {
      setPollingProjectId(null);
    }
  }, [selectedProject?.id, selectedProject?.status]);

  // usePolling for generation progress endpoint
  const generationProgressEndpoint = useMemo(
    () => (pollingProjectId ? `/library/projects/${pollingProjectId}/progress` : ""),
    [pollingProjectId]
  );

  const { startPolling: startProgressPolling, stopPolling: stopProgressPolling } = usePolling<{
    percentage?: number;
    current_step?: string;
    estimated_remaining?: number;
  }>({
    endpoint: generationProgressEndpoint,
    interval: 2000,
    enabled: false,
    onData: async (progress) => {
      setGenerationProgress({
        percentage: progress.percentage || 0,
        currentStep: progress.current_step ?? null,
        estimatedRemaining: progress.estimated_remaining ?? null,
      });
      if (pollingProjectId) {
        try {
          const projectRes = await apiFetch(`/library/projects/${pollingProjectId}`);
          if (projectRes.ok) {
            const project = await projectRes.json();
            setSelectedProject(project);
            setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)));
            if (project.status === "ready_for_triage" || project.status === "failed") {
              stopProgressPolling();
              setGenerating(false);
              setGenerationProgress(null);
              setPollingProjectId(null);
              if (project.status === "ready_for_triage") {
                fetchClips(pollingProjectId);
              }
            }
          }
        } catch (error) {
          handleApiError(error, "Eroare la verificarea statusului proiectului");
        }
      }
    },
  });

  // Start/stop progress polling when pollingProjectId changes
  useEffect(() => {
    if (pollingProjectId && generationProgressEndpoint) {
      startProgressPolling();
    } else {
      stopProgressPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingProjectId]);

  // ============== API HANDLERS ==============

  const fetchProjects = async () => {
    try {
      const res = await apiFetch("/library/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      handleApiError(error, "Eroare la incarcarea proiectelor");
    }
  };

  const fetchPresets = async () => {
    try {
      const res = await apiFetch("/library/export-presets");
      if (res.ok) {
        const data = await res.json();
        const defaultPreset = data.presets?.find((p: { is_default: boolean; name: string }) => p.is_default);
        if (defaultPreset) {
          setSelectedPreset(defaultPreset.name);
        }
      }
    } catch (error) {
      handleApiError(error, "Eroare la incarcarea preseturilor");
    }
  };

  const fetchClips = async (projectId: string) => {
    try {
      const res = await apiFetch(`/library/projects/${projectId}/clips`);
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips || []);
      }
    } catch (error) {
      handleApiError(error, "Eroare la incarcarea clipurilor");
    }
  };

  const fetchClipContent = async (clipId: string) => {
    try {
      const res = await apiFetch(`/library/clips/${clipId}`);
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
      handleApiError(error, "Eroare la incarcarea continutului clipului");
    }
  };

  const fetchProjectSegments = async (projectId: string) => {
    try {
      const res = await apiFetch(`/segments/projects/${projectId}/segments`);
      if (res.ok) {
        const data = await res.json();
        setProjectSegments(data);
        setAssignedSegmentsCount(data.length);
        if (data.length > 0) {
          setGenerationMode("segments");
        }
      }
    } catch (error) {
      handleApiError(error, "Eroare la incarcarea segmentelor proiectului");
    }
  };

  // Create error state
  const [createError, setCreateError] = useState<string | null>(null);

  const createProject = async () => {
    if (!newProjectName.trim()) return;

    setLoading(true);
    setCreateError(null);
    try {
      const res = await apiPost("/library/projects", {
        name: newProjectName,
        description: newProjectDescription,
        target_duration: newProjectDuration,
        context_text: newProjectContext,
      });

      if (res.ok) {
        const project = await res.json();
        setProjects([project, ...projects]);
        setSelectedProject(project);
        setShowNewProject(false);
        setNewProjectName("");
        setNewProjectDescription("");
        setNewProjectContext("");
      } else {
        let detail = "Eroare la crearea proiectului";
        try {
          const errData = await res.json();
          detail = errData.detail || detail;
        } catch {}
        setCreateError(`${res.status}: ${detail}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Eroare de rețea";
      setCreateError(msg);
      handleApiError(error, "Eroare la crearea proiectului");
    } finally {
      setLoading(false);
    }
  };

  const requestDeleteProject = (project: Project) => {
    setProjectToDelete(project);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      const res = await apiDelete(`/library/projects/${projectToDelete.id}`);

      if (res.ok) {
        setProjects(projects.filter((p) => p.id !== projectToDelete.id));
        if (selectedProject?.id === projectToDelete.id) {
          setSelectedProject(null);
          setClips([]);
        }
      }
    } catch (error) {
      handleApiError(error, "Eroare la stergerea proiectului");
    } finally {
      setProjectToDelete(null);
    }
  };

  const handleSelectProject = (project: Project) => {
    setSelectedProject(project);
    fetchClips(project.id);
    fetchProjectSegments(project.id);
    setSelectedClip(null);
  };

  const generateRawClips = async () => {
    if (!selectedProject || (!uploadVideo && !localVideoPath)) return;

    setGenerating(true);
    setGenerationProgress({
      percentage: 0,
      currentStep: "Inițializare...",
      estimatedRemaining: null,
    });

    try {
      const formData = new FormData();
      if (uploadVideo) {
        formData.append("video", uploadVideo);
      } else if (localVideoPath) {
        formData.append("video_path", localVideoPath);
      }
      formData.append("variant_count", variantCount.toString());

      const res = await apiFetch(`/library/projects/${selectedProject.id}/generate`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        setSelectedProject({
          ...selectedProject,
          status: "generating",
        });
      } else {
        setGenerating(false);
        setGenerationProgress(null);
      }
    } catch (error) {
      handleApiError(error, "Eroare la generarea clipurilor");
      setGenerating(false);
      setGenerationProgress(null);
    }
  };

  const cancelGeneration = async () => {
    if (selectedProject) {
      try {
        await apiPost(`/library/projects/${selectedProject.id}/cancel`);
      } catch (error) {
        handleApiError(error, "Eroare la anularea generarii");
      }

      const projectRes = await apiFetch(`/library/projects/${selectedProject.id}`);
      if (projectRes.ok) {
        const project = await projectRes.json();
        setSelectedProject(project);
        setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)));
      }
    }

    setGenerating(false);
    setGenerationProgress(null);
    setElapsedTime(0);
  };

  const generateFromSegments = async () => {
    if (!selectedProject) return;

    if (assignedSegmentsCount === 0) {
      toast.error("Trebuie sa asignezi segmente mai intai!");
      return;
    }

    try {
      setGenerating(true);

      const requestBody: Record<string, unknown> = {
        variant_count: variantCount,
        selection_mode: selectionMode,
        target_duration: targetDuration,
        mute_source_voice: muteSourceVoice,
      };

      if (workflowMode === "with_audio" && scriptText.trim()) {
        requestBody.tts_text = scriptText;
        requestBody.generate_tts = generateTts;
      }

      const res = await apiPost(
        `/library/projects/${selectedProject.id}/generate-from-segments`,
        requestBody
      );

      if (res.ok) {
        setSelectedProject({
          ...selectedProject,
          status: "generating",
        });
      } else {
        const error = await res.json();
        const errorMsg =
          typeof error === "object"
            ? error.detail || JSON.stringify(error)
            : String(error);
        toast.error(errorMsg || "Eroare la generare");
        setGenerating(false);
      }
    } catch (error) {
      handleApiError(error, "Eroare la generarea din segmente");
      setGenerating(false);
    }
  };

  const toggleClipSelection = async (clipId: string, selected: boolean) => {
    try {
      const res = await apiPatch(`/library/clips/${clipId}/select?selected=${selected}`);

      if (res.ok) {
        setClips(clips.map((c) => (c.id === clipId ? { ...c, is_selected: selected } : c)));
        if (selectedProject) {
          const projectRes = await apiFetch(`/library/projects/${selectedProject.id}`);
          if (projectRes.ok) {
            setSelectedProject(await projectRes.json());
          }
        }
      }
    } catch (error) {
      handleApiError(error, "Eroare la modificarea selectiei");
    }
  };

  const deleteClip = async (clipId: string) => {
    try {
      const res = await apiDelete(`/library/clips/${clipId}`);

      if (res.ok) {
        const newClips = clips.filter((c) => c.id !== clipId);
        setClips(newClips);
        if (selectedClip?.id === clipId) {
          setSelectedClip(null);
        }

        if (selectedProject) {
          const projectRes = await apiFetch(`/library/projects/${selectedProject.id}`);
          if (projectRes.ok) {
            const updatedProject = await projectRes.json();
            setSelectedProject(updatedProject);
            setProjects(projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)));
          }
        }
      }
    } catch (error) {
      handleApiError(error, "Eroare la stergerea clipului");
    }
  };

  const saveClipContent = async () => {
    if (!selectedClip) return;

    try {
      const res = await apiFetch(`/library/clips/${selectedClip.id}/content`, {
        method: "PUT",
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
      handleApiError(error, "Eroare la salvarea continutului clipului");
    }
  };

  const renderFinalClip = async (clipId: string) => {
    setRendering(true);
    try {
      const formData = new FormData();
      formData.append("preset_name", selectedPreset);
      formData.append("elevenlabs_model", selectedElevenLabsModel);

      // Video enhancement filters (Phase 9)
      formData.append("enable_denoise", videoFilters.enableDenoise.toString());
      formData.append("denoise_strength", videoFilters.denoiseStrength.toString());
      formData.append("enable_sharpen", videoFilters.enableSharpen.toString());
      formData.append("sharpen_amount", videoFilters.sharpenAmount.toString());
      formData.append("enable_color", videoFilters.enableColor.toString());
      formData.append("brightness", videoFilters.brightness.toString());
      formData.append("contrast", videoFilters.contrast.toString());
      formData.append("saturation", videoFilters.saturation.toString());

      // Subtitle enhancement (Phase 11)
      formData.append("shadow_depth", (editingSubtitleSettings.shadowDepth ?? 0).toString());
      formData.append("enable_glow", (editingSubtitleSettings.enableGlow ?? false).toString());
      formData.append("glow_blur", (editingSubtitleSettings.glowBlur ?? 0).toString());
      formData.append("adaptive_sizing", (editingSubtitleSettings.adaptiveSizing ?? false).toString());

      const res = await apiFetch(`/library/clips/${clipId}/render`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        // Add clip to rendering pollers (replaces raw setInterval pollClipStatus)
        setRenderingClipIds((prev) => [...prev, clipId]);
      } else {
        setRendering(false);
      }
    } catch (error) {
      handleApiError(error, "Eroare la renderizarea clipului");
      setRendering(false);
    }
  };

  const renameClip = async (clipId: string, newName: string) => {
    try {
      const res = await apiPatch(`/library/clips/${clipId}`, { variant_name: newName });
      if (res.ok) {
        setClips((prev) =>
          prev.map((c) => (c.id === clipId ? { ...c, variant_name: newName } : c))
        );
        setRenamingClipId(null);
        setRenameValue("");
      }
    } catch (error) {
      handleApiError(error, "Eroare la redenumirea clipului");
    }
  };

  const resetProject = async () => {
    if (!selectedProject) return;
    try {
      const res = await apiPatch(`/library/projects/${selectedProject.id}`, { status: "draft" });
      if (res.ok) {
        const updated = await res.json();
        setSelectedProject(updated);
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
    } catch (error) {
      handleApiError(error, "Eroare la resetarea proiectului");
    }
  };

  // Postiz handlers
  const openPostizModal = (clip: Clip) => {
    setPostizClipToPublish(clip);
    setPostizBulkMode(false);
    setShowPostizModal(true);
  };

  const openBulkPostizModal = () => {
    setPostizClipToPublish(null);
    setPostizBulkMode(true);
    setShowPostizModal(true);
  };

  // Handle clip status update from ClipStatusPoller
  const handleClipStatusUpdate = (updatedClip: Clip) => {
    setClips((prevClips) =>
      prevClips.map((c) => (c.id === updatedClip.id ? updatedClip : c))
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left sidebar */}
          <div className="col-span-3">
            <ProjectSidebar
              projects={projects}
              selectedProject={selectedProject}
              onSelectProject={handleSelectProject}
              onDeleteProject={requestDeleteProject}
              onNewProject={() => setShowNewProject(true)}
            />
          </div>

          {/* Main content */}
          <div className="col-span-6">
            <ClipGallery
              selectedProject={selectedProject}
              clips={clips}
              selectedClip={selectedClip}
              generating={generating}
              generationProgress={generationProgress}
              elapsedTime={elapsedTime}
              generationMode={generationMode}
              setGenerationMode={setGenerationMode}
              projectSegments={projectSegments}
              setProjectSegments={setProjectSegments}
              variantCount={variantCount}
              setVariantCount={setVariantCount}
              uploadVideo={uploadVideo}
              setUploadVideo={setUploadVideo}
              localVideoPath={localVideoPath}
              setLocalVideoPath={setLocalVideoPath}
              workflowMode={workflowMode}
              setWorkflowMode={setWorkflowMode}
              scriptText={scriptText}
              setScriptText={setScriptText}
              generateTts={generateTts}
              setGenerateTts={setGenerateTts}
              muteSourceVoice={muteSourceVoice}
              setMuteSourceVoice={setMuteSourceVoice}
              durationMode={durationMode}
              setDurationMode={setDurationMode}
              manualDuration={manualDuration}
              setManualDuration={setManualDuration}
              ttsPreviewDuration={ttsPreviewDuration}
              setTtsPreviewDuration={setTtsPreviewDuration}
              selectionMode={selectionMode}
              setSelectionMode={setSelectionMode}
              targetDuration={targetDuration}
              renamingClipId={renamingClipId}
              setRenamingClipId={setRenamingClipId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              rendering={rendering}
              setRendering={setRendering}
              renderingClipIds={renderingClipIds}
              setRenderingClipIds={setRenderingClipIds}
              onSelectClip={(clip) => {
                setSelectedClip(clip);
                fetchClipContent(clip.id);
                setVideoFilters(defaultVideoFilters);
              }}
              onGenerateAI={generateRawClips}
              onGenerateSegments={generateFromSegments}
              onCancelGeneration={cancelGeneration}
              onToggleSelection={toggleClipSelection}
              onDeleteClip={(clip) => {
                setClipToDelete(clip);
                setShowDeleteDialog(true);
              }}
              onOpenSegmentModal={() => setShowSegmentModal(true)}
              onOpenPostizModal={openPostizModal}
              onOpenBulkPostizModal={openBulkPostizModal}
              onRenameClip={renameClip}
              onResetProject={resetProject}
              onClipStatusUpdate={handleClipStatusUpdate}
            />
          </div>

          {/* Right sidebar */}
          <div className="col-span-3">
            <ClipEditorPanel
              selectedClip={selectedClip}
              clipContent={clipContent}
              editingTtsText={editingTtsText}
              setEditingTtsText={setEditingTtsText}
              editingSrtContent={editingSrtContent}
              setEditingSrtContent={setEditingSrtContent}
              editingSubtitleSettings={editingSubtitleSettings}
              setEditingSubtitleSettings={setEditingSubtitleSettings}
              selectedPreset={selectedPreset}
              setSelectedPreset={setSelectedPreset}
              selectedElevenLabsModel={selectedElevenLabsModel}
              setSelectedElevenLabsModel={setSelectedElevenLabsModel}
              videoFilters={videoFilters}
              setVideoFilters={setVideoFilters}
              rendering={rendering}
              onSave={saveClipContent}
              onRender={renderFinalClip}
            />
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

          {createError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              {createError}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowNewProject(false);
                setCreateError(null);
              }}
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

      {/* Delete Clip Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmare Ștergere</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Ești sigur că vrei să ștergi clipul &quot;
              {clipToDelete?.variant_name || `Varianta ${clipToDelete?.variant_index}`}&quot;?
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

      {/* Project delete confirmation */}
      {projectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/80"
            onClick={() => setProjectToDelete(null)}
          />
          <div className="relative z-10 bg-background border border-border rounded-lg shadow-lg w-full max-w-md mx-4 animate-in fade-in-0 zoom-in-95">
            <div className="p-6 pb-4">
              <div className="flex items-center gap-2 text-lg font-semibold text-destructive">
                <Trash2 className="h-5 w-5" />
                Confirmare Ștergere
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Sigur vrei să ștergi proiectul <strong>{projectToDelete.name}</strong> și toate
                clipurile asociate? Această acțiune nu poate fi anulată.
              </p>
              <button
                onClick={() => setProjectToDelete(null)}
                className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
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

      {/* Segment Selection Modal */}
      <SegmentSelectionModal
        open={showSegmentModal}
        onClose={() => setShowSegmentModal(false)}
        selectedProject={selectedProject}
        projectSegments={projectSegments}
        onSegmentsChange={(segments) => {
          setProjectSegments(segments);
          setAssignedSegmentsCount(segments.length);
          if (segments.length > 0) {
            setGenerationMode("segments");
          }
        }}
      />

      {/* Postiz Publish Modal */}
      <PostizPublishModal
        open={showPostizModal}
        onClose={() => setShowPostizModal(false)}
        clip={postizClipToPublish}
        bulkMode={postizBulkMode}
        clips={clips}
      />
    </div>
  );
}

// Wrapper with Suspense for useSearchParams
export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background p-6">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
          </div>
        </div>
      }
    >
      <LibraryPageContent />
    </Suspense>
  );
}
