"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
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
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DollarSign } from "lucide-react";

// Shared components
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { TTSPanel } from "@/components/video-processing/tts-panel";
import { SecondaryVideosForm } from "@/components/video-processing/secondary-videos-form";
import { ProgressTracker } from "@/components/video-processing/progress-tracker";
import { VariantTriage } from "@/components/video-processing/variant-triage";
import {
  SubtitleSettings as SharedSubtitleSettings,
  SubtitleLine as SharedSubtitleLine,
  Variant,
  SecondaryVideo,
  DEFAULT_SUBTITLE_SETTINGS,
  FONT_OPTIONS,
  COLOR_PRESETS,
} from "@/types/video-processing";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001/api/v1";

interface Job {
  job_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: string;
  error?: string;
  result?: {
    final_video?: string;
    variants?: Array<{
      variant_index: number;
      variant_name: string;
      final_video: string;
    }>;
    processed_videos?: Array<{
      original: string;
      with_tts?: string;
      error?: string;
      status: string;
    }>;
  };
}

interface VideoInfo {
  filename: string;
  duration: number;
}

interface Segment {
  start_time: number;
  end_time: number;
  duration: number;
  motion_score: number;
}

interface AnalysisResult {
  video_info?: VideoInfo;
  segments?: Segment[];
}

interface SubtitleLine {
  id: number;
  start: string;
  end: string;
  text: string;
}

interface SubtitleSettings {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
  position: "top" | "center" | "bottom";
  marginV: number;
  positionY: number; // 0-100% de la jos in sus
}

const fontFamilies = [
  { value: "var(--font-montserrat), Montserrat, sans-serif", label: "Montserrat Bold" },
  { value: "var(--font-roboto), Roboto, sans-serif", label: "Roboto" },
  { value: "var(--font-open-sans), 'Open Sans', sans-serif", label: "Open Sans" },
  { value: "var(--font-oswald), Oswald, sans-serif", label: "Oswald" },
  { value: "var(--font-bebas-neue), 'Bebas Neue', sans-serif", label: "Bebas Neue" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Helvetica, sans-serif", label: "Helvetica" },
  { value: "Impact, sans-serif", label: "Impact" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "Georgia, serif", label: "Georgia" },
];

const colorPresets = [
  { name: "Alb", value: "#FFFFFF" },
  { name: "Negru", value: "#000000" },
  { name: "Galben", value: "#FFFF00" },
  { name: "Rosu", value: "#FF0000" },
  { name: "Verde", value: "#00FF00" },
  { name: "Albastru", value: "#0000FF" },
  { name: "Cyan", value: "#00FFFF" },
  { name: "Magenta", value: "#FF00FF" },
  { name: "Portocaliu", value: "#FF8C00" },
];

function parseSRT(content: string): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  // Normalizam line endings: \r\n -> \n si \r -> \n
  const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalizedContent.trim().split(/\n\n+/);

  for (const block of blocks) {
    const parts = block.split("\n");
    if (parts.length >= 3) {
      const id = parseInt(parts[0], 10);
      const timeParts = parts[1].split(" --> ");
      if (timeParts.length === 2) {
        lines.push({
          id,
          start: timeParts[0].trim(),
          end: timeParts[1].trim(),
          text: parts.slice(2).join("\n").trim(),
        });
      }
    }
  }

  return lines;
}

function generateSRT(lines: SubtitleLine[]): string {
  return lines
    .map((line) => `${line.id}\n${line.start} --> ${line.end}\n${line.text}`)
    .join("\n\n");
}

