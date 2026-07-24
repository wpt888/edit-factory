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
import { ChevronDown, CopyPlus, Loader2, Plus, Trash2, Type } from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { EditorHeader } from "@/components/editor-header";
import { WorkspacePanelHeader } from "@/components/workspace-panel-header";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  type UserSubtitleTemplate,
} from "@/types/video-processing";

type StyleDraft = {
  id?: string;
  name: string;
  settings: SubtitleSettings;
  settingsA?: SubtitleSettings;
  settingsB?: SubtitleSettings;
  wordsPerSubtitle: number;
};

type Draft = {
  name: string;
  styles: StyleDraft[];
};

type Tab = "shared" | "A" | "B";
type PanelId = "templates" | "settings" | "preview";
type DropTarget = { panelId: PanelId; side: "before" | "after" };
type StyleNameEdit = { templateId: string; styleIndex: number; value: string };
type TemplateNameEdit = { templateId: string; value: string };
type DeletedStyleUndo = { session: number; styleIndex: number; style: StyleDraft };
type SaveState = "idle" | "saving" | "saved" | "error";
type SaveSnapshot = {
  draft: Draft;
  revision: number;
  selectedStyleIndex: number;
  session: number;
  templateId: string;
};

const DEFAULT_PANEL_ORDER: PanelId[] = ["templates", "settings", "preview"];
const PANEL_ORDER_STORAGE_KEY = "blipost.subtitle-templates.panel-order.v1";
const PANEL_LAYOUT_STORAGE_KEY = "blipost.subtitle-templates.panel-layout.v1";
const DRAG_THRESHOLD = 5;
const AUTOSAVE_DELAY_MS = 650;
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

const NEW_STYLE: StyleDraft = {
  name: "Style 1",
  settings: { ...DEFAULT_SUBTITLE_SETTINGS },
  wordsPerSubtitle: 2,
};

const NEW_DRAFT: Draft = {
  name: "My subtitle template",
  styles: [NEW_STYLE],
};

function toStyleDraft(preset: UserSubtitlePreset): StyleDraft {
  return {
    id: preset.id,
    name: preset.name,
    settings: { ...DEFAULT_SUBTITLE_SETTINGS, ...preset.settings },
    settingsA: preset.settingsA ? { ...DEFAULT_SUBTITLE_SETTINGS, ...preset.settingsA } : undefined,
    settingsB: preset.settingsB ? { ...DEFAULT_SUBTITLE_SETTINGS, ...preset.settingsB } : undefined,
    wordsPerSubtitle: preset.wordsPerSubtitle ?? 2,
  };
}

function toDraft(template: UserSubtitleTemplate): Draft {
  return {
    name: template.name,
    styles: template.styles.map(toStyleDraft),
  };
}

