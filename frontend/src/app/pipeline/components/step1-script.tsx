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
import {
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle,
  XCircle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  BookOpen,
  Search,
  ChevronDown,
  ChevronUp,
  X,
  Info,
  Pencil,
} from "lucide-react";
import { DebouncedInput, DebouncedTextarea } from "../pipeline-utils";
import type { Dispatch, SetStateAction } from "react";
import type { CatalogProduct, ContextProduct } from "../pipeline-types";

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
    handleCancelGenerate,
    handleGenerate,
    handleCreateManual,
  }: Step1Ctx = ctx;
  return (
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Video Idea</CardTitle>
                <CardDescription>
                  Describe your video idea and configure generation options
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* AI Rules (collapsible) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 -ml-2"
                      onClick={() => setAiRulesExpanded(!aiRulesExpanded)}
                    >
                      {aiRulesExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 mr-1" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      <BookOpen className="h-3.5 w-3.5 mr-1" />
                      AI Rules
                    </Button>
                    {aiInstructions.trim() && !aiRulesExpanded && (
                      <Badge variant="secondary" className="text-xs">
                        {aiInstructions.trim().length} chars
                      </Badge>
                    )}
                    {aiRulesSaved && (
                      <span className="text-xs text-success flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Saved
                      </span>
                    )}
                  </div>
                  {aiRulesExpanded && (
                    <div className="space-y-2">
                      <Textarea
                        id="ai-instructions"
                        placeholder="Persistent rules for AI script generation (tone, style, phrases, formatting)..."
                        rows={4}
                        value={aiInstructions}
                        onChange={(e) => {
                          setAiInstructions(e.target.value);
                          setAiRulesDirty(true);
                        }}
                        className="resize-y text-sm [field-sizing:fixed]"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant={aiRulesDirty ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => saveAiInstructions(aiInstructions, true)}
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Save & Close
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Script set name */}
                <div className="space-y-2">
                  <Label htmlFor="pipeline-name">Script Set Name</Label>
                  <DebouncedInput
                    id="pipeline-name"
                    placeholder="e.g. Nike Air Max Campaign, Summer Sale Promo..."
                    value={pipelineName}
                    onCommit={setPipelineName}
                    maxLength={200}
                  />
                </div>

                {/* Idea textarea */}
                <div className="space-y-2">
                  <Label htmlFor="idea">Video Idea *</Label>
                  <DebouncedTextarea
                    id="idea"
                    placeholder="Describe your video idea..."
                    rows={5}
                    value={idea}
                    onCommit={setIdea}
                    className="resize-y [field-sizing:fixed]"
                  />
                </div>

                {/* Context textarea (collapsible) */}
                <div className="space-y-2">
                  {/* Header row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label htmlFor="context" className="mr-auto">Context (Optional)</Label>
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
                      {catalogOpen ? "Close My Products" : "Add from My Products"}
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
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search your products..."
                            value={catalogSearch}
                            onChange={(e) => handleCatalogSearchChange(e.target.value)}
                            className="pl-9 h-9"
                          />
                        </div>
                        <Select value={catalogBrand} onValueChange={(v) => handleCatalogFilterChange("brand", v)}>
                          <SelectTrigger className="w-[140px] h-9">
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
                          <SelectTrigger className="w-[140px] h-9">
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

                {/* Configuration row */}
                <div className="grid grid-cols-3 gap-4">
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
                  <div className="flex gap-2 w-full">
                    <Button
                      disabled
                      className="flex-1"
                      size="lg"
                    >
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </Button>
                    <Button
                      variant="destructive"
                      size="lg"
                      onClick={handleCancelGenerate}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Stop
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button
                      variant="cta"
                      onClick={handleGenerate}
                      disabled={!idea.trim()}
                      className="w-full"
                      size="lg"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Scripts
                    </Button>
                    <Button
                      onClick={handleCreateManual}
                      variant="outline"
                      className="w-full"
                      size="lg"
                      title="Skip AI generation — create blank script slots to fill in yourself"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Create Script Manually
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
  );
}
