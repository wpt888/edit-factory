"use client";

import { useState, useEffect } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { apiGet, apiPost, handleApiError } from "@/lib/api";
import { Loader2, ChevronDown, ChevronUp, Sparkles, AlertCircle, FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function ScriptsPage() {
  // Input state
  const [idea, setIdea] = useState("");
  const [context, setContext] = useState("");
  const [variantCount, setVariantCount] = useState(3);
  const [provider, setProvider] = useState("gemini");

  // Keywords state
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [keywordsOpen, setKeywordsOpen] = useState(false);

  // Generation state
  const [scripts, setScripts] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load keywords on mount
  useEffect(() => {
    fetchKeywords();
  }, []);

  const fetchKeywords = async () => {
    setKeywordsLoading(true);
    try {
      const res = await apiGet("/scripts/keywords");
      if (res.ok) {
        const data = await res.json();
        setKeywords(data.keywords || []);
      } else {
        handleApiError(new Error(await res.text()), "Eroare la incarcarea cuvintelor cheie");
      }
    } catch (err) {
      handleApiError(err, "Eroare la incarcarea cuvintelor cheie");
    } finally {
      setKeywordsLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!idea.trim()) return;

    setError(null);
    setIsGenerating(true);

    try {
      const res = await apiPost("/scripts/generate", {
        idea: idea.trim(),
        context: context.trim() || undefined,
        variant_count: variantCount,
        provider,
      });

      if (res.ok) {
        const data = await res.json();
        setScripts(data.scripts || []);
      } else {
        const errorData = await res.json().catch(() => ({ detail: "Failed to generate scripts" }));
        setError(errorData.detail || "Failed to generate scripts");
      }
    } catch (err) {
      handleApiError(err, "Eroare la generarea scripturilor");
      setError("Network error. Please check if the backend is running.");
    } finally {
      setIsGenerating(false);
    }
  };

  const updateScript = (index: number, value: string) => {
    setScripts((prev) => prev.map((s, i) => (i === index ? value : s)));
  };

  const countWords = (text: string): number => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            AI Script Generator
          </h1>
          <p className="text-muted-foreground mt-2">
            Generate TTS-ready scripts from your ideas
          </p>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Input */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Input</CardTitle>
                <CardDescription>
                  Describe your video idea and configure generation options
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Idea textarea */}
                <div className="space-y-2">
                  <Label htmlFor="idea">Video Idea *</Label>
                  <Textarea
                    id="idea"
                    placeholder="Describe your video idea... (e.g., 'Product review for our new wireless earbuds, emphasizing comfort and battery life')"
                    rows={5}
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    className="resize-y"
                  />
                </div>

                {/* Context textarea */}
                <div className="space-y-2">
                  <Label htmlFor="context">Product/Brand Context (Optional)</Label>
                  <Textarea
                    id="context"
                    placeholder="Product/brand context... (e.g., 'TechGear Pro is a premium electronics brand targeting young professionals')"
                    rows={3}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    className="resize-y"
                  />
                </div>

                {/* Configuration row */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Variant count */}
                  <div className="space-y-2">
                    <Label htmlFor="variant-count">Variants</Label>
                    <Select
                      value={variantCount.toString()}
                      onValueChange={(val) => setVariantCount(parseInt(val))}
                    >
                      <SelectTrigger id="variant-count">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <SelectItem key={n} value={n.toString()}>
                            {n} {n === 1 ? "variant" : "variants"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* AI Provider */}
                  <div className="space-y-2">
                    <Label htmlFor="provider">AI Provider</Label>
                    <Select value={provider} onValueChange={setProvider}>
                      <SelectTrigger id="provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemini">Gemini 2.5 Flash</SelectItem>
                        <SelectItem value="claude">Claude Sonnet 4</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Available Keywords section */}
                <Collapsible open={keywordsOpen} onOpenChange={setKeywordsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" className="w-full justify-between" size="sm">
                      <span className="text-sm">
                        Available Keywords ({keywords.length})
                      </span>
                      {keywordsOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3">
                    {keywordsLoading ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Loading keywords...
                      </p>
                    ) : keywords.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No segment keywords found. Upload and tag segments first.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {keywords.map((kw) => (
                          <Badge key={kw} variant="outline" className="text-xs">
                            {kw}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                {/* Error display */}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Generate button */}
                <Button
                  onClick={handleGenerate}
                  disabled={!idea.trim() || isGenerating}
                  className="w-full"
                  size="lg"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Scripts
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Output */}
          <div className="space-y-6">
            {scripts.length === 0 ? (
              // Empty state
              <EmptyState
                icon={<FileText className="h-6 w-6" />}
                title="Niciun script"
                description="Genereaza un script pentru a incepe."
              />
            ) : (
              // Scripts display
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">
                    Generated Scripts ({scripts.length})
                  </h2>
                  <Badge variant="secondary">
                    {provider === "gemini" ? "Gemini 2.5 Flash" : "Claude Sonnet 4"}
                  </Badge>
                </div>

                {scripts.map((script, index) => {
                  const wordCount = countWords(script);
                  const estimatedDuration = Math.round(wordCount / 2.5);

                  return (
                    <Card key={index}>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">Script {index + 1}</CardTitle>
                          <Badge variant="outline">
                            {wordCount} words (~{estimatedDuration}s)
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Textarea
                          value={script}
                          onChange={(e) => updateScript(index, e.target.value)}
                          rows={8}
                          className="resize-y font-mono text-sm"
                        />
                      </CardContent>
                    </Card>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
