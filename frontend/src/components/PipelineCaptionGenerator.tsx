"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sparkles,
  Loader2,
  Settings2,
  Plus,
  Trash2,
  Check,
  Copy,
  MessageSquareText,
} from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { toast } from "sonner";

/* ---------- Types ---------- */

interface CompletedClip {
  clip_id: string;
  variant_index: number;
  final_video_path: string;
  thumbnail_path?: string;
}

interface CaptionTemplate {
  id: string;
  name: string;
  prompt_template: string;
  is_default: boolean;
}

interface PipelineCaptionGeneratorProps {
  pipelineId: string;
  completedClips: CompletedClip[];
  scripts: string[];
  onCaptionsGenerated: (captions: Record<string, string>) => void;
}

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "funny", label: "Funny" },
  { value: "luxury", label: "Luxury" },
  { value: "urgenta", label: "Urgenta" },
];

const LANGUAGES = [
  { value: "ro", label: "Romanian" },
  { value: "en", label: "English" },
];

const LS_TEMPLATE_KEY = "ef_video_caption_template_id";
const LS_TONE_KEY = "ef_video_caption_tone";
const LS_LANGUAGE_KEY = "ef_video_caption_language";

/* ---------- Component ---------- */

export function PipelineCaptionGenerator({
  pipelineId,
  completedClips,
  scripts,
  onCaptionsGenerated,
}: PipelineCaptionGeneratorProps) {
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // Settings state (persisted in localStorage)
  const [tone, setTone] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(LS_TONE_KEY) || "professional" : "professional"
  );
  const [language, setLanguage] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(LS_LANGUAGE_KEY) || "ro" : "ro"
  );
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [includeCta, setIncludeCta] = useState(true);
  const [customInstructions, setCustomInstructions] = useState("");

  // Template state
  const [templates, setTemplates] = useState<CaptionTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(LS_TEMPLATE_KEY) || "" : ""
  );
  const [templatesLoading, setTemplatesLoading] = useState(true);

  // Template management dialog
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplatePrompt, setNewTemplatePrompt] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<CaptionTemplate | null>(null);

  // Generation state
  const [generating, setGenerating] = useState(false);
  // variant_index -> string[] (multiple caption options)
  const [generatedCaptions, setGeneratedCaptions] = useState<Record<number, string[]>>({});
  // variant_index -> selected caption index
  const [selectedCaptionIdx, setSelectedCaptionIdx] = useState<Record<number, number>>({});

  // Persist tone/language to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_TONE_KEY, tone);
    }
  }, [tone]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_LANGUAGE_KEY, language);
    }
  }, [language]);

  /* ---------- Fetch templates ---------- */

  const fetchTemplates = useCallback(async () => {
    try {
      setTemplatesLoading(true);
      const res = await apiGet("/pipeline/video-caption-templates");
      const data = await res.json();
      const tpls = data.templates || [];
      if (!isMountedRef.current) return;
      setTemplates(tpls);

      // Auto-select: saved template, or default, or none
      const savedId = typeof window !== "undefined" ? localStorage.getItem(LS_TEMPLATE_KEY) : null;
      const savedExists = tpls.some((t: CaptionTemplate) => t.id === savedId);
      if (savedExists) {
        setSelectedTemplateId(savedId!);
      } else {
        const defaultTpl = tpls.find((t: CaptionTemplate) => t.is_default);
        if (defaultTpl) {
          setSelectedTemplateId(defaultTpl.id);
          localStorage.setItem(LS_TEMPLATE_KEY, defaultTpl.id);
        }
      }
    } catch {
      // Silent — templates are optional
    } finally {
      if (isMountedRef.current) setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  /* ---------- Template selection ---------- */

  const handleSelectTemplate = (id: string) => {
    const effectiveId = id === "none" ? "" : id;
    setSelectedTemplateId(effectiveId);
    if (typeof window !== "undefined") {
      if (effectiveId) {
        localStorage.setItem(LS_TEMPLATE_KEY, effectiveId);
      } else {
        localStorage.removeItem(LS_TEMPLATE_KEY);
      }
    }
  };

  /* ---------- Template CRUD ---------- */

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim() || !newTemplatePrompt.trim()) return;
    try {
      await apiPost("/pipeline/video-caption-templates", {
        name: newTemplateName.trim(),
        prompt_template: newTemplatePrompt.trim(),
        is_default: templates.length === 0,
      });
      toast.success("Template created");
      setNewTemplateName("");
      setNewTemplatePrompt("");
      fetchTemplates();
    } catch {
      toast.error("Failed to create template");
    }
  };

  const handleUpdateTemplate = async () => {
    if (!editingTemplate) return;
    try {
      await apiPut(`/pipeline/video-caption-templates/${editingTemplate.id}`, {
        name: editingTemplate.name,
        prompt_template: editingTemplate.prompt_template,
      });
      toast.success("Template updated");
      setEditingTemplate(null);
      fetchTemplates();
    } catch {
      toast.error("Failed to update template");
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await apiDelete(`/pipeline/video-caption-templates/${id}`);
      toast.success("Template deleted");
      if (selectedTemplateId === id) {
        setSelectedTemplateId("");
        localStorage.removeItem(LS_TEMPLATE_KEY);
      }
      fetchTemplates();
    } catch {
      toast.error("Failed to delete template");
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await apiPut(`/pipeline/video-caption-templates/${id}`, { is_default: true });
      fetchTemplates();
    } catch {
      toast.error("Failed to set default");
    }
  };

  /* ---------- Generate captions ---------- */

  const handleGenerate = async () => {
    const variantIndices = completedClips.map(c => c.variant_index);
    if (variantIndices.length === 0) return;

    setGenerating(true);
    try {
      const res = await apiPost("/pipeline/generate-video-captions", {
        pipeline_id: pipelineId,
        variant_indices: variantIndices,
        tone,
        language,
        include_hashtags: includeHashtags,
        include_cta: includeCta,
        template_id: selectedTemplateId || undefined,
        custom_instructions: customInstructions.trim() || undefined,
        variants_per_clip: 3,
      }, { timeout: 120_000 });
      const data = await res.json();
      if (!isMountedRef.current) return;

      const captions: Record<number, string[]> = {};
      const captionsObj = data.captions || {};
      for (const [key, val] of Object.entries(captionsObj)) {
        captions[parseInt(key)] = val as string[];
      }
      setGeneratedCaptions(captions);

      // Auto-select first caption for each variant
      const selections: Record<number, number> = {};
      const captionMap: Record<string, string> = {};
      for (const clip of completedClips) {
        const varCaptions = captions[clip.variant_index];
        if (varCaptions && varCaptions.length > 0) {
          selections[clip.variant_index] = 0;
          captionMap[clip.clip_id] = varCaptions[0];
        }
      }
      setSelectedCaptionIdx(selections);
      onCaptionsGenerated(captionMap);

      const errorCount = Object.keys(data.errors || {}).length;
      if (errorCount > 0) {
        toast.warning(`Generated captions with ${errorCount} error(s)`);
      } else {
        toast.success("Captions generated!");
      }
    } catch {
      toast.error("Failed to generate captions");
    } finally {
      if (isMountedRef.current) setGenerating(false);
    }
  };

  /* ---------- Caption selection ---------- */

  const handleSelectCaption = (variantIndex: number, captionIdx: number) => {
    setSelectedCaptionIdx(prev => ({ ...prev, [variantIndex]: captionIdx }));

    // Update parent with new selection
    const captionMap: Record<string, string> = {};
    for (const clip of completedClips) {
      const idx = clip.variant_index === variantIndex ? captionIdx : (selectedCaptionIdx[clip.variant_index] ?? 0);
      const varCaptions = generatedCaptions[clip.variant_index];
      if (varCaptions && varCaptions[idx]) {
        captionMap[clip.clip_id] = varCaptions[idx];
      }
    }
    onCaptionsGenerated(captionMap);
  };

  const copyCaption = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied!");
  };

  if (completedClips.length === 0) return null;

  /* ---------- Render ---------- */

  return (
    <div className="space-y-4 mt-6">
      <div className="flex items-center gap-3">
        <MessageSquareText className="size-6 text-primary" />
        <div>
          <h3 className="text-lg font-semibold">AI Social Media Captions</h3>
          <p className="text-sm text-muted-foreground">
            Auto-generate caption variants for each video clip
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Caption Settings
            </span>
            <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Settings2 className="size-4 mr-1" />
                  Templates
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Caption Templates</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {/* Existing templates */}
                  {templates.map((tpl) => (
                    <div key={tpl.id} className="border rounded-md p-3 space-y-2">
                      {editingTemplate?.id === tpl.id ? (
                        <>
                          <Input
                            value={editingTemplate.name}
                            onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                            placeholder="Template name"
                          />
                          <Textarea
                            value={editingTemplate.prompt_template}
                            onChange={(e) => setEditingTemplate({ ...editingTemplate, prompt_template: e.target.value })}
                            rows={4}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleUpdateTemplate}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingTemplate(null)}>Cancel</Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{tpl.name}</span>
                            <div className="flex items-center gap-1">
                              {tpl.is_default && <Badge variant="secondary" className="text-xs">Default</Badge>}
                              {!tpl.is_default && (
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSetDefault(tpl.id)} title="Set as default">
                                  <Check className="size-3" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingTemplate({ ...tpl })} title="Edit">
                                <Settings2 className="size-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteTemplate(tpl.id)} title="Delete">
                                <Trash2 className="size-3" />
                              </Button>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-3">{tpl.prompt_template}</p>
                        </>
                      )}
                    </div>
                  ))}

                  {/* Create new template */}
                  <div className="border-2 border-dashed rounded-md p-3 space-y-2">
                    <Label className="text-sm font-medium">New Template</Label>
                    <Input
                      placeholder="Template name (e.g. Product Promo)"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                    />
                    <Textarea
                      placeholder="Template prompt... (e.g. You are a social media expert for an online fashion store. Focus on product benefits and lifestyle appeal.)"
                      value={newTemplatePrompt}
                      onChange={(e) => setNewTemplatePrompt(e.target.value)}
                      rows={4}
                    />
                    <Button
                      size="sm"
                      onClick={handleCreateTemplate}
                      disabled={!newTemplateName.trim() || !newTemplatePrompt.trim()}
                    >
                      <Plus className="size-4 mr-1" />
                      Create Template
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Template selector */}
          <div className="space-y-2">
            <Label>Template</Label>
            {templatesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading templates...
              </div>
            ) : (
              <Select value={selectedTemplateId || "none"} onValueChange={handleSelectTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="No template (generate freely)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name} {tpl.is_default ? "(default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Tone + Language */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tone</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Options */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={includeHashtags} onCheckedChange={(v) => setIncludeHashtags(v === true)} />
              Include hashtags
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={includeCta} onCheckedChange={(v) => setIncludeCta(v === true)} />
              Include CTA
            </label>
          </div>

          {/* Custom instructions */}
          <div className="space-y-2">
            <Label>Custom Instructions (optional)</Label>
            <Textarea
              placeholder="Any additional instructions for the AI..."
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              rows={2}
            />
          </div>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-none hover:from-blue-600 hover:to-cyan-600"
          >
            {generating ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="size-4 mr-2" />
            )}
            Generate Captions for {completedClips.length} Clip{completedClips.length !== 1 ? "s" : ""}
          </Button>
        </CardContent>
      </Card>

      {/* Generated captions per variant */}
      {Object.keys(generatedCaptions).length > 0 && (
        <div className="space-y-4">
          {completedClips.map((clip) => {
            const varCaptions = generatedCaptions[clip.variant_index];
            if (!varCaptions || varCaptions.length === 0) return null;
            const selectedIdx = selectedCaptionIdx[clip.variant_index] ?? 0;

            return (
              <Card key={clip.clip_id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    Variant {clip.variant_index + 1} — Captions
                    <Badge variant="outline" className="text-xs">
                      {varCaptions.length} variant{varCaptions.length !== 1 ? "s" : ""}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {varCaptions.map((caption, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectCaption(clip.variant_index, idx)}
                      className={`relative p-3 rounded-md border-2 cursor-pointer transition-colors text-sm ${
                        idx === selectedIdx
                          ? "border-primary bg-primary/5"
                          : "border-transparent bg-muted/50 hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              variant={idx === selectedIdx ? "default" : "outline"}
                              className="text-xs"
                            >
                              {idx === selectedIdx ? "Selected" : `Option ${idx + 1}`}
                            </Badge>
                          </div>
                          <p className="whitespace-pre-wrap break-words">{caption}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={(e) => { e.stopPropagation(); copyCaption(caption); }}
                        >
                          <Copy className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
