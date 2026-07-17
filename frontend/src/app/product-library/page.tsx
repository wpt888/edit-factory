"use client";

/**
 * Context Library — local, per-user store of context items (Phase D1).
 * An item is anything the user promotes: a product, a service, an offer.
 * Title + images + description (optionally AI-generated from image+title via
 * Gemini Vision). Items live in SQLite in userData; images on disk.
 * Replaces the hardcoded Gomag catalog as the default context source.
 * Routes/tables keep the historical "product" naming — UI copy is generic.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiGetWithRetry, apiDelete, apiUpload, apiPost, apiFetch, API_URL, handleApiError } from "@/lib/api";
import { useProfile } from "@/contexts/profile-context";
import { toast } from "sonner";
import {
  BookOpen,
  Loader2,
  Pencil,
  PlusCircle,
  Sparkles,
  Trash2,
  Upload,
  Film,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ImportProductsDialog } from "@/components/dialogs/import-products-dialog";
import { BatchSettingsDialog, type BatchSettings } from "@/components/dialogs/batch-settings-dialog";

interface LocalProduct {
  id: string;
  title: string;
  description: string;
  image_paths: string[];
  image_urls: string[];
  source_type?: string;
  extra_fields?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ProductSource {
  id: string;
  name: string;
  source_type: string;
  source_url?: string;
  last_synced_at?: string;
  sync_status: string;
}

const imageUrl = (product: LocalProduct, idx = 0) => {
  const value = product.image_urls[idx];
  if (!value) return "/placeholder-product.svg";
  return value.startsWith("http://") || value.startsWith("https://") ? value : `${API_URL}${value}`;
};

export default function ProductLibraryPage() {
  const { currentProfile } = useProfile();
  const router = useRouter();

  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sources, setSources] = useState<ProductSource[]>([]);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);

  // Dialog state — null = closed, "new" = add, otherwise product being edited
  const [editing, setEditing] = useState<LocalProduct | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [keptPaths, setKeptPaths] = useState<string[]>([]); // existing images kept (edit mode)
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "50", ...(search.trim() && { search: search.trim() }) });
      const res = await apiGetWithRetry(`/product-library?${params}`);
      const data = await res.json();
      setProducts(data.products || []);
      setTotal(data.pagination?.total || 0);
      setTotalPages(data.pagination?.total_pages || 1);
    } catch {
      toast.error("Failed to load context library");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const fetchSources = useCallback(async () => {
    try {
      const response = await apiGetWithRetry("/product-library/sources");
      const data = await response.json();
      setSources(data.sources || []);
    } catch {
      // Products remain usable even when source metadata cannot be loaded.
    }
  }, []);

  useEffect(() => {
    if (!currentProfile) return;
    fetchProducts();
  }, [currentProfile, fetchProducts]);

  useEffect(() => {
    if (!currentProfile) return;
    fetchSources();
  }, [currentProfile, fetchSources]);

  const refreshImportedData = () => {
    void fetchProducts();
    void fetchSources();
  };

  const syncSource = async (source: ProductSource) => {
    setSyncingSourceId(source.id);
    try {
      const response = await apiPost(`/product-library/sources/${source.id}/sync`);
      const data = await response.json();
      toast.success(`Synced ${data.imported} items${data.skipped ? `; skipped ${data.skipped}` : ""}`);
      refreshImportedData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Source sync failed");
    } finally {
      setSyncingSourceId(null);
    }
  };

  // ---- dialog helpers ----

  const openAdd = () => {
    setTitle("");
    setDescription("");
    setNewFiles([]);
    setKeptPaths([]);
    setEditing("new");
  };

  const openEdit = (product: LocalProduct) => {
    setTitle(product.title);
    setDescription(product.description || "");
    setNewFiles([]);
    setKeptPaths(product.image_paths);
    setEditing(product);
  };

  const addFiles = (files: FileList | File[]) => {
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setNewFiles((prev) => [...prev, ...images]);
  };

  const handleGenerateDescription = async () => {
    if (!title.trim()) {
      toast.error("Enter a title first");
      return;
    }
    setGenerating(true);
    try {
      let res: Response;
      if (newFiles.length > 0) {
        // Unsaved images in the form — send them directly
        const fd = new FormData();
        fd.append("title", title.trim());
        newFiles.slice(0, 3).forEach((f) => fd.append("images", f));
        res = await apiUpload("/product-library/generate-description", fd);
      } else if (editing && editing !== "new" && keptPaths.length > 0) {
        // Existing product with stored images
        res = await apiPost(`/product-library/${editing.id}/generate-description`);
      } else {
        toast.error("Add at least one image first");
        return;
      }
      const data = await res.json();
      if (data.description) {
        setDescription(data.description);
        toast.success("Description generated — review and edit as needed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      toast.error(msg || "Failed to generate description");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", description);
      newFiles.forEach((f) => fd.append("images", f));

      if (editing === "new") {
        const res = await apiUpload("/product-library", fd);
        const created = await res.json();
        setProducts((prev) => [created, ...prev]);
        toast.success("Item added");
      } else if (editing) {
        const removed = editing.image_paths.filter((p) => !keptPaths.includes(p));
        if (removed.length > 0) fd.append("remove_paths", JSON.stringify(removed));
        // apiUpload hardcodes POST — go through apiFetch for multipart PUT
        const res = await apiFetch(`/product-library/${editing.id}`, { method: "PUT", body: fd });
        const updated = await res.json();
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        toast.success("Item updated");
      }
      setEditing(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || "Failed to save item");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: LocalProduct) => {
    // ponytail: native confirm — no AlertDialog state machinery for one destructive action
    if (!window.confirm(`Delete "${product.title}"? Its images are removed too.`)) return;
    try {
      await apiDelete(`/product-library/${product.id}`);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      toast.success("Item deleted");
    } catch {
      toast.error("Failed to delete item");
    }
  };

  const handleGenerateVideo = (product: LocalProduct) => {
    const params = new URLSearchParams({
      id: product.id,
      title: product.title,
      source: "local",
      ...(product.image_urls[0] && { image: imageUrl(product) }),
    });
    router.push(`/product-video?${params.toString()}`);
  };

  const handleBatchGenerate = async (settings: BatchSettings) => {
    setBatchLoading(true);
    try {
      const response = await apiPost("/products/batch-generate", {
        product_ids: Array.from(selectedIds),
        source: "local",
        ...settings,
      });
      const data = await response.json();
      const params = new URLSearchParams({ batch_id: data.batch_id, src: "local" });
      if (settings.voiceover_mode !== "quick") params.set("vm", settings.voiceover_mode);
      if (settings.ai_provider !== "gemini") params.set("ai", settings.ai_provider);
      if (settings.codex_model) params.set("cm", settings.codex_model);
      router.push(`/batch-generate?${params.toString()}`);
    } catch (error) {
      handleApiError(error, "Batch generation failed");
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-background">
      <PageShell className="space-y-6">
        {/* Header */}
        <PageHeader
          icon={<BookOpen className="size-8 text-primary" />}
          title="Context Library"
          description="Products, services, offers — anything you promote, used as context for video generation"
          actions={
            <div className="flex gap-2">
              {selectedIds.size >= 2 && (
                <Button onClick={() => setBatchOpen(true)}>
                  <Film className="size-4 mr-2" /> Generate {selectedIds.size}
                </Button>
              )}
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="size-4 mr-2" /> Import
              </Button>
              <Button onClick={openAdd} data-testid="add-product">
                <PlusCircle className="size-4 mr-2" /> Add Item
              </Button>
            </div>
          }
        />

        <div className="relative mb-5 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Search names, descriptions or any custom column..."
            className="pl-9"
          />
        </div>

        {sources.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {sources.map((source) => (
              <div key={source.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                <FileSpreadsheet className="size-4 text-muted-foreground" />
                <span className="font-medium">{source.name}</span>
                <span className="text-xs text-muted-foreground">{source.source_type.replaceAll("_", " ")}</span>
                {source.source_url && (
                  <Button variant="ghost" size="sm" className="h-7" disabled={syncingSourceId === source.id} onClick={() => void syncSource(source)}>
                    <RefreshCw className={`size-3.5 ${syncingSourceId === source.id ? "animate-spin" : ""}`} /> Sync
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-6" />}
            title="Nothing here yet"
            description="Add your first item — a product, a service, an offer: a title, a few photos, and an optional description. It stays on this computer."
            action={{ label: "Add Item", onClick: openAdd }}
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {products.map((product) => (
              <Card key={product.id} className="relative overflow-hidden hover:shadow-md transition-shadow" data-testid="product-card">
                <div className="absolute left-2 top-2 z-10 rounded bg-background/90 p-1 shadow">
                  <Checkbox
                    checked={selectedIds.has(product.id)}
                    aria-label={`Select ${product.title}`}
                    onCheckedChange={() => setSelectedIds((current) => {
                      const next = new Set(current);
                      if (next.has(product.id)) next.delete(product.id);
                      else if (next.size < 50) next.add(product.id);
                      else toast.error("A batch can contain at most 50 items");
                      return next;
                    })}
                  />
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(product)}
                  alt={product.title}
                  className="w-full h-48 object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "/placeholder-product.svg";
                  }}
                />
                <CardContent className="p-3 space-y-1.5">
                  <h3
                    className="font-semibold text-sm leading-tight overflow-hidden"
                    style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                    title={product.title}
                  >
                    {product.title}
                  </h3>
                  {product.description && (
                    <p
                      className="text-xs text-muted-foreground overflow-hidden"
                      style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                    >
                      {product.description}
                    </p>
                  )}
                  <div className="flex gap-1 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs h-7"
                      onClick={() => handleGenerateVideo(product)}
                    >
                      <Film className="size-3 mr-1" />
                      Video
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => openEdit(product)}>
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(product)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && total > 0 && (
          <div className="mt-6 flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{total.toLocaleString()} items</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="size-4" /></Button>
              <span>Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}><ChevronRight className="size-4" /></Button>
            </div>
          </div>
        )}
      </PageShell>

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} onImported={refreshImportedData} />
      <BatchSettingsDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        onConfirm={handleBatchGenerate}
        productCount={selectedIds.size}
        loading={batchLoading}
      />

      {/* Add / Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add Item" : "Edit Item"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="product-title">Title</Label>
              <Input
                id="product-title"
                placeholder='e.g. "Parfum Oud Royal 50ml" or "SEO Audit — Starter"'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Images — drop zone + previews */}
            <div className="space-y-1.5">
              <Label>Images</Label>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter") fileInputRef.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed py-6 cursor-pointer transition-colors ${
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}
              >
                <Upload className="size-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Drag & drop images here, or click to browse
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  data-testid="image-input"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>

              {(keptPaths.length > 0 || newFiles.length > 0) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {editing !== "new" && editing !== null &&
                    keptPaths.map((rel) => {
                      const idx = editing.image_paths.indexOf(rel);
                      return (
                        <div key={rel} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imageUrl(editing, idx)}
                            alt=""
                            className="size-16 object-cover rounded-md border"
                          />
                          <button
                            type="button"
                            onClick={() => setKeptPaths((prev) => prev.filter((p) => p !== rel))}
                            className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  {newFiles.map((file, i) => (
                    <div key={`${file.name}-${i}`} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={URL.createObjectURL(file)}
                        alt=""
                        className="size-16 object-cover rounded-md border"
                      />
                      <button
                        type="button"
                        onClick={() => setNewFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Description + AI generate */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="product-description">Description</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={handleGenerateDescription}
                  disabled={generating}
                  data-testid="generate-description"
                >
                  {generating ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5 mr-1" />
                  )}
                  Generate with AI
                </Button>
              </div>
              <Textarea
                id="product-description"
                placeholder="Short description — or generate one from the image + title"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} data-testid="save-product">
              {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
              {editing === "new" ? "Add Item" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
