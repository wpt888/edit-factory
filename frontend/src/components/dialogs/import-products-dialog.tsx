"use client";

import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiUpload } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SourceType = "google_sheets" | "csv" | "xlsx" | "google_shopping_xml";
type Mapping = Record<string, string | string[]>;

interface Preview {
  headers: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  suggested_mapping: Mapping;
}

const FIELDS = [
  ["title", "Product name", true],
  ["description", "Description", false],
  ["external_id", "External ID", false],
  ["sku", "SKU", false],
  ["brand", "Brand", false],
  ["category", "Category", false],
  ["price", "Price", false],
  ["sale_price", "Sale price", false],
  ["product_url", "Product URL", false],
] as const;

export function ImportProductsDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceType, setSourceType] = useState<SourceType>("google_sheets");
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [busy, setBusy] = useState(false);

  const imageColumns = useMemo(() => {
    const value = mapping.images;
    return Array.isArray(value) ? value : value ? [value] : [];
  }, [mapping.images]);

  const reset = () => {
    setPreview(null);
    setMapping({});
    setFile(null);
    setSourceUrl("");
    setName("");
  };

  const formData = (includeMapping = false) => {
    const data = new FormData();
    data.append("source_type", sourceType);
    data.append("source_url", sourceUrl.trim());
    if (file) data.append("file", file);
    if (includeMapping) {
      data.append("name", name.trim() || file?.name || "Product import");
      data.append("mapping_json", JSON.stringify(mapping));
    }
    return data;
  };

  const loadPreview = async () => {
    if (!file && !sourceUrl.trim()) {
      toast.error("Choose a file or enter a URL");
      return;
    }
    setBusy(true);
    try {
      const response = await apiUpload("/product-library/import/preview", formData());
      const data = (await response.json()) as Preview;
      setPreview(data);
      setMapping(data.suggested_mapping || {});
      if (!name) setName(file?.name?.replace(/\.[^.]+$/, "") || "Google Sheets products");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read product source");
    } finally {
      setBusy(false);
    }
  };

  const importRows = async () => {
    if (!mapping.title) {
      toast.error("Map a column to Product name");
      return;
    }
    setBusy(true);
    try {
      const response = await apiUpload("/product-library/import", formData(true));
      const result = await response.json();
      toast.success(`Imported ${result.imported} products${result.skipped ? `; skipped ${result.skipped}` : ""}`);
      onImported();
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Product import failed");
    } finally {
      setBusy(false);
    }
  };

  const setField = (field: string, value: string) => {
    setMapping((current) => {
      const next = { ...current };
      if (value === "__none__") delete next[field];
      else next[field] = value;
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="size-5" /> Import products</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Source type</Label>
            <Select value={sourceType} onValueChange={(value) => { setSourceType(value as SourceType); setPreview(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="google_sheets">Google Sheets URL</SelectItem>
                <SelectItem value="csv">CSV / TSV</SelectItem>
                <SelectItem value="xlsx">Excel XLSX</SelectItem>
                <SelectItem value="google_shopping_xml">Google Shopping XML</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Source name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="My store products" />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Source URL</Label>
          <Input
            value={sourceUrl}
            onChange={(event) => { setSourceUrl(event.target.value); setPreview(null); }}
            placeholder={sourceType === "google_sheets" ? "https://docs.google.com/spreadsheets/d/.../edit" : "Optional public CSV, XLSX or XML URL"}
          />
          <p className="text-xs text-muted-foreground">Google Sheets must be shared so the link can be read. The current signed-in profile owns the imported source.</p>
        </div>

        {sourceType !== "google_sheets" && (
          <div className="rounded-lg border border-dashed p-4">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept={sourceType === "xlsx" ? ".xlsx,.xlsm" : sourceType === "google_shopping_xml" ? ".xml" : ".csv,.tsv,.txt"}
              onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }}
            />
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" /> {file ? file.name : "Choose file"}
            </Button>
          </div>
        )}

        {!preview ? (
          <Button type="button" onClick={loadPreview} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Read headers
          </Button>
        ) : (
          <div className="space-y-5">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              Found <strong>{preview.row_count}</strong> data rows and <strong>{preview.headers.length}</strong> columns. Every column is retained in the product&apos;s custom fields.
            </div>

            <div>
              <h3 className="mb-3 font-medium">Map columns used by the pipeline</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map(([field, label, required]) => (
                  <div key={field} className="space-y-1.5">
                    <Label>{label}{required ? " *" : ""}</Label>
                    <Select value={(mapping[field] as string) || "__none__"} onValueChange={(value) => setField(field, value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {!required && <SelectItem value="__none__">Not mapped</SelectItem>}
                        {preview.headers.map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Image columns (select one or more)</Label>
              <div className="mt-2 flex flex-wrap gap-3 rounded-lg border p-3">
                {preview.headers.map((header) => (
                  <label key={header} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={imageColumns.includes(header)}
                      onCheckedChange={(checked) => setMapping((current) => ({
                        ...current,
                        images: checked ? [...imageColumns, header] : imageColumns.filter((item) => item !== header),
                      }))}
                    />
                    {header}
                  </label>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-xs">
                <thead className="bg-muted"><tr>{preview.headers.slice(0, 8).map((header) => <th key={header} className="whitespace-nowrap p-2 text-left">{header}</th>)}</tr></thead>
                <tbody>{preview.rows.slice(0, 5).map((row, index) => (
                  <tr key={index} className="border-t">{preview.headers.slice(0, 8).map((header) => <td key={header} className="max-w-48 truncate p-2">{String(row[header] ?? "")}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {preview && <Button onClick={importRows} disabled={busy || !mapping.title}>{busy && <Loader2 className="size-4 animate-spin" />} Import {preview.row_count} rows</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
