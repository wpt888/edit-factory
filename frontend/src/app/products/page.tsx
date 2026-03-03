"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiGetWithRetry, apiPost } from "@/lib/api";
import { useProfile } from "@/contexts/profile-context";
import { toast } from "sonner";
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Tag,
  Film,
  PlusCircle,
  BookOpen,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CreateFeedDialog } from "@/components/create-feed-dialog";

// Type definitions
interface Feed {
  id: string;
  name: string;
  feed_url: string;
  sync_status: string;
  product_count: number;
  last_synced_at: string | null;
  sync_error: string | null;
}

interface Product {
  id: string;
  feed_id: string;
  title: string;
  brand: string | null;
  product_type: string | null;
  image_link: string | null;
  raw_price_str: string | null;
  raw_sale_price_str: string | null;
  is_on_sale: boolean;
  product_url: string | null;
  variant_count?: number;
}

interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

interface FilterOptions {
  brands: string[];
  categories: string[];
}

type SourceTab = "catalog" | "feed";

export default function ProductsPage() {
  const { currentProfile } = useProfile();
  const router = useRouter();

  // Tab state
  const [activeTab, setActiveTab] = useState<SourceTab>("catalog");

  // Feed state (for "feed" tab)
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [selectedFeed, setSelectedFeed] = useState<Feed | null>(null);

  // Product state
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    page_size: 50,
    total: 0,
    total_pages: 1,
  });
  const [loading, setLoading] = useState(false);

  // Filter state
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [onSale, setOnSale] = useState(false);
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    brands: [],
    categories: [],
  });

  // Pagination
  const [page, setPage] = useState(1);

  // Multi-select state
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  // Create feed dialog state
  const [createFeedOpen, setCreateFeedOpen] = useState(false);

  // Ref for sync timeout cleanup
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Search debounce — 400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Cleanup sync timeout on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  // Reset filters when tab changes
  useEffect(() => {
    setPage(1);
    setSearch("");
    setDebouncedSearch("");
    setOnSale(false);
    setCategory("all");
    setBrand("all");
    setSelectedProductIds(new Set());
    setProducts([]);
    setPagination({ page: 1, page_size: 50, total: 0, total_pages: 1 });
  }, [activeTab]);

  // Reset page to 1 when any filter changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, onSale, category, brand]);

  // ---- Feed tab logic ----
  const fetchFeeds = useCallback(async () => {
    try {
      const res = await apiGetWithRetry("/feeds");
      if (res.ok) {
        const data = await res.json();
        setFeeds(data);
        if (data.length > 0 && !selectedFeedId) {
          setSelectedFeedId(data[0].id);
          setSelectedFeed(data[0]);
        }
      } else {
        toast.error("Failed to load feeds");
      }
    } catch {
      toast.error("Network error loading feeds");
    }
  }, [selectedFeedId]);

  useEffect(() => {
    if (!currentProfile || activeTab !== "feed") return;
    fetchFeeds();
  }, [currentProfile, activeTab, fetchFeeds]);

  const fetchFeedFilterOptions = useCallback(async (feedId: string) => {
    try {
      const res = await apiGetWithRetry(`/feeds/${feedId}/products/filters`);
      if (res.ok) {
        const data = await res.json();
        setFilterOptions(data);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchFeedProducts = useCallback(async () => {
    if (!selectedFeedId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: "50",
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(onSale && { on_sale: "true" }),
        ...(category !== "all" && { category }),
        ...(brand !== "all" && { brand }),
      });
      const res = await apiGetWithRetry(`/feeds/${selectedFeedId}/products?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products);
        setPagination(data.pagination);
      } else {
        toast.error("Failed to load products");
      }
    } catch {
      toast.error("Network error loading products");
    } finally {
      setLoading(false);
    }
  }, [selectedFeedId, debouncedSearch, onSale, category, brand, page]);

  // When feed changes, fetch filter options + reset
  useEffect(() => {
    if (!selectedFeedId || activeTab !== "feed") return;
    fetchFeedFilterOptions(selectedFeedId);
    setPage(1);
    setCategory("all");
    setBrand("all");
    setSearch("");
    setDebouncedSearch("");
    setOnSale(false);
    setSelectedProductIds(new Set());
  }, [selectedFeedId, activeTab, fetchFeedFilterOptions]);

  // Fetch feed products when filters/page change
  useEffect(() => {
    if (!selectedFeedId || activeTab !== "feed") return;
    fetchFeedProducts();
  }, [selectedFeedId, debouncedSearch, onSale, category, brand, page, activeTab, fetchFeedProducts]);

  // ---- Catalog tab logic ----
  const fetchCatalogFilterOptions = useCallback(async () => {
    try {
      const res = await apiGetWithRetry("/catalog/products/filters");
      if (res.ok) {
        const data = await res.json();
        setFilterOptions(data);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchCatalogProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: "50",
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(onSale && { on_sale: "true" }),
        ...(category !== "all" && { category }),
        ...(brand !== "all" && { brand }),
      });
      const res = await apiGetWithRetry(`/catalog/products?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products);
        setPagination(data.pagination);
      } else {
        toast.error("Failed to load catalog products");
      }
    } catch {
      toast.error("Network error loading catalog products");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, onSale, category, brand, page]);

  // Fetch catalog filters on tab switch
  useEffect(() => {
    if (activeTab !== "catalog" || !currentProfile) return;
    fetchCatalogFilterOptions();
  }, [activeTab, currentProfile, fetchCatalogFilterOptions]);

  // Fetch catalog products when filters/page change
  useEffect(() => {
    if (activeTab !== "catalog" || !currentProfile) return;
    fetchCatalogProducts();
  }, [activeTab, currentProfile, debouncedSearch, onSale, category, brand, page, fetchCatalogProducts]);

  // ---- Shared handlers ----
  const handleFeedCreated = async (newFeed: Feed) => {
    setFeeds((prev) => [newFeed, ...prev]);
    setSelectedFeedId(newFeed.id);
    setSelectedFeed(newFeed);
    await fetchFeeds();
  };

  const handleFeedChange = (feedId: string) => {
    const feed = feeds.find((f) => f.id === feedId) || null;
    setSelectedFeedId(feedId);
    setSelectedFeed(feed);
  };

  const handleSync = async (feedId: string) => {
    try {
      const res = await apiPost(`/feeds/${feedId}/sync`);
      if (res.ok) {
        toast.success("Sync started");
        setFeeds((prev) =>
          prev.map((f) =>
            f.id === feedId ? { ...f, sync_status: "syncing" } : f
          )
        );
        if (selectedFeed?.id === feedId) {
          setSelectedFeed((prev) =>
            prev ? { ...prev, sync_status: "syncing" } : prev
          );
        }
        syncTimeoutRef.current = setTimeout(async () => {
          const refreshRes = await apiGetWithRetry("/feeds");
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            setFeeds(data);
            const updated = data.find((f: Feed) => f.id === feedId);
            if (updated && selectedFeedId === feedId) {
              setSelectedFeed(updated);
            }
          }
        }, 3000);
      } else {
        const errData = await res.json().catch(() => ({ detail: "Sync failed" }));
        toast.error(errData.detail || "Sync failed");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleGenerateVideo = (product: Product) => {
    const params = new URLSearchParams({
      id: product.id,
      title: product.title,
      source: activeTab,
      ...(product.image_link && { image: product.image_link }),
      ...(product.raw_price_str && { price: product.raw_price_str }),
      ...(product.brand && { brand: product.brand }),
      ...(activeTab === "feed" && selectedFeedId ? { feed_id: selectedFeedId } : {}),
    });
    router.push(`/product-video?${params.toString()}`);
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const selectAllOnPage = () => {
    setSelectedProductIds(new Set(products.map((p) => p.id)));
  };

  const clearSelection = () => {
    setSelectedProductIds(new Set());
  };

  const handleBatchGenerate = async () => {
    setBatchLoading(true);
    try {
      const res = await apiPost("/products/batch-generate", {
        product_ids: Array.from(selectedProductIds),
        source: activeTab,
        voiceover_mode: "quick",
        tts_provider: "edge",
        duration_s: 30,
        encoding_preset: "tiktok",
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/batch-generate?batch_id=${data.batch_id}`);
      } else {
        const err = await res.json().catch(() => ({ detail: "Batch generation failed" }));
        toast.error(err.detail || "Batch generation failed");
      }
    } catch {
      toast.error("Network error starting batch generation");
    } finally {
      setBatchLoading(false);
    }
  };

  const getSyncBadgeVariant = (status: string) => {
    switch (status) {
      case "idle":
      case "completed":
        return "default";
      case "syncing":
        return "secondary";
      case "error":
        return "destructive";
      default:
        return "outline";
    }
  };

  const getSyncBadgeClass = (status: string) => {
    switch (status) {
      case "idle":
      case "completed":
        return "bg-green-600 hover:bg-green-600 text-white";
      case "syncing":
        return "bg-yellow-500 hover:bg-yellow-500 text-white";
      case "error":
        return "";
      default:
        return "";
    }
  };

  const showProducts = activeTab === "catalog" || (activeTab === "feed" && selectedFeedId);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Package className="h-8 w-8 text-primary" />
              Products
            </h1>
            <p className="text-muted-foreground mt-1">
              Browse and filter synced product catalog
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-4 p-1 bg-muted rounded-lg w-fit">
          <button
            onClick={() => setActiveTab("catalog")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "catalog"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BookOpen className="h-4 w-4" />
            Catalog
          </button>
          <button
            onClick={() => setActiveTab("feed")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "feed"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Tag className="h-4 w-4" />
            Feed
          </button>
        </div>

        {/* Feed selector bar — only visible on Feed tab */}
        {activeTab === "feed" && (
          <div className="flex flex-wrap items-center gap-3 mb-4 p-4 bg-card border rounded-lg">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select
                value={selectedFeedId || ""}
                onValueChange={handleFeedChange}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select a feed..." />
                </SelectTrigger>
                <SelectContent>
                  {feeds.map((feed) => (
                    <SelectItem key={feed.id} value={feed.id}>
                      {feed.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedFeed && (
              <>
                <Badge
                  variant={getSyncBadgeVariant(selectedFeed.sync_status)}
                  className={getSyncBadgeClass(selectedFeed.sync_status)}
                >
                  {selectedFeed.sync_status === "syncing" && (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  )}
                  {selectedFeed.sync_status}
                </Badge>

                <span className="text-sm text-muted-foreground">
                  {selectedFeed.product_count.toLocaleString()} products
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSync(selectedFeed.id)}
                  disabled={selectedFeed.sync_status === "syncing"}
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-1 ${
                      selectedFeed.sync_status === "syncing"
                        ? "animate-spin"
                        : ""
                    }`}
                  />
                  Re-sync
                </Button>
              </>
            )}

            {feeds.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreateFeedOpen(true)}
              >
                <PlusCircle className="h-4 w-4 mr-1" />
                New Feed
              </Button>
            )}

            {feeds.length === 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreateFeedOpen(true)}
              >
                <PlusCircle className="h-4 w-4 mr-1" />
                Add Your First Feed
              </Button>
            )}
          </div>
        )}

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-card border rounded-lg">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* On Sale toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="on-sale-toggle"
              checked={onSale}
              onCheckedChange={setOnSale}
            />
            <Label htmlFor="on-sale-toggle" className="cursor-pointer text-sm">
              On Sale
            </Label>
          </div>

          {/* Category dropdown */}
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {filterOptions.categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Brand dropdown */}
          <Select value={brand} onValueChange={setBrand}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Brands" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              {filterOptions.brands.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Product card grid */}
        {!showProducts ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Niciun produs"
            description="Import products from a feed or add manually."
            action={{ label: "Add Feed", onClick: () => setCreateFeedOpen(true) }}
          />
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Niciun produs"
            description={activeTab === "catalog"
              ? "Catalogul nu contine produse care sa corespunda filtrelor."
              : "Import products from a feed or add manually."}
          />
        ) : (
          <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 ${selectedProductIds.size > 0 ? "pb-24" : ""}`}>
            {products.map((product) => (
              <Card key={product.id} className={`overflow-hidden hover:shadow-md transition-shadow ${selectedProductIds.has(product.id) ? "ring-2 ring-primary" : ""}`}>
                <div className="relative">
                  {/* Multi-select checkbox */}
                  <div
                    className="absolute top-2 left-2 z-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedProductIds.has(product.id)}
                      onCheckedChange={() => toggleProductSelection(product.id)}
                      className="bg-background/80 border-2"
                    />
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={product.image_link || "/placeholder-product.svg"}
                    alt={product.title}
                    className="w-full h-48 object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        "/placeholder-product.svg";
                    }}
                  />
                  {product.is_on_sale && (
                    <Badge
                      variant="destructive"
                      className="absolute top-2 right-2 text-xs"
                    >
                      SALE
                    </Badge>
                  )}
                  {product.variant_count && product.variant_count > 1 && (
                    <Badge
                      variant="secondary"
                      className="absolute bottom-2 right-2 text-xs"
                    >
                      {product.variant_count} variante
                    </Badge>
                  )}
                </div>
                <CardContent className="p-3 space-y-1">
                  <h3
                    className="font-semibold text-sm leading-tight overflow-hidden"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                    title={product.title}
                  >
                    {product.title}
                  </h3>
                  {product.brand && (
                    <p className="text-xs text-muted-foreground truncate">
                      {product.brand}
                    </p>
                  )}
                  <div className="flex items-center gap-1 flex-wrap pt-1">
                    {product.is_on_sale ? (
                      <>
                        <span className="text-sm font-bold text-green-400">
                          {product.raw_sale_price_str}
                        </span>
                        <span className="text-xs text-muted-foreground line-through">
                          {product.raw_price_str}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm font-bold">
                        {product.raw_price_str}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 text-xs h-7"
                    onClick={() => handleGenerateVideo(product)}
                  >
                    <Film className="h-3 w-3 mr-1" />
                    Generate Video
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pagination controls */}
        {showProducts && !loading && products.length > 0 && (
          <div className="flex flex-col items-center gap-2 mt-8">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>

              <span className="text-sm font-medium">
                Page {pagination.page} of {pagination.total_pages}
              </span>

              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPage((p) => Math.min(pagination.total_pages, p + 1))
                }
                disabled={page >= pagination.total_pages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Showing {pagination.total.toLocaleString()} products
            </p>
          </div>
        )}
      </div>

      {/* Create Feed dialog */}
      <CreateFeedDialog
        open={createFeedOpen}
        onOpenChange={setCreateFeedOpen}
        onCreated={handleFeedCreated}
      />

      {/* Sticky action bar — visible when products are selected */}
      {selectedProductIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-50 p-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-medium">{selectedProductIds.size} selected</span>
              <Button variant="ghost" size="sm" onClick={selectAllOnPage}>
                Select all on page
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
            <Button onClick={handleBatchGenerate} disabled={batchLoading}>
              {batchLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Film className="h-4 w-4 mr-2" />
              )}
              Generate {selectedProductIds.size} Videos
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
