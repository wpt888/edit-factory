/**
 * ProductPickerDialog - Modal dialog for searching and selecting a catalog product
 * to associate with a video segment.
 *
 * Features:
 * - Search with 300ms debounce (useRef timer pattern, no external library)
 * - Brand and category filter dropdowns (fetched from /catalog/products/filters)
 * - Scrollable product grid with thumbnails, brand badge, price, sale badge, variant count badge
 * - Pagination (prev/next buttons + page indicator)
 * - On product select: POST /associations, then calls onProductSelected callback
 * - Loading spinner and empty state
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { apiGet, apiPost, handleApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  Search,
  Loader2,
  Package,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";

// ============== TYPE DEFINITIONS ==============

export interface PipConfig {
  enabled: boolean;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  size: "small" | "medium" | "large";
  animation: "static" | "fade" | "kenburns";
}

export const DEFAULT_PIP_CONFIG: PipConfig = {
  enabled: false,
  position: "bottom-right",
  size: "medium",
  animation: "static",
};

export interface AssociationResponse {
  id: string;
  segment_id: string;
  catalog_product_id: string;
  selected_image_urls: string[];
  pip_config: PipConfig | null;
  slide_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  product_title: string | null;
  product_image: string | null;
  product_brand: string | null;
}

interface CatalogProduct {
  id: string;
  title: string;
  brand: string | null;
  product_type: string | null;
  image_link: string | null;
  raw_price_str: string | null;
  raw_sale_price_str: string | null;
  is_on_sale: boolean;
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

interface ProductPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segmentId: string;
  onProductSelected: (association: AssociationResponse) => void;
}

// ============== COMPONENT ==============

export function ProductPickerDialog({
  open,
  onOpenChange,
  segmentId,
  onProductSelected,
}: ProductPickerDialogProps) {
  // State
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    page_size: 20,
    total: 0,
    total_pages: 1,
  });
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    brands: [],
    categories: [],
  });

  // Debounce ref — 300ms timer pattern (no external library)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // ---- Debounce search input ----
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [brand, category]);

  // ---- Fetch filter options on dialog open ----
  const fetchFilterOptions = useCallback(async () => {
    try {
      const res = await apiGet("/catalog/products/filters");
      const data = await res.json();
      setFilterOptions(data);
    } catch {
      // Non-fatal — filters just won't be available
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchFilterOptions();
    } else {
      // Reset state on close
      setSearch("");
      setDebouncedSearch("");
      setBrand("all");
      setCategory("all");
      setPage(1);
      setProducts([]);
    }
    return () => { fetchAbortRef.current?.abort(); };
  }, [open, fetchFilterOptions]);

  // ---- Fetch products ----
  const fetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;

    // Abort previous request
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const abortController = new AbortController();
    fetchAbortRef.current = abortController;

    setLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: "20",
          ...(debouncedSearch && { search: debouncedSearch }),
          ...(brand !== "all" && { brand }),
          ...(category !== "all" && { category }),
        });
        const res = await apiGet(`/catalog/products?${params}`, { signal: abortController.signal });
        if (abortController.signal.aborted) return;
        const data = await res.json();
        setProducts(data.products ?? []);
        setPagination(data.pagination ?? { page: 1, page_size: 20, total: 0, total_pages: 1 });
      } catch {
        if (!abortController.signal.aborted) {
          toast.error("Failed to load catalog products");
        }
      } finally {
        if (!abortController.signal.aborted) setLoading(false);
      }
    })();

    return () => { abortController.abort(); };
  }, [open, debouncedSearch, brand, category, page]);

  // ---- Handle product selection ----
  const handleSelectProduct = async (product: CatalogProduct) => {
    setSelectingId(product.id);
    try {
      const res = await apiPost("/associations", {
        segment_id: segmentId,
        catalog_product_id: product.id,
      });
      const association: AssociationResponse = await res.json();
      toast.success(`Associated "${product.title}"`);
      onProductSelected(association);
      onOpenChange(false);
    } catch (err) {
      handleApiError(err, "Failed to associate product");
    } finally {
      setSelectingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select a Product</DialogTitle>
        </DialogHeader>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2 pt-1 pb-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Brand filter */}
          <Select value={brand} onValueChange={setBrand}>
            <SelectTrigger className="w-[150px]">
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

          {/* Category filter */}
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[160px]">
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
        </div>

        {/* Product grid */}
        <ScrollArea className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title="No products found"
              description="Try adjusting your search or filters."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-1 pr-3">
              {products.map((product) => (
                <Card
                  key={product.id}
                  className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleSelectProduct(product)}
                >
                  {/* Thumbnail */}
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={product.image_link || "/placeholder-product.svg"}
                      alt={product.title}
                      className="w-full h-36 object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          "/placeholder-product.svg";
                      }}
                    />
                    {product.is_on_sale && (
                      <Badge
                        variant="destructive"
                        className="absolute top-1 right-1 text-xs px-1"
                      >
                        SALE
                      </Badge>
                    )}
                    {product.variant_count && product.variant_count > 1 && (
                      <Badge
                        variant="secondary"
                        className="absolute bottom-1 right-1 text-xs px-1"
                      >
                        {product.variant_count} variants
                      </Badge>
                    )}
                    {/* Loading overlay for this card */}
                    {selectingId === product.id && (
                      <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    )}
                  </div>

                  <CardContent className="p-2 space-y-1">
                    <h3
                      className="font-semibold text-xs leading-tight overflow-hidden"
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
                      <Badge variant="outline" className="text-xs px-1 py-0">
                        {product.brand}
                      </Badge>
                    )}
                    <div className="flex items-center gap-1 pt-0.5">
                      {product.is_on_sale ? (
                        <>
                          <span className="text-xs font-bold text-green-400">
                            {product.raw_sale_price_str}
                          </span>
                          <span className="text-xs text-muted-foreground line-through">
                            {product.raw_price_str}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs font-bold">
                          {product.raw_price_str}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Pagination */}
        {!loading && products.length > 0 && (
          <div className="flex items-center justify-center gap-3 pt-2 border-t">
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
              onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
              disabled={page >= pagination.total_pages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
