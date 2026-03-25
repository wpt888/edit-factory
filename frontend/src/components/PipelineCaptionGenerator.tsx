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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  ChevronDown,
  Pencil,
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

  // Manual captions per variant (always editable)
  const [manualCaptions, setManualCaptions] = useState<Record<number, string>>({});

  // AI settings state (persisted in localStorage)
  const [tone, setTone] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(LS_TONE_KEY) || "professional" : "professional"
  );
  const [language, setLanguage] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(LS_LANGUAGE_KEY) || "ro" : "ro"
  );
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [includeCta, setIncludeCta] = useState(true);
  const [customInstructions, setCustomInstructions] = useState("");

  // AI generation collapsible — open by default
  const [aiSettingsOpen, setAiSettingsOpen] = useState(true);

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
  // variant_index -> string[] (multiple AI caption options)
  const [generatedCaptions, setGeneratedCaptions] = useState<Record<number, string[]>>({});
  // variant_index -> selected AI caption index
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

  /* ---------- Propagate captions to parent ---------- */

  const propagateCaptions = useCallback((
    manual: Record<number, string>,
    aiCaptions: Record<number, string[]>,
    aiSelections: Record<number, number>,
  ) => {
    const captionMap: Record<string, string> = {};
    for (const clip of completedClips) {
      const manualText = manual[clip.variant_index];
      if (manualText && manualText.trim()) {
        captionMap[clip.clip_id] = manualText;
      } else {
        const varCaptions = aiCaptions[clip.variant_index];
        const idx = aiSelections[clip.variant_index] ?? 0;
        if (varCaptions && varCaptions[idx]) {
          captionMap[clip.clip_id] = varCaptions[idx];
        }
      }
    }
    onCaptionsGenerated(captionMap);
  }, [completedClips, onCaptionsGenerated]);

  // Re-propagate when clip_ids change (pending-* → real ids after render completes)
  useEffect(() => {
    const hasContent = Object.values(manualCaptions).some(v => v?.trim()) ||
                       Object.keys(generatedCaptions).length > 0;
    if (hasContent) {
      propagateCaptions(manualCaptions, generatedCaptions, selectedCaptionIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedClips]);

  /* ---------- Manual caption editing ---------- */

  const handleManualCaptionChange = (variantIndex: number, text: string) => {
    const updated = { ...manualCaptions, [variantIndex]: text };
    setManualCaptions(updated);
    propagateCaptions(updated, generatedCaptions, selectedCaptionIdx);
  };

  /* ---------- Fetch templates ---------- */

  const fetchTemplates = useCallback(async () => {
    try {
      setTemplatesLoading(true);
      const res = await apiGet("/pipeline/video-caption-templates");
      const data = await res.json();
      const tpls = data.templates || [];
      if (!isMountedRef.current) return;
      setTemplates(tpls);

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

  /* ---------- Generate captions via AI ---------- */

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

      // Auto-select first AI caption for each variant (only if no manual caption)
      const selections: Record<number, number> = {};
      for (const clip of completedClips) {
        const varCaptions = captions[clip.variant_index];
        if (varCaptions && varCaptions.length > 0) {
          selections[clip.variant_index] = 0;
        }
      }
      setSelectedCaptionIdx(selections);
      propagateCaptions(manualCaptions, captions, selections);

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

  /* ---------- AI Caption selection ---------- */

  const handleSelectCaption = (variantIndex: number, captionIdx: number) => {
    const newSelections = { ...selectedCaptionIdx, [variantIndex]: captionIdx };
    setSelectedCaptionIdx(newSelections);

    // Apply the selected AI caption to the manual field
    const varCaptions = generatedCaptions[variantIndex];
    if (varCaptions && varCaptions[captionIdx]) {
      const updated = { ...manualCaptions, [variantIndex]: varCaptions[captionIdx] };
      setManualCaptions(updated);
      propagateCaptions(updated, generatedCaptions, newSelections);
    }
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
          <h3 className="text-lg font-semibold">Social Media Captions</h3>
          <p className="text-sm text-muted-foreground">
            Write captions manually or generate them with AI
          </p>
        </div>
      </div>

      {/* Manual caption fields per variant — always visible */}
      <div className="space-y-3">
        {completedClips.map((clip) => (
          <Card key={clip.clip_id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Pencil className="size-3.5" />
                Variant {clip.variant_index + 1} — Caption
                {manualCaptions[clip.variant_index]?.trim() && (
                  <Badge variant="default" className="text-xs">Has caption</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder={`Write the social media caption for variant ${clip.variant_index + 1}...`}
                value={manualCaptions[clip.variant_index] || ""}
                onChange={(e) => handleManualCaptionChange(clip.variant_index, e.target.value)}
                rows={3}
                className="resize-y"
              />
              {manualCaptions[clip.variant_index]?.trim() && (
                <p className="text-xs text-muted-foreground mt-1">
                  {manualCaptions[clip.variant_index].length} characters
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* AI Generation — collapsible */}
      <Collapsible open={aiSettingsOpen} onOpenChange={setAiSettingsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-3 cursor-pointer hover:bg-accent/50 transition-colors">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Sparkles className="size-4" />
                  AI Caption Generator
                  <Badge variant="outline" className="text-xs font-normal">Optional</Badge>
                </span>
                <ChevronDown className={`size-4 transition-transform ${aiSettingsOpen ? "rotate-180" : ""}`} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              {/* Template selector + management */}
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
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

              {/* AI-generated caption options per variant */}
              {Object.keys(generatedCaptions).length > 0 && (
                <div className="space-y-3 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Click an AI caption to use it. It will be copied to the caption field above.
                  </p>
                  {completedClips.map((clip) => {
                    const varCaptions = generatedCaptions[clip.variant_index];
                    if (!varCaptions || varCaptions.length === 0) return null;
                    const selectedIdx = selectedCaptionIdx[clip.variant_index] ?? 0;

                    return (
                      <div key={clip.clip_id} className="space-y-2">
                        <p className="text-sm font-medium">Variant {clip.variant_index + 1} — AI Options</p>
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
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
