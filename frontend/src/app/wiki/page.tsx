"use client";

import * as React from "react";
import { useProfile } from "@/contexts/profile-context";
import {
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  handleApiError,
} from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { WikiSidebar, type WikiPageSummary } from "@/components/wiki/wiki-sidebar";
import { WikiMarkdown } from "@/components/wiki/wiki-markdown";
import { NotebookPen, Pencil, Save, Trash2, X, Loader2 } from "lucide-react";

interface WikiPageFull extends WikiPageSummary {
  content_md: string;
  created_at?: string | null;
}

export default function WikiPage() {
  const { currentProfile } = useProfile();
  const [pages, setPages] = React.useState<WikiPageSummary[]>([]);
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState<WikiPageFull | null>(null);
  const [loadingList, setLoadingList] = React.useState(true);
  const [loadingPage, setLoadingPage] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Edit-mode draft state
  const [editing, setEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState("");
  const [draftCategory, setDraftCategory] = React.useState("");
  const [draftMd, setDraftMd] = React.useState("");

  const loadList = React.useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await apiGet("/wiki");
      const data: WikiPageSummary[] = await res.json();
      setPages(data);
      return data;
    } catch (err) {
      handleApiError(err, "Nu am putut încărca notițele");
      return [];
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Reload when the active profile changes (each profile has its own KB).
  React.useEffect(() => {
    setSelectedId(null);
    setCurrent(null);
    setEditing(false);
    loadList();
  }, [currentProfile?.id, loadList]);

  const selectPage = React.useCallback(async (id: string) => {
    setSelectedId(id);
    setEditing(false);
    setLoadingPage(true);
    try {
      const res = await apiGet(`/wiki/${id}`);
      const data: WikiPageFull = await res.json();
      setCurrent(data);
    } catch (err) {
      handleApiError(err, "Nu am putut încărca notița");
      setCurrent(null);
    } finally {
      setLoadingPage(false);
    }
  }, []);

  const handleNew = React.useCallback(async () => {
    setCreating(true);
    try {
      const res = await apiPost("/wiki", {
        title: "Notiță nouă",
        category: "",
        content_md: "",
      });
      const created: WikiPageFull = await res.json();
      await loadList();
      setSelectedId(created.id);
      setCurrent(created);
      // Jump straight into editing the fresh page.
      setDraftTitle(created.title);
      setDraftCategory(created.category || "");
      setDraftMd(created.content_md || "");
      setEditing(true);
    } catch (err) {
      handleApiError(err, "Nu am putut crea notița");
    } finally {
      setCreating(false);
    }
  }, [loadList]);

  const startEdit = React.useCallback(() => {
    if (!current) return;
    setDraftTitle(current.title);
    setDraftCategory(current.category || "");
    setDraftMd(current.content_md || "");
    setEditing(true);
  }, [current]);

  const handleSave = React.useCallback(async () => {
    if (!current) return;
    setSaving(true);
    try {
      const res = await apiPut(`/wiki/${current.id}`, {
        title: draftTitle,
        category: draftCategory,
        content_md: draftMd,
      });
      const updated: WikiPageFull = await res.json();
      setCurrent(updated);
      setEditing(false);
      await loadList();
      toast.success("Notiță salvată");
    } catch (err) {
      handleApiError(err, "Nu am putut salva notița");
    } finally {
      setSaving(false);
    }
  }, [current, draftTitle, draftCategory, draftMd, loadList]);

  const handleDelete = React.useCallback(async () => {
    if (!current) return;
    try {
      await apiDelete(`/wiki/${current.id}`);
      toast.success("Notiță ștearsă");
      setCurrent(null);
      setSelectedId(null);
      setEditing(false);
      await loadList();
    } catch (err) {
      handleApiError(err, "Nu am putut șterge notița");
    }
  }, [current, loadList]);

  return (
    <div className="container mx-auto p-6">
      <div className="mb-4 flex items-center gap-2">
        <NotebookPen className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">Notițe</h1>
        <Badge variant="secondary" className="ml-1">
          {currentProfile?.name || "—"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* Sidebar */}
        <aside className="rounded-lg border bg-card p-3 lg:h-[calc(100vh-12rem)]">
          {loadingList ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <WikiSidebar
              pages={pages}
              selectedId={selectedId}
              query={query}
              onQueryChange={setQuery}
              onSelect={selectPage}
              onNew={handleNew}
              creating={creating}
            />
          )}
        </aside>

        {/* Content */}
        <section className="rounded-lg border bg-card p-5 lg:h-[calc(100vh-12rem)] lg:overflow-y-auto">
          {loadingPage ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : !current ? (
            <EmptyState onNew={handleNew} creating={creating} hasPages={pages.length > 0} />
          ) : editing ? (
            /* ---------- EDIT MODE ---------- */
            <div className="flex h-full flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Titlu"
                  className="sm:flex-1 text-base font-semibold"
                />
                <Input
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value)}
                  placeholder="Categorie (opțional)"
                  className="sm:w-56"
                />
              </div>
              <Separator />
              {/* Split: Markdown source | live preview */}
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex min-h-0 flex-col">
                  <span className="mb-1 text-xs font-medium text-muted-foreground">
                    Markdown
                  </span>
                  <Textarea
                    value={draftMd}
                    onChange={(e) => setDraftMd(e.target.value)}
                    placeholder="Scrie în Markdown…"
                    className="min-h-[300px] flex-1 resize-none font-mono text-sm"
                  />
                </div>
                <div className="flex min-h-0 flex-col">
                  <span className="mb-1 text-xs font-medium text-muted-foreground">
                    Previzualizare
                  </span>
                  <div className="flex-1 overflow-y-auto rounded-md border bg-background p-4">
                    <WikiMarkdown content={draftMd} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  <X className="mr-1 size-4" /> Anulează
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-1 size-4" />
                  )}
                  Salvează
                </Button>
              </div>
            </div>
          ) : (
            /* ---------- VIEW MODE ---------- */
            <div className="flex h-full flex-col">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{current.title}</h2>
                  {current.category && (
                    <Badge variant="outline" className="mt-1">
                      {current.category}
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" onClick={startEdit}>
                    <Pencil className="mr-1 size-4" /> Editează
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" title="Șterge notița">
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Ștergi „{current.title}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Această acțiune nu poate fi anulată.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Anulează</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Șterge</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <Separator className="mb-4" />
              <div className="flex-1 overflow-y-auto">
                <WikiMarkdown content={current.content_md} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyState({
  onNew,
  creating,
  hasPages,
}: {
  onNew: () => void;
  creating: boolean;
  hasPages: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <NotebookPen className="size-12 text-muted-foreground/40" />
      <div>
        <p className="font-medium">
          {hasPages ? "Selectează o notiță" : "Nicio notiță încă"}
        </p>
        <p className="text-sm text-muted-foreground">
          {hasPages
            ? "Alege o notiță din stânga sau creează una nouă."
            : "Salvează aici prompturi, idei și notițe de lucru."}
        </p>
      </div>
      <Button onClick={onNew} disabled={creating}>
        {creating ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
        Notiță nouă
      </Button>
    </div>
  );
}