export default function SubtitleTemplatesPage() {
  const { currentProfile } = useProfile();
  const profileId = currentProfile?.id ?? null;

  const [templates, setTemplates] = useState<UserSubtitleTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("new");
  const [selectedStyleIndex, setSelectedStyleIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>({ ...NEW_DRAFT, styles: [{ ...NEW_STYLE }] });
  const [expandedTemplateIds, setExpandedTemplateIds] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("shared");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [draftRevision, setDraftRevision] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletedStyleUndo, setDeletedStyleUndo] = useState<DeletedStyleUndo | null>(null);
  const [templateNameEdit, setTemplateNameEdit] = useState<TemplateNameEdit | null>(null);
  const [styleNameEdit, setStyleNameEdit] = useState<StyleNameEdit | null>(null);
  const [panelOrder, setPanelOrder] = useState<PanelId[]>(DEFAULT_PANEL_ORDER);
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const panelOrderRef = useRef(panelOrder);
  const draftRevisionRef = useRef(0);
  const editSessionRef = useRef(0);
  const selectedTemplateIdRef = useRef(selectedTemplateId);
  const persistedRevisionsRef = useRef(new Map<number, number>([[0, 0]]));
  const sessionTemplateIdsRef = useRef(new Map<number, string>());
  const queuedSnapshotsRef = useRef(new Set<string>());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
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

  const isNew = selectedTemplateId === "new";
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const selectedStyle = draft.styles[selectedStyleIndex] ?? draft.styles[0];

  const markDirty = useCallback((preserveStyleUndo = false) => {
    if (!preserveStyleUndo) setDeletedStyleUndo(null);
    setSaveState("saving");
    setDraftRevision((current) => {
      const next = current + 1;
      draftRevisionRef.current = next;
      return next;
    });
  }, []);

  const startEditSession = useCallback((templateId: string, persisted = true) => {
    const session = editSessionRef.current + 1;
    editSessionRef.current = session;
    selectedTemplateIdRef.current = templateId;
    if (persisted) persistedRevisionsRef.current.set(session, draftRevisionRef.current);
    return session;
  }, []);

  // Settings shown/edited for the active tab. "A"/"B" fall back to the shared
  // style until the user explicitly edits them (then the override is created).
  const activeSettings = useMemo<SubtitleSettings>(() => {
    if (tab === "A") return selectedStyle.settingsA ?? selectedStyle.settings;
    if (tab === "B") return selectedStyle.settingsB ?? selectedStyle.settings;
    return selectedStyle.settings;
  }, [tab, selectedStyle]);

  const loadTemplates = useCallback(
    async (preferredTemplateId?: string, preferredStyleId?: string) => {
      if (!profileId) return;
      setLoading(true);
      try {
        const res = await apiGetWithRetry(`/profiles/${profileId}/subtitle-templates`);
        const data = await res.json();
        const next: UserSubtitleTemplate[] = Array.isArray(data?.templates) ? data.templates : [];
        setTemplates(next);
        const preferred = next.find((template) => template.id === preferredTemplateId);
        const templateToSelect = preferred ?? next[0];
        if (templateToSelect) {
          const styleIndex = preferred
            ? Math.max(0, preferred.styles.findIndex((style) => style.id === preferredStyleId))
            : 0;
          startEditSession(templateToSelect.id);
          setSelectedTemplateId(templateToSelect.id);
          setSelectedStyleIndex(styleIndex);
          setDraft(toDraft(templateToSelect));
          setExpandedTemplateIds((current) => (
            current.includes(templateToSelect.id) ? current : [...current, templateToSelect.id]
          ));
          setSaveState("saved");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load subtitle templates");
      } finally {
        setLoading(false);
      }
    },
    [profileId, startEditSession],
  );

  useEffect(() => {
    // Loading is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTemplates();
  }, [loadTemplates]);

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

  const enqueueSave = useCallback((snapshot: SaveSnapshot) => {
    if (!profileId) return;
    const name = snapshot.draft.name.trim();
    if (!name || snapshot.draft.styles.some((style) => !style.name.trim())) return;

    const snapshotKey = `${snapshot.session}:${snapshot.revision}`;
    if (queuedSnapshotsRef.current.has(snapshotKey)) return;
    queuedSnapshotsRef.current.add(snapshotKey);

    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const effectiveTemplateId = sessionTemplateIdsRef.current.get(snapshot.session) ?? snapshot.templateId;
        const payload = {
          name,
          styles: snapshot.draft.styles.map((style) => ({
            id: style.id,
            name: style.name.trim(),
            settings: style.settings,
            settingsA: style.settingsA,
            settingsB: style.settingsB,
            wordsPerSubtitle: style.wordsPerSubtitle,
          })),
        };

        try {
          const res = effectiveTemplateId === "new"
            ? await apiPost(`/profiles/${profileId}/subtitle-templates`, payload)
            : await apiPut(`/profiles/${profileId}/subtitle-templates/${effectiveTemplateId}`, payload);
          const saved = (await res.json()) as UserSubtitleTemplate;
          sessionTemplateIdsRef.current.set(snapshot.session, saved.id);
          persistedRevisionsRef.current.set(snapshot.session, snapshot.revision);
          setTemplates((current) => {
            const index = current.findIndex((template) => template.id === saved.id);
            if (index < 0) return [...current, saved];
            return current.map((template) => template.id === saved.id ? saved : template);
          });

          if (editSessionRef.current !== snapshot.session) return;
          if (selectedTemplateIdRef.current === "new") {
            selectedTemplateIdRef.current = saved.id;
            setSelectedTemplateId(saved.id);
            setExpandedTemplateIds((current) => current.includes(saved.id) ? current : [...current, saved.id]);
          }
          if (draftRevisionRef.current === snapshot.revision) {
            const styleIndex = Math.min(snapshot.selectedStyleIndex, saved.styles.length - 1);
            setSelectedStyleIndex(Math.max(0, styleIndex));
            setDraft(toDraft(saved));
            setSaveState("saved");
          } else {
            setSaveState("saving");
          }
        } catch (error) {
          if (editSessionRef.current === snapshot.session) setSaveState("error");
          toast.error(error instanceof Error ? error.message : "Could not autosave template");
        } finally {
          queuedSnapshotsRef.current.delete(snapshotKey);
        }
      });
  }, [profileId]);

  const flushCurrentDraft = () => {
    const session = editSessionRef.current;
    if ((persistedRevisionsRef.current.get(session) ?? -1) >= draftRevision) return;
    enqueueSave({
      draft,
      revision: draftRevision,
      selectedStyleIndex,
      session,
      templateId: selectedTemplateId,
    });
  };

  useEffect(() => {
    const session = editSessionRef.current;
    if (
      loading
      || !profileId
      || (persistedRevisionsRef.current.get(session) ?? -1) >= draftRevision
      || !draft.name.trim()
      || draft.styles.some((style) => !style.name.trim())
    ) return;

    const timeout = window.setTimeout(() => {
      enqueueSave({ draft, revision: draftRevision, selectedStyleIndex, session, templateId: selectedTemplateId });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [draft, draftRevision, enqueueSave, loading, profileId, selectedStyleIndex, selectedTemplateId]);

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

  const select = (template: UserSubtitleTemplate, styleIndex = 0) => {
    flushCurrentDraft();
    startEditSession(template.id);
    setDeletedStyleUndo(null);
    setTemplateNameEdit(null);
    setStyleNameEdit(null);
    setSelectedTemplateId(template.id);
    setSelectedStyleIndex(styleIndex);
    setDraft(toDraft(template));
    setExpandedTemplateIds((current) => current.includes(template.id) ? current : [...current, template.id]);
    setTab("shared");
    setSaveState("saved");
  };

  const beginCreate = (autosave = true) => {
    flushCurrentDraft();
    startEditSession("new");
    setTemplateNameEdit(null);
    setStyleNameEdit(null);
    setSelectedTemplateId("new");
    setSelectedStyleIndex(0);
    setDraft({
      ...NEW_DRAFT,
      styles: [{ ...NEW_STYLE, settings: { ...DEFAULT_SUBTITLE_SETTINGS } }],
    });
    setTab("shared");
    setSaveState(autosave ? "saving" : "idle");
    if (autosave) markDirty();
  };

  const addStyle = (template?: UserSubtitleTemplate) => {
    const base = template && template.id !== selectedTemplateId ? toDraft(template) : draft;
    const nextStyle: StyleDraft = {
      ...NEW_STYLE,
      name: `Style ${base.styles.length + 1}`,
      settings: { ...DEFAULT_SUBTITLE_SETTINGS },
    };
    if (template) {
      if (template.id !== selectedTemplateId) {
        flushCurrentDraft();
        startEditSession(template.id);
      }
      setSelectedTemplateId(template.id);
      selectedTemplateIdRef.current = template.id;
      setExpandedTemplateIds((current) => current.includes(template.id) ? current : [...current, template.id]);
    }
    setDraft({ ...base, styles: [...base.styles, nextStyle] });
    setSelectedStyleIndex(base.styles.length);
    setTab("shared");
    markDirty();
  };

  const beginStyleNameEdit = (style: StyleDraft | UserSubtitlePreset, styleIndex: number, template?: UserSubtitleTemplate) => {
    const templateId = template?.id ?? "new";
    if (template) {
      if (selectedTemplateId === template.id) {
        setSelectedStyleIndex(styleIndex);
        setTab("shared");
      } else {
        select(template, styleIndex);
      }
    } else {
      setSelectedStyleIndex(styleIndex);
      setTab("shared");
    }
    setTemplateNameEdit(null);
    setStyleNameEdit({ templateId, styleIndex, value: style.name });
  };

  const beginTemplateNameEdit = (template: UserSubtitleTemplate) => {
    if (selectedTemplateId !== template.id) select(template);
    setStyleNameEdit(null);
    setTemplateNameEdit({ templateId: template.id, value: template.name });
  };

  const commitTemplateNameEdit = () => {
    if (!templateNameEdit || templateNameEdit.templateId !== selectedTemplateId) {
      setTemplateNameEdit(null);
      return;
    }
    const name = templateNameEdit.value.trim();
    if (name) {
      setDraft((current) => ({ ...current, name }));
      markDirty();
    }
    setTemplateNameEdit(null);
  };

  const commitStyleNameEdit = () => {
    if (!styleNameEdit || styleNameEdit.templateId !== selectedTemplateId) {
      setStyleNameEdit(null);
      return;
    }
    const name = styleNameEdit.value.trim();
    if (name) {
      setDraft((current) => ({
        ...current,
        styles: current.styles.map((style, index) => index === styleNameEdit.styleIndex ? { ...style, name } : style),
      }));
      markDirty();
    }
    setStyleNameEdit(null);
  };

  const removeStyle = (
    style: StyleDraft | UserSubtitlePreset,
    styleIndex: number,
    template?: UserSubtitleTemplate,
  ) => {
    const base = template && template.id !== selectedTemplateId ? toDraft(template) : draft;
    let session = editSessionRef.current;
    if (base.styles.length <= 1) {
      toast.error("A template must keep at least one style");
      return;
    }

    if (template && template.id !== selectedTemplateId) {
      flushCurrentDraft();
      session = startEditSession(template.id);
      setSelectedTemplateId(template.id);
      selectedTemplateIdRef.current = template.id;
      setExpandedTemplateIds((current) => current.includes(template.id) ? current : [...current, template.id]);
    }
    setTemplateNameEdit(null);
    setStyleNameEdit(null);
    setDeletedStyleUndo({
      session,
      styleIndex,
      style: {
        id: style.id,
        name: style.name,
        settings: { ...style.settings },
        settingsA: style.settingsA ? { ...style.settingsA } : undefined,
        settingsB: style.settingsB ? { ...style.settingsB } : undefined,
        wordsPerSubtitle: style.wordsPerSubtitle ?? 2,
      },
    });
    setDraft({
      ...base,
      styles: base.styles.filter((_, index) => index !== styleIndex),
    });
    setSelectedStyleIndex(Math.min(styleIndex, base.styles.length - 2));
    setTab("shared");
    markDirty(true);
    toast.success("Style deleted · Ctrl+Z to undo");
  };

  const undoStyleDelete = useCallback(() => {
    if (!deletedStyleUndo || deletedStyleUndo.session !== editSessionRef.current) return;

    const restoredIndex = Math.min(deletedStyleUndo.styleIndex, draft.styles.length);
    setDraft((current) => {
      const styles = [...current.styles];
      styles.splice(restoredIndex, 0, deletedStyleUndo.style);
      return { ...current, styles };
    });
    setSelectedStyleIndex(restoredIndex);
    setDeletedStyleUndo(null);
    setTab("shared");
    markDirty(true);
    toast.success("Style restored");
  }, [deletedStyleUndo, draft.styles.length, markDirty]);

  useEffect(() => {
    const handleUndo = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "z"
        || (!event.ctrlKey && !event.metaKey)
        || event.shiftKey
        || event.altKey
      ) return;

      const target = event.target;
      if (
        target instanceof HTMLElement
        && target.closest("input, textarea, [contenteditable='true'], [role='textbox']")
      ) return;

      if (!deletedStyleUndo || deletedStyleUndo.session !== editSessionRef.current) return;
      event.preventDefault();
      undoStyleDelete();
    };

    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [deletedStyleUndo, undoStyleDelete]);

  const duplicate = () => {
    flushCurrentDraft();
    startEditSession("new");
    setSelectedTemplateId("new");
    setDraft((current) => ({
      ...current,
      name: `${current.name} copy`,
      styles: current.styles.map((style) => ({
        name: style.name,
        settings: { ...style.settings },
        settingsA: style.settingsA ? { ...style.settingsA } : undefined,
        settingsB: style.settingsB ? { ...style.settingsB } : undefined,
        wordsPerSubtitle: style.wordsPerSubtitle,
      })),
    }));
    setTab("shared");
    markDirty();
  };

  const applySettings = (next: SubtitleSettings) => {
    setDraft((current) => {
      const styles = current.styles.map((style, index) => {
        if (index !== selectedStyleIndex) return style;
        if (tab === "A") return { ...style, settingsA: next };
        if (tab === "B") return { ...style, settingsB: next };
        return { ...style, settings: next };
      });
      return { ...current, styles };
    });
    markDirty();
  };

  const remove = async () => {
    if (!profileId || !selectedTemplate) return;
    setDeleting(true);
    try {
      await apiDelete(`/profiles/${profileId}/subtitle-presets/${selectedTemplate.id}`);
      setDeleteOpen(false);
      beginCreate(false);
      await loadTemplates();
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
    <WorkspacePanelHeader
      title={title}
      onPointerDown={(event) => beginPanelDrag(panelId, event)}
      tooltip="Drag to move panel"
      className="touch-none cursor-grab active:cursor-grabbing"
      data-testid={`subtitle-panel-header-${panelId}`}
      actions={actions}
    />
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
      <div className="flex h-full min-w-0 flex-col bg-surface-canvas">
        {panelHeader("templates", "Templates", (
          <Button size="icon" variant="ghost" className="size-7" onClick={() => beginCreate()} aria-label="New template">
            <Plus className="size-4" />
          </Button>
        ))}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-1 p-2">
            {isNew && !loading && (
              <div className="ml-5 space-y-1 border-l border-border pl-2" data-testid="subtitle-template-draft-styles">
                {draft.styles.map((style, index) => (
                  styleNameEdit?.templateId === "new" && styleNameEdit.styleIndex === index ? (
                    <div
                      key={style.id ?? index}
                      data-testid="subtitle-style-row"
                      className="flex w-full items-center gap-2 rounded-md bg-primary/10 px-2 py-1 text-foreground"
                    >
                      <Input
                        autoFocus
                        value={styleNameEdit.value}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => setStyleNameEdit((current) => current ? { ...current, value: event.target.value } : current)}
                        onBlur={commitStyleNameEdit}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitStyleNameEdit();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setStyleNameEdit(null);
                          }
                        }}
                        className="h-8 px-2 text-xs"
                        aria-label={`Rename ${style.name}`}
                        data-testid="subtitle-style-name-input"
                      />
                      <span className="shrink-0 text-[11px] text-muted-foreground">{style.wordsPerSubtitle}w</span>
                    </div>
                  ) : (
                    <div key={style.id ?? index} className="flex items-center gap-1" data-testid="subtitle-style-row">
                      <button
                        type="button"
                        onClick={() => { setSelectedStyleIndex(index); setTab("shared"); }}
                        className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${selectedStyleIndex === index ? "bg-primary/10 text-foreground" : "text-muted-foreground"}`}
                      >
                        <span
                          className="truncate"
                          title="Double-click to rename"
                          onDoubleClick={() => beginStyleNameEdit(style, index)}
                        >
                          {style.name}
                        </span>
                        <span className="shrink-0 text-[11px]">{style.wordsPerSubtitle}w</span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeStyle(style, index)}
                        disabled={draft.styles.length <= 1}
                        aria-label={`Delete style ${style.name}`}
                        title={draft.styles.length <= 1 ? "A template must keep at least one style" : `Delete ${style.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )
                ))}
              </div>
            )}
            {loading ? (
              <div className="flex justify-center p-8"><Loader2 className="size-5 animate-spin text-primary" /></div>
            ) : templates.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No saved templates yet.</p>
            ) : (
              templates.map((template) => {
                const expanded = expandedTemplateIds.includes(template.id);
                const visibleStyles = selectedTemplateId === template.id ? draft.styles : template.styles;
                const visibleTemplateName = selectedTemplateId === template.id ? draft.name : template.name;
                return (
                  <Collapsible
                    key={template.id}
                    open={expanded}
                    onOpenChange={(open) => setExpandedTemplateIds((current) => (
                      open
                        ? (current.includes(template.id) ? current : [...current, template.id])
                        : current.filter((id) => id !== template.id)
                    ))}
                    className={`rounded-md border ${selectedTemplateId === template.id ? "border-primary/50 bg-primary/5" : "border-transparent"}`}
                    data-testid="subtitle-template-group"
                  >
                    <div className="flex items-stretch gap-0.5 p-1">
                      <CollapsibleTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`${expanded ? "Collapse" : "Expand"} ${visibleTemplateName}`}>
                          <ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`} />
                        </Button>
                      </CollapsibleTrigger>
                      {templateNameEdit?.templateId === template.id ? (
                        <div
                          className="min-w-0 flex-1 rounded-md bg-primary/10 px-2 py-1"
                          data-testid="subtitle-template-row"
                        >
                          <Input
                            autoFocus
                            value={templateNameEdit.value}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) => setTemplateNameEdit((current) => current ? { ...current, value: event.target.value } : current)}
                            onBlur={commitTemplateNameEdit}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                commitTemplateNameEdit();
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                setTemplateNameEdit(null);
                              }
                            }}
                            className="h-8 px-2 text-xs"
                            aria-label={`Rename ${visibleTemplateName}`}
                            data-testid="subtitle-template-name-input"
                          />
                          <span className="block px-2 text-[11px] text-muted-foreground">
                            {visibleStyles.length} {visibleStyles.length === 1 ? "style" : "styles"}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => select(template)}
                          onDoubleClick={() => beginTemplateNameEdit(template)}
                          title="Double-click to rename"
                          data-testid="subtitle-template-row"
                          className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="block truncate text-sm font-medium">{visibleTemplateName}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {visibleStyles.length} {visibleStyles.length === 1 ? "style" : "styles"}
                          </span>
                        </button>
                      )}
                      <Button type="button" variant="ghost" size="icon" className="size-8 self-center" onClick={() => addStyle(template)} aria-label={`Add style to ${visibleTemplateName}`}>
                        <Plus className="size-3.5" />
                      </Button>
                    </div>
                    <CollapsibleContent>
                      <div className="mb-1 ml-5 space-y-1 border-l border-border pl-2 pr-1">
                        {visibleStyles.map((style, index) => (
                          styleNameEdit?.templateId === template.id && styleNameEdit.styleIndex === index ? (
                            <div
                              key={style.id ?? index}
                              data-testid="subtitle-style-row"
                              className="flex w-full items-center gap-2 rounded-md bg-primary/10 px-2 py-1 text-foreground"
                            >
                              <Input
                                autoFocus
                                value={styleNameEdit.value}
                                onFocus={(event) => event.currentTarget.select()}
                                onChange={(event) => setStyleNameEdit((current) => current ? { ...current, value: event.target.value } : current)}
                                onBlur={commitStyleNameEdit}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    commitStyleNameEdit();
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    setStyleNameEdit(null);
                                  }
                                }}
                                className="h-8 px-2 text-xs"
                                aria-label={`Rename ${style.name}`}
                                data-testid="subtitle-style-name-input"
                              />
                              <span className="shrink-0 text-[11px] text-muted-foreground">{style.wordsPerSubtitle ?? 2}w</span>
                            </div>
                          ) : (
                            <div key={style.id ?? index} className="flex items-center gap-1" data-testid="subtitle-style-row">
                              <button
                                type="button"
                                onClick={() => {
                                  if (selectedTemplateId === template.id) {
                                    setSelectedStyleIndex(index);
                                    setTab("shared");
                                    return;
                                  }
                                  select(template, index);
                                }}
                                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${selectedTemplateId === template.id && selectedStyleIndex === index ? "bg-primary/10 text-foreground" : "text-muted-foreground"}`}
                              >
                                <span
                                  className="truncate"
                                  title="Double-click to rename"
                                  onDoubleClick={() => beginStyleNameEdit(style, index, template)}
                                >
                                  {style.name}
                                </span>
                                <span className="shrink-0 text-[11px]">{style.wordsPerSubtitle ?? 2}w</span>
                              </button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => removeStyle(style, index, template)}
                                disabled={visibleStyles.length <= 1}
                                aria-label={`Delete style ${style.name}`}
                                title={visibleStyles.length <= 1 ? "A template must keep at least one style" : `Delete ${style.name}`}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          )
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })
            )}
          </div>
        </div>
      </div>
    ),
    settings: (
      <div className="flex h-full min-w-0 flex-col bg-surface-canvas">
        {panelHeader("settings", "Subtitle settings")}
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="subtitle-template-settings">
          <div className="space-y-3 border-b border-border p-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Template name</Label>
              <Input
                value={draft.name}
                onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); markDirty(); }}
                data-testid="subtitle-template-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Style name</Label>
              <Input
                value={selectedStyle.name}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    styles: current.styles.map((style, index) => index === selectedStyleIndex ? { ...style, name: event.target.value } : style),
                  }));
                  markDirty();
                }}
                data-testid="subtitle-style-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Words per subtitle</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={selectedStyle.wordsPerSubtitle}
                onChange={(event) => {
                  const wordsPerSubtitle = Math.max(1, Math.min(20, Number(event.target.value) || 1));
                  setDraft((current) => ({
                    ...current,
                    styles: current.styles.map((style, index) => index === selectedStyleIndex ? { ...style, wordsPerSubtitle } : style),
                  }));
                  markDirty();
                }}
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
                {(tab === "A" ? selectedStyle.settingsA : selectedStyle.settingsB)
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
      <div className="flex h-full min-w-0 flex-col bg-surface-canvas">
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
        breadcrumb={`${draft.name} / ${selectedStyle.name}`}
        subtitle="Reusable caption sets for video variants"
        actions={
          <>
            {saveState !== "idle" && (
              <span
                className={`mr-1 inline-flex items-center gap-1.5 text-xs ${saveState === "error" ? "text-destructive" : "text-muted-foreground"}`}
                data-testid="subtitle-template-save-status"
                role="status"
              >
                {saveState === "saving" && <Loader2 className="size-3.5 animate-spin" />}
                {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Couldn’t save"}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={duplicate} disabled={loading}>
              <CopyPlus className="mr-2 size-4" />Duplicate
            </Button>
            <Button variant="ghost" size="sm" onClick={() => beginCreate()}>
              <Plus className="mr-2 size-4" />New template
            </Button>
            {!isNew && selectedTemplate && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 size-4" />Delete template
              </Button>
            )}
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
                data-workspace-pane
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
        description={`This removes “${selectedTemplate?.name ?? "this template"}” and all of its subtitle styles from your profile.`}
        confirmLabel="Delete template"
        variant="destructive"
        loading={deleting}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