export default function AppPage() {
  // Active tab state - synced with URL
  const [activeTab, setActiveTab] = useState<string>("upload");

  // Processing time tracking for ETA
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string>("");

  // Flag pentru a preveni suprascrierea localStorage la mount
  const isInitialMount = useRef(true);

  // File states
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [outputName, setOutputName] = useState("");
  const [targetDuration, setTargetDuration] = useState(20);
  const [scriptText, setScriptText] = useState("");
  const [contextText, setContextText] = useState(""); // Context for AI frame matching

  // Subtitle settings
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>({
    fontSize: 48,
    fontFamily: "var(--font-montserrat), Montserrat, sans-serif",
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 3,
    position: "bottom",
    marginV: 30,
    positionY: 85, // 85% = aproape de jos (0=sus, 100=jos)
  });

  // Subtitle editor
  const [subtitleLines, setSubtitleLines] = useState<SubtitleLine[]>([]);
  const [editingSubtitle, setEditingSubtitle] = useState<SubtitleLine | null>(null);
  const [showSubtitleEditor, setShowSubtitleEditor] = useState(false);

  // Export variants
  const [variantCount, setVariantCount] = useState(1);

  // Secondary videos for keyword triggers
  const [secondaryVideos, setSecondaryVideos] = useState<Array<{
    file: File | null;
    keywords: string;
  }>>([
    { file: null, keywords: "" },
    { file: null, keywords: "" },
    { file: null, keywords: "" },
  ]);
  const [secondarySegmentDuration, setSecondarySegmentDuration] = useState(2.0);
  const [generateAudio, setGenerateAudio] = useState(false); // Default: generate without audio first
  const [muteSourceVoice, setMuteSourceVoice] = useState(true); // Mute voice from source video (keep effects)
  const [generatedVariants, setGeneratedVariants] = useState<Array<{
    variant_index: number;
    variant_name: string;
    final_video: string;
    selected: boolean;
  }>>([]);
  const [ttsJobId, setTtsJobId] = useState<string | null>(null);
  const [ttsStatus, setTtsStatus] = useState<string>("");
  const [isAddingTts, setIsAddingTts] = useState(false);

  // Video info for preview - default portrait (9:16)
  const [videoInfo, setVideoInfo] = useState<{
    width: number;
    height: number;
    duration: number;
    fps: number;
    aspect_ratio: string;
    is_vertical: boolean;
  }>({
    width: 1080,
    height: 1920,
    duration: 0,
    fps: 30,
    aspect_ratio: "portrait",
    is_vertical: true,
  });
  const [isLoadingVideoInfo, setIsLoadingVideoInfo] = useState(false);

  // Processing states
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  // Sync tab state with URL params on mount and URL changes
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabFromUrl = params.get("tab");
    if (tabFromUrl && ["upload", "subtitles", "export"].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }

    // Also listen for popstate (back/forward navigation)
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab && ["upload", "subtitles", "export"].includes(tab)) {
        setActiveTab(tab);
      } else {
        setActiveTab("upload");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Handle tab change - update URL immediately
  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", newTab);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({ tab: newTab }, "", newUrl);
  };

  // Load saved values from localStorage on mount
  useEffect(() => {
    const savedScriptText = localStorage.getItem("editai_scriptText");
    const savedPositionY = localStorage.getItem("editai_positionY");

    if (savedScriptText) {
      setScriptText(savedScriptText);
    }
    if (savedPositionY) {
      setSubtitleSettings(prev => ({
        ...prev,
        positionY: parseInt(savedPositionY, 10)
      }));
    }
  }, []);

  // Save scriptText to localStorage when it changes
  useEffect(() => {
    if (scriptText) {
      localStorage.setItem("editai_scriptText", scriptText);
    }
  }, [scriptText]);

  // Save positionY to localStorage when it changes (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    localStorage.setItem("editai_positionY", subtitleSettings.positionY.toString());
  }, [subtitleSettings.positionY]);

  // Load SRT file content when uploaded
  useEffect(() => {
    if (srtFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const parsed = parseSRT(content);
        setSubtitleLines(parsed);
      };
      reader.readAsText(srtFile);
    } else {
      setSubtitleLines([]);
    }
  }, [srtFile]);

  // Fetch video info when video file is selected
  useEffect(() => {
    if (videoFile) {
      const fetchVideoInfo = async () => {
        setIsLoadingVideoInfo(true);
        try {
          const formData = new FormData();
          formData.append("video", videoFile);

          const response = await fetch(`${API_BASE}/video-info`, {
            method: "POST",
            body: formData,
          });

          if (response.ok) {
            const info = await response.json();
            setVideoInfo(info);

            // Auto-adjust font size based on video resolution
            // For vertical video (1080x1920), font should be proportionally larger
            const baseFontSize = info.is_vertical ? 48 : 24;
            const scaleFactor = Math.min(info.width, info.height) / 1080;
            const adjustedFontSize = Math.round(baseFontSize * scaleFactor);

            setSubtitleSettings(prev => ({
              ...prev,
              fontSize: Math.max(16, Math.min(72, adjustedFontSize)),
              marginV: info.is_vertical ? 80 : 30
            }));
          }
        } catch (err) {
          console.error("Failed to get video info:", err);
        } finally {
          setIsLoadingVideoInfo(false);
        }
      };

      fetchVideoInfo();
    }
    // Nu resetam la null - pastram default portrait
  }, [videoFile]);

  const refreshJobs = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/jobs`);
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  }, []);

  const pollJobStatus = useCallback(async (jobId: string) => {
    let isCancelled = false;

    const poll = async () => {
      if (isCancelled) return;

      try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}`);
        const job: Job = await response.json();

        if (isCancelled) return;

        setStatusText(job.progress || job.status);

        if (job.status === "processing" || job.status === "pending") {
          const newProgress = job.status === "pending" ? 10 : 50;
          setProgress(newProgress);

          // Calculate ETA based on elapsed time and progress
          if (processingStartTime && newProgress > 10) {
            const elapsed = (Date.now() - processingStartTime) / 1000; // seconds
            const progressDone = newProgress - 10; // Progress made since start
            const progressRemaining = 100 - newProgress;
            const timePerPercent = elapsed / progressDone;
            const eta = Math.round(timePerPercent * progressRemaining);

            if (eta > 60) {
              const minutes = Math.floor(eta / 60);
              const seconds = eta % 60;
              setEstimatedTimeRemaining(`~${minutes}m ${seconds}s ramas`);
            } else if (eta > 0) {
              setEstimatedTimeRemaining(`~${eta}s ramas`);
            }
          }

          setTimeout(poll, 2000);
        } else if (job.status === "completed") {
          setProgress(100);
          setResult({ video_info: { filename: jobId, duration: 0 } });
          setIsProcessing(false);
          refreshJobs();

          // Capture generated variants for triage
          if (job.result?.variants && Array.isArray(job.result.variants)) {
            setGeneratedVariants(
              job.result.variants.map((v: any) => ({
                variant_index: v.variant_index,
                variant_name: v.variant_name,
                final_video: v.final_video,
                selected: false
              }))
            );
          }
        } else if (job.status === "failed") {
          setError(job.error || "Job esuat");
          setIsProcessing(false);
        }
      } catch (err) {
        if (isCancelled) return;
        setError(err instanceof Error ? err.message : "Eroare necunoscuta");
        setIsProcessing(false);
      }
    };

    poll();

    // Return cleanup function
    return () => { isCancelled = true; };
  }, [refreshJobs, processingStartTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!videoFile) {
      setError("Selecteaza un videoclip!");
      return;
    }

    // Check if we have secondary videos with keywords
    const hasSecondaryVideos = secondaryVideos.some(sv => sv.file && sv.keywords.trim());

    // For multi-video, SRT is required
    if (hasSecondaryVideos && !srtFile && subtitleLines.length === 0) {
      setError("Pentru videouri secundare cu keywords, trebuie sa incarci un fisier SRT!");
      return;
    }

    setIsProcessing(true);
    setProgress(10);
    setProcessingStartTime(Date.now());
    setEstimatedTimeRemaining("");
    setError(null);
    setResult(null);
    setGeneratedVariants([]); // Reset variants from previous job
    setStatusText("Se incarca...");

    const formData = new FormData();

    if (hasSecondaryVideos) {
      // Multi-video endpoint
      formData.append("main_video", videoFile);

      // SRT is required for multi-video
      if (subtitleLines.length > 0) {
        const srtContent = generateSRT(subtitleLines);
        const srtBlob = new Blob([srtContent], { type: "text/plain" });
        formData.append("srt", srtBlob, "subtitles.srt");
      } else if (srtFile) {
        formData.append("srt", srtFile);
      }

      // Add secondary videos with keywords
      secondaryVideos.forEach((sv, idx) => {
        if (sv.file && sv.keywords.trim()) {
          formData.append(`secondary_video_${idx + 1}`, sv.file);
          formData.append(`secondary_keywords_${idx + 1}`, sv.keywords.trim());
        }
      });

      formData.append("secondary_segment_duration", secondarySegmentDuration.toString());
    } else {
      // Standard single-video endpoint
      formData.append("video", videoFile);

      // Generate modified SRT if we have edited subtitles
      if (subtitleLines.length > 0) {
        const srtContent = generateSRT(subtitleLines);
        const srtBlob = new Blob([srtContent], { type: "text/plain" });
        formData.append("srt", srtBlob, "subtitles.srt");
      } else if (srtFile) {
        formData.append("srt", srtFile);
      }
    }

    if (audioFile) formData.append("audio", audioFile);
    if (outputName) formData.append("output_name", outputName);
    formData.append("target_duration", targetDuration.toString());
    if (scriptText) formData.append("script_text", scriptText);
    if (contextText) formData.append("context_text", contextText);

    // Add subtitle settings
    formData.append("subtitle_settings", JSON.stringify(subtitleSettings));

    // Add variant count
    formData.append("variant_count", variantCount.toString());

    // Add generate_audio flag
    formData.append("generate_audio", generateAudio.toString());
    // Add mute_source_voice flag
    formData.append("mute_source_voice", muteSourceVoice.toString());

    try {
      // Use multi-video endpoint if we have secondary videos
      const endpoint = hasSecondaryVideos ? `${API_BASE}/jobs/multi-video` : `${API_BASE}/jobs`;

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      const job = await response.json();

      if (response.ok) {
        setCurrentJobId(job.job_id);
        setStatusText(`Job creat: ${job.job_id}`);
        pollJobStatus(job.job_id);
      } else {
        throw new Error(job.detail || "Eroare la creare job");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Eroare necunoscuta";
      setError(`Eroare: ${errorMsg}. Verifica consola browser (F12) pentru detalii.`);
      setIsProcessing(false);
    }
  };

  const handleAddTts = async () => {
    const selectedVideos = generatedVariants.filter(v => v.selected);
    if (selectedVideos.length === 0) {
      setError("Selectează cel puțin o variantă!");
      return;
    }

    if (!scriptText.trim()) {
      setError("Scrie textul pentru voice-over în câmpul 'Text pentru TTS'!");
      return;
    }

    setIsAddingTts(true);
    setTtsStatus("Se inițializează...");
    setError(null);

    const formData = new FormData();
    formData.append("video_paths", JSON.stringify(selectedVideos.map(v => v.final_video)));
    formData.append("tts_text", scriptText);
    formData.append("output_suffix", "_with_tts");

    try {
      const response = await fetch(`${API_BASE}/tts/add-to-videos`, {
        method: "POST",
        body: formData,
      });

      const job = await response.json();

      if (response.ok) {
        setTtsJobId(job.job_id);
        setTtsStatus(`Job creat: ${job.job_id}`);
        pollTtsJobStatus(job.job_id);
      } else {
        throw new Error(job.detail || "Eroare la crearea job-ului TTS");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Eroare necunoscută";
      setError(`Eroare TTS: ${errorMsg}`);
      setIsAddingTts(false);
    }
  };

  const pollTtsJobStatus = useCallback(async (jobId: string) => {
    let isCancelled = false;

    const poll = async () => {
      if (isCancelled) return;

      try {
        const response = await fetch(`${API_BASE}/jobs/${jobId}`);
        const job = await response.json();

        if (isCancelled) return;

        setTtsStatus(job.progress || job.status);

        if (job.status === "processing" || job.status === "pending") {
          setTimeout(poll, 2000);
        } else if (job.status === "completed") {
          setIsAddingTts(false);
          setTtsStatus("TTS adăugat cu succes!");
          refreshJobs();

          // Update variants with TTS versions
          if (job.result?.processed_videos) {
            const ttsVideos = job.result.processed_videos.filter((v: any) => v.status === "success");
            if (ttsVideos.length > 0) {
              alert(`Voice-over adăugat la ${ttsVideos.length} videoclipuri!\n\nFișierele sunt salvate cu sufixul '_with_tts'.`);
            }
          }
        } else if (job.status === "failed") {
          setError(job.error || "Job TTS eșuat");
          setIsAddingTts(false);
        }
      } catch (err) {
        if (isCancelled) return;
        setError(err instanceof Error ? err.message : "Eroare la verificarea statusului");
        setIsAddingTts(false);
      }
    };

    poll();

    return () => { isCancelled = true; };
  }, [refreshJobs]);

  const handleAnalyzeOnly = async () => {
    if (!videoFile) {
      setError("Selecteaza un videoclip!");
      return;
    }

    setIsProcessing(true);
    setProgress(50);
    setError(null);
    setResult(null);
    setStatusText("Se analizeaza...");

    const formData = new FormData();
    formData.append("video", videoFile);
    formData.append("target_duration", targetDuration.toString());

    try {
      const response = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
        setProgress(100);
      } else {
        throw new Error(data.detail || "Eroare la analiza");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare necunoscuta");
    } finally {
      setIsProcessing(false);
    }
  };

  const updateSubtitleLine = (id: number, newText: string) => {
    setSubtitleLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, text: newText } : line))
    );
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "completed":
        return "default";
      case "processing":
        return "secondary";
      case "failed":
        return "destructive";
      default:
        return "outline";
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Main Content */}
      <main className="pt-8 pb-16">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">
              Editor Video AI
            </h1>
            <p className="text-muted-foreground">
              Incarca un videoclip si lasa AI-ul sa creeze continut optimizat pentru social media.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Form Card */}
            <div className="lg:col-span-2">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>Procesare Video Noua</CardTitle>
                  <CardDescription>
                    Incarca un videoclip si configureaza optiunile de procesare
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Context Section - Prima etapa */}
                  <div className="mb-6 p-4 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge className="bg-primary text-primary-foreground">Pasul 0</Badge>
                      <h3 className="font-semibold">Context pentru AI</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      Descrie ce vrei să apară în video. AI-ul va selecta cadrele care se potrivesc cel mai bine cu descrierea ta.
                    </p>
                    <Textarea
                      placeholder="Ex: Video despre un parfum de lux pentru bărbați. Vreau cadre cu sticla de parfum, close-up-uri elegante, atmosferă premium, lumini calde..."
                      value={contextText}
                      onChange={(e) => setContextText(e.target.value)}
                      className="bg-background/80 min-h-[100px] border-primary/30 focus:border-primary"
                    />
                    {contextText && (
                      <p className="text-xs text-primary mt-2">
                        ✓ Context setat ({contextText.length} caractere) - AI-ul va folosi acest context pentru a selecta cadrele
                      </p>
                    )}
                  </div>

                  <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-6">
                      <TabsTrigger value="upload">1. Fisiere</TabsTrigger>
                      <TabsTrigger value="subtitles">2. Subtitrari</TabsTrigger>
                      <TabsTrigger value="export">3. Export</TabsTrigger>
                    </TabsList>

                    {/* Tab 1: File Upload */}
                    <TabsContent value="upload" className="space-y-6">
                      {/* Video Upload */}
                      <div className="space-y-2">
                        <Label htmlFor="video">Videoclip *</Label>
                        <Input
                          id="video"
                          type="file"
                          accept=".mp4,.mov,.avi,.mkv"
                          onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                          className="bg-muted/50"
                          required
                        />
                      </div>

                      {/* Audio & SRT Row */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="audio">
                            Fisier Audio{" "}
                            <span className="text-muted-foreground text-xs">(optional)</span>
                          </Label>
                          <Input
                            id="audio"
                            type="file"
                            accept=".mp3,.wav"
                            onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                            className="bg-muted/50"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="srt">
                            Fisier SRT{" "}
                            <span className="text-muted-foreground text-xs">(optional)</span>
                          </Label>
                          <Input
                            id="srt"
                            type="file"
                            accept=".srt"
                            onChange={(e) => setSrtFile(e.target.files?.[0] || null)}
                            className="bg-muted/50"
                          />
                        </div>
                      </div>

                      {/* Output Name & Duration Row */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="outputName">Nume Output</Label>
                          <Input
                            id="outputName"
                            type="text"
                            placeholder="reel_parfum_1"
                            value={outputName}
                            onChange={(e) => setOutputName(e.target.value)}
                            className="bg-muted/50"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="targetDuration">Durata Tinta (secunde)</Label>
                          <Input
                            id="targetDuration"
                            type="number"
                            min={5}
                            max={120}
                            value={targetDuration}
                            onChange={(e) => setTargetDuration(parseInt(e.target.value))}
                            className="bg-muted/50"
                          />
                        </div>
                      </div>

                      {/* Script Text */}
                      <div className="space-y-2">
                        <Label htmlFor="scriptText">
                          Text pentru TTS{" "}
                          <span className="text-muted-foreground text-xs">
                            (optional - pentru generare voiceover)
                          </span>
                        </Label>
                        <Textarea
                          id="scriptText"
                          placeholder="Scrie textul care va fi citit..."
                          value={scriptText}
                          onChange={(e) => setScriptText(e.target.value)}
                          className="bg-muted/50 min-h-[100px]"
                        />
                      </div>
                    </TabsContent>

                    {/* Tab 2: Subtitle Settings */}
                    <TabsContent value="subtitles" className="space-y-6">
                      {/* Subtitle Style Settings */}
                      <div className="space-y-4">
                        <h3 className="font-semibold">Stil Subtitrari</h3>

                        {/* Font Size */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <Label>Marime Font</Label>
                            <span className="text-sm text-muted-foreground">{subtitleSettings.fontSize}px</span>
                          </div>
                          <Slider
                            value={[subtitleSettings.fontSize]}
                            onValueChange={([value]) => setSubtitleSettings(s => ({ ...s, fontSize: value }))}
                            min={12}
                            max={72}
                            step={1}
                            className="w-full"
                          />
                        </div>

                        {/* Font Family */}
                        <div className="space-y-2">
                          <Label>Font</Label>
                          <Select
                            value={subtitleSettings.fontFamily}
                            onValueChange={(value) => setSubtitleSettings(s => ({ ...s, fontFamily: value }))}
                          >
                            <SelectTrigger className="bg-muted/50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {fontFamilies.map((font) => (
                                <SelectItem key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                                  {font.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Colors Row */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Text Color */}
                          <div className="space-y-2">
                            <Label>Culoare Text</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" className="w-full justify-start gap-2">
                                  <div
                                    className="w-5 h-5 rounded border"
                                    style={{ backgroundColor: subtitleSettings.textColor }}
                                  />
                                  {subtitleSettings.textColor}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64">
                                <div className="space-y-3">
                                  <div className="grid grid-cols-5 gap-2">
                                    {colorPresets.map((color) => (
                                      <button
                                        key={color.value}
                                        className="w-8 h-8 rounded border-2 hover:scale-110 transition-transform"
                                        style={{
                                          backgroundColor: color.value,
                                          borderColor: subtitleSettings.textColor === color.value ? "hsl(var(--primary))" : "transparent"
                                        }}
                                        onClick={() => setSubtitleSettings(s => ({ ...s, textColor: color.value }))}
                                        title={color.name}
                                      />
                                    ))}
                                  </div>
                                  <div className="flex gap-2">
                                    <Input
                                      type="color"
                                      value={subtitleSettings.textColor}
                                      onChange={(e) => setSubtitleSettings(s => ({ ...s, textColor: e.target.value }))}
                                      className="w-12 h-10 p-1 cursor-pointer"
                                    />
                                    <Input
                                      type="text"
                                      value={subtitleSettings.textColor}
                                      onChange={(e) => setSubtitleSettings(s => ({ ...s, textColor: e.target.value }))}
                                      className="flex-1"
                                      placeholder="#FFFFFF"
                                    />
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>

                          {/* Outline Color */}
                          <div className="space-y-2">
                            <Label>Culoare Contur</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" className="w-full justify-start gap-2">
                                  <div
                                    className="w-5 h-5 rounded border"
                                    style={{ backgroundColor: subtitleSettings.outlineColor }}
                                  />
                                  {subtitleSettings.outlineColor}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64">
                                <div className="space-y-3">
                                  <div className="grid grid-cols-5 gap-2">
                                    {colorPresets.map((color) => (
                                      <button
                                        key={color.value}
                                        className="w-8 h-8 rounded border-2 hover:scale-110 transition-transform"
                                        style={{
                                          backgroundColor: color.value,
                                          borderColor: subtitleSettings.outlineColor === color.value ? "hsl(var(--primary))" : "transparent"
                                        }}
                                        onClick={() => setSubtitleSettings(s => ({ ...s, outlineColor: color.value }))}
                                        title={color.name}
                                      />
                                    ))}
                                  </div>
                                  <div className="flex gap-2">
                                    <Input
                                      type="color"
                                      value={subtitleSettings.outlineColor}
                                      onChange={(e) => setSubtitleSettings(s => ({ ...s, outlineColor: e.target.value }))}
                                      className="w-12 h-10 p-1 cursor-pointer"
                                    />
                                    <Input
                                      type="text"
                                      value={subtitleSettings.outlineColor}
                                      onChange={(e) => setSubtitleSettings(s => ({ ...s, outlineColor: e.target.value }))}
                                      className="flex-1"
                                      placeholder="#000000"
                                    />
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>

                        {/* Outline Width */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <Label>Grosime Contur</Label>
                            <span className="text-sm text-muted-foreground">{subtitleSettings.outlineWidth}px</span>
                          </div>
                          <Slider
                            value={[subtitleSettings.outlineWidth]}
                            onValueChange={([value]) => setSubtitleSettings(s => ({ ...s, outlineWidth: value }))}
                            min={0}
                            max={10}
                            step={1}
                            className="w-full"
                          />
                        </div>

                        {/* Pozitie Y - slider pentru control exact */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <Label>Pozitie Verticala (Y)</Label>
                            <span className="text-sm text-muted-foreground">{subtitleSettings.positionY}%</span>
                          </div>
                          <Slider
                            value={[subtitleSettings.positionY]}
                            onValueChange={([value]) => setSubtitleSettings(s => ({ ...s, positionY: value }))}
                            min={5}
                            max={95}
                            step={1}
                            className="w-full"
                          />
                          <p className="text-xs text-muted-foreground">
                            0% = sus, 50% = centru, 100% = jos
                          </p>
                        </div>

                        {/* Preview - proportional la video */}
                        <div className="mt-4">
                          <div className="flex justify-between items-center mb-3">
                            <Label className="text-base font-semibold">Preview Live</Label>
                            {isLoadingVideoInfo && (
                              <span className="text-xs text-muted-foreground">Se incarca...</span>
                            )}
                          </div>
                          {/* Preview MARE - 600px height pentru portrait */}
                          <div className="flex justify-center">
                            {(() => {
                              // Safe calculations to prevent NaN
                              const safeWidth = videoInfo.width || 1080;
                              const safeHeight = videoInfo.height || 1920;
                              const previewHeight = 600;
                              const aspectRatio = safeWidth / safeHeight;
                              const previewWidth = videoInfo.is_vertical
                                ? previewHeight * aspectRatio
                                : 600;
                              const actualPreviewHeight = videoInfo.is_vertical
                                ? previewHeight
                                : 600 / aspectRatio;
                              const scaledFontSize = (subtitleSettings.fontSize / safeHeight) * previewHeight;
                              const scaledOutline = Math.max(1, (subtitleSettings.outlineWidth / safeHeight) * previewHeight);

                              return (
                                <div
                                  className="relative bg-black rounded-lg overflow-hidden border-2 border-border shadow-xl"
                                  style={{
                                    // Pentru portrait: height fix 600px, width calculat
                                    // Pentru landscape: width fix 600px, height calculat
                                    ...(videoInfo.is_vertical
                                      ? {
                                          height: `${previewHeight}px`,
                                          width: `${previewWidth}px`,
                                        }
                                      : {
                                          width: "600px",
                                          height: `${actualPreviewHeight}px`,
                                        }),
                                  }}
                                >
                                  {/* Gradient background simuland video */}
                                  <div className="absolute inset-0 bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900" />

                                  {/* Subtitle text - actualizare in timp real cu pozitie Y directa */}
                                  <div
                                    className="absolute left-0 right-0 text-center px-4 transition-all duration-100"
                                    style={{
                                      fontFamily: subtitleSettings.fontFamily,
                                      // Font size scalat proportional cu preview-ul (600px height)
                                      fontSize: `${scaledFontSize}px`,
                                      color: subtitleSettings.textColor,
                                      textShadow: `
                                        -${scaledOutline}px -${scaledOutline}px 0 ${subtitleSettings.outlineColor},
                                        ${scaledOutline}px -${scaledOutline}px 0 ${subtitleSettings.outlineColor},
                                        -${scaledOutline}px ${scaledOutline}px 0 ${subtitleSettings.outlineColor},
                                        ${scaledOutline}px ${scaledOutline}px 0 ${subtitleSettings.outlineColor}
                                      `,
                                      fontWeight: 700,
                                      // Pozitie Y directa - de la 0% (sus) la 100% (jos)
                                      top: `${subtitleSettings.positionY}%`,
                                      transform: "translateY(-50%)",
                                    }}
                                  >
                                    {subtitleLines.length > 0 ? subtitleLines[0].text : "Exemplu de text subtitrare"}
                                  </div>

                                </div>
                              );
                            })()}
                          </div>

                          {/* Real size info */}
                          <div className="text-center mt-4 space-y-1">
                            <p className="text-sm font-medium">
                              {videoInfo.width}x{videoInfo.height} ({videoInfo.aspect_ratio})
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Font: {subtitleSettings.fontSize}px | Contur: {subtitleSettings.outlineWidth}px | Y: {subtitleSettings.positionY}%
                            </p>
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Subtitle Editor */}
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <h3 className="font-semibold">Editor Subtitrari</h3>
                          {subtitleLines.length > 0 && (
                            <Badge variant="secondary">{subtitleLines.length} linii</Badge>
                          )}
                        </div>

                        {subtitleLines.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <p>Incarca un fisier SRT pentru a edita subtitrările</p>
                            <p className="text-sm mt-1">sau lasa AI-ul sa genereze automat</p>
                          </div>
                        ) : (
                          <ScrollArea className="h-[300px] border rounded-lg">
                            <div className="p-4 space-y-2">
                              {subtitleLines.map((line) => (
                                <div
                                  key={line.id}
                                  className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                                >
                                  <div className="flex justify-between items-start gap-2 mb-2">
                                    <Badge variant="outline" className="text-xs">
                                      #{line.id}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {line.start} → {line.end}
                                    </span>
                                  </div>
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <button
                                        className="w-full text-left text-sm hover:text-primary transition-colors"
                                        onClick={() => setEditingSubtitle(line)}
                                      >
                                        {line.text}
                                      </button>
                                    </DialogTrigger>
                                    <DialogContent>
                                      <DialogHeader>
                                        <DialogTitle>Editeaza Subtitrarea #{line.id}</DialogTitle>
                                        <DialogDescription>
                                          {line.start} → {line.end}
                                        </DialogDescription>
                                      </DialogHeader>
                                      <Textarea
                                        value={line.text}
                                        onChange={(e) => updateSubtitleLine(line.id, e.target.value)}
                                        className="min-h-[100px]"
                                      />
                                      <DialogFooter>
                                        <Button variant="outline" onClick={() => setEditingSubtitle(null)}>
                                          Inchide
                                        </Button>
                                      </DialogFooter>
                                    </DialogContent>
                                  </Dialog>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        )}
                      </div>
                    </TabsContent>

                    {/* Tab 3: Export Settings */}
                    <TabsContent value="export" className="space-y-6">
                      <div className="space-y-4">
                        <h3 className="font-semibold">Optiuni Export</h3>

                        {/* Generate Audio Toggle */}
                        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-medium text-amber-700 dark:text-amber-400">Generare Audio/TTS</h4>
                              <p className="text-sm text-muted-foreground mt-1">
                                {generateAudio
                                  ? "Audio și subtitrări vor fi adăugate direct"
                                  : "Videoclipurile vor fi generate FĂRĂ audio - poți adăuga TTS după ce triezi"}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setGenerateAudio(!generateAudio)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                generateAudio ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  generateAudio ? "translate-x-6" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </div>
                          {!generateAudio && (
                            <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">
                              💡 Recomandat: Generează mai întâi fără audio, triază, apoi adaugă TTS doar pe cele bune
                            </p>
                          )}
                        </div>

                        <Separator />

                        {/* Variant Count */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <Label>Numar de variante</Label>
                            <span className="text-sm font-semibold text-primary">{variantCount} {variantCount === 1 ? "varianta" : "variante"}</span>
                          </div>
                          <Slider
                            value={[variantCount]}
                            onValueChange={([value]) => setVariantCount(value)}
                            min={1}
                            max={10}
                            step={1}
                            className="w-full"
                          />
                          <p className="text-xs text-muted-foreground">
                            Fiecare varianta va folosi acelasi audio si subtitrari, dar scene diferite din video.
                            Prima scena va fi diferita pentru fiecare varianta.
                          </p>
                        </div>

                        {/* Mute Source Voice Option */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                          <div className="flex-1">
                            <Label htmlFor="mute-voice" className="text-sm font-medium cursor-pointer">
                              Elimina vocea din sursa
                            </Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Detecteaza si muta vocile din video-ul original (pastreaza efectele sonore si muzica).
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            id="mute-voice"
                            checked={muteSourceVoice}
                            onChange={(e) => setMuteSourceVoice(e.target.checked)}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                          />
                        </div>

                        <Separator />

                        {/* Secondary Videos with Keywords */}
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <h3 className="font-semibold">Videouri Secundare (Keywords)</h3>
                            <Badge variant="outline" className="text-xs">
                              {secondaryVideos.filter(sv => sv.file && sv.keywords.trim()).length} / 3
                            </Badge>
                          </div>

                          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20 mb-4">
                            <p className="text-sm text-muted-foreground">
                              Adauga videouri secundare care vor aparea cand anumite cuvinte sunt rostite.
                              Exemplu: adauga un video cu &quot;decant&quot; si keywords &quot;decant, decanturi&quot; -
                              clipuri din acest video vor fi inserate cand aceste cuvinte apar in SRT.
                            </p>
                          </div>

                          {secondaryVideos.map((sv, idx) => (
                            <div key={idx} className="p-4 rounded-lg bg-muted/30 border border-border space-y-3">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary">Video {idx + 1}</Badge>
                                {sv.file && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{sv.file.name}</span>}
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label htmlFor={`secondary-video-${idx}`} className="text-xs">
                                    Fisier Video
                                  </Label>
                                  <Input
                                    id={`secondary-video-${idx}`}
                                    type="file"
                                    accept=".mp4,.mov,.avi,.mkv"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0] || null;
                                      setSecondaryVideos(prev => {
                                        const updated = [...prev];
                                        updated[idx] = { ...updated[idx], file };
                                        return updated;
                                      });
                                    }}
                                    className="bg-muted/50 text-xs"
                                  />
                                </div>

                                <div className="space-y-1">
                                  <Label htmlFor={`secondary-keywords-${idx}`} className="text-xs">
                                    Keywords (separate cu virgula)
                                  </Label>
                                  <Input
                                    id={`secondary-keywords-${idx}`}
                                    type="text"
                                    placeholder="decant, decanturi, parfum"
                                    value={sv.keywords}
                                    onChange={(e) => {
                                      setSecondaryVideos(prev => {
                                        const updated = [...prev];
                                        updated[idx] = { ...updated[idx], keywords: e.target.value };
                                        return updated;
                                      });
                                    }}
                                    className="bg-muted/50 text-sm"
                                  />
                                </div>
                              </div>

                              {sv.file && sv.keywords.trim() && (
                                <p className="text-xs text-green-600">
                                  ✓ Activ: va insera clipuri cand se aude &quot;{sv.keywords.split(',')[0].trim()}&quot;
                                </p>
                              )}
                            </div>
                          ))}

                          {/* Secondary Segment Duration */}
                          <div className="space-y-3 pt-2">
                            <div className="flex justify-between items-center">
                              <Label>Durata clipuri secundare</Label>
                              <span className="text-sm text-muted-foreground">{secondarySegmentDuration.toFixed(1)}s</span>
                            </div>
                            <Slider
                              value={[secondarySegmentDuration]}
                              onValueChange={([value]) => setSecondarySegmentDuration(value)}
                              min={0.5}
                              max={5}
                              step={0.5}
                              className="w-full"
                            />
                            <p className="text-xs text-muted-foreground">
                              Cat timp va dura fiecare clip inserat din videoul secundar.
                            </p>
                          </div>
                        </div>

                        <Separator />

                        {/* Info about variants */}
                        <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                          <h4 className="font-medium text-primary mb-2">Cum functioneaza variantele?</h4>
                          <ul className="text-sm text-muted-foreground space-y-1">
                            <li>• Fiecare varianta incepe cu o scena diferita</li>
                            <li>• Scenele sunt permutate pentru diversitate</li>
                            <li>• Audio si subtitrari raman identice</li>
                            <li>• Perfect pentru testare A/B pe social media</li>
                          </ul>
                        </div>

                        {/* Buttons */}
                        <div className="flex gap-4 pt-4">
                          <Button onClick={handleSubmit} disabled={isProcessing} className="flex-1">
                            {secondaryVideos.some(sv => sv.file && sv.keywords.trim())
                              ? "Proceseaza Multi-Video"
                              : variantCount > 1
                                ? `Genereaza ${variantCount} Variante`
                                : "Proceseaza Video"
                            }
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleAnalyzeOnly}
                            disabled={isProcessing}
                          >
                            Doar Analiza
                          </Button>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>

                  {/* Progress Section */}
                  {isProcessing && (
                    <div className="mt-6 space-y-3">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">{progress}%</span>
                        {estimatedTimeRemaining && (
                          <span className="text-primary font-medium">{estimatedTimeRemaining}</span>
                        )}
                      </div>
                      <Progress value={progress} className="h-3" />
                      <p className="text-sm text-muted-foreground">{statusText}</p>
                    </div>
                  )}

                  {/* Error Alert */}
                  {error && (
                    <Alert variant="destructive" className="mt-6">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  {/* Result Section */}
                  {result && (
                    <div className="mt-6 p-4 rounded-lg bg-primary/10 border border-primary/30">
                      <h3 className="text-lg font-semibold text-primary mb-3">
                        Rezultat
                      </h3>
                      {result.video_info && (
                        <>
                          <p className="text-foreground">
                            <span className="text-muted-foreground">Video:</span>{" "}
                            {result.video_info.filename}
                          </p>
                          {result.video_info.duration > 0 && (
                            <p className="text-foreground">
                              <span className="text-muted-foreground">Durata originala:</span>{" "}
                              {result.video_info.duration.toFixed(1)}s
                            </p>
                          )}
                        </>
                      )}
                      {result.segments && (
                        <>
                          <p className="text-foreground">
                            <span className="text-muted-foreground">Segmente selectate:</span>{" "}
                            {result.segments.length}
                          </p>
                          <p className="text-foreground">
                            <span className="text-muted-foreground">
                              Durata totala selectata:
                            </span>{" "}
                            {result.segments
                              .reduce((sum, s) => sum + s.duration, 0)
                              .toFixed(1)}
                            s
                          </p>
                        </>
                      )}
                      {currentJobId && generatedVariants.length === 0 && (
                        <Button asChild className="mt-4">
                          <a href={`${API_BASE}/jobs/${currentJobId}/download`}>
                            Descarca Video
                          </a>
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Variant Selection/Triage UI */}
                  {generatedVariants.length > 0 && (
                    <div className="mt-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-blue-700 dark:text-blue-400">
                          Variante Generate ({generatedVariants.length})
                        </h3>
                        <Badge variant="outline" className="text-blue-600">
                          {generatedVariants.filter(v => v.selected).length} selectate
                        </Badge>
                      </div>

                      <p className="text-sm text-muted-foreground mb-4">
                        {!generateAudio
                          ? "Selectează variantele pe care vrei să le păstrezi, apoi adaugă TTS."
                          : "Descarcă variantele dorite."}
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {generatedVariants.map((variant) => (
                          <div
                            key={variant.variant_index}
                            className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                              variant.selected
                                ? "border-primary bg-primary/10"
                                : "border-border hover:border-primary/50"
                            }`}
                            onClick={() => {
                              setGeneratedVariants(prev =>
                                prev.map(v =>
                                  v.variant_index === variant.variant_index
                                    ? { ...v, selected: !v.selected }
                                    : v
                                )
                              );
                            }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <Badge variant={variant.selected ? "default" : "secondary"}>
                                Varianta {variant.variant_index}
                              </Badge>
                              <input
                                type="checkbox"
                                checked={variant.selected}
                                onChange={() => {}}
                                className="h-5 w-5 rounded"
                              />
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {variant.variant_name}
                            </p>
                            <div className="mt-3 flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1"
                                asChild
                              >
                                <a
                                  href={`${API_BASE}/files/${encodeURIComponent(variant.final_video)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Preview
                                </a>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1"
                                asChild
                              >
                                <a
                                  href={`${API_BASE}/files/${encodeURIComponent(variant.final_video)}?download=true`}
                                  download
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Download
                                </a>
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Add TTS Button - only shows if audio wasn't generated */}
                      {!generateAudio && generatedVariants.some(v => v.selected) && (
                        <div className="mt-6 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                          <h4 className="font-medium text-green-700 dark:text-green-400 mb-2">
                            Adaugă TTS la variantele selectate
                          </h4>
                          <p className="text-sm text-muted-foreground mb-3">
                            {generatedVariants.filter(v => v.selected).length} variante selectate vor primi voice-over cu ElevenLabs.
                          </p>

                          {!scriptText.trim() && (
                            <Alert className="mb-4">
                              <AlertDescription>
                                Scrie textul pentru voice-over în tab-ul &quot;Fișiere&quot; → &quot;Text pentru TTS&quot;
                              </AlertDescription>
                            </Alert>
                          )}

                          {isAddingTts && (
                            <div className="mb-4">
                              <Progress value={50} className="h-2 mb-2" />
                              <p className="text-sm text-muted-foreground">{ttsStatus}</p>
                            </div>
                          )}

                          <Button
                            className="w-full"
                            onClick={handleAddTts}
                            disabled={isAddingTts || !scriptText.trim()}
                          >
                            {isAddingTts ? "Se procesează..." : "Adaugă Voice-over (ElevenLabs)"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Jobs List Card */}
              <Card className="bg-card border-border">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-lg">Job-urile Tale</CardTitle>
                  <Button variant="ghost" size="sm" onClick={refreshJobs}>
                    Refresh
                  </Button>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    {jobs.length === 0 ? (
                      <p className="text-muted-foreground text-center py-8 text-sm">
                        Niciun job momentan.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {jobs.map((job) => (
                          <div
                            key={job.job_id}
                            className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{job.job_id}</p>
                              <p className="text-xs text-muted-foreground truncate">{job.progress}</p>
                            </div>
                            <Badge variant={getStatusBadgeVariant(job.status)}>
                              {job.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Quick Stats */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Statistica Lunara</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Videoclipuri procesate</span>
                    <span className="font-semibold">3 / 5</span>
                  </div>
                  <Progress value={60} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    Ai ramas cu 2 videoclipuri gratuite luna aceasta.
                  </p>
                  <Separator />
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/usage">
                      <DollarSign className="h-4 w-4 mr-2" />
                      Vezi Costuri API
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/statsai#preturi">Upgrade la Pro</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/20">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 py-12 md:py-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 md:gap-12">
            <div className="sm:col-span-2 lg:col-span-1">
              <Link href="/statsai" className="inline-block mb-4">
                <span className="text-xl font-bold text-primary">EditAI</span>
              </Link>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Editare video inteligenta cu AI pentru creatori de continut si agentii.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Produs</h4>
              <ul className="space-y-3">
                {[
                  { label: "Editor Video", href: "/" },
                  { label: "Subtitrari AI", href: "/functionalitati" },
                  { label: "Voiceover TTS", href: "/functionalitati" },
                  { label: "Integratii", href: "/functionalitati" },
                  { label: "Acces API", href: "/preturi" },
                ].map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Companie</h4>
              <ul className="space-y-3">
                {[
                  { label: "Despre Noi", href: "/despre" },
                  { label: "Preturi", href: "/preturi" },
                  { label: "Testimoniale", href: "/testimoniale" },
                  { label: "Contact", href: "/contact" },
                ].map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Urmareste-ne</h4>
              <div className="flex gap-3">
                {["X", "LI", "GH", "YT"].map((social) => (
                  <div
                    key={social}
                    className="w-10 h-10 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                    aria-label={`Social icon placeholder - ${social}`}
                  >
                    {social}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Separator className="my-8" />

          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
            <div className="text-center sm:text-left">
              <p>&copy; 2025 EditAI. Toate drepturile rezervate.</p>
              <p className="text-xs mt-1">
                OBSID S.R.L. | CUI: 52168342 | J2025052732002
              </p>
              <p className="text-xs">
                Str. 13 Decembrie, Nr. 90, Bl. 6, Sc. B, Ap. 19, Brasov
              </p>
            </div>
            <div className="flex gap-6">
              <Link href="/politica-confidentialitate" className="hover:text-foreground transition-colors">
                Politica de Confidentialitate
              </Link>
              <Link href="/termeni" className="hover:text-foreground transition-colors">
                Termeni si Conditii
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
