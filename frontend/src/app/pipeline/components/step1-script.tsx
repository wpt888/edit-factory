"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle,
  XCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Search,
  ChevronDown,
  ChevronUp,
  X,
  Info,
  Pencil,
  Settings2,
} from "lucide-react";
import { DebouncedInput, DebouncedTextarea } from "../pipeline-utils";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { CatalogProduct, ContextProduct } from "../pipeline-types";
import { SourceVideosCard } from "./source-videos-card";
import { WorkspaceSplit } from "./workspace-split";

// Loose ctx-bag type (F4): only the fields that need contextual typing for the
// inline callbacks below are typed precisely; everything else stays `any`.
type Step1Ctx = {
  contextProducts: ContextProduct[];
  setContextProducts: Dispatch<SetStateAction<ContextProduct[]>>;
  catalogFilters: { brands: string[]; categories: string[] };
  catalogProducts: CatalogProduct[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Step1Script({ ctx }: { ctx: any }) {
  const {
    aiRulesExpanded,
    setAiRulesExpanded,
    aiInstructions,
    setAiInstructions,
    aiRulesDirty,
    setAiRulesDirty,
    aiRulesSaved,
    saveAiInstructions,
    pipelineName,
    setPipelineName,
    idea,
    setIdea,
    context,
    setContext,
    contextExpanded,
    setContextExpanded,
    contextProductCount,
    contextProducts,
    setContextProducts,
    handleOpenCatalog,
    catalogOpen,
    catalogSearch,
    handleCatalogSearchChange,
    catalogBrand,
    catalogCategory,
    handleCatalogFilterChange,
    catalogFilters,
    catalogLoading,
    catalogProducts,
    toggleCatalogProduct,
    selectedCatalogIds,
    catalogPage,
    handleCatalogPageChange,
    catalogPagination,
    handleAddToContext,
    variantCount,
    setVariantCount,
    targetScriptDuration,
    setTargetScriptDuration,
    provider,
    setProvider,
    error,
    totalSegmentDuration,
    isGenerating,
    generationJob,
    handleCancelGenerate,
    handleGenerate,
    handleCreateManual,
    pipelineLayout,
    sourceVideos,
    selectedSourceIds,
  }: Step1Ctx = ctx;
  const workspaceLayout = pipelineLayout !== "guided";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const selectedSegmentCount = sourceVideos
    .filter((video: { id: string }) => selectedSourceIds.has(video.id))
    .reduce(
      (total: number, video: { segments_count: number }) => total + video.segments_count,
      0
    );
  const hasSelectedSegments = selectedSegmentCount > 0;
  return (
          <WorkspaceSplit
            splitId="step1"
            enabled={workspaceLayout}
            fallbackClassName={workspaceLayout
              ? "w-full space-y-3 min-[1280px]:grid min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:grid-cols-[minmax(22rem,0.72fr)_minmax(0,1.6fr)] min-[1280px]:items-stretch min-[1280px]:gap-px min-[1280px]:space-y-0 min-[1280px]:bg-border"
              : "w-full space-y-4"
            }
            leftSizing={{ defaultSize: "31%", minSize: "18rem" }}
            rightSizing={{ minSize: "30%" }}
            data-testid="step1-workspace"
            data-layout={pipelineLayout}
          >
            <aside
              className={workspaceLayout
                ? "min-w-0 bg-background min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:overflow-y-auto min-[1280px]:overscroll-contain"
                : "min-w-0"
              }
              data-testid="step1-inspector"
            >
              <SourceVideosCard ctx={ctx} workspace={workspaceLayout} />
            </aside>

            <section
              className={workspaceLayout
                ? "min-w-0 bg-background min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:overflow-y-auto min-[1280px]:overscroll-contain"
                : "min-w-0"
              }
              aria-label="Video idea editor"
              data-testid="step1-idea-canvas"
            >
            <Card className={workspaceLayout ? "min-[1280px]:gap-4 min-[1280px]:rounded-none min-[1280px]:border-0 min-[1280px]:py-4 min-[1280px]:shadow-none" : undefined}>
              <CardHeader className={workspaceLayout ? "min-[1280px]:border-b min-[1280px]:px-5 min-[1280px]:pb-4" : undefined}>
                <CardTitle>Video Idea</CardTitle>
                <CardDescription>
                  Describe the video you want to create, then generate scripts.
                </CardDescription>
              </CardHeader>
              <CardContent className={`space-y-4 ${workspaceLayout ? "min-[1280px]:px-5 min-[1280px]:pb-5" : ""}`}>
                <div className="space-y-2">
                  <Label htmlFor="idea">Video Idea *</Label>
                  <DebouncedTextarea
                    id="idea"
                    placeholder="Describe your video idea..."
                    rows={8}
                    value={idea}
                    onCommit={setIdea}
                    className="resize-y [field-sizing:fixed]"
                  />
                </div>

                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-between border border-dashed px-3 text-muted-foreground hover:text-foreground"
                      data-testid="step1-advanced-trigger"
                      aria-label="Advanced generation options"
                    >
                      <span className="flex items-center gap-2">
                        <Settings2 className="size-4" />
                        Advanced
                      </span>
                      {advancedOpen ? (
                        <ChevronUp className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent
                    className="space-y-4 pt-4"
                    data-testid="step1-advanced-content"
                  >
                {/* Persistent script-generation rules */}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-2"
                    onClick={() => setAiRulesExpanded(true)}
                  >
                    <BookOpen className="size-4 text-primary" />
                    Rules
                  </Button>

                  <div className="group/info relative flex items-center">
                    <button
                      type="button"
                      aria-label="About rules"
                      aria-describedby="rules-help"
                      className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Info className="size-3.5" />
                    </button>
                    <div
                      id="rules-help"
                      role="tooltip"
                      className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-72 rounded-md border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/info:opacity-100 group-focus-within/info:opacity-100"
                    >
                      These instructions are applied to every generated script. Use them to define tone, writing style, required phrases, and formatting.
                    </div>
                  </div>

                  {aiInstructions.trim() && (
                    <Badge variant="secondary" className="text-[11px] font-normal">
                      Configured
                    </Badge>
                  )}
                  {aiRulesSaved && (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle className="size-3" /> Saved
                    </span>
                  )}
                </div>

                <Dialog open={aiRulesExpanded} onOpenChange={setAiRulesExpanded}>
                  <DialogContent className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <BookOpen className="size-5 text-primary" />
                        Rules
                      </DialogTitle>
                      <DialogDescription>
                        Define the persistent instructions used for every AI-generated script.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="min-h-0 space-y-2">
                      <Label htmlFor="ai-instructions">Generation instructions</Label>
                      <Textarea
                        id="ai-instructions"
                        placeholder="For example: Use a conversational tone, avoid abbreviations, and start directly with the script..."
                        value={aiInstructions}
                        onChange={(e) => {
                          setAiInstructions(e.target.value);
                          setAiRulesDirty(true);
                        }}
                        className="h-[min(55vh,32rem)] min-h-64 resize-none overflow-y-auto text-sm [field-sizing:fixed]"
                      />
                      <p className="text-xs text-muted-foreground">
                        {aiInstructions.trim().length} characters · Saved rules are reused for future script sets.
                      </p>
                    </div>

                    <DialogFooter>
                      <DialogClose asChild>
                        <Button type="button" variant="outline">
                          Close
                        </Button>
                      </DialogClose>
                      <Button
                        type="button"
                        variant={aiRulesDirty ? "default" : "outline"}
                        onClick={() => saveAiInstructions(aiInstructions, true)}
                      >
                        <CheckCircle className="mr-1 size-4" />
                        Save & Close
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
                  <div className="space-y-4">
                    {/* Script set name */}
                    <div className="space-y-2">
                      <Label htmlFor="pipeline-name">Script Set Name (optional)</Label>
                      <DebouncedInput
                        id="pipeline-name"
                        placeholder="Generated automatically from your idea"
                        value={pipelineName}
                        onCommit={setPipelineName}
                        maxLength={200}
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave blank to use the first words of your idea. You can rename it later.
                      </p>
                    </div>
                  </div>

                  {/* Reference context: product data is optional, not required */}
                  <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
                  {/* Header row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="mr-auto">
                      <Label htmlFor="context">Reference Context</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Optional product details, brand information, or creative direction
                      </p>
                    </div>
                    {contextProductCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {contextProductCount} {contextProductCount === 1 ? "product" : "products"}
                      </Badge>
                    )}
                    {context.trim() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setContextExpanded(!contextExpanded)}
                      >
                        {contextExpanded ? (
                          <><ChevronUp className="h-3.5 w-3.5 mr-1" />Collapse</>
                        ) : (
                          <><ChevronDown className="h-3.5 w-3.5 mr-1" />Expand</>
                        )}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7"
                      onClick={handleOpenCatalog}
                    >
                      <BookOpen className="h-3.5 w-3.5 mr-1" />
                      {catalogOpen ? "Close Catalog" : "Browse Catalog"}
                    </Button>
                  </div>

                  {/* Product chips — always visible */}
                  {contextProducts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {contextProducts.map((product, idx) => (
                        <span
                          key={idx}
                          title={product.description}
                          className="inline-flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 rounded-full px-2.5 py-1 text-xs font-medium max-w-[200px]"
                        >
                          <span className="truncate">{product.title}</span>
                          <button
                            type="button"
                            onClick={() => setContextProducts(prev => prev.filter((_, i) => i !== idx))}
                            className="flex-shrink-0 hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Expanded: textarea for manual text */}
                  {contextExpanded && (
                    <DebouncedTextarea
                      id="context"
                      placeholder="Additional context (brand info, instructions)..."
                      rows={3}
                      value={context}
                      onCommit={setContext}
                      className="resize-none max-h-[200px] overflow-y-auto [field-sizing:fixed]"
                    />
                  )}

                  {/* Catalog Picker */}
                  {catalogOpen && (
                    <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
                      {/* Filters row */}
                      <div className="flex flex-wrap gap-2">
                        <div className="min-w-[180px] flex-1 relative">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search your products..."
                            value={catalogSearch}
                            onChange={(e) => handleCatalogSearchChange(e.target.value)}
                            className="pl-9 h-9"
                          />
                        </div>
                        <Select value={catalogBrand} onValueChange={(v) => handleCatalogFilterChange("brand", v)}>
                          <SelectTrigger className="h-9 min-w-[130px]">
                            <SelectValue placeholder="Brand" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Brands</SelectItem>
                            {catalogFilters.brands.map((b) => (
                              <SelectItem key={b} value={b}>{b}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={catalogCategory} onValueChange={(v) => handleCatalogFilterChange("category", v)}>
                          <SelectTrigger className="h-9 min-w-[130px]">
                            <SelectValue placeholder="Category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            {catalogFilters.categories.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Products grid */}
                      {catalogLoading ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : catalogProducts.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No products found</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-1.5 max-h-[300px] overflow-y-auto">
                          {catalogProducts.map((product) => (
                            <div
                              key={product.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleCatalogProduct(product.id)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCatalogProduct(product.id); } }}
                              className={`flex items-center gap-3 p-2 rounded-md border text-left transition-colors hover:bg-accent cursor-pointer ${
                                selectedCatalogIds.has(product.id) ? "border-primary bg-primary/5" : "border-border"
                              }`}
                            >
                              <Checkbox
                                checked={selectedCatalogIds.has(product.id)}
                                onCheckedChange={() => toggleCatalogProduct(product.id)}
                                className="flex-shrink-0"
                              />
                              {product.image_link && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={product.image_link}
                                  alt=""
                                  className="w-10 h-10 object-cover rounded flex-shrink-0"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{product.title}</p>
                                <div className="flex items-center gap-2">
                                  {product.brand && <span className="text-xs text-muted-foreground">{product.brand}</span>}
                                  {product.sku && <span className="text-xs text-muted-foreground font-mono">{product.sku}</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Pagination + action footer */}
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={catalogPage <= 1}
                            onClick={() => handleCatalogPageChange(catalogPage - 1)}
                          >
                            <ArrowLeft className="h-3 w-3" />
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            Page {catalogPagination.page} of {catalogPagination.total_pages} ({catalogPagination.total} products)
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={catalogPage >= catalogPagination.total_pages}
                            onClick={() => handleCatalogPageChange(catalogPage + 1)}
                          >
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </div>
                        {selectedCatalogIds.size > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">
                              {selectedCatalogIds.size} selected
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleAddToContext}
                            >
                              Add to Context
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                </div>

                {/* Configuration row */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

                  {/* Script Duration */}
                  <div className="space-y-2">
                    <Label>Duration (sec)</Label>
                    <div className="flex items-center gap-2">
                       <Slider
                         value={[targetScriptDuration]}
                         onValueChange={([v]) => setTargetScriptDuration(v)}
                         min={10}
                         max={120}
                         step={1}
                         className="flex-1"
                       />
                       <Input
                         type="number"
                         min={5}
                         max={300}
                         step={1}
                         value={targetScriptDuration}
                         onChange={(e) => {
                           const v = parseInt(e.target.value);
                           if (!isNaN(v) && v >= 5 && v <= 300) setTargetScriptDuration(v);
                         }}
                        className="w-16 h-8 text-center text-sm px-1"
                      />
                    </div>
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
                  </CollapsibleContent>
                </Collapsible>

                {/* Error display */}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Segment duration info */}
                {totalSegmentDuration > 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Info className="h-4 w-4" />
                    <span>{Math.round(totalSegmentDuration)}s material video disponibil (brut)</span>
                  </div>
                )}

                {/* Generate button */}
                {isGenerating ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <div className="w-full rounded-md border bg-muted/30 p-3" data-testid="script-generation-progress">
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium">
                          {generationJob?.current_step || "Starting script generation"}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {Math.round(generationJob?.progress || 0)}%
                        </span>
                      </div>
                      <Progress value={generationJob?.progress || 0} className="h-2" />
                      <p className="mt-2 text-xs text-muted-foreground">
                        You can refresh this page; progress is saved automatically.
                      </p>
                    </div>
                    <Button
                      disabled
                      className="w-full sm:w-auto sm:min-w-48"
                    >
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleCancelGenerate}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Stop
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      onClick={handleCreateManual}
                      variant="outline"
                      className="w-full sm:w-auto sm:min-w-48"
                      title="Skip AI generation — create blank script slots to fill in yourself"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Create Script Manually
                    </Button>
                    <Button
                      variant="cta"
                      onClick={handleGenerate}
                      disabled={!idea.trim() || !hasSelectedSegments}
                      className="w-full sm:w-auto sm:min-w-48"
                      title={!hasSelectedSegments
                        ? "Select footage with at least one segment before generating"
                        : undefined
                      }
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Scripts
                    </Button>
                  </div>
                )}
                {!hasSelectedSegments && (
                  <p className="text-right text-xs text-warning" role="status">
                    Select footage with at least one segment to enable generation.
                  </p>
                )}
              </CardContent>
            </Card>
            </section>
          </WorkspaceSplit>
  );
}
