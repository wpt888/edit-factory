(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/src/components/timeline-editor.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "TimelineEditor",
    ()=>TimelineEditor
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/ui/button.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/ui/badge.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$input$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/ui/input.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$scroll$2d$area$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/ui/scroll-area.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/ui/dialog.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$check$2d$big$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CheckCircle$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/circle-check-big.js [app-client] (ecmascript) <export default as CheckCircle>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$triangle$2d$alert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__AlertTriangle$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/triangle-alert.js [app-client] (ecmascript) <export default as AlertTriangle>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/search.js [app-client] (ecmascript) <export default as Search>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$film$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Film$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/film.js [app-client] (ecmascript) <export default as Film>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$grip$2d$vertical$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__GripVertical$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/grip-vertical.js [app-client] (ecmascript) <export default as GripVertical>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$refresh$2d$cw$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__RefreshCw$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/refresh-cw.js [app-client] (ecmascript) <export default as RefreshCw>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$clock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Clock$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/clock.js [app-client] (ecmascript) <export default as Clock>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/plus.js [app-client] (ecmascript) <export default as Plus>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$minus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Minus$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/minus.js [app-client] (ecmascript) <export default as Minus>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$list$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__List$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/list.js [app-client] (ecmascript) <export default as List>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$layout$2d$panel$2d$left$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__LayoutPanelLeft$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/layout-panel-left.js [app-client] (ecmascript) <export default as LayoutPanelLeft>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$play$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Play$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/play.js [app-client] (ecmascript) <export default as Play>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$pause$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Pause$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/pause.js [app-client] (ecmascript) <export default as Pause>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$skip$2d$back$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__SkipBack$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/skip-back.js [app-client] (ecmascript) <export default as SkipBack>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$skip$2d$forward$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__SkipForward$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/skip-forward.js [app-client] (ecmascript) <export default as SkipForward>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$square$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Square$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/square.js [app-client] (ecmascript) <export default as Square>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$image$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ImageIcon$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/image.js [app-client] (ecmascript) <export default as ImageIcon>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$trash$2d$2$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Trash2$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/trash-2.js [app-client] (ecmascript) <export default as Trash2>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$chevron$2d$down$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ChevronDown$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/chevron-down.js [app-client] (ecmascript) <export default as ChevronDown>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/loader-circle.js [app-client] (ecmascript) <export default as Loader2>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$maximize$2d$2$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Maximize2$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/maximize-2.js [app-client] (ecmascript) <export default as Maximize2>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$pin$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Pin$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/pin.js [app-client] (ecmascript) <export default as Pin>");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/src/lib/api.ts [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/utils.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$dialogs$2f$generate$2d$ai$2d$segment$2d$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/dialogs/generate-ai-segment-dialog.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$sparkles$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Sparkles$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/sparkles.js [app-client] (ecmascript) <export default as Sparkles>");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
;
;
;
;
;
const compactPreviewFrameStyle = {
    aspectRatio: "9 / 16",
    width: "min(180px, 100%)",
    maxWidth: "100%"
};
const expandedPreviewFrameStyle = {
    aspectRatio: "9 / 16",
    width: "min(421.875px, 100%)",
    maxWidth: "100%"
};
function TimelineEditor({ matches, audioDuration, sourceVideoIds: _sourceVideoIds, availableSegments, onMatchesChange, profileId, pipelineId, variantIndex, subtitleSettings, interstitialSlides = [], onInterstitialSlidesChange }) {
    _s();
    // View mode: "timeline" (horizontal) or "list" (vertical)
    const [viewMode, setViewMode] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("timeline");
    // Dialog state (used for both unmatched assignment and swap)
    const [assigningIndex, setAssigningIndex] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [searchQuery, setSearchQuery] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const [sourceFilter, setSourceFilter] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("all");
    // D2: "Generate with AI" — capture the phrase text before the assign dialog
    // closes so the generation dialog keeps its prompt.
    const [aiGenOpen, setAiGenOpen] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [aiGenPrompt, setAiGenPrompt] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    // Timeline view state
    const [selectedBlockIndex, setSelectedBlockIndex] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [selectedSlideId, setSelectedSlideId] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const videoRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const lastSourceVideoId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const lastStartTime = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    // Drag-and-drop state
    const [dragIndex, setDragIndex] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [dragOverIndex, setDragOverIndex] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    // --- Inline continuous preview player state ---
    const [isPreviewActive, setIsPreviewActive] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [isPreviewExpanded, setIsPreviewExpanded] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [isPreviewPlaying, setIsPreviewPlaying] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [isPreviewBuffering, setIsPreviewBuffering] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [previewCurrentTime, setPreviewCurrentTime] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(0);
    const [previewDuration, setPreviewDuration] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(0);
    const [previewActiveIndex, setPreviewActiveIndex] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(0);
    // Which of the two ping-pong <video> slots is currently visible/playing (0 or 1).
    const [activeSlot, setActiveSlot] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(0);
    const previewAudioRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    // Ping-pong double-buffer: two fixed <video> slots instead of one element per
    // source. The active slot plays the current segment (visible); the idle slot is
    // pre-seeked & paused on the NEXT segment, so a boundary crossing is a pure
    // visibility swap — no async seek at the seam (that seek was the stutter cause).
    const previewSlotRefs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])([
        null,
        null
    ]);
    const activeSlotRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(0);
    const slotStateRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])([
        {
            sourceVideoId: null,
            segmentStartTime: null,
            preparedForIndex: null,
            ready: false
        },
        {
            sourceVideoId: null,
            segmentStartTime: null,
            preparedForIndex: null,
            ready: false
        }
    ]);
    // Marker so the rAF loop stages the idle slot once per current index, not every frame.
    const preparedNextForIndexRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const previewContainerRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const isPreviewPlayingRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(false);
    const isPreviewActiveRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(false);
    const previewActiveIndexRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(0);
    const previewSegmentEndTimeRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(undefined);
    const previewSegmentStartTimeRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(undefined);
    const pendingCanPlayRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const matchesRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(matches);
    const previewRafIdRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const seekGraceTimestampRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(0);
    const lastReportedTimeRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(0);
    const activationIdRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(0);
    const activationTimeoutRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    // Keep refs in sync (state → ref for use in callbacks)
    // Note: isPreviewPlayingRef is also set synchronously in togglePreviewPlayPause to avoid 1-frame stale reads
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            isPreviewPlayingRef.current = isPreviewPlaying;
        }
    }["TimelineEditor.useEffect"], [
        isPreviewPlaying
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            isPreviewActiveRef.current = isPreviewActive;
        }
    }["TimelineEditor.useEffect"], [
        isPreviewActive
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            previewActiveIndexRef.current = previewActiveIndex;
        }
    }["TimelineEditor.useEffect"], [
        previewActiveIndex
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            matchesRef.current = matches;
        }
    }["TimelineEditor.useEffect"], [
        matches
    ]);
    // Cleanup: pause all audio/video and stop rAF on unmount
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            return ({
                "TimelineEditor.useEffect": ()=>{
                    activationIdRef.current++; // invalidate any pending async activation work
                    if (activationTimeoutRef.current != null) {
                        clearTimeout(activationTimeoutRef.current);
                        activationTimeoutRef.current = null;
                    }
                    if (previewRafIdRef.current != null) {
                        cancelAnimationFrame(previewRafIdRef.current);
                        previewRafIdRef.current = null;
                    }
                    const audio = previewAudioRef.current;
                    if (audio) {
                        audio.pause();
                        audio.removeAttribute("src");
                        audio.load();
                    }
                    for (const vid of previewSlotRefs.current){
                        if (vid) vid.pause();
                    }
                }
            })["TimelineEditor.useEffect"];
        }
    }["TimelineEditor.useEffect"], []);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            if (!isPreviewActive) {
                setIsPreviewExpanded(false);
            }
        }
    }["TimelineEditor.useEffect"], [
        isPreviewActive
    ]);
    // Matches that have a usable video segment (drives canPreview). The old
    // per-source video pool + prune effect are gone — we now use two fixed slots.
    const videoMatches = matches.filter((m)=>m.segment_id && m.source_video_id);
    // Can we show the preview? Need pipelineId, profileId, and at least one video match
    const canPreview = !!(pipelineId && variantIndex !== undefined && profileId && videoMatches.length > 0);
    // Next index that triggers a REAL video cut (different merge group than the
    // segment at `curIdx`). Phrases inside one merge group share a single video
    // segment, so they never become a staging target — the picture stays put while
    // only the subtitle advances.
    const findNextTransitionIndex = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[findNextTransitionIndex]": (curIdx)=>{
            const ms = matchesRef.current;
            const cur = ms[curIdx];
            for(let i = curIdx + 1; i < ms.length; i += 1){
                const m = ms[i];
                if (!m) continue;
                const sameGroup = cur && m.merge_group != null && cur.merge_group != null && m.merge_group === cur.merge_group;
                if (!sameGroup) return i;
            }
            return null;
        }
    }["TimelineEditor.useCallback[findNextTransitionIndex]"], []);
    const getPreviewStreamUrl = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[getPreviewStreamUrl]": (sourceVideoId)=>{
            if (!profileId) return "";
            return `${__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["API_URL"]}/segments/source-videos/${sourceVideoId}/preview-stream?profile_id=${profileId}`;
        }
    }["TimelineEditor.useCallback[getPreviewStreamUrl]"], [
        profileId
    ]);
    // --- Continuous (live, client-side) preview helpers ---
    // NOTE: this is a client-side segment stitcher driven by the TTS audio clock,
    // NOT the same as VariantPreviewPlayer (which plays one server-rendered mp4).
    const findActiveMatch = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[findActiveMatch]": (time)=>{
            const ms = matchesRef.current;
            const idx = ms.findIndex({
                "TimelineEditor.useCallback[findActiveMatch].idx": (m)=>m.srt_start <= time && time < m.srt_end
            }["TimelineEditor.useCallback[findActiveMatch].idx"]);
            return idx >= 0 ? idx : previewActiveIndexRef.current;
        }
    }["TimelineEditor.useCallback[findActiveMatch]"], []);
    // Compute the active segment's end boundary (cap by merge_group_duration if set).
    const setSegmentEndBoundary = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[setSegmentEndBoundary]": (match)=>{
            if (match?.merge_group_duration != null && match.segment_start_time != null) {
                const mergeEnd = match.segment_start_time + match.merge_group_duration;
                previewSegmentEndTimeRef.current = match.segment_end_time != null ? Math.min(mergeEnd, match.segment_end_time) : mergeEnd;
            } else {
                previewSegmentEndTimeRef.current = match?.segment_end_time ?? undefined;
            }
            previewSegmentStartTimeRef.current = match?.segment_start_time ?? undefined;
        }
    }["TimelineEditor.useCallback[setSegmentEndBoundary]"], []);
    // Point a slot's <video> at a source, reloading only when it actually changes
    // (keeps the warm buffer for the common same-source case).
    const loadSlotSource = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[loadSlotSource]": (slot, sourceVideoId)=>{
            const el = previewSlotRefs.current[slot];
            const st = slotStateRef.current[slot];
            if (!el) return;
            if (st.sourceVideoId !== sourceVideoId) {
                el.pause();
                el.src = getPreviewStreamUrl(sourceVideoId);
                el.load();
                st.sourceVideoId = sourceVideoId;
                st.segmentStartTime = null;
            }
        }
    }["TimelineEditor.useCallback[loadSlotSource]"], [
        getPreviewStreamUrl
    ]);
    // Seek a slot's <video> to `targetTime` while paused; invoke onReady once the
    // frame at that time is decoded (so it can be shown/played with no seam).
    const seekSlotTo = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[seekSlotTo]": (slot, targetTime, onReady)=>{
            const el = previewSlotRefs.current[slot];
            if (!el) return;
            const doSeek = {
                "TimelineEditor.useCallback[seekSlotTo].doSeek": ()=>{
                    if (el.readyState >= 2 && Math.abs(el.currentTime - targetTime) < 0.05) {
                        onReady();
                        return;
                    }
                    const onSeeked = {
                        "TimelineEditor.useCallback[seekSlotTo].doSeek.onSeeked": ()=>{
                            el.removeEventListener("seeked", onSeeked);
                            onReady();
                        }
                    }["TimelineEditor.useCallback[seekSlotTo].doSeek.onSeeked"];
                    el.addEventListener("seeked", onSeeked);
                    el.currentTime = targetTime;
                }
            }["TimelineEditor.useCallback[seekSlotTo].doSeek"];
            if (el.readyState >= 1) {
                doSeek();
            } else {
                const onMeta = {
                    "TimelineEditor.useCallback[seekSlotTo].onMeta": ()=>{
                        el.removeEventListener("loadedmetadata", onMeta);
                        doSeek();
                    }
                }["TimelineEditor.useCallback[seekSlotTo].onMeta"];
                el.addEventListener("loadedmetadata", onMeta);
            }
        }
    }["TimelineEditor.useCallback[seekSlotTo]"], []);
    // Stage the IDLE slot for a future segment: load + pre-seek + mark ready. The
    // slot stays PAUSED — a paused, seeked video already paints its target frame,
    // so committing later is just a visibility flip + play (no seek at the seam).
    const prepareSlot = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[prepareSlot]": (slot, idx)=>{
            const match = matchesRef.current[idx];
            const el = previewSlotRefs.current[slot];
            if (!el || !match?.source_video_id || match.segment_start_time == null) return;
            const st = slotStateRef.current[slot];
            st.preparedForIndex = idx;
            st.ready = false;
            loadSlotSource(slot, match.source_video_id);
            const targetTime = match.segment_start_time;
            seekSlotTo(slot, targetTime, {
                "TimelineEditor.useCallback[prepareSlot]": ()=>{
                    st.segmentStartTime = targetTime;
                    st.ready = true;
                }
            }["TimelineEditor.useCallback[prepareSlot]"]);
        }
    }["TimelineEditor.useCallback[prepareSlot]"], [
        loadSlotSource,
        seekSlotTo
    ]);
    // Make the ACTIVE slot show segment `idx` via a direct seek — the one acceptable
    // seek, used for startup, explicit user jumps, and re-staging after a remount.
    // Does NOT own previewActiveIndex; callers set that.
    const seatActiveSlot = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[seatActiveSlot]": (idx, shouldPlay)=>{
            const match = matchesRef.current[idx];
            const slot = activeSlotRef.current;
            const el = previewSlotRefs.current[slot];
            setSegmentEndBoundary(match);
            // Only the active slot ever plays — keep the idle one paused.
            const idleEl = previewSlotRefs.current[slot ^ 1];
            if (idleEl) idleEl.pause();
            slotStateRef.current[slot ^ 1].ready = false;
            if (!el || !match?.source_video_id || match.segment_start_time == null) {
                if (el) el.pause(); // no video for this segment → fallback UI shows
                return;
            }
            loadSlotSource(slot, match.source_video_id);
            const targetTime = match.segment_start_time;
            const st = slotStateRef.current[slot];
            st.preparedForIndex = idx;
            seekGraceTimestampRef.current = performance.now();
            seekSlotTo(slot, targetTime, {
                "TimelineEditor.useCallback[seatActiveSlot]": ()=>{
                    st.segmentStartTime = targetTime;
                    st.ready = true;
                    if (shouldPlay && isPreviewPlayingRef.current) {
                        el.play().catch({
                            "TimelineEditor.useCallback[seatActiveSlot]": ()=>{}
                        }["TimelineEditor.useCallback[seatActiveSlot]"]);
                    }
                }
            }["TimelineEditor.useCallback[seatActiveSlot]"]);
        }
    }["TimelineEditor.useCallback[seatActiveSlot]"], [
        loadSlotSource,
        seekSlotTo,
        setSegmentEndBoundary
    ]);
    // Apply the visibility swap IMPERATIVELY (no React-render delay) by toggling
    // opacity/z-index. Both <video> layers stay display:block so the incoming
    // (idle) slot keeps a live GPU layer + decoded frame — Chromium tears down and
    // throttles `display:none` videos, which is what made the seam freeze.
    const applySlotVisibility = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[applySlotVisibility]": (newActive)=>{
            const a = previewSlotRefs.current[newActive];
            const b = previewSlotRefs.current[newActive ^ 1];
            if (a) {
                a.style.opacity = "1";
                a.style.zIndex = "1";
            }
            if (b) {
                b.style.opacity = "0";
                b.style.zIndex = "0";
            }
        }
    }["TimelineEditor.useCallback[applySlotVisibility]"], []);
    // Automatic boundary transition: swap to the pre-staged idle slot (no seek).
    // Owns advancing previewActiveIndex. Falls back to a direct seat if the idle
    // slot wasn't ready in time (very short segment / slow load) — never worse
    // than the pre-fix behavior.
    const commitTransition = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[commitTransition]": (nextIdx)=>{
            const match = matchesRef.current[nextIdx];
            // Advance index/state + boundary first, so subtitle + counter track the
            // picture even when the next segment has no video.
            setPreviewActiveIndex(nextIdx);
            previewActiveIndexRef.current = nextIdx;
            setSegmentEndBoundary(match);
            if (!match?.source_video_id || match.segment_start_time == null) {
                for (const vid of previewSlotRefs.current){
                    if (vid) vid.pause();
                }
                return;
            }
            const idleSlot = activeSlotRef.current ^ 1;
            const st = slotStateRef.current[idleSlot];
            if (st.preparedForIndex === nextIdx && st.ready) {
                // Seamless: idle slot already decoded the first frame at the right offset.
                const newEl = previewSlotRefs.current[idleSlot];
                const oldEl = previewSlotRefs.current[activeSlotRef.current];
                activeSlotRef.current = idleSlot;
                // Flip visibility imperatively FIRST (instant, GPU-composited) — the idle
                // slot already holds its decoded first frame, so this paints with no gap.
                applySlotVisibility(idleSlot);
                setActiveSlot(idleSlot);
                // seekGraceTimestampRef now covers the play()/clock-resync moment so the
                // end-enforcement loop doesn't pause the freshly-shown slot a frame early.
                seekGraceTimestampRef.current = performance.now();
                if (isPreviewPlayingRef.current) newEl?.play().catch({
                    "TimelineEditor.useCallback[commitTransition]": ()=>{}
                }["TimelineEditor.useCallback[commitTransition]"]);
                if (oldEl) oldEl.pause();
                st.ready = false; // consumed
            } else {
                // Staging missed the deadline — degrade to seeking the active slot in place.
                seatActiveSlot(nextIdx, true);
            }
        }
    }["TimelineEditor.useCallback[commitTransition]"], [
        setSegmentEndBoundary,
        seatActiveSlot,
        applySlotVisibility
    ]);
    // rAF loop — tracks audio.currentTime at ~60fps for near-instant segment switching
    // This replaces timeupdate (which only fires ~4Hz) to eliminate ~250ms segment switch lag
    const startPreviewRafLoop = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[startPreviewRafLoop]": ()=>{
            const loop = {
                "TimelineEditor.useCallback[startPreviewRafLoop].loop": ()=>{
                    const audio = previewAudioRef.current;
                    if (!audio || !isPreviewPlayingRef.current) {
                        previewRafIdRef.current = null;
                        return;
                    }
                    const time = audio.currentTime;
                    if (Math.abs(time - lastReportedTimeRef.current) > 0.1) {
                        lastReportedTimeRef.current = time;
                        setPreviewCurrentTime(time);
                    }
                    const newIdx = findActiveMatch(time);
                    const curIdx = previewActiveIndexRef.current;
                    if (newIdx !== curIdx) {
                        // Detect merge-group siblings against the OLD index BEFORE advancing.
                        const prev = matchesRef.current[curIdx];
                        const cur = matchesRef.current[newIdx];
                        const sameMergeGroup = prev && cur && prev.merge_group != null && cur.merge_group != null && prev.merge_group === cur.merge_group;
                        if (sameMergeGroup) {
                            // Within a merge group: advance the subtitle/counter, keep the frame.
                            setPreviewActiveIndex(newIdx);
                            previewActiveIndexRef.current = newIdx;
                        } else {
                            // Real cut: swap to the pre-staged idle slot (no seek at the seam).
                            commitTransition(newIdx);
                        }
                        preparedNextForIndexRef.current = null; // re-stage for the new "next"
                    }
                    // Stage the idle slot for the next real cut, once per settled index. Segments
                    // are ~2-3s, so there's ample time to load + seek before the boundary.
                    const settledIdx = previewActiveIndexRef.current;
                    if (preparedNextForIndexRef.current !== settledIdx) {
                        const nextIdx = findNextTransitionIndex(settledIdx);
                        if (nextIdx != null) {
                            prepareSlot(activeSlotRef.current ^ 1, nextIdx);
                        }
                        preparedNextForIndexRef.current = settledIdx;
                    }
                    previewRafIdRef.current = requestAnimationFrame(loop);
                }
            }["TimelineEditor.useCallback[startPreviewRafLoop].loop"];
            if (previewRafIdRef.current != null) cancelAnimationFrame(previewRafIdRef.current);
            previewRafIdRef.current = requestAnimationFrame(loop);
        }
    }["TimelineEditor.useCallback[startPreviewRafLoop]"], [
        findActiveMatch,
        commitTransition,
        findNextTransitionIndex,
        prepareSlot
    ]);
    const stopPreviewRafLoop = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[stopPreviewRafLoop]": ()=>{
            if (previewRafIdRef.current != null) {
                cancelAnimationFrame(previewRafIdRef.current);
                previewRafIdRef.current = null;
            }
        }
    }["TimelineEditor.useCallback[stopPreviewRafLoop]"], []);
    // Audio metadata + ended events (no timeupdate — rAF replaces it)
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            if (!isPreviewActive) return;
            const audio = previewAudioRef.current;
            if (!audio) return;
            const onLoadedMetadata = {
                "TimelineEditor.useEffect.onLoadedMetadata": ()=>{
                    setPreviewDuration(audio.duration);
                }
            }["TimelineEditor.useEffect.onLoadedMetadata"];
            const onEnded = {
                "TimelineEditor.useEffect.onEnded": ()=>{
                    setIsPreviewPlaying(false);
                    isPreviewPlayingRef.current = false;
                    stopPreviewRafLoop();
                    for (const vid of previewSlotRefs.current){
                        if (vid) vid.pause();
                    }
                }
            }["TimelineEditor.useEffect.onEnded"];
            const onError = {
                "TimelineEditor.useEffect.onError": ()=>{
                    console.warn("[timeline-editor] Audio error during preview");
                    setIsPreviewPlaying(false);
                    isPreviewPlayingRef.current = false;
                    stopPreviewRafLoop();
                }
            }["TimelineEditor.useEffect.onError"];
            audio.addEventListener("loadedmetadata", onLoadedMetadata);
            audio.addEventListener("ended", onEnded);
            audio.addEventListener("error", onError);
            return ({
                "TimelineEditor.useEffect": ()=>{
                    audio.removeEventListener("loadedmetadata", onLoadedMetadata);
                    audio.removeEventListener("ended", onEnded);
                    audio.removeEventListener("error", onError);
                    audio.onerror = null;
                    stopPreviewRafLoop();
                }
            })["TimelineEditor.useEffect"];
        }
    }["TimelineEditor.useEffect"], [
        isPreviewActive,
        stopPreviewRafLoop
    ]);
    // Video segment_end_time enforcement via rAF (60fps instead of timeupdate's ~4Hz).
    // This prevents the ~250ms overshoot that timeupdate allows past segment boundaries.
    const segmentEnforceRafRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const segmentEnforceTimeoutRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null); // Bug #134
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            if (!isPreviewActive) return;
            const enforceLoop = {
                "TimelineEditor.useEffect.enforceLoop": ()=>{
                    // When paused, use a slow setTimeout poll instead of tight rAF to save CPU.
                    // Bug #134: Use separate timeout ref to avoid overwriting rAF ref
                    if (!isPreviewPlayingRef.current) {
                        segmentEnforceTimeoutRef.current = window.setTimeout({
                            "TimelineEditor.useEffect.enforceLoop": ()=>{
                                segmentEnforceTimeoutRef.current = null;
                                segmentEnforceRafRef.current = requestAnimationFrame(enforceLoop);
                            }
                        }["TimelineEditor.useEffect.enforceLoop"], 100);
                        return;
                    }
                    // Skip enforcement during seek grace period — async seek hasn't
                    // completed yet, so currentTime is stale from the previous segment.
                    const inGrace = performance.now() - seekGraceTimestampRef.current < 200;
                    if (!inGrace) {
                        // Only the active slot plays; the idle slot is intentionally paused.
                        const vid = previewSlotRefs.current[activeSlotRef.current];
                        if (vid && !vid.paused && previewSegmentEndTimeRef.current != null && vid.currentTime >= previewSegmentEndTimeRef.current) {
                            // Mirror the render engine: a segment shorter than its phrase slot is
                            // LOOPED there (use_loop), so wrap to the in-point instead of freezing
                            // on the last frame — the freeze read as stutter at every seam.
                            const loopStart = previewSegmentStartTimeRef.current;
                            if (loopStart != null) {
                                seekGraceTimestampRef.current = performance.now();
                                vid.currentTime = loopStart;
                            } else {
                                vid.pause();
                            }
                        }
                    }
                    segmentEnforceRafRef.current = requestAnimationFrame(enforceLoop);
                }
            }["TimelineEditor.useEffect.enforceLoop"];
            segmentEnforceRafRef.current = requestAnimationFrame(enforceLoop);
            return ({
                "TimelineEditor.useEffect": ()=>{
                    if (segmentEnforceRafRef.current != null) {
                        cancelAnimationFrame(segmentEnforceRafRef.current);
                        segmentEnforceRafRef.current = null;
                    }
                    // Bug #134: clear separate timeout ref
                    if (segmentEnforceTimeoutRef.current != null) {
                        clearTimeout(segmentEnforceTimeoutRef.current);
                        segmentEnforceTimeoutRef.current = null;
                    }
                }
            })["TimelineEditor.useEffect"];
        }
    }["TimelineEditor.useEffect"], [
        isPreviewActive
    ]);
    const togglePreviewPlayPause = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[togglePreviewPlayPause]": ()=>{
            const audio = previewAudioRef.current;
            if (!audio) return;
            if (isPreviewPlayingRef.current) {
                audio.pause();
                stopPreviewRafLoop();
                for (const vid of previewSlotRefs.current){
                    if (vid) vid.pause();
                }
                // Set ref synchronously to prevent 1-frame stale read in rAF loop
                isPreviewPlayingRef.current = false;
                setIsPreviewPlaying(false);
            } else {
                // Set ref synchronously before starting rAF loop
                isPreviewPlayingRef.current = true;
                setIsPreviewPlaying(true);
                // Re-seat the active slot on the current segment (a single seek is fine on
                // an explicit resume) and force the idle slot to re-stage next rAF tick.
                preparedNextForIndexRef.current = null;
                seatActiveSlot(previewActiveIndexRef.current, true);
                audio.play().catch({
                    "TimelineEditor.useCallback[togglePreviewPlayPause]": ()=>{
                        isPreviewPlayingRef.current = false;
                        setIsPreviewPlaying(false);
                    }
                }["TimelineEditor.useCallback[togglePreviewPlayPause]"]);
                startPreviewRafLoop();
            }
        }
    }["TimelineEditor.useCallback[togglePreviewPlayPause]"], [
        startPreviewRafLoop,
        stopPreviewRafLoop,
        seatActiveSlot
    ]);
    // Discrete user jump (prev/next, scrub-to-segment, segment click). A single
    // direct seek on the active slot is visually acceptable here; ping-pong only
    // needs to be seamless for AUTOMATIC boundary crossings.
    const jumpToIndex = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[jumpToIndex]": (idx)=>{
            const audio = previewAudioRef.current;
            const match = matchesRef.current[idx];
            if (!audio || !match) return;
            audio.currentTime = match.srt_start;
            setPreviewCurrentTime(match.srt_start);
            setPreviewActiveIndex(idx);
            previewActiveIndexRef.current = idx;
            preparedNextForIndexRef.current = null;
            seatActiveSlot(idx, isPreviewPlayingRef.current);
        }
    }["TimelineEditor.useCallback[jumpToIndex]"], [
        seatActiveSlot
    ]);
    const previewPrevSegment = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[previewPrevSegment]": ()=>{
            if (previewActiveIndexRef.current <= 0) return;
            jumpToIndex(previewActiveIndexRef.current - 1);
        }
    }["TimelineEditor.useCallback[previewPrevSegment]"], [
        jumpToIndex
    ]);
    const previewNextSegment = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[previewNextSegment]": ()=>{
            if (previewActiveIndexRef.current >= matchesRef.current.length - 1) return;
            jumpToIndex(previewActiveIndexRef.current + 1);
        }
    }["TimelineEditor.useCallback[previewNextSegment]"], [
        jumpToIndex
    ]);
    const handlePreviewSeek = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[handlePreviewSeek]": (e)=>{
            const audio = previewAudioRef.current;
            if (!audio) return;
            const time = parseFloat(e.target.value);
            audio.currentTime = time;
            setPreviewCurrentTime(time);
            const newIdx = findActiveMatch(time);
            setPreviewActiveIndex(newIdx);
            previewActiveIndexRef.current = newIdx;
            preparedNextForIndexRef.current = null;
            // Scrub lands at an arbitrary audio time; seat the active slot at the
            // segment's start (video doesn't track sub-phrase position — same as before).
            seatActiveSlot(newIdx, isPreviewPlayingRef.current);
        }
    }["TimelineEditor.useCallback[handlePreviewSeek]"], [
        findActiveMatch,
        seatActiveSlot
    ]);
    const handleSeekToSegment = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[handleSeekToSegment]": (idx)=>{
            if (!isPreviewActive) return;
            jumpToIndex(idx);
        }
    }["TimelineEditor.useCallback[handleSeekToSegment]"], [
        isPreviewActive,
        jumpToIndex
    ]);
    const activatePreview = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[activatePreview]": ()=>{
            // Increment activation ID — any pending async work from previous activations
            // will check this and bail out if it's stale (prevents audio restarting after Stop).
            const thisActivation = ++activationIdRef.current;
            if (activationTimeoutRef.current != null) {
                clearTimeout(activationTimeoutRef.current);
                activationTimeoutRef.current = null;
            }
            seekGraceTimestampRef.current = performance.now();
            setIsPreviewActive(true);
            setPreviewActiveIndex(0);
            previewActiveIndexRef.current = 0;
            setPreviewCurrentTime(0);
            // Wait for React to mount the audio element, then wait for it to be playable.
            // Uses requestAnimationFrame to wait for the next render, then checks readyState.
            let attempts = 0;
            const tryStart = {
                "TimelineEditor.useCallback[activatePreview].tryStart": ()=>{
                    if (activationIdRef.current !== thisActivation) return; // stale — user clicked Stop
                    const audio = previewAudioRef.current;
                    if (!audio) {
                        // Audio not mounted yet — retry next frame (React render pending)
                        // Bug #117: cap retries to prevent infinite rAF loop on unmount
                        if (++attempts > 100) return;
                        requestAnimationFrame(tryStart);
                        return;
                    }
                    const beginPlayback = {
                        "TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback": ()=>{
                            if (activationIdRef.current !== thisActivation) return; // stale — user clicked Stop
                            audio.currentTime = 0;
                            isPreviewPlayingRef.current = true;
                            setIsPreviewPlaying(true);
                            seekGraceTimestampRef.current = performance.now();
                            // Reset the ping-pong slots for this activation. The <video> elements
                            // were freshly (re)mounted, so slot 0 starts blank and must be loaded.
                            activeSlotRef.current = 0;
                            setActiveSlot(0);
                            preparedNextForIndexRef.current = null;
                            slotStateRef.current[0] = {
                                sourceVideoId: null,
                                segmentStartTime: null,
                                preparedForIndex: null,
                                ready: false
                            };
                            slotStateRef.current[1] = {
                                sourceVideoId: null,
                                segmentStartTime: null,
                                preparedForIndex: null,
                                ready: false
                            };
                            const firstMatch = matchesRef.current[0];
                            // Start the audio + rAF loop, then stage the idle slot for the first cut.
                            const startAudioAndLoop = {
                                "TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback.startAudioAndLoop": ()=>{
                                    if (activationIdRef.current !== thisActivation) return; // stale — user clicked Stop
                                    startPreviewRafLoop();
                                    audio.play().catch({
                                        "TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback.startAudioAndLoop": ()=>{
                                            isPreviewPlayingRef.current = false;
                                            setIsPreviewPlaying(false);
                                        }
                                    }["TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback.startAudioAndLoop"]);
                                    const nextIdx = findNextTransitionIndex(0);
                                    if (nextIdx != null) prepareSlot(1, nextIdx);
                                }
                            }["TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback.startAudioAndLoop"];
                            // Pre-seek the first segment into the ACTIVE slot BEFORE starting audio —
                            // prevents an initial black-frame stall. This is the one unavoidable seek.
                            if (firstMatch?.source_video_id && firstMatch.segment_start_time != null) {
                                const targetTime = firstMatch.segment_start_time;
                                setSegmentEndBoundary(firstMatch);
                                loadSlotSource(0, firstMatch.source_video_id);
                                slotStateRef.current[0].preparedForIndex = 0;
                                let started = false;
                                const onReady = {
                                    "TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback.onReady": ()=>{
                                        if (started) return;
                                        started = true;
                                        if (activationIdRef.current !== thisActivation) return; // stale
                                        const el = previewSlotRefs.current[0];
                                        slotStateRef.current[0].segmentStartTime = targetTime;
                                        slotStateRef.current[0].ready = true;
                                        if (el && isPreviewPlayingRef.current) el.play().catch({
                                            "TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback.onReady": ()=>{}
                                        }["TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback.onReady"]);
                                        startAudioAndLoop();
                                    }
                                }["TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback.onReady"];
                                seekSlotTo(0, targetTime, onReady);
                                // Safety timeout: don't block forever if the video fails to load.
                                activationTimeoutRef.current = setTimeout({
                                    "TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback": ()=>{
                                        activationTimeoutRef.current = null;
                                        if (activationIdRef.current !== thisActivation) return; // stale
                                        if (!audio.paused) return; // already started
                                        onReady();
                                    }
                                }["TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback"], 3000);
                            } else {
                                startAudioAndLoop();
                            }
                        }
                    }["TimelineEditor.useCallback[activatePreview].tryStart.beginPlayback"];
                    // FE-12: Handle audio load errors gracefully
                    audio.onerror = ({
                        "TimelineEditor.useCallback[activatePreview].tryStart": ()=>{
                            console.warn("[TimelineEditor] Audio failed to load for preview playback");
                            isPreviewPlayingRef.current = false;
                            setIsPreviewPlaying(false);
                            setIsPreviewActive(false);
                        }
                    })["TimelineEditor.useCallback[activatePreview].tryStart"];
                    if (audio.readyState >= 2) {
                        // Already loaded (cached) — play immediately
                        beginPlayback();
                    } else {
                        // Wait for audio to be playable
                        const onCanPlay = {
                            "TimelineEditor.useCallback[activatePreview].tryStart.onCanPlay": ()=>{
                                pendingCanPlayRef.current = null;
                                audio.removeEventListener("canplay", onCanPlay);
                                beginPlayback();
                            }
                        }["TimelineEditor.useCallback[activatePreview].tryStart.onCanPlay"];
                        pendingCanPlayRef.current = onCanPlay;
                        audio.addEventListener("canplay", onCanPlay);
                        // Safety: if audio loads very fast between checks
                        if (audio.readyState >= 2) {
                            audio.removeEventListener("canplay", onCanPlay);
                            beginPlayback();
                        }
                    }
                }
            }["TimelineEditor.useCallback[activatePreview].tryStart"];
            requestAnimationFrame(tryStart);
        }
    }["TimelineEditor.useCallback[activatePreview]"], [
        startPreviewRafLoop,
        setSegmentEndBoundary,
        loadSlotSource,
        seekSlotTo,
        prepareSlot,
        findNextTransitionIndex
    ]);
    const deactivatePreview = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "TimelineEditor.useCallback[deactivatePreview]": ()=>{
            // Invalidate any pending async work from activatePreview (rAF retries, timeouts, event listeners)
            activationIdRef.current++;
            if (activationTimeoutRef.current != null) {
                clearTimeout(activationTimeoutRef.current);
                activationTimeoutRef.current = null;
            }
            stopPreviewRafLoop();
            const audio = previewAudioRef.current;
            if (audio) {
                audio.onerror = null;
                if (pendingCanPlayRef.current) {
                    audio.removeEventListener("canplay", pendingCanPlayRef.current);
                    pendingCanPlayRef.current = null;
                }
                audio.pause();
                audio.currentTime = 0;
            }
            for (const vid of previewSlotRefs.current){
                if (vid) vid.pause();
            }
            isPreviewPlayingRef.current = false;
            setIsPreviewActive(false);
            setIsPreviewPlaying(false);
            setIsPreviewBuffering(false);
            setPreviewCurrentTime(0);
            setPreviewActiveIndex(0);
            previewActiveIndexRef.current = 0;
            previewSegmentEndTimeRef.current = undefined;
            previewSegmentStartTimeRef.current = undefined;
            // Reset ping-pong state (slot <video> elements unmount with the preview block).
            activeSlotRef.current = 0;
            setActiveSlot(0);
            preparedNextForIndexRef.current = null;
            slotStateRef.current[0] = {
                sourceVideoId: null,
                segmentStartTime: null,
                preparedForIndex: null,
                ready: false
            };
            slotStateRef.current[1] = {
                sourceVideoId: null,
                segmentStartTime: null,
                preparedForIndex: null,
                ready: false
            };
        }
    }["TimelineEditor.useCallback[deactivatePreview]"], [
        stopPreviewRafLoop
    ]);
    // Expanding/collapsing moves the preview into a different DOM subtree, so the
    // two <video> slots remount blank. Re-seat the active slot + re-stage the idle
    // one after the new elements bind their refs.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            if (!isPreviewActive) return;
            const raf = requestAnimationFrame({
                "TimelineEditor.useEffect.raf": ()=>{
                    if (!isPreviewActiveRef.current) return;
                    slotStateRef.current[0] = {
                        sourceVideoId: null,
                        segmentStartTime: null,
                        preparedForIndex: null,
                        ready: false
                    };
                    slotStateRef.current[1] = {
                        sourceVideoId: null,
                        segmentStartTime: null,
                        preparedForIndex: null,
                        ready: false
                    };
                    activeSlotRef.current = activeSlot; // keep ref aligned with the visible slot
                    preparedNextForIndexRef.current = null;
                    seatActiveSlot(previewActiveIndexRef.current, isPreviewPlayingRef.current);
                }
            }["TimelineEditor.useEffect.raf"]);
            return ({
                "TimelineEditor.useEffect": ()=>cancelAnimationFrame(raf)
            })["TimelineEditor.useEffect"];
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }
    }["TimelineEditor.useEffect"], [
        isPreviewExpanded
    ]);
    // Filtered segments: proximity ±2 rule + source filter + keyword search
    const filteredSegments = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "TimelineEditor.useMemo[filteredSegments]": ()=>{
            let pool = availableSegments;
            // Source video filter
            if (sourceFilter === "same" && assigningIndex !== null) {
                const currentSourceId = matches[assigningIndex]?.source_video_id;
                if (currentSourceId) {
                    pool = pool.filter({
                        "TimelineEditor.useMemo[filteredSegments]": (seg)=>seg.source_video_id === currentSourceId
                    }["TimelineEditor.useMemo[filteredSegments]"]);
                }
            }
            // Proximity ±2: exclude segments already used at neighboring positions
            if (assigningIndex !== null) {
                const nearbySegmentIds = new Set();
                for(let offset = -2; offset <= 2; offset++){
                    if (offset === 0) continue;
                    const neighborIdx = assigningIndex + offset;
                    if (neighborIdx >= 0 && neighborIdx < matches.length) {
                        const neighborId = matches[neighborIdx].segment_id;
                        if (neighborId) nearbySegmentIds.add(neighborId);
                    }
                }
                pool = pool.filter({
                    "TimelineEditor.useMemo[filteredSegments]": (seg)=>!nearbySegmentIds.has(seg.id)
                }["TimelineEditor.useMemo[filteredSegments]"]);
            }
            // Keyword search filter
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                pool = pool.filter({
                    "TimelineEditor.useMemo[filteredSegments]": (seg)=>seg.keywords.some({
                            "TimelineEditor.useMemo[filteredSegments]": (kw)=>kw.toLowerCase().includes(q)
                        }["TimelineEditor.useMemo[filteredSegments]"])
                }["TimelineEditor.useMemo[filteredSegments]"]);
            }
            return pool;
        }
    }["TimelineEditor.useMemo[filteredSegments]"], [
        availableSegments,
        assigningIndex,
        matches,
        searchQuery,
        sourceFilter
    ]);
    // Count how many segments were excluded by proximity rule (for UI indicator)
    const proximityExcludedCount = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "TimelineEditor.useMemo[proximityExcludedCount]": ()=>{
            if (assigningIndex === null) return 0;
            const nearbySegmentIds = new Set();
            for(let offset = -2; offset <= 2; offset++){
                if (offset === 0) continue;
                const neighborIdx = assigningIndex + offset;
                if (neighborIdx >= 0 && neighborIdx < matches.length) {
                    const neighborId = matches[neighborIdx].segment_id;
                    if (neighborId) nearbySegmentIds.add(neighborId);
                }
            }
            return availableSegments.filter({
                "TimelineEditor.useMemo[proximityExcludedCount]": (seg)=>nearbySegmentIds.has(seg.id)
            }["TimelineEditor.useMemo[proximityExcludedCount]"]).length;
        }
    }["TimelineEditor.useMemo[proximityExcludedCount]"], [
        availableSegments,
        assigningIndex,
        matches
    ]);
    // Memoize timeline group computation to avoid recalculating on every render
    const timelineGroups = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "TimelineEditor.useMemo[timelineGroups]": ()=>{
            const groups = [];
            let currentGroup = null;
            matches.forEach({
                "TimelineEditor.useMemo[timelineGroups]": (match, idx)=>{
                    const mg = match.merge_group;
                    if (mg !== undefined && currentGroup && currentGroup.groupId === mg) {
                        currentGroup.matchIndices.push(idx);
                    } else {
                        currentGroup = {
                            groupId: mg ?? idx,
                            groupDuration: match.merge_group_duration ?? match.srt_end - match.srt_start,
                            matchIndices: [
                                idx
                            ]
                        };
                        groups.push(currentGroup);
                    }
                }
            }["TimelineEditor.useMemo[timelineGroups]"]);
            return groups;
        }
    }["TimelineEditor.useMemo[timelineGroups]"], [
        matches
    ]);
    // --- Dialog handlers ---
    const handleOpenDialog = (matchIndex)=>{
        setAssigningIndex(matchIndex);
        setSearchQuery("");
    };
    const handleCloseDialog = ()=>{
        setAssigningIndex(null);
        setSearchQuery("");
        setSourceFilter("all");
    };
    const handleSelectSegment = (segment)=>{
        if (assigningIndex === null) return;
        // When swapping a segment, propagate to ALL entries in the same merge group.
        // The render collapse uses the first entry's segment for the whole group,
        // so all entries must agree for preview and render to match.
        const targetGroup = matches[assigningIndex]?.merge_group;
        const segmentFields = {
            segment_id: segment.id,
            segment_keywords: segment.keywords,
            matched_keyword: segment.keywords[0] ?? null,
            confidence: 1.0,
            source_video_id: segment.source_video_id,
            segment_start_time: segment.start_time,
            segment_end_time: segment.end_time,
            thumbnail_path: segment.thumbnail_path,
            product_group: segment.product_group,
            transforms: segment.transforms,
            is_auto_filled: false,
            pinned: true
        };
        const updatedMatches = matches.map((match, idx)=>{
            // Update the clicked entry AND all entries in the same merge group
            if (idx === assigningIndex) {
                return {
                    ...match,
                    ...segmentFields
                };
            }
            if (targetGroup != null && match.merge_group === targetGroup) {
                return {
                    ...match,
                    ...segmentFields
                };
            }
            return match;
        });
        onMatchesChange(updatedMatches);
        handleCloseDialog();
    };
    // --- Drag-and-drop handlers ---
    const handleDragStart = (e, index)=>{
        setDragIndex(index);
        e.dataTransfer.effectAllowed = "move";
        // Required for Firefox
        e.dataTransfer.setData("text/plain", String(index));
    };
    const handleDragOver = (e, index)=>{
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOverIndex !== index) {
            setDragOverIndex(index);
        }
    };
    const handleDragLeave = (e)=>{
        // Only clear if leaving the row entirely (not entering a child)
        if (!e.currentTarget.contains(e.relatedTarget)) {
            setDragOverIndex(null);
        }
    };
    const handleDrop = (e, dropIndex)=>{
        e.preventDefault();
        if (dragIndex === null || dragIndex === dropIndex) {
            setDragIndex(null);
            setDragOverIndex(null);
            return;
        }
        const updated = [
            ...matches
        ];
        // Swap segment assignments between dragged and dropped positions
        // SRT text/timing stays in place — only the segment mapping moves
        const dragSegment = {
            segment_id: updated[dragIndex].segment_id,
            segment_keywords: updated[dragIndex].segment_keywords,
            matched_keyword: updated[dragIndex].matched_keyword,
            confidence: updated[dragIndex].confidence,
            is_auto_filled: updated[dragIndex].is_auto_filled,
            product_group: updated[dragIndex].product_group,
            source_video_id: updated[dragIndex].source_video_id,
            segment_start_time: updated[dragIndex].segment_start_time,
            segment_end_time: updated[dragIndex].segment_end_time,
            thumbnail_path: updated[dragIndex].thumbnail_path,
            transforms: updated[dragIndex].transforms,
            pinned: true
        };
        const dropSegment = {
            segment_id: updated[dropIndex].segment_id,
            segment_keywords: updated[dropIndex].segment_keywords,
            matched_keyword: updated[dropIndex].matched_keyword,
            confidence: updated[dropIndex].confidence,
            is_auto_filled: updated[dropIndex].is_auto_filled,
            product_group: updated[dropIndex].product_group,
            source_video_id: updated[dropIndex].source_video_id,
            segment_start_time: updated[dropIndex].segment_start_time,
            segment_end_time: updated[dropIndex].segment_end_time,
            thumbnail_path: updated[dropIndex].thumbnail_path,
            transforms: updated[dropIndex].transforms,
            pinned: true
        };
        updated[dragIndex] = {
            ...updated[dragIndex],
            ...dropSegment
        };
        updated[dropIndex] = {
            ...updated[dropIndex],
            ...dragSegment
        };
        onMatchesChange(updated);
        setDragIndex(null);
        setDragOverIndex(null);
    };
    const handleDragEnd = ()=>{
        setDragIndex(null);
        setDragOverIndex(null);
    };
    // --- Duration adjustment handlers ---
    const adjustDuration = (index, delta)=>{
        const match = matches[index];
        const naturalDuration = match.srt_end - match.srt_start;
        const currentDuration = match.duration_override ?? naturalDuration;
        const newDuration = Math.max(0.5, Math.min(10, currentDuration + delta));
        const updated = [
            ...matches
        ];
        updated[index] = {
            ...updated[index],
            duration_override: newDuration
        };
        onMatchesChange(updated);
    };
    // --- Trim (in/out point) adjustment ---
    // Nudges segment_start_time / segment_end_time within the source video.
    // Propagates to the whole merge group (render collapse uses the first entry's
    // segment for the group), same as handleSelectSegment.
    const adjustTrim = (index, edge, delta)=>{
        const match = matches[index];
        if (!match?.segment_id) return;
        const start = match.segment_start_time ?? 0;
        const end = match.segment_end_time ?? start + 0.5;
        // Clamp within the segment's library bounds when known.
        const lib = availableSegments.find((s)=>s.id === match.segment_id);
        const minStart = lib?.start_time ?? 0;
        const maxEnd = lib?.end_time ?? end + 10;
        let newStart = start;
        let newEnd = end;
        if (edge === "in") {
            // Keep at least a 0.5s window and stay within library bounds.
            newStart = Math.min(Math.max(minStart, start + delta), end - 0.5);
        } else {
            newEnd = Math.max(Math.min(maxEnd, end + delta), start + 0.5);
        }
        if (newStart === start && newEnd === end) return;
        const targetGroup = match.merge_group;
        const updated = matches.map((m, idx)=>{
            if (idx === index || targetGroup != null && m.merge_group === targetGroup) {
                return {
                    ...m,
                    segment_start_time: newStart,
                    segment_end_time: newEnd,
                    pinned: true
                };
            }
            return m;
        });
        onMatchesChange(updated);
    };
    // --- Pin handlers ---
    // Manual swaps/drags pin an assignment so re-running assembly won't touch it.
    // Users can click the pin indicator to release it back to auto-assignment.
    const handleTogglePin = (index)=>{
        const updated = [
            ...matches
        ];
        updated[index] = {
            ...updated[index],
            pinned: !updated[index].pinned
        };
        onMatchesChange(updated);
    };
    // --- Interstitial slide handlers ---
    const handleInsertSlide = (afterMatchIndex)=>{
        if (!onInterstitialSlidesChange) return;
        const newSlide = {
            id: crypto.randomUUID(),
            afterMatchIndex,
            imageUrl: "",
            duration: 2.0,
            animation: "kenburns",
            kenBurnsDirection: "zoom-in",
            productTitle: ""
        };
        const updated = [
            ...interstitialSlides,
            newSlide
        ];
        onInterstitialSlidesChange(updated);
        setSelectedSlideId(newSlide.id);
        setSelectedBlockIndex(null);
    };
    const handleUpdateSlide = (slideId, changes)=>{
        if (!onInterstitialSlidesChange) return;
        const updated = interstitialSlides.map((s)=>s.id === slideId ? {
                ...s,
                ...changes
            } : s);
        onInterstitialSlidesChange(updated);
    };
    const handleRemoveSlide = (slideId)=>{
        if (!onInterstitialSlidesChange) return;
        const updated = interstitialSlides.filter((s)=>s.id !== slideId);
        onInterstitialSlidesChange(updated);
        if (selectedSlideId === slideId) setSelectedSlideId(null);
    };
    // --- Video preview effect for timeline view ---
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "TimelineEditor.useEffect": ()=>{
            if (viewMode !== "timeline" || selectedBlockIndex === null) return;
            const match = matches[selectedBlockIndex];
            if (!match || !videoRef.current) return;
            const video = videoRef.current;
            const sourceVideoId = match.source_video_id;
            const startTime = match.segment_start_time ?? 0;
            // Respect merge_group_duration — don't play beyond what the render will use.
            // Without this, a 5s segment plays fully even if only 2.8s is needed.
            let endTime = match.segment_end_time;
            if (match.merge_group_duration != null && match.segment_start_time != null) {
                const mergeEnd = match.segment_start_time + match.merge_group_duration;
                // If segment_end_time exists, cap by it. If not, use mergeEnd alone.
                endTime = endTime != null ? Math.min(mergeEnd, endTime) : mergeEnd;
            }
            // Change src when source_video_id or start time changes (handles same-source segments)
            if (sourceVideoId && (sourceVideoId !== lastSourceVideoId.current || startTime !== lastStartTime.current) && profileId) {
                lastSourceVideoId.current = sourceVideoId;
                lastStartTime.current = startTime;
                video.src = getPreviewStreamUrl(sourceVideoId);
                video.load();
            }
            // rAF enforcement loop (60fps) replaces timeupdate (4Hz) to prevent ~250ms overshoot
            let enforcementRaf = null;
            const enforceEnd = {
                "TimelineEditor.useEffect.enforceEnd": ()=>{
                    if (endTime !== undefined && video.currentTime >= endTime) {
                        video.pause();
                        enforcementRaf = null;
                        return;
                    }
                    enforcementRaf = requestAnimationFrame(enforceEnd);
                }
            }["TimelineEditor.useEffect.enforceEnd"];
            // FE-13: Start enforcement once — triggered by play, not duplicated outside.
            const startPlayAndEnforce = {
                "TimelineEditor.useEffect.startPlayAndEnforce": ()=>{
                    video.currentTime = startTime;
                    video.play().catch({
                        "TimelineEditor.useEffect.startPlayAndEnforce": ()=>{}
                    }["TimelineEditor.useEffect.startPlayAndEnforce"]);
                    // Cancel any previous enforcement before starting new one
                    if (enforcementRaf != null) cancelAnimationFrame(enforcementRaf);
                    enforcementRaf = requestAnimationFrame(enforceEnd);
                }
            }["TimelineEditor.useEffect.startPlayAndEnforce"];
            const handleLoaded = {
                "TimelineEditor.useEffect.handleLoaded": ()=>{
                    startPlayAndEnforce();
                }
            }["TimelineEditor.useEffect.handleLoaded"];
            video.addEventListener("loadeddata", handleLoaded);
            // If video is already loaded (same source), just seek and play
            if (video.readyState >= 2) {
                startPlayAndEnforce();
            }
            return ({
                "TimelineEditor.useEffect": ()=>{
                    video.removeEventListener("loadeddata", handleLoaded);
                    if (enforcementRaf != null) cancelAnimationFrame(enforcementRaf);
                    video.pause();
                }
            })["TimelineEditor.useEffect"];
        }
    }["TimelineEditor.useEffect"], [
        viewMode,
        selectedBlockIndex,
        matches,
        profileId,
        getPreviewStreamUrl
    ]);
    if (matches.length === 0) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "flex items-center justify-center py-8 text-muted-foreground text-sm",
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$film$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Film$3e$__["Film"], {
                    className: "h-4 w-4 mr-2"
                }, void 0, false, {
                    fileName: "[project]/src/components/timeline-editor.tsx",
                    lineNumber: 1199,
                    columnNumber: 9
                }, this),
                "No SRT phrases to display."
            ]
        }, void 0, true, {
            fileName: "[project]/src/components/timeline-editor.tsx",
            lineNumber: 1198,
            columnNumber: 7
        }, this);
    }
    // Determine dialog title based on context
    const isSwapMode = assigningIndex !== null && matches[assigningIndex]?.segment_id !== null;
    const dialogTitle = isSwapMode ? "Swap Segment" : "Select Segment";
    const dialogSubLabel = isSwapMode ? "Swapping segment for phrase" : "Assigning to phrase";
    // Calculate total duration for proportional widths in timeline view
    const totalDuration = audioDuration > 0 ? audioDuration : matches.reduce((sum, m)=>sum + (m.duration_override ?? m.srt_end - m.srt_start), 0);
    // Selected match for inline preview
    const selectedMatch = selectedBlockIndex !== null ? matches[selectedBlockIndex] : null;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center gap-1 mb-3",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        variant: viewMode === "timeline" ? "default" : "outline",
                        size: "sm",
                        className: "h-7 text-xs gap-1.5",
                        onClick: ()=>setViewMode("timeline"),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$layout$2d$panel$2d$left$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__LayoutPanelLeft$3e$__["LayoutPanelLeft"], {
                                className: "h-3.5 w-3.5"
                            }, void 0, false, {
                                fileName: "[project]/src/components/timeline-editor.tsx",
                                lineNumber: 1230,
                                columnNumber: 11
                            }, this),
                            "Timeline"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/timeline-editor.tsx",
                        lineNumber: 1224,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                        variant: viewMode === "list" ? "default" : "outline",
                        size: "sm",
                        className: "h-7 text-xs gap-1.5",
                        onClick: ()=>setViewMode("list"),
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$list$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__List$3e$__["List"], {
                                className: "h-3.5 w-3.5"
                            }, void 0, false, {
                                fileName: "[project]/src/components/timeline-editor.tsx",
                                lineNumber: 1239,
                                columnNumber: 11
                            }, this),
                            "List"
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/timeline-editor.tsx",
                        lineNumber: 1233,
                        columnNumber: 9
                    }, this),
                    canPreview && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "ml-auto",
                        children: isPreviewActive ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                            variant: "outline",
                            size: "sm",
                            className: "h-7 text-xs gap-1.5 border-destructive text-destructive hover:bg-destructive/10",
                            onClick: deactivatePreview,
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$square$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Square$3e$__["Square"], {
                                    className: "h-3 w-3"
                                }, void 0, false, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 1252,
                                    columnNumber: 17
                                }, this),
                                "Stop Preview"
                            ]
                        }, void 0, true, {
                            fileName: "[project]/src/components/timeline-editor.tsx",
                            lineNumber: 1246,
                            columnNumber: 15
                        }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                            variant: "default",
                            size: "sm",
                            className: "h-7 text-xs gap-1.5",
                            onClick: activatePreview,
                            title: "Instant composite preview — plays source segments directly, no render",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$play$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Play$3e$__["Play"], {
                                    className: "h-3 w-3"
                                }, void 0, false, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 1263,
                                    columnNumber: 17
                                }, this),
                                "Instant Preview"
                            ]
                        }, void 0, true, {
                            fileName: "[project]/src/components/timeline-editor.tsx",
                            lineNumber: 1256,
                            columnNumber: 15
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/src/components/timeline-editor.tsx",
                        lineNumber: 1244,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/components/timeline-editor.tsx",
                lineNumber: 1223,
                columnNumber: 7
            }, this),
            canPreview && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("audio", {
                ref: previewAudioRef,
                src: `${__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["API_URL"]}/pipeline/audio/${pipelineId}/${variantIndex}`,
                preload: "auto",
                style: {
                    display: "none"
                }
            }, void 0, false, {
                fileName: "[project]/src/components/timeline-editor.tsx",
                lineNumber: 1274,
                columnNumber: 9
            }, this),
            isPreviewActive && pipelineId && variantIndex !== undefined && profileId && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                children: [
                    !isPreviewExpanded && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "rounded-lg border bg-card mb-3 overflow-hidden",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                ref: previewContainerRef,
                                className: "relative mx-auto bg-black flex items-center justify-center",
                                style: compactPreviewFrameStyle,
                                children: [
                                    [
                                        0,
                                        1
                                    ].map((slot)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("video", {
                                            ref: (el)=>{
                                                previewSlotRefs.current[slot] = el;
                                            },
                                            muted: true,
                                            playsInline: true,
                                            preload: "auto",
                                            className: "absolute inset-0 w-full h-full object-cover",
                                            onWaiting: ()=>setIsPreviewBuffering(true),
                                            onPlaying: ()=>setIsPreviewBuffering(false),
                                            onSeeked: ()=>setIsPreviewBuffering(false),
                                            style: {
                                                display: "block",
                                                opacity: activeSlot === slot && matches[previewActiveIndex]?.source_video_id ? 1 : 0,
                                                zIndex: activeSlot === slot ? 1 : 0
                                            }
                                        }, `slot-${slot}`, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1296,
                                            columnNumber: 19
                                        }, this)),
                                    isPreviewBuffering && isPreviewPlaying && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "absolute inset-0 flex items-center justify-center bg-black/30 z-10",
                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                                            className: "h-6 w-6 animate-spin text-white"
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1320,
                                            columnNumber: 21
                                        }, this)
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1319,
                                        columnNumber: 19
                                    }, this),
                                    !matches[previewActiveIndex]?.source_video_id && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex items-center justify-center text-muted-foreground text-sm",
                                        children: "No video for this segment"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1326,
                                        columnNumber: 19
                                    }, this),
                                    matches[previewActiveIndex]?.srt_text && (()=>{
                                        // Use same proportional scaling as subtitle-editor.tsx
                                        // ASS PlayRes reference height = 1920; scale to actual preview container height
                                        const ASS_REF_HEIGHT = 1920;
                                        const containerH = previewContainerRef.current?.clientHeight ?? 320;
                                        const scale = containerH / ASS_REF_HEIGHT;
                                        const fontSize = Math.max(8, (subtitleSettings?.fontSize ?? 48) * scale);
                                        const outlineW = (subtitleSettings?.outlineWidth ?? 3) * scale;
                                        const shadowDepth = (subtitleSettings?.shadowDepth ?? 0) * scale;
                                        const glowBlur = (subtitleSettings?.glowBlur ?? 0) * scale;
                                        const opacity = Math.max(0, Math.min(100, subtitleSettings?.opacity ?? 100)) / 100;
                                        const baseShadow = shadowDepth > 0 ? `0 ${shadowDepth}px ${Math.max(1, shadowDepth * 2)}px ${subtitleSettings?.shadowColor ?? "#000000"}` : "0 1px 3px rgba(0,0,0,0.85)";
                                        const glowShadow = subtitleSettings?.enableGlow && glowBlur > 0 ? `, 0 0 ${glowBlur}px ${subtitleSettings?.outlineColor ?? "#000000"}` : "";
                                        const positionY = subtitleSettings?.positionY ?? 85;
                                        const positionStyle = positionY <= 20 ? {
                                            top: `${positionY}%`
                                        } : {
                                            top: `${positionY}%`,
                                            transform: "translateY(-50%)"
                                        };
                                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "absolute left-2 right-2 z-[2] text-center pointer-events-none",
                                            style: positionStyle,
                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                                className: "inline-block px-2 py-1 font-semibold leading-tight",
                                                style: {
                                                    fontFamily: subtitleSettings?.fontFamily ?? "var(--font-montserrat), Montserrat, sans-serif",
                                                    fontSize: `${fontSize}px`,
                                                    color: subtitleSettings?.textColor ?? "#FFFFFF",
                                                    opacity,
                                                    textShadow: `${baseShadow}${glowShadow}`,
                                                    WebkitTextStroke: outlineW > 0 ? `${outlineW}px ${subtitleSettings?.outlineColor ?? "#000000"}` : undefined,
                                                    paintOrder: "stroke fill"
                                                },
                                                children: matches[previewActiveIndex].srt_text
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1359,
                                                columnNumber: 23
                                            }, this)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1355,
                                            columnNumber: 21
                                        }, this);
                                    })()
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/timeline-editor.tsx",
                                lineNumber: 1288,
                                columnNumber: 15
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "px-3 py-2 space-y-1.5",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                        type: "range",
                                        min: 0,
                                        max: previewDuration || 1,
                                        step: 0.1,
                                        value: previewCurrentTime,
                                        onChange: handlePreviewSeek,
                                        className: "w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-secondary accent-primary"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1383,
                                        columnNumber: 17
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex items-center justify-between gap-2",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "text-[11px] text-muted-foreground font-mono tabular-nums",
                                                children: [
                                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTimeShort"])(previewCurrentTime),
                                                    " / ",
                                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTimeShort"])(previewDuration || audioDuration)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1395,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "flex items-center gap-1",
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                        variant: "ghost",
                                                        size: "icon",
                                                        className: "h-7 w-7",
                                                        onClick: previewPrevSegment,
                                                        disabled: previewActiveIndex <= 0,
                                                        title: "Previous segment",
                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$skip$2d$back$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__SkipBack$3e$__["SkipBack"], {
                                                            className: "h-3.5 w-3.5"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1408,
                                                            columnNumber: 23
                                                        }, this)
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1400,
                                                        columnNumber: 21
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                        variant: "default",
                                                        size: "icon",
                                                        className: "h-8 w-8",
                                                        onClick: togglePreviewPlayPause,
                                                        title: isPreviewPlaying ? "Pause" : "Play",
                                                        children: isPreviewPlaying ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$pause$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Pause$3e$__["Pause"], {
                                                            className: "h-4 w-4"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1418,
                                                            columnNumber: 25
                                                        }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$play$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Play$3e$__["Play"], {
                                                            className: "h-4 w-4"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1420,
                                                            columnNumber: 25
                                                        }, this)
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1410,
                                                        columnNumber: 21
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                        variant: "ghost",
                                                        size: "icon",
                                                        className: "h-7 w-7",
                                                        onClick: previewNextSegment,
                                                        disabled: previewActiveIndex >= matches.length - 1,
                                                        title: "Next segment",
                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$skip$2d$forward$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__SkipForward$3e$__["SkipForward"], {
                                                            className: "h-3.5 w-3.5"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1431,
                                                            columnNumber: 23
                                                        }, this)
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1423,
                                                        columnNumber: 21
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                        variant: "ghost",
                                                        size: "icon",
                                                        className: "h-7 w-7",
                                                        onClick: ()=>setIsPreviewExpanded(true),
                                                        title: "Expand preview",
                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$maximize$2d$2$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Maximize2$3e$__["Maximize2"], {
                                                            className: "h-3.5 w-3.5"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1440,
                                                            columnNumber: 23
                                                        }, this)
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1433,
                                                        columnNumber: 21
                                                    }, this)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1399,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "text-[11px] text-muted-foreground",
                                                children: [
                                                    previewActiveIndex + 1,
                                                    "/",
                                                    matches.length
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1444,
                                                columnNumber: 19
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1394,
                                        columnNumber: 17
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/timeline-editor.tsx",
                                lineNumber: 1381,
                                columnNumber: 15
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/components/timeline-editor.tsx",
                        lineNumber: 1286,
                        columnNumber: 13
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Dialog"], {
                        open: isPreviewExpanded,
                        onOpenChange: setIsPreviewExpanded,
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DialogContent"], {
                            className: "w-[min(96vw,1200px)] max-w-[1200px] p-0 overflow-hidden",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DialogHeader"], {
                                    className: "px-6 pt-6 pb-0",
                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DialogTitle"], {
                                        children: "Expanded Preview"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1455,
                                        columnNumber: 17
                                    }, this)
                                }, void 0, false, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 1454,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "px-6 pb-6",
                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "rounded-lg border bg-card overflow-hidden",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                ref: previewContainerRef,
                                                className: "relative mx-auto bg-black flex items-center justify-center",
                                                style: expandedPreviewFrameStyle,
                                                children: [
                                                    [
                                                        0,
                                                        1
                                                    ].map((slot)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("video", {
                                                            ref: (el)=>{
                                                                previewSlotRefs.current[slot] = el;
                                                            },
                                                            muted: true,
                                                            playsInline: true,
                                                            preload: "auto",
                                                            className: "absolute inset-0 w-full h-full object-cover",
                                                            onWaiting: ()=>setIsPreviewBuffering(true),
                                                            onPlaying: ()=>setIsPreviewBuffering(false),
                                                            onSeeked: ()=>setIsPreviewBuffering(false),
                                                            style: {
                                                                display: "block",
                                                                opacity: activeSlot === slot && matches[previewActiveIndex]?.source_video_id ? 1 : 0,
                                                                zIndex: activeSlot === slot ? 1 : 0
                                                            }
                                                        }, `expanded-slot-${slot}`, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1467,
                                                            columnNumber: 23
                                                        }, this)),
                                                    isPreviewBuffering && isPreviewPlaying && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                        className: "absolute inset-0 flex items-center justify-center bg-black/30 z-10",
                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                                                            className: "h-8 w-8 animate-spin text-white"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1490,
                                                            columnNumber: 25
                                                        }, this)
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1489,
                                                        columnNumber: 23
                                                    }, this),
                                                    !matches[previewActiveIndex]?.source_video_id && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                        className: "flex items-center justify-center text-muted-foreground text-sm",
                                                        children: "No video for this segment"
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1495,
                                                        columnNumber: 23
                                                    }, this),
                                                    matches[previewActiveIndex]?.srt_text && (()=>{
                                                        const ASS_REF_HEIGHT = 1920;
                                                        const containerH = previewContainerRef.current?.clientHeight ?? 720;
                                                        const scale = containerH / ASS_REF_HEIGHT;
                                                        const fontSize = Math.max(10, (subtitleSettings?.fontSize ?? 48) * scale);
                                                        const outlineW = (subtitleSettings?.outlineWidth ?? 3) * scale;
                                                        const shadowDepth = (subtitleSettings?.shadowDepth ?? 0) * scale;
                                                        const glowBlur = (subtitleSettings?.glowBlur ?? 0) * scale;
                                                        const opacity = Math.max(0, Math.min(100, subtitleSettings?.opacity ?? 100)) / 100;
                                                        const baseShadow = shadowDepth > 0 ? `0 ${shadowDepth}px ${Math.max(1, shadowDepth * 2)}px ${subtitleSettings?.shadowColor ?? "#000000"}` : "0 1px 3px rgba(0,0,0,0.85)";
                                                        const glowShadow = subtitleSettings?.enableGlow && glowBlur > 0 ? `, 0 0 ${glowBlur}px ${subtitleSettings?.outlineColor ?? "#000000"}` : "";
                                                        const positionY = subtitleSettings?.positionY ?? 85;
                                                        const positionStyle = positionY <= 20 ? {
                                                            top: `${positionY}%`
                                                        } : {
                                                            top: `${positionY}%`,
                                                            transform: "translateY(-50%)"
                                                        };
                                                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                            className: "absolute left-2 right-2 z-[2] text-center pointer-events-none",
                                                            style: positionStyle,
                                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                                                className: "inline-block px-2 py-1 font-semibold leading-tight",
                                                                style: {
                                                                    fontFamily: subtitleSettings?.fontFamily ?? "var(--font-montserrat), Montserrat, sans-serif",
                                                                    fontSize: `${fontSize}px`,
                                                                    color: subtitleSettings?.textColor ?? "#FFFFFF",
                                                                    opacity,
                                                                    textShadow: `${baseShadow}${glowShadow}`,
                                                                    WebkitTextStroke: outlineW > 0 ? `${outlineW}px ${subtitleSettings?.outlineColor ?? "#000000"}` : undefined,
                                                                    paintOrder: "stroke fill"
                                                                },
                                                                children: matches[previewActiveIndex].srt_text
                                                            }, void 0, false, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 1525,
                                                                columnNumber: 27
                                                            }, this)
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1521,
                                                            columnNumber: 25
                                                        }, this);
                                                    })()
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1459,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "px-4 py-3 space-y-2",
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                                        type: "range",
                                                        min: 0,
                                                        max: previewDuration || 1,
                                                        step: 0.1,
                                                        value: previewCurrentTime,
                                                        onChange: handlePreviewSeek,
                                                        className: "w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-secondary accent-primary"
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1547,
                                                        columnNumber: 21
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                        className: "flex items-center justify-between gap-2",
                                                        children: [
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                className: "text-xs text-muted-foreground font-mono tabular-nums",
                                                                children: [
                                                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTimeShort"])(previewCurrentTime),
                                                                    " / ",
                                                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTimeShort"])(previewDuration || audioDuration)
                                                                ]
                                                            }, void 0, true, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 1558,
                                                                columnNumber: 23
                                                            }, this),
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                                className: "flex items-center gap-1",
                                                                children: [
                                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                        variant: "ghost",
                                                                        size: "icon",
                                                                        className: "h-8 w-8",
                                                                        onClick: previewPrevSegment,
                                                                        disabled: previewActiveIndex <= 0,
                                                                        title: "Previous segment",
                                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$skip$2d$back$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__SkipBack$3e$__["SkipBack"], {
                                                                            className: "h-4 w-4"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 1571,
                                                                            columnNumber: 27
                                                                        }, this)
                                                                    }, void 0, false, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 1563,
                                                                        columnNumber: 25
                                                                    }, this),
                                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                        variant: "default",
                                                                        size: "icon",
                                                                        className: "h-9 w-9",
                                                                        onClick: togglePreviewPlayPause,
                                                                        title: isPreviewPlaying ? "Pause" : "Play",
                                                                        children: isPreviewPlaying ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$pause$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Pause$3e$__["Pause"], {
                                                                            className: "h-4 w-4"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 1581,
                                                                            columnNumber: 29
                                                                        }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$play$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Play$3e$__["Play"], {
                                                                            className: "h-4 w-4"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 1583,
                                                                            columnNumber: 29
                                                                        }, this)
                                                                    }, void 0, false, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 1573,
                                                                        columnNumber: 25
                                                                    }, this),
                                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                        variant: "ghost",
                                                                        size: "icon",
                                                                        className: "h-8 w-8",
                                                                        onClick: previewNextSegment,
                                                                        disabled: previewActiveIndex >= matches.length - 1,
                                                                        title: "Next segment",
                                                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$skip$2d$forward$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__SkipForward$3e$__["SkipForward"], {
                                                                            className: "h-4 w-4"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 1594,
                                                                            columnNumber: 27
                                                                        }, this)
                                                                    }, void 0, false, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 1586,
                                                                        columnNumber: 25
                                                                    }, this)
                                                                ]
                                                            }, void 0, true, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 1562,
                                                                columnNumber: 23
                                                            }, this),
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                className: "text-xs text-muted-foreground",
                                                                children: [
                                                                    previewActiveIndex + 1,
                                                                    "/",
                                                                    matches.length
                                                                ]
                                                            }, void 0, true, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 1598,
                                                                columnNumber: 23
                                                            }, this)
                                                        ]
                                                    }, void 0, true, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1557,
                                                        columnNumber: 21
                                                    }, this)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1546,
                                                columnNumber: 19
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1458,
                                        columnNumber: 17
                                    }, this)
                                }, void 0, false, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 1457,
                                    columnNumber: 15
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/src/components/timeline-editor.tsx",
                            lineNumber: 1453,
                            columnNumber: 13
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/src/components/timeline-editor.tsx",
                        lineNumber: 1452,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true),
            viewMode === "timeline" ? /* ========== TIMELINE VIEW ========== */ /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "space-y-3",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "overflow-x-auto rounded-md border bg-muted/30 p-2",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "flex items-stretch gap-0.5",
                            style: {
                                minWidth: "100%"
                            },
                            children: (()=>{
                                const groups = timelineGroups;
                                const elements = [];
                                // Helper: render a "+" insertion button
                                const renderInsertButton = (afterMatchIndex)=>{
                                    if (!onInterstitialSlidesChange) return null;
                                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                        onClick: ()=>handleInsertSlide(afterMatchIndex),
                                        className: "flex-shrink-0 flex items-center justify-center w-5 h-[80px] rounded border border-dashed border-primary/50 text-primary/50 hover:bg-primary/10 hover:text-primary transition-colors",
                                        title: `Insert image slide ${afterMatchIndex === -1 ? "before first block" : "here"}`,
                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__["Plus"], {
                                            className: "h-3 w-3"
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1631,
                                            columnNumber: 23
                                        }, this)
                                    }, `insert-${afterMatchIndex}`, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1625,
                                        columnNumber: 21
                                    }, this);
                                };
                                // Helper: render an interstitial slide block
                                const renderSlideBlock = (slide)=>{
                                    const slideWidthPercent = totalDuration > 0 ? slide.duration / totalDuration * 100 : 5;
                                    const isSlideSelected = selectedSlideId === slide.id;
                                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        onClick: ()=>{
                                            setSelectedSlideId(slide.id === selectedSlideId ? null : slide.id);
                                            setSelectedBlockIndex(null);
                                        },
                                        className: `
                        relative flex-shrink-0 rounded-md border-2 cursor-pointer
                        transition-all select-none overflow-hidden
                        border-primary bg-primary/10
                        ${isSlideSelected ? "ring-2 ring-primary ring-offset-1" : ""}
                      `,
                                        style: {
                                            width: `max(50px, ${slideWidthPercent}%)`,
                                            height: "80px"
                                        },
                                        title: slide.productTitle || "Image slide",
                                        children: [
                                            slide.imageUrl && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("img", {
                                                src: slide.imageUrl,
                                                alt: "",
                                                className: "absolute inset-0 w-full h-full object-cover opacity-40",
                                                loading: "lazy",
                                                onError: (e)=>{
                                                    e.target.style.display = "none";
                                                }
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1661,
                                                columnNumber: 25
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "relative z-10 flex flex-col items-center justify-center h-full px-1 py-1 text-center",
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$image$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ImageIcon$3e$__["ImageIcon"], {
                                                        className: "h-3 w-3 text-primary mb-0.5"
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1670,
                                                        columnNumber: 25
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                        className: "text-[10px] font-medium leading-tight text-foreground",
                                                        children: [
                                                            slide.duration.toFixed(1),
                                                            "s"
                                                        ]
                                                    }, void 0, true, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1671,
                                                        columnNumber: 25
                                                    }, this),
                                                    slide.animation === "kenburns" && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                        className: "text-[9px] text-primary leading-none mt-0.5",
                                                        children: "KB"
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 1675,
                                                        columnNumber: 27
                                                    }, this)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1669,
                                                columnNumber: 23
                                            }, this)
                                        ]
                                    }, `slide-${slide.id}`, true, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1641,
                                        columnNumber: 21
                                    }, this);
                                };
                                // Insert "before first" button
                                elements.push(renderInsertButton(-1));
                                // Slides before the first group (afterMatchIndex === -1)
                                interstitialSlides.filter((s)=>s.afterMatchIndex === -1).forEach((s)=>elements.push(renderSlideBlock(s)));
                                groups.forEach((group)=>{
                                    const firstIdx = group.matchIndices[0];
                                    const lastIdx = group.matchIndices[group.matchIndices.length - 1];
                                    const firstMatch = matches[firstIdx];
                                    const isMulti = group.matchIndices.length > 1;
                                    const groupDuration = group.groupDuration;
                                    const widthPercent = totalDuration > 0 ? groupDuration / totalDuration * 100 : 10;
                                    // Use first match for color/status
                                    const isMatched = firstMatch.segment_id !== null && firstMatch.confidence > 0;
                                    const isAutoFilled = firstMatch.is_auto_filled === true && firstMatch.segment_id !== null;
                                    const isPinned = firstMatch.pinned === true;
                                    const isLowConfidence = isMatched && !isPinned && firstMatch.confidence < 0.5;
                                    const isSelected = group.matchIndices.includes(selectedBlockIndex ?? -1);
                                    const isPreviewHighlighted = isPreviewActive && group.matchIndices.includes(previewActiveIndex);
                                    const borderColor = isMatched ? isLowConfidence ? "border-amber-400" : "border-success" : isAutoFilled ? "border-muted-foreground" : "border-amber-500";
                                    const bgColor = isSelected ? "bg-accent" : isMatched ? isLowConfidence ? "bg-amber-50/60 dark:bg-amber-950/10" : "bg-success/10" : isAutoFilled ? "bg-muted/50" : "bg-amber-50 dark:bg-amber-950/20";
                                    // Combine texts for tooltip, plus the assembly explanation if present
                                    const groupTexts = group.matchIndices.map((i)=>matches[i].srt_text).join(" ") + (firstMatch.explanation ? `\n\n${firstMatch.explanation}` : "");
                                    elements.push(/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        draggable: true,
                                        onDragStart: (e)=>handleDragStart(e, firstIdx),
                                        onDragOver: (e)=>handleDragOver(e, firstIdx),
                                        onDragLeave: handleDragLeave,
                                        onDrop: (e)=>handleDrop(e, firstIdx),
                                        onDragEnd: handleDragEnd,
                                        onClick: ()=>{
                                            if (isPreviewActive) {
                                                handleSeekToSegment(firstIdx);
                                            } else {
                                                setSelectedBlockIndex(firstIdx === selectedBlockIndex ? null : firstIdx);
                                                setSelectedSlideId(null);
                                            }
                                        },
                                        className: `
                        relative flex-shrink-0 rounded-md border-2 cursor-pointer
                        transition-all select-none overflow-hidden
                        ${borderColor} ${bgColor}
                        ${isSelected && !isPreviewActive ? "ring-2 ring-primary ring-offset-1" : ""}
                        ${isPreviewHighlighted ? "ring-2 ring-primary ring-offset-1 brightness-110" : ""}
                      `,
                                        style: {
                                            width: `max(${isMulti ? 90 : 60}px, ${widthPercent}%)`,
                                            height: "80px"
                                        },
                                        title: groupTexts,
                                        children: [
                                            firstMatch.thumbnail_path && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("img", {
                                                src: `${__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["API_URL"]}/segments/files/${encodeURIComponent(firstMatch.thumbnail_path.split('/').pop() ?? '')}`,
                                                alt: "",
                                                className: "absolute inset-0 w-full h-full object-cover opacity-40",
                                                loading: "lazy"
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1760,
                                                columnNumber: 25
                                            }, this),
                                            isPinned && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                                type: "button",
                                                onClick: (e)=>{
                                                    e.stopPropagation();
                                                    handleTogglePin(firstIdx);
                                                },
                                                className: "absolute top-0.5 right-0.5 z-20 text-primary hover:text-muted-foreground transition-colors",
                                                title: "Pinned — manually assigned, click to unpin",
                                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$pin$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Pin$3e$__["Pin"], {
                                                    className: "h-3 w-3 fill-current"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1775,
                                                    columnNumber: 27
                                                }, this)
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1769,
                                                columnNumber: 25
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "relative z-10 flex flex-col items-center justify-center h-full px-1 py-1 text-center",
                                                children: isMulti ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "text-[10px] font-mono font-bold leading-none",
                                                            children: [
                                                                "#",
                                                                firstMatch.srt_index + 1,
                                                                "-",
                                                                matches[group.matchIndices[group.matchIndices.length - 1]].srt_index + 1
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1782,
                                                            columnNumber: 29
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "text-[10px] font-medium leading-tight mt-0.5",
                                                            children: [
                                                                groupDuration.toFixed(1),
                                                                "s"
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1785,
                                                            columnNumber: 29
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "text-[9px] text-muted-foreground leading-tight mt-0.5 truncate max-w-full",
                                                            children: [
                                                                group.matchIndices.length,
                                                                " phrases"
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1788,
                                                            columnNumber: 29
                                                        }, this)
                                                    ]
                                                }, void 0, true) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "text-[10px] font-mono font-bold leading-none",
                                                            children: [
                                                                "#",
                                                                firstMatch.srt_index + 1
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1794,
                                                            columnNumber: 29
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "text-[10px] font-medium leading-tight mt-0.5 truncate max-w-full",
                                                            children: [
                                                                groupDuration.toFixed(1),
                                                                "s"
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1797,
                                                            columnNumber: 29
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "text-[9px] text-muted-foreground leading-tight mt-0.5 truncate max-w-full",
                                                            children: firstMatch.matched_keyword ?? (isAutoFilled ? "auto" : "?")
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1800,
                                                            columnNumber: 29
                                                        }, this)
                                                    ]
                                                }, void 0, true)
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1779,
                                                columnNumber: 23
                                            }, this)
                                        ]
                                    }, `g-${group.groupId}`, true, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1729,
                                        columnNumber: 21
                                    }, this));
                                    // "+" button after this group
                                    elements.push(renderInsertButton(lastIdx));
                                    // Interstitial slides after this group
                                    interstitialSlides.filter((s)=>s.afterMatchIndex === lastIdx).forEach((s)=>elements.push(renderSlideBlock(s)));
                                });
                                return elements;
                            })()
                        }, void 0, false, {
                            fileName: "[project]/src/components/timeline-editor.tsx",
                            lineNumber: 1615,
                            columnNumber: 13
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/src/components/timeline-editor.tsx",
                        lineNumber: 1614,
                        columnNumber: 11
                    }, this),
                    selectedSlideId !== null && (()=>{
                        const slide = interstitialSlides.find((s)=>s.id === selectedSlideId);
                        if (!slide) return null;
                        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "rounded-md border border-primary/25 bg-primary/10 p-4 space-y-3",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "flex items-center justify-between",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "flex items-center gap-2 text-sm font-medium text-foreground",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$image$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ImageIcon$3e$__["ImageIcon"], {
                                                    className: "h-4 w-4 text-primary"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1831,
                                                    columnNumber: 21
                                                }, this),
                                                "Image Slide Config"
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1830,
                                            columnNumber: 19
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                            variant: "ghost",
                                            size: "sm",
                                            className: "h-7 text-xs gap-1 text-destructive hover:bg-destructive/10",
                                            onClick: ()=>handleRemoveSlide(slide.id),
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$trash$2d$2$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Trash2$3e$__["Trash2"], {
                                                    className: "h-3 w-3"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1840,
                                                    columnNumber: 21
                                                }, this),
                                                "Remove"
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1834,
                                            columnNumber: 19
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 1829,
                                    columnNumber: 17
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "flex items-start gap-4",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "flex-shrink-0 w-20 h-20 rounded border overflow-hidden bg-muted flex items-center justify-center",
                                            children: slide.imageUrl ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("img", {
                                                src: slide.imageUrl,
                                                alt: "Product",
                                                className: "w-full h-full object-cover",
                                                onError: (e)=>{
                                                    e.target.style.display = "none";
                                                }
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1849,
                                                columnNumber: 23
                                            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$image$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ImageIcon$3e$__["ImageIcon"], {
                                                className: "h-6 w-6 text-muted-foreground"
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 1856,
                                                columnNumber: 23
                                            }, this)
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1847,
                                            columnNumber: 19
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "flex-1 min-w-0 space-y-2",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: "space-y-1",
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                                                            className: "text-xs font-medium text-muted-foreground",
                                                            children: "Image URL"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1863,
                                                            columnNumber: 23
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                                            type: "text",
                                                            value: slide.imageUrl,
                                                            onChange: (e)=>handleUpdateSlide(slide.id, {
                                                                    imageUrl: e.target.value
                                                                }),
                                                            placeholder: "https://...",
                                                            className: "w-full h-7 text-xs px-2 rounded border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1864,
                                                            columnNumber: 23
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1862,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: "flex items-center gap-2",
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                                                            className: "text-xs font-medium text-muted-foreground whitespace-nowrap",
                                                            children: "Duration"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1875,
                                                            columnNumber: 23
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                            className: "flex items-center gap-1",
                                                            children: [
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                    variant: "ghost",
                                                                    size: "icon",
                                                                    className: "h-5 w-5",
                                                                    onClick: ()=>handleUpdateSlide(slide.id, {
                                                                            duration: Math.max(0.5, slide.duration - 0.5)
                                                                        }),
                                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$minus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Minus$3e$__["Minus"], {
                                                                        className: "h-3 w-3"
                                                                    }, void 0, false, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 1883,
                                                                        columnNumber: 27
                                                                    }, this)
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 1877,
                                                                    columnNumber: 25
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                    className: "w-12 text-center text-xs font-mono tabular-nums",
                                                                    children: [
                                                                        slide.duration.toFixed(1),
                                                                        "s"
                                                                    ]
                                                                }, void 0, true, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 1885,
                                                                    columnNumber: 25
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                    variant: "ghost",
                                                                    size: "icon",
                                                                    className: "h-5 w-5",
                                                                    onClick: ()=>handleUpdateSlide(slide.id, {
                                                                            duration: Math.min(5.0, slide.duration + 0.5)
                                                                        }),
                                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__["Plus"], {
                                                                        className: "h-3 w-3"
                                                                    }, void 0, false, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 1894,
                                                                        columnNumber: 27
                                                                    }, this)
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 1888,
                                                                    columnNumber: 25
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("input", {
                                                                    type: "range",
                                                                    min: 0.5,
                                                                    max: 5.0,
                                                                    step: 0.5,
                                                                    value: slide.duration,
                                                                    onChange: (e)=>handleUpdateSlide(slide.id, {
                                                                            duration: parseFloat(e.target.value)
                                                                        }),
                                                                    className: "w-24 h-1.5 rounded-lg appearance-none cursor-pointer bg-secondary accent-primary"
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 1896,
                                                                    columnNumber: 25
                                                                }, this)
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1876,
                                                            columnNumber: 23
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1874,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: "flex items-center gap-2",
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                                                            className: "text-xs font-medium text-muted-foreground whitespace-nowrap",
                                                            children: "Animation"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1910,
                                                            columnNumber: 23
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                            className: "flex gap-1",
                                                            children: [
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                    variant: slide.animation === "static" ? "default" : "outline",
                                                                    size: "sm",
                                                                    className: "h-6 text-xs px-2",
                                                                    onClick: ()=>handleUpdateSlide(slide.id, {
                                                                            animation: "static"
                                                                        }),
                                                                    children: "Static"
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 1912,
                                                                    columnNumber: 25
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                    variant: slide.animation === "kenburns" ? "default" : "outline",
                                                                    size: "sm",
                                                                    className: "h-6 text-xs px-2",
                                                                    onClick: ()=>handleUpdateSlide(slide.id, {
                                                                            animation: "kenburns"
                                                                        }),
                                                                    children: "Ken Burns"
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 1920,
                                                                    columnNumber: 25
                                                                }, this)
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1911,
                                                            columnNumber: 23
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1909,
                                                    columnNumber: 21
                                                }, this),
                                                slide.animation === "kenburns" && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: "flex items-center gap-2",
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("label", {
                                                            className: "text-xs font-medium text-muted-foreground whitespace-nowrap",
                                                            children: "Direction"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1934,
                                                            columnNumber: 25
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                            className: "relative",
                                                            children: [
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("select", {
                                                                    value: slide.kenBurnsDirection ?? "zoom-in",
                                                                    onChange: (e)=>handleUpdateSlide(slide.id, {
                                                                            kenBurnsDirection: e.target.value
                                                                        }),
                                                                    className: "h-6 text-xs pl-2 pr-6 rounded border bg-background text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary",
                                                                    children: [
                                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                                                            value: "zoom-in",
                                                                            children: "Zoom In"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 1941,
                                                                            columnNumber: 29
                                                                        }, this),
                                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                                                            value: "zoom-out",
                                                                            children: "Zoom Out"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 1942,
                                                                            columnNumber: 29
                                                                        }, this),
                                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                                                            value: "pan-left",
                                                                            children: "Pan Left"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 1943,
                                                                            columnNumber: 29
                                                                        }, this),
                                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("option", {
                                                                            value: "pan-right",
                                                                            children: "Pan Right"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 1944,
                                                                            columnNumber: 29
                                                                        }, this)
                                                                    ]
                                                                }, void 0, true, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 1936,
                                                                    columnNumber: 27
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$chevron$2d$down$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ChevronDown$3e$__["ChevronDown"], {
                                                                    className: "pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground"
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 1946,
                                                                    columnNumber: 27
                                                                }, this)
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 1935,
                                                            columnNumber: 25
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1933,
                                                    columnNumber: 23
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1860,
                                            columnNumber: 19
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 1845,
                                    columnNumber: 17
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/src/components/timeline-editor.tsx",
                            lineNumber: 1828,
                            columnNumber: 15
                        }, this);
                    })(),
                    selectedBlockIndex !== null && selectedMatch && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "rounded-md border bg-card p-4 space-y-3",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "flex items-start gap-4",
                            children: [
                                selectedMatch.source_video_id && profileId ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "flex-shrink-0 w-48 rounded overflow-hidden bg-black",
                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("video", {
                                        ref: videoRef,
                                        className: "w-full h-auto",
                                        controls: true,
                                        muted: true
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1963,
                                        columnNumber: 21
                                    }, this)
                                }, void 0, false, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 1962,
                                    columnNumber: 19
                                }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "flex-shrink-0 w-48 h-28 rounded bg-muted flex items-center justify-center",
                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$film$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Film$3e$__["Film"], {
                                        className: "h-6 w-6 text-muted-foreground"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 1972,
                                        columnNumber: 21
                                    }, this)
                                }, void 0, false, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 1971,
                                    columnNumber: 19
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "flex-1 min-w-0 space-y-2",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "text-sm font-medium",
                                            children: [
                                                "#",
                                                selectedMatch.srt_index + 1,
                                                ": ",
                                                selectedMatch.srt_text
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1978,
                                            columnNumber: 19
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "text-xs text-muted-foreground",
                                            children: [
                                                (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTimeShort"])(selectedMatch.srt_start),
                                                " – ",
                                                (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTimeShort"])(selectedMatch.srt_end)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1981,
                                            columnNumber: 19
                                        }, this),
                                        selectedMatch.matched_keyword && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Badge"], {
                                            variant: "secondary",
                                            className: "text-xs bg-success/10 text-success border-success/20",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$check$2d$big$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CheckCircle$3e$__["CheckCircle"], {
                                                    className: "h-3 w-3 mr-1"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1991,
                                                    columnNumber: 23
                                                }, this),
                                                selectedMatch.matched_keyword
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1987,
                                            columnNumber: 21
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "flex items-center gap-1 text-xs",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$clock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Clock$3e$__["Clock"], {
                                                    className: "h-3 w-3 text-muted-foreground"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1998,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                    variant: "ghost",
                                                    size: "icon",
                                                    className: "h-5 w-5",
                                                    onClick: ()=>adjustDuration(selectedBlockIndex, -0.5),
                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$minus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Minus$3e$__["Minus"], {
                                                        className: "h-3 w-3"
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2005,
                                                        columnNumber: 23
                                                    }, this)
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 1999,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: "w-10 text-center font-mono tabular-nums",
                                                    children: [
                                                        (selectedMatch.duration_override ?? selectedMatch.srt_end - selectedMatch.srt_start).toFixed(1),
                                                        "s"
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2007,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                    variant: "ghost",
                                                    size: "icon",
                                                    className: "h-5 w-5",
                                                    onClick: ()=>adjustDuration(selectedBlockIndex, 0.5),
                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__["Plus"], {
                                                        className: "h-3 w-3"
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2016,
                                                        columnNumber: 23
                                                    }, this)
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2010,
                                                    columnNumber: 21
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 1997,
                                            columnNumber: 19
                                        }, this),
                                        selectedMatch.segment_id && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "space-y-0.5 text-xs",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: "flex items-center gap-1",
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "text-muted-foreground w-7",
                                                            children: "In"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2026,
                                                            columnNumber: 25
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                            variant: "ghost",
                                                            size: "icon",
                                                            className: "h-5 w-5",
                                                            onClick: ()=>adjustTrim(selectedBlockIndex, "in", -0.5),
                                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$minus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Minus$3e$__["Minus"], {
                                                                className: "h-3 w-3"
                                                            }, void 0, false, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2033,
                                                                columnNumber: 27
                                                            }, this)
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2027,
                                                            columnNumber: 25
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                            variant: "ghost",
                                                            size: "icon",
                                                            className: "h-5 w-5",
                                                            onClick: ()=>adjustTrim(selectedBlockIndex, "in", 0.5),
                                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__["Plus"], {
                                                                className: "h-3 w-3"
                                                            }, void 0, false, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2041,
                                                                columnNumber: 27
                                                            }, this)
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2035,
                                                            columnNumber: 25
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "font-mono tabular-nums",
                                                            children: [
                                                                (selectedMatch.segment_start_time ?? 0).toFixed(1),
                                                                "s"
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2043,
                                                            columnNumber: 25
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2025,
                                                    columnNumber: 23
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: "flex items-center gap-1",
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "text-muted-foreground w-7",
                                                            children: "Out"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2048,
                                                            columnNumber: 25
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                            variant: "ghost",
                                                            size: "icon",
                                                            className: "h-5 w-5",
                                                            onClick: ()=>adjustTrim(selectedBlockIndex, "out", -0.5),
                                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$minus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Minus$3e$__["Minus"], {
                                                                className: "h-3 w-3"
                                                            }, void 0, false, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2055,
                                                                columnNumber: 27
                                                            }, this)
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2049,
                                                            columnNumber: 25
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                            variant: "ghost",
                                                            size: "icon",
                                                            className: "h-5 w-5",
                                                            onClick: ()=>adjustTrim(selectedBlockIndex, "out", 0.5),
                                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__["Plus"], {
                                                                className: "h-3 w-3"
                                                            }, void 0, false, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2063,
                                                                columnNumber: 27
                                                            }, this)
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2057,
                                                            columnNumber: 25
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: "font-mono tabular-nums",
                                                            children: [
                                                                (selectedMatch.segment_end_time ?? 0).toFixed(1),
                                                                "s"
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2065,
                                                            columnNumber: 25
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2047,
                                                    columnNumber: 23
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: "text-muted-foreground",
                                                    children: [
                                                        "Trim (",
                                                        Math.max(0, (selectedMatch.segment_end_time ?? 0) - (selectedMatch.segment_start_time ?? 0)).toFixed(1),
                                                        "s)"
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2069,
                                                    columnNumber: 23
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2024,
                                            columnNumber: 21
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                            variant: "outline",
                                            size: "sm",
                                            className: "h-7 text-xs gap-1",
                                            onClick: ()=>handleOpenDialog(selectedBlockIndex),
                                            disabled: availableSegments.length === 0,
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$refresh$2d$cw$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__RefreshCw$3e$__["RefreshCw"], {
                                                    className: "h-3 w-3"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2083,
                                                    columnNumber: 21
                                                }, this),
                                                selectedMatch.segment_id ? "Swap Segment" : "Assign Segment"
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2076,
                                            columnNumber: 19
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 1977,
                                    columnNumber: 17
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/src/components/timeline-editor.tsx",
                            lineNumber: 1959,
                            columnNumber: 15
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/src/components/timeline-editor.tsx",
                        lineNumber: 1958,
                        columnNumber: 13
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/components/timeline-editor.tsx",
                lineNumber: 1612,
                columnNumber: 9
            }, this) : /* ========== LIST VIEW ========== */ /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "max-h-[500px] overflow-y-auto rounded-md border",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "divide-y",
                    children: [
                        onInterstitialSlidesChange && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "flex items-center px-3 py-1 bg-muted/20",
                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                onClick: ()=>handleInsertSlide(-1),
                                className: "flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__["Plus"], {
                                        className: "h-3 w-3"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 2102,
                                        columnNumber: 19
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        children: "Insert slide before"
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 2103,
                                        columnNumber: 19
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/components/timeline-editor.tsx",
                                lineNumber: 2098,
                                columnNumber: 17
                            }, this)
                        }, void 0, false, {
                            fileName: "[project]/src/components/timeline-editor.tsx",
                            lineNumber: 2097,
                            columnNumber: 15
                        }, this),
                        interstitialSlides.filter((s)=>s.afterMatchIndex === -1).map((slide)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "group flex items-center gap-3 px-3 py-2.5 border-l-4 border-l-primary bg-primary/10",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex-shrink-0 w-10 h-10 rounded overflow-hidden border bg-muted flex items-center justify-center",
                                        children: slide.imageUrl ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("img", {
                                            src: slide.imageUrl,
                                            alt: "",
                                            className: "w-full h-full object-cover",
                                            onError: (e)=>{
                                                e.target.style.display = "none";
                                            }
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2117,
                                            columnNumber: 23
                                        }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$image$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ImageIcon$3e$__["ImageIcon"], {
                                            className: "h-4 w-4 text-muted-foreground"
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2119,
                                            columnNumber: 23
                                        }, this)
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 2115,
                                        columnNumber: 19
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex-1 min-w-0 text-sm text-foreground",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "font-medium",
                                                children: "Image Slide"
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 2123,
                                                columnNumber: 21
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "text-xs text-muted-foreground",
                                                children: [
                                                    slide.duration.toFixed(1),
                                                    "s · ",
                                                    slide.animation === "kenburns" ? `Ken Burns (${slide.kenBurnsDirection ?? "zoom-in"})` : "Static"
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 2124,
                                                columnNumber: 21
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 2122,
                                        columnNumber: 19
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                        variant: "ghost",
                                        size: "icon",
                                        className: "h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 transition-opacity",
                                        onClick: ()=>handleRemoveSlide(slide.id),
                                        title: "Remove slide",
                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$trash$2d$2$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Trash2$3e$__["Trash2"], {
                                            className: "h-3 w-3"
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2133,
                                            columnNumber: 21
                                        }, this)
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 2126,
                                        columnNumber: 19
                                    }, this)
                                ]
                            }, `list-slide-${slide.id}`, true, {
                                fileName: "[project]/src/components/timeline-editor.tsx",
                                lineNumber: 2111,
                                columnNumber: 17
                            }, this)),
                        matches.map((match, idx)=>{
                            const isMatched = match.segment_id !== null && match.confidence > 0;
                            const isAutoFilled = match.is_auto_filled === true && match.segment_id !== null;
                            const isPinned = match.pinned === true;
                            const isLowConfidence = isMatched && !isPinned && match.confidence < 0.5;
                            const isDragging = dragIndex === idx;
                            const isDragOver = dragOverIndex === idx && dragIndex !== idx;
                            const displayText = match.srt_text.length > 60 ? match.srt_text.substring(0, 60) + "..." : match.srt_text;
                            const naturalDuration = match.srt_end - match.srt_start;
                            const displayDuration = match.duration_override ?? naturalDuration;
                            const isDurationOverridden = match.duration_override !== undefined && Math.abs(match.duration_override - naturalDuration) > 0.05;
                            // Merge group info: check if this entry is first/last in its group
                            const mg = match.merge_group;
                            const prevMg = idx > 0 ? matches[idx - 1].merge_group : undefined;
                            const nextMg = idx < matches.length - 1 ? matches[idx + 1].merge_group : undefined;
                            const isGroupStart = mg !== undefined && mg !== prevMg;
                            const isGroupEnd = mg !== undefined && mg !== nextMg;
                            const isInGroup = mg !== undefined && (mg === prevMg || mg === nextMg);
                            // Slides and insert button after this match
                            const slidesAfter = interstitialSlides.filter((s)=>s.afterMatchIndex === idx);
                            return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].Fragment, {
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        draggable: true,
                                        onDragStart: (e)=>handleDragStart(e, idx),
                                        onDragOver: (e)=>handleDragOver(e, idx),
                                        onDragLeave: handleDragLeave,
                                        onDrop: (e)=>handleDrop(e, idx),
                                        onDragEnd: handleDragEnd,
                                        className: `group flex items-center gap-3 px-3 py-2.5 min-h-[48px] border-l-4 transition-colors select-none ${isMatched ? isLowConfidence ? "border-l-amber-400 bg-amber-50/60 dark:bg-amber-950/10" : "border-l-success bg-success/10" : isAutoFilled ? "border-l-muted-foreground bg-muted/50" : "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20"} ${isDragging ? "opacity-50" : ""} ${isDragOver ? "border-t-2 border-t-primary" : "border-t-transparent"} ${isInGroup ? "border-r-2 border-r-chart-2" : ""} ${isGroupStart && isInGroup ? "rounded-tr-md" : ""} ${isGroupEnd && isInGroup ? "rounded-br-md" : ""}`,
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors",
                                                title: "Drag to swap segment assignment",
                                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$grip$2d$vertical$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__GripVertical$3e$__["GripVertical"], {
                                                    className: "h-4 w-4"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2195,
                                                    columnNumber: 21
                                                }, this)
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 2191,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "flex-shrink-0 text-xs text-muted-foreground w-24 space-y-0.5",
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                        className: "font-mono font-semibold text-foreground",
                                                        children: [
                                                            "#",
                                                            match.srt_index + 1
                                                        ]
                                                    }, void 0, true, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2200,
                                                        columnNumber: 21
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                        children: [
                                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTimeShort"])(match.srt_start),
                                                            " – ",
                                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$utils$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTimeShort"])(match.srt_end)
                                                        ]
                                                    }, void 0, true, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2203,
                                                        columnNumber: 21
                                                    }, this)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 2199,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "flex-1 min-w-0 text-sm",
                                                title: match.srt_text,
                                                children: displayText
                                            }, void 0, false, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 2209,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: "flex-shrink-0 flex flex-col items-end gap-1",
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                        className: "flex items-center gap-1 text-xs",
                                                        children: [
                                                            isGroupStart && isInGroup && match.merge_group_duration ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                className: "text-[10px] font-mono bg-chart-2/15 text-chart-2 px-1 rounded mr-0.5",
                                                                title: `Segment video: ${match.merge_group_duration.toFixed(1)}s (grupate)`,
                                                                children: [
                                                                    match.merge_group_duration.toFixed(1),
                                                                    "s"
                                                                ]
                                                            }, void 0, true, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2221,
                                                                columnNumber: 25
                                                            }, this) : null,
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                title: "Subtitle duration",
                                                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$clock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Clock$3e$__["Clock"], {
                                                                    className: "h-3 w-3 text-muted-foreground"
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2229,
                                                                    columnNumber: 25
                                                                }, this)
                                                            }, void 0, false, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2228,
                                                                columnNumber: 23
                                                            }, this),
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                variant: "ghost",
                                                                size: "icon",
                                                                className: "h-5 w-5",
                                                                onClick: ()=>adjustDuration(idx, -0.5),
                                                                title: "Decrease duration by 0.5s",
                                                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$minus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Minus$3e$__["Minus"], {
                                                                    className: "h-3 w-3"
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2238,
                                                                    columnNumber: 25
                                                                }, this)
                                                            }, void 0, false, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2231,
                                                                columnNumber: 23
                                                            }, this),
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                className: `w-10 text-center font-mono tabular-nums ${isDurationOverridden ? "text-foreground font-semibold" : "text-muted-foreground"}`,
                                                                title: isDurationOverridden ? `Adjusted from ${naturalDuration.toFixed(1)}s` : "Natural SRT duration",
                                                                children: [
                                                                    displayDuration.toFixed(1),
                                                                    "s"
                                                                ]
                                                            }, void 0, true, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2240,
                                                                columnNumber: 23
                                                            }, this),
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                variant: "ghost",
                                                                size: "icon",
                                                                className: "h-5 w-5",
                                                                onClick: ()=>adjustDuration(idx, 0.5),
                                                                title: "Increase duration by 0.5s",
                                                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__["Plus"], {
                                                                    className: "h-3 w-3"
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2261,
                                                                    columnNumber: 25
                                                                }, this)
                                                            }, void 0, false, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2254,
                                                                columnNumber: 23
                                                            }, this)
                                                        ]
                                                    }, void 0, true, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2219,
                                                        columnNumber: 21
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                        className: "flex items-center gap-2",
                                                        children: isMatched ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                                            children: [
                                                                isPinned && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                                                    type: "button",
                                                                    onClick: ()=>handleTogglePin(idx),
                                                                    className: "text-primary hover:text-muted-foreground transition-colors flex-shrink-0",
                                                                    title: "Pinned — manually assigned, click to unpin",
                                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$pin$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Pin$3e$__["Pin"], {
                                                                        className: "h-3 w-3 fill-current"
                                                                    }, void 0, false, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 2276,
                                                                        columnNumber: 31
                                                                    }, this)
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2270,
                                                                    columnNumber: 29
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Badge"], {
                                                                    variant: "secondary",
                                                                    className: "text-xs bg-success/10 text-success border-success/20 max-w-[90px]",
                                                                    title: match.explanation,
                                                                    children: [
                                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$circle$2d$check$2d$big$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__CheckCircle$3e$__["CheckCircle"], {
                                                                            className: "h-3 w-3 mr-1 flex-shrink-0"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 2284,
                                                                            columnNumber: 29
                                                                        }, this),
                                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                            className: "truncate",
                                                                            children: match.matched_keyword
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 2285,
                                                                            columnNumber: 29
                                                                        }, this)
                                                                    ]
                                                                }, void 0, true, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2279,
                                                                    columnNumber: 27
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                    className: `text-xs font-medium ${isLowConfidence ? "text-amber-600 dark:text-amber-400" : "text-success"}`,
                                                                    title: match.explanation ?? (isLowConfidence ? "Low-confidence match" : undefined),
                                                                    children: [
                                                                        Math.round(match.confidence * 100),
                                                                        "%"
                                                                    ]
                                                                }, void 0, true, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2287,
                                                                    columnNumber: 27
                                                                }, this),
                                                                match.product_group && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Badge"], {
                                                                    variant: "outline",
                                                                    className: "text-[9px] h-4 px-1 border-chart-2/60 text-chart-2",
                                                                    children: match.product_group
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2298,
                                                                    columnNumber: 29
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                    variant: "ghost",
                                                                    size: "icon",
                                                                    className: "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity",
                                                                    onClick: ()=>handleOpenDialog(idx),
                                                                    disabled: availableSegments.length === 0,
                                                                    title: "Swap segment",
                                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$refresh$2d$cw$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__RefreshCw$3e$__["RefreshCw"], {
                                                                        className: "h-3 w-3"
                                                                    }, void 0, false, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 2310,
                                                                        columnNumber: 29
                                                                    }, this)
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2302,
                                                                    columnNumber: 27
                                                                }, this)
                                                            ]
                                                        }, void 0, true) : isAutoFilled ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                                            children: [
                                                                isPinned && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                                                    type: "button",
                                                                    onClick: ()=>handleTogglePin(idx),
                                                                    className: "text-primary hover:text-muted-foreground transition-colors flex-shrink-0",
                                                                    title: "Pinned — manually assigned, click to unpin",
                                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$pin$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Pin$3e$__["Pin"], {
                                                                        className: "h-3 w-3 fill-current"
                                                                    }, void 0, false, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 2322,
                                                                        columnNumber: 31
                                                                    }, this)
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2316,
                                                                    columnNumber: 29
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Badge"], {
                                                                    variant: "secondary",
                                                                    className: "text-xs border-primary/25 bg-primary/10 text-foreground max-w-[90px]",
                                                                    title: match.explanation,
                                                                    children: [
                                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$film$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Film$3e$__["Film"], {
                                                                            className: "h-3 w-3 mr-1 flex-shrink-0"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 2330,
                                                                            columnNumber: 29
                                                                        }, this),
                                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                            className: "truncate",
                                                                            children: match.segment_keywords[0] ?? "auto"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 2331,
                                                                            columnNumber: 29
                                                                        }, this)
                                                                    ]
                                                                }, void 0, true, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2325,
                                                                    columnNumber: 27
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                                    className: "text-xs text-primary font-medium cursor-help",
                                                                    title: match.explanation ?? "Auto-filled from the segment pool (no keyword match)",
                                                                    children: "auto"
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2333,
                                                                    columnNumber: 27
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                    variant: "ghost",
                                                                    size: "icon",
                                                                    className: "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity",
                                                                    onClick: ()=>handleOpenDialog(idx),
                                                                    disabled: availableSegments.length === 0,
                                                                    title: "Swap segment",
                                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$refresh$2d$cw$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__RefreshCw$3e$__["RefreshCw"], {
                                                                        className: "h-3 w-3"
                                                                    }, void 0, false, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 2347,
                                                                        columnNumber: 29
                                                                    }, this)
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2339,
                                                                    columnNumber: 27
                                                                }, this)
                                                            ]
                                                        }, void 0, true) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                                            children: [
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Badge"], {
                                                                    variant: "outline",
                                                                    className: "text-xs border-amber-400 text-amber-700 dark:text-amber-300",
                                                                    children: [
                                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$triangle$2d$alert$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__AlertTriangle$3e$__["AlertTriangle"], {
                                                                            className: "h-3 w-3 mr-1"
                                                                        }, void 0, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 2356,
                                                                            columnNumber: 29
                                                                        }, this),
                                                                        "Unmatched"
                                                                    ]
                                                                }, void 0, true, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2352,
                                                                    columnNumber: 27
                                                                }, this),
                                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                                    size: "sm",
                                                                    variant: "outline",
                                                                    className: "h-7 text-xs border-primary text-primary hover:bg-primary/10",
                                                                    onClick: ()=>handleOpenDialog(idx),
                                                                    disabled: availableSegments.length === 0,
                                                                    children: "Select Segment"
                                                                }, void 0, false, {
                                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                                    lineNumber: 2359,
                                                                    columnNumber: 27
                                                                }, this)
                                                            ]
                                                        }, void 0, true)
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2266,
                                                        columnNumber: 21
                                                    }, this)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 2217,
                                                columnNumber: 19
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 2167,
                                        columnNumber: 17
                                    }, this),
                                    slidesAfter.map((slide)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "group flex items-center gap-3 px-3 py-2.5 border-l-4 border-l-primary bg-primary/10",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: "flex-shrink-0 w-10 h-10 rounded overflow-hidden border bg-muted flex items-center justify-center",
                                                    children: slide.imageUrl ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("img", {
                                                        src: slide.imageUrl,
                                                        alt: "",
                                                        className: "w-full h-full object-cover",
                                                        onError: (e)=>{
                                                            e.target.style.display = "none";
                                                        }
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2381,
                                                        columnNumber: 25
                                                    }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$image$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__ImageIcon$3e$__["ImageIcon"], {
                                                        className: "h-4 w-4 text-muted-foreground"
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2383,
                                                        columnNumber: 25
                                                    }, this)
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2379,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: "flex-1 min-w-0 text-sm text-foreground",
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                            className: "font-medium",
                                                            children: "Image Slide"
                                                        }, void 0, false, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2387,
                                                            columnNumber: 23
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                            className: "text-xs text-muted-foreground",
                                                            children: [
                                                                slide.duration.toFixed(1),
                                                                "s · ",
                                                                slide.animation === "kenburns" ? `Ken Burns (${slide.kenBurnsDirection ?? "zoom-in"})` : "Static"
                                                            ]
                                                        }, void 0, true, {
                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                            lineNumber: 2388,
                                                            columnNumber: 23
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2386,
                                                    columnNumber: 21
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                    variant: "ghost",
                                                    size: "icon",
                                                    className: "h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 transition-opacity",
                                                    onClick: ()=>handleRemoveSlide(slide.id),
                                                    title: "Remove slide",
                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$trash$2d$2$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Trash2$3e$__["Trash2"], {
                                                        className: "h-3 w-3"
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2397,
                                                        columnNumber: 23
                                                    }, this)
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2390,
                                                    columnNumber: 21
                                                }, this)
                                            ]
                                        }, `list-slide-${slide.id}`, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2375,
                                            columnNumber: 19
                                        }, this)),
                                    onInterstitialSlidesChange && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex items-center px-3 py-1 bg-muted/20",
                                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                            onClick: ()=>handleInsertSlide(idx),
                                            className: "flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$plus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Plus$3e$__["Plus"], {
                                                    className: "h-3 w-3"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2408,
                                                    columnNumber: 23
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    children: "Insert slide after"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2409,
                                                    columnNumber: 23
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2404,
                                            columnNumber: 21
                                        }, this)
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 2403,
                                        columnNumber: 19
                                    }, this)
                                ]
                            }, idx, true, {
                                fileName: "[project]/src/components/timeline-editor.tsx",
                                lineNumber: 2166,
                                columnNumber: 17
                            }, this);
                        })
                    ]
                }, void 0, true, {
                    fileName: "[project]/src/components/timeline-editor.tsx",
                    lineNumber: 2094,
                    columnNumber: 11
                }, this)
            }, void 0, false, {
                fileName: "[project]/src/components/timeline-editor.tsx",
                lineNumber: 2093,
                columnNumber: 9
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Dialog"], {
                open: assigningIndex !== null,
                onOpenChange: (open)=>{
                    if (!open) handleCloseDialog();
                },
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DialogContent"], {
                    className: "max-w-lg",
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DialogHeader"], {
                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DialogTitle"], {
                                children: dialogTitle
                            }, void 0, false, {
                                fileName: "[project]/src/components/timeline-editor.tsx",
                                lineNumber: 2429,
                                columnNumber: 13
                            }, this)
                        }, void 0, false, {
                            fileName: "[project]/src/components/timeline-editor.tsx",
                            lineNumber: 2428,
                            columnNumber: 11
                        }, this),
                        assigningIndex !== null && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: "space-y-3",
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "rounded-md bg-muted/50 px-3 py-2 text-sm",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "text-muted-foreground text-xs font-medium uppercase tracking-wide",
                                            children: dialogSubLabel
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2436,
                                            columnNumber: 17
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                            className: "mt-0.5 font-medium",
                                            children: [
                                                "“",
                                                matches[assigningIndex]?.srt_text,
                                                "”"
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2439,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 2435,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                    variant: "outline",
                                    size: "sm",
                                    className: "w-full gap-1.5 border-primary/40 text-primary hover:bg-primary/10",
                                    onClick: ()=>{
                                        setAiGenPrompt(matches[assigningIndex]?.srt_text ?? "");
                                        setAiGenOpen(true);
                                    },
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$sparkles$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Sparkles$3e$__["Sparkles"], {
                                            className: "h-3.5 w-3.5"
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2454,
                                            columnNumber: 17
                                        }, this),
                                        "Generate with AI"
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 2445,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "relative",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$search$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Search$3e$__["Search"], {
                                            className: "absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2460,
                                            columnNumber: 17
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$input$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Input"], {
                                            placeholder: "Search segments by keyword...",
                                            value: searchQuery,
                                            onChange: (e)=>setSearchQuery(e.target.value),
                                            className: "pl-9",
                                            autoFocus: true
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2461,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 2459,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: "flex items-center justify-between",
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "flex gap-1",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                    variant: sourceFilter === "all" ? "default" : "outline",
                                                    size: "sm",
                                                    className: "h-7 text-xs",
                                                    onClick: ()=>setSourceFilter("all"),
                                                    children: "All sources"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2473,
                                                    columnNumber: 19
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$button$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Button"], {
                                                    variant: sourceFilter === "same" ? "default" : "outline",
                                                    size: "sm",
                                                    className: "h-7 text-xs",
                                                    onClick: ()=>setSourceFilter("same"),
                                                    children: "Same source"
                                                }, void 0, false, {
                                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                                    lineNumber: 2481,
                                                    columnNumber: 19
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2472,
                                            columnNumber: 17
                                        }, this),
                                        proximityExcludedCount > 0 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: "text-xs text-muted-foreground",
                                            children: [
                                                proximityExcludedCount,
                                                " nearby excluded"
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2491,
                                            columnNumber: 19
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 2471,
                                    columnNumber: 15
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$scroll$2d$area$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ScrollArea"], {
                                    className: "max-h-[300px] rounded-md border",
                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "divide-y",
                                        children: filteredSegments.length === 0 ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: "flex items-center justify-center py-6 text-sm text-muted-foreground",
                                            children: availableSegments.length === 0 ? "No segments available for selected sources." : "No segments match your search."
                                        }, void 0, false, {
                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                            lineNumber: 2501,
                                            columnNumber: 21
                                        }, this) : filteredSegments.map((seg)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                                className: "w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors",
                                                onClick: ()=>handleSelectSegment(seg),
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$film$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$export__default__as__Film$3e$__["Film"], {
                                                        className: "h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0"
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2513,
                                                        columnNumber: 25
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                        className: "flex-1 min-w-0",
                                                        children: [
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                                className: "flex flex-wrap gap-1",
                                                                children: [
                                                                    seg.keywords.slice(0, 5).map((kw)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Badge"], {
                                                                            variant: "secondary",
                                                                            className: "text-xs",
                                                                            children: kw
                                                                        }, kw, false, {
                                                                            fileName: "[project]/src/components/timeline-editor.tsx",
                                                                            lineNumber: 2517,
                                                                            columnNumber: 31
                                                                        }, this)),
                                                                    seg.keywords.length > 5 && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$ui$2f$badge$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Badge"], {
                                                                        variant: "outline",
                                                                        className: "text-xs",
                                                                        children: [
                                                                            "+",
                                                                            seg.keywords.length - 5
                                                                        ]
                                                                    }, void 0, true, {
                                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                                        lineNumber: 2526,
                                                                        columnNumber: 31
                                                                    }, this)
                                                                ]
                                                            }, void 0, true, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2515,
                                                                columnNumber: 27
                                                            }, this),
                                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                                                className: "text-xs text-muted-foreground mt-0.5",
                                                                children: seg.duration > 0 ? `Duration: ${seg.duration.toFixed(1)}s` : ""
                                                            }, void 0, false, {
                                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                                lineNumber: 2531,
                                                                columnNumber: 27
                                                            }, this)
                                                        ]
                                                    }, void 0, true, {
                                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                                        lineNumber: 2514,
                                                        columnNumber: 25
                                                    }, this)
                                                ]
                                            }, seg.id, true, {
                                                fileName: "[project]/src/components/timeline-editor.tsx",
                                                lineNumber: 2508,
                                                columnNumber: 23
                                            }, this))
                                    }, void 0, false, {
                                        fileName: "[project]/src/components/timeline-editor.tsx",
                                        lineNumber: 2499,
                                        columnNumber: 17
                                    }, this)
                                }, void 0, false, {
                                    fileName: "[project]/src/components/timeline-editor.tsx",
                                    lineNumber: 2498,
                                    columnNumber: 15
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/src/components/timeline-editor.tsx",
                            lineNumber: 2433,
                            columnNumber: 13
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/src/components/timeline-editor.tsx",
                    lineNumber: 2427,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/src/components/timeline-editor.tsx",
                lineNumber: 2421,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$dialogs$2f$generate$2d$ai$2d$segment$2d$dialog$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["GenerateAiSegmentDialog"], {
                open: aiGenOpen,
                onOpenChange: setAiGenOpen,
                initialPrompt: aiGenPrompt,
                onGenerated: (seg)=>handleSelectSegment(seg)
            }, void 0, false, {
                fileName: "[project]/src/components/timeline-editor.tsx",
                lineNumber: 2548,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true);
}
_s(TimelineEditor, "mvEulFxPsWX12iN3klK00ZRoQBc=");
_c = TimelineEditor;
var _c;
__turbopack_context__.k.register(_c, "TimelineEditor");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=src_components_timeline-editor_tsx_350b6038._.js.map