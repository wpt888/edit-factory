"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { CopyPlus, GripVertical, Loader2, Plus, Save, Trash2, Type } from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { EditorHeader } from "@/components/editor-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { useProfile } from "@/contexts/profile-context";
import { apiDelete, apiGetWithRetry, apiPost, apiPut } from "@/lib/api";
import {
  DEFAULT_SUBTITLE_SETTINGS,
  type SubtitleSettings,
  type UserSubtitlePreset,
} from "@/types/video-processing";

type Draft = {
  name: string;
  settings: SubtitleSettings;
  settingsA?: SubtitleSettings;
  settingsB?: SubtitleSettings;
  wordsPerSubtitle: number;
};

type Tab = "shared" | "A" | "B";
type PanelId = "templates" | "settings" | "preview";
type DropTarget = { panelId: PanelId; side: "before" | "after" };

const DEFAULT_PANEL_ORDER: PanelId[] = ["templates", "settings", "preview"];
const PANEL_ORDER_STORAGE_KEY = "blipost.subtitle-templates.panel-order.v1";
const PANEL_LAYOUT_STORAGE_KEY = "blipost.subtitle-templates.panel-layout.v1";
const DRAG_THRESHOLD = 5;
const INTERACTIVE_SELECTOR = "button, a, input, textarea, select, [role='button'], [contenteditable='true']";
const noopStorage = { getItem: () => null, setItem: () => {} };

function isPanelId(value: string | undefined): value is PanelId {
  return value === "templates" || value === "settings" || value === "preview";
}

function readPanelOrder(): PanelId[] {
  if (typeof window === "undefined") return [...DEFAULT_PANEL_ORDER];
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_ORDER_STORAGE_KEY) ?? "null");
    if (
      Array.isArray(parsed)
      && parsed.length === DEFAULT_PANEL_ORDER.length
      && DEFAULT_PANEL_ORDER.every((panelId) => parsed.includes(panelId))
    ) {
      return parsed as PanelId[];
    }
  } catch {
    // Use the default arrangement when storage is unavailable or malformed.
  }
  return [...DEFAULT_PANEL_ORDER];
}

function movePanel(order: PanelId[], draggedId: PanelId, target: DropTarget): PanelId[] {
  const withoutDragged = order.filter((panelId) => panelId !== draggedId);
  const targetIndex = withoutDragged.indexOf(target.panelId);
  if (targetIndex < 0) return order;
  const insertAt = targetIndex + (target.side === "after" ? 1 : 0);
  withoutDragged.splice(insertAt, 0, draggedId);
  return withoutDragged;
}

const NEW_DRAFT: Draft = {
  name: "My subtitle template",
  settings: { ...DEFAULT_SUBTITLE_SETTINGS },
  wordsPerSubtitle: 2,
};

function toDraft(preset: UserSubtitlePreset): Draft {
  return {
    name: preset.name,
    settings: { ...DEFAULT_SUBTITLE_SETTINGS, ...preset.settings },
    settingsA: preset.settingsA ? { ...DEFAULT_SUBTITLE_SETTINGS, ...preset.settingsA } : undefined,
    settingsB: preset.settingsB ? { ...DEFAULT_SUBTITLE_SETTINGS, ...preset.settingsB } : undefined,
    wordsPerSubtitle: preset.wordsPerSubtitle ?? 2,
  };
}

export default function SubtitleTemplatesPage() {
  const { currentProfile } = useProfile();
  const profileId = currentProfile?.id ?? null;

  const [presets, setPresets] = useState<UserSubtitlePreset[]>([]);
  const [selectedId, setSelectedId] = useState("new");
  const [draft, setDraft] = useState<Draft>({ ...NEW_DRAFT });
  const [tab, setTab] = useState<Tab>("shared");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [panelOrder, setPanelOrder] = useState<PanelId[]>(DEFAULT_PANEL_ORDER);
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const panelOrderRef = useRef(panelOrder);
  const dragRef = useRef<{
    panelId: PanelId;
    startX: number;
    startY: number;
    armed: boolean;
  } | null>(null);
  const { defaultLayout, onLayoutChange } = useDefaultLayout({
    id: PANEL_LAYOUT_STORAGE_KEY,
    storage: typeof window === "undefined" ? noopStorage : window.localStorage,
  });

  const isNew = selectedId === "new";
  const selectedPreset = presets.find((preset) => preset.id === selectedId);

  // Settings shown/edited for the active tab. "A"/"B" fall back to the shared
  // style until the user explicitly edits them (then the override is created).
  const activeSettings = useMemo<SubtitleSettings>(() => {
    if (tab === "A") return draft.settingsA ?? draft.settings;
    if (tab === "B") return draft.settingsB ?? draft.settings;
    return draft.settings;
  }, [tab, draft]);

  const loadPresets = useCallback(
    async (preferredId?: string) => {
      if (!profileId) return;
      setLoading(true);
      try {
        const res = await apiGetWithRetry(`/profiles/${profileId}/subtitle-presets`);
        const data = await res.json();
        const next: UserSubtitlePreset[] = Array.isArray(data?.presets) ? data.presets : [];
        setPresets(next);
        const preferred = next.find((preset) => preset.id === preferredId);
        if (preferred) {
          setSelectedId(preferred.id);
          setDraft(toDraft(preferred));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load subtitle templates");
      } finally {
        setLoading(false);
      }
    },
    [profileId],
  );

  useEffect(() => {
    // Loading is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    const nextOrder = readPanelOrder();
    panelOrderRef.current = nextOrder;
    // Read after hydration so a saved browser preference cannot mismatch SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPanelOrder(nextOrder);
  }, []);

  useEffect(() => {
    panelOrderRef.current = panelOrder;
  }, [panelOrder]);

  useEffect(() => {
    const resetDrag = () => {
      dragRef.current = null;
      setDraggedPanel(null);
      setDropTarget(null);
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    };

    const targetAtPoint = (x: number, y: number): DropTarget | null => {
      const element = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-subtitle-template-panel]");
      const panelId = element?.dataset.subtitleTemplatePanel;
      if (!element || !isPanelId(panelId)) return null;
      const bounds = element.getBoundingClientRect();
      return {
        panelId,
        side: x < bounds.left + bounds.width / 2 ? "before" : "after",
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.armed) {
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (distance < DRAG_THRESHOLD) return;
        drag.armed = true;
        setDraggedPanel(drag.panelId);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      setDropTarget(targetAtPoint(event.clientX, event.clientY));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.armed) {
        const target = targetAtPoint(event.clientX, event.clientY);
        if (target && target.panelId !== drag.panelId) {
          const nextOrder = movePanel(panelOrderRef.current, drag.panelId, target);
          panelOrderRef.current = nextOrder;
          setPanelOrder(nextOrder);
          try {
            localStorage.setItem(PANEL_ORDER_STORAGE_KEY, JSON.stringify(nextOrder));
          } catch {
            // The current-session layout still works when storage is unavailable.
          }
        }
      }
      resetDrag();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) resetDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", resetDrag);
    window.addEventListener("blur", resetDrag);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", resetDrag);
      window.removeEventListener("blur", resetDrag);
      window.removeEventListener("keydown", handleKeyDown);
      resetDrag();
    };
  }, []);

  const select = (preset: UserSubtitlePreset) => {
    setSelectedId(preset.id);
    setDraft(toDraft(preset));
    setTab("shared");
    setSavedAt(false);
  };

  const beginCreate = () => {
    setSelectedId("new");
    setDraft({ ...NEW_DRAFT, settings: { ...DEFAULT_SUBTITLE_SETTINGS } });
    setTab("shared");
    setSavedAt(false);
  };

  const duplicate = () => {
    setSelectedId("new");
    setDraft((current) => ({ ...current, name: `${current.name} copy` }));
    setTab("shared");
    setSavedAt(false);
  };

  const applySettings = (next: SubtitleSettings) => {
    setSavedAt(false);
    setDraft((current) => {
      if (tab === "A") return { ...current, settingsA: next };
      if (tab === "B") return { ...current, settingsB: next };
      return { ...current, settings: next };
    });
  };

  const save = async () => {
    if (!profileId) {
      toast.error("No active profile");
      return;
    }
    const name = draft.name.trim();
    if (!name) {
      toast.error("Template name cannot be empty");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        settings: draft.settings,
        settingsA: draft.settingsA,
        settingsB: draft.settingsB,
        wordsPerSubtitle: draft.wordsPerSubtitle,
      };
      const res = isNew
        ? await apiPost(`/profiles/${profileId}/subtitle-presets`, payload)
        : await apiPut(`/profiles/${profileId}/subtitle-presets/${selectedId}`, payload);
      const saved = (await res.json().catch(() => null)) as UserSubtitlePreset | null;
      await loadPresets(saved?.id ?? (isNew ? undefined : selectedId));
      setSavedAt(true);
      toast.success(isNew ? "Template created" : "Template saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save template");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!profileId || !selectedPreset) return;
    setDeleting(true);
    try {
      await apiDelete(`/profiles/${profileId}/subtitle-presets/${selectedPreset.id}`);
      setDeleteOpen(false);
      beginCreate();
      await loadPresets();
      toast.success("Template deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete template");
    } finally {
      setDeleting(false);
    }
  };

  const beginPanelDrag = (
    panelId: PanelId,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    event.preventDefault();
    dragRef.current = {
      panelId,
      startX: event.clientX,
      startY: event.clientY,
      armed: false,
    };
  };

  const panelHeader = (panelId: PanelId, title: string, actions?: ReactNode) => (
    <div
      onPointerDown={(event) => beginPanelDrag(panelId, event)}
      title="Drag to move panel"
      className="flex h-12 shrink-0 touch-none cursor-grab items-center gap-2 border-b border-border px-3 active:cursor-grabbing"
      data-testid={`subtitle-panel-header-${panelId}`}
    >
      <GripVertical className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
      {actions}
    </div>
  );

  const dropIndicator = (panelId: PanelId) => {
    if (!dropTarget || draggedPanel === panelId || dropTarget.panelId !== panelId) return null;
    return (
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-2 z-50 w-1 rounded-full bg-primary shadow-lg ${dropTarget.side === "before" ? "left-1" : "right-1"}`}
      />
    );
  };

  const panelContent: Record<PanelId, ReactNode> = {
    templates: (
      <div className="flex h-full min-w-0 flex-col bg-muted/20">
        {panelHeader("templates", "Templates", (
          <Button size="icon" variant="ghost" className="size-7" onClick={beginCreate} aria-label="New template">
            <Plus className="size-4" />
          </Button>
        ))}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-1 p-2">
            <button
              type="button"
              onClick={beginCreate}
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left text-sm ${isNew ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-accent"}`}
            >
              <Plus className="size-3.5" />New template
            </button>
            {loading ? (
              <div className="flex justify-center p-8"><Loader2 className="size-5 animate-spin text-primary" /></div>
            ) : presets.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No saved templates yet.</p>
            ) : (
              presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => select(preset)}
                  data-testid="subtitle-template-row"
                  className={`flex w-full flex-col rounded-md border px-3 py-2.5 text-left ${selectedId === preset.id ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-accent"}`}
                >
                  <span className="truncate text-sm font-medium">{preset.name}</span>
                  <span className="mt-0.5 text-[11px] text-muted-foreground">
                    {preset.wordsPerSubtitle ?? 2} words/line
                    {(preset.settingsA || preset.settingsB) ? " · A/B" : ""}
                  </span>
                </button>
              ))
            )}
          </div>
          {!isNew && selectedPreset && (
            <div className="p-3">
              <Button variant="ghost" size="sm" className="w-full text-destructive hover:bg-destructive/10" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 size-4" />Delete template
              </Button>
            </div>
          )}
        </div>
      </div>
    ),
    settings: (
      <div className="flex h-full min-w-0 flex-col bg-background">
        {panelHeader("settings", "Subtitle settings")}
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="subtitle-template-settings">
          <div className="space-y-3 border-b border-border p-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Template name</Label>
              <Input
                value={draft.name}
                onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); setSavedAt(false); }}
                data-testid="subtitle-template-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Words per subtitle</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={draft.wordsPerSubtitle}
                onChange={(event) => { setDraft((current) => ({ ...current, wordsPerSubtitle: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })); setSavedAt(false); }}
                data-testid="subtitle-template-words"
              />
            </div>
            <div className="flex gap-1 rounded-md border border-border p-1">
              {(["shared", "A", "B"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  data-testid={`subtitle-template-tab-${value}`}
                  className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
                >
                  {value === "shared" ? "Shared" : `Meta ${value}`}
                </button>
              ))}
            </div>
            {tab !== "shared" && (
              <p className="text-[11px] text-muted-foreground">
                {(tab === "A" ? draft.settingsA : draft.settingsB)
                  ? `Overriding the shared style for Meta ${tab}.`
                  : `Editing here creates a Meta ${tab} override; until then it mirrors the shared style.`}
              </p>
            )}
          </div>
          <div className="p-4">
            <SubtitleEditor
              renderMode="settings-only"
              settings={activeSettings}
              onSettingsChange={applySettings}
              showPreview={false}
              compact
            />
          </div>
        </div>
      </div>
    ),
    preview: (
      <div className="flex h-full min-w-0 flex-col bg-muted/10">
        {panelHeader("preview", "Preview")}
        <section className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6" aria-label="Subtitle preview">
          <SubtitleEditor
            renderMode="preview-only"
            settings={activeSettings}
            onSettingsChange={applySettings}
            previewText="Sample subtitle text"
            previewHeight={520}
            className="w-full max-w-[320px]"
          />
        </section>
      </div>
    ),
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[640px] flex-col overflow-hidden bg-background" data-testid="subtitle-template-editor">
      <EditorHeader
        icon={<Type className="size-4 text-primary" />}
        title="Subtitle Templates"
        breadcrumb={draft.name}
        subtitle="Reusable caption looks"
        actions={
          <>
            {savedAt && !saving && <span className="mr-1 text-xs text-muted-foreground" data-testid="subtitle-template-saved">Saved</span>}
            <Button variant="ghost" size="sm" onClick={duplicate} disabled={loading}>
              <CopyPlus className="mr-2 size-4" />Duplicate
            </Button>
            <Button variant="ghost" size="sm" onClick={beginCreate}>
              <Plus className="mr-2 size-4" />New template
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || !draft.name.trim() || !profileId} data-testid="subtitle-template-save">
              <Save className="mr-2 size-4" />{saving ? "Saving..." : "Save template"}
            </Button>
          </>
        }
      />

      <ResizablePanelGroup
        id="subtitle-template-workspace"
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChange={onLayoutChange}
        className="min-h-0 flex-1"
        data-testid="subtitle-template-panels"
      >
        {panelOrder.map((panelId, index) => (
          <Fragment key={panelId}>
            {index > 0 && (
              <ResizableHandle
                withHandle
                className="w-px bg-border/70"
                data-testid="subtitle-panel-resize-handle"
              />
            )}
            <ResizablePanel
              id={`subtitle-template-${panelId}`}
              defaultSize={panelId === "templates" ? 280 : panelId === "settings" ? 360 : undefined}
              minSize={panelId === "preview" ? 280 : 240}
              className="min-w-0"
            >
              <div
                data-subtitle-template-panel={panelId}
                data-testid={`subtitle-panel-${panelId}`}
                className={`relative h-full min-w-0 ${draggedPanel === panelId ? "opacity-50" : ""}`}
              >
                {dropIndicator(panelId)}
                {panelContent[panelId]}
              </div>
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>


      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete subtitle template?"
        description={`This removes “${selectedPreset?.name ?? "this template"}” from your profile.`}
        confirmLabel="Delete template"
        variant="destructive"
        loading={deleting}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
