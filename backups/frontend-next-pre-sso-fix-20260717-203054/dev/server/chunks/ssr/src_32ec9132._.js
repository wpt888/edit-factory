module.exports = [
"[project]/src/hooks/use-local-storage-config.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useConfigPersistence",
    ()=>useConfigPersistence,
    "useLocalStorageConfig",
    ()=>useLocalStorageConfig
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
"use client";
;
function useLocalStorageConfig(key, defaultValue) {
    // Lazy initialization: read from localStorage on first render to avoid
    // hydration mismatches and set-state-in-effect lint errors
    const [value, setValue] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(()=>{
        if ("TURBOPACK compile-time truthy", 1) return defaultValue;
        //TURBOPACK unreachable
        ;
    });
    const [hydrated] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(()=>("TURBOPACK compile-time value", "undefined") !== "undefined");
    // Memoize defaultValue to keep a stable reference
    const defaultValueJson = JSON.stringify(defaultValue);
    const stableDefault = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useMemo"])(()=>defaultValue, [
        defaultValueJson
    ]); // eslint-disable-line react-hooks/exhaustive-deps
    // Reinitialize state when the key parameter changes
    const prevKeyRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(key);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (prevKeyRef.current === key) return;
        prevKeyRef.current = key;
        if ("TURBOPACK compile-time truthy", 1) {
            setValue(stableDefault);
            return;
        }
        //TURBOPACK unreachable
        ;
    }, [
        key,
        stableDefault
    ]);
    // Sync to localStorage when value changes (only after hydration to avoid
    // overwriting stored values with defaults on first render)
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (!hydrated) return;
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            // Show specific message for storage quota errors (Bug #115)
            if (error instanceof DOMException && error.name === "QuotaExceededError") {
                console.warn("localStorage quota exceeded for key:", key);
            } else {
                console.warn("Failed to persist setting to localStorage:", error);
            }
        }
    }, [
        key,
        value,
        hydrated
    ]);
    // Wrapped setValue that handles function updates
    const setStoredValue = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((newValue)=>{
        setValue((prev)=>{
            const resolved = typeof newValue === "function" ? newValue(prev) : newValue;
            return resolved;
        });
    }, []);
    return [
        value,
        setStoredValue
    ];
}
function useConfigPersistence(key, defaultConfig) {
    const [config, setConfig] = useLocalStorageConfig(key, defaultConfig);
    const updateConfig = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((partial)=>{
        setConfig((prev)=>({
                ...prev,
                ...partial
            }));
    }, [
        setConfig
    ]);
    const resetConfig = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        setConfig(defaultConfig);
    }, [
        setConfig,
        defaultConfig
    ]);
    return {
        config,
        setConfig,
        updateConfig,
        resetConfig
    };
}
}),
"[project]/src/hooks/use-subtitle-settings.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useSubtitleSettings",
    ()=>useSubtitleSettings
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$types$2f$video$2d$processing$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/types/video-processing.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/src/lib/api.ts [app-ssr] (ecmascript) <locals>");
"use client";
;
;
;
const STORAGE_KEY_PREFIX = "editai_subtitle_";
function useSubtitleSettings(storageKey) {
    const fullKey = storageKey ? `${STORAGE_KEY_PREFIX}${storageKey}` : null;
    // Lazy initialization: read from localStorage on first render to avoid
    // hydration mismatches and set-state-in-effect lint errors
    const [settings, setSettings] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(()=>{
        if ("TURBOPACK compile-time truthy", 1) return {
            ...__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$types$2f$video$2d$processing$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["DEFAULT_SUBTITLE_SETTINGS"]
        };
        //TURBOPACK unreachable
        ;
    });
    // Reload settings from localStorage when fullKey changes
    const prevFullKeyRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(fullKey);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (prevFullKeyRef.current === fullKey) return;
        prevFullKeyRef.current = fullKey;
        if ("TURBOPACK compile-time truthy", 1) {
            setSettings({
                ...__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$types$2f$video$2d$processing$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["DEFAULT_SUBTITLE_SETTINGS"]
            });
            return;
        }
        //TURBOPACK unreachable
        ;
    }, [
        fullKey
    ]);
    // Persist to localStorage when settings change
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if ("TURBOPACK compile-time truthy", 1) return;
        //TURBOPACK unreachable
        ;
    }, [
        settings,
        fullKey
    ]);
    const updateSettings = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((partial)=>{
        setSettings((prev)=>({
                ...prev,
                ...partial
            }));
    }, []);
    const resetSettings = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        setSettings({
            ...__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$types$2f$video$2d$processing$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["DEFAULT_SUBTITLE_SETTINGS"]
        });
    }, []);
    // Individual setters for convenience
    const setFontSize = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((fontSize)=>{
        updateSettings({
            fontSize: Math.max(12, Math.min(72, fontSize))
        });
    }, [
        updateSettings
    ]);
    const setFontFamily = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((fontFamily)=>{
        updateSettings({
            fontFamily
        });
    }, [
        updateSettings
    ]);
    const setTextColor = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((textColor)=>{
        updateSettings({
            textColor
        });
    }, [
        updateSettings
    ]);
    const setOutlineColor = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((outlineColor)=>{
        updateSettings({
            outlineColor
        });
    }, [
        updateSettings
    ]);
    const setOutlineWidth = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((outlineWidth)=>{
        updateSettings({
            outlineWidth: Math.max(0, Math.min(10, outlineWidth))
        });
    }, [
        updateSettings
    ]);
    const setPositionY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((positionY)=>{
        updateSettings({
            positionY: Math.max(5, Math.min(95, positionY))
        });
    }, [
        updateSettings
    ]);
    return {
        settings,
        setSettings,
        updateSettings,
        resetSettings,
        // Individual setters
        setFontSize,
        setFontFamily,
        setTextColor,
        setOutlineColor,
        setOutlineWidth,
        setPositionY
    };
}
}),
"[project]/src/hooks/use-job-polling.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "extractProgress",
    ()=>extractProgress,
    "formatElapsedTime",
    ()=>formatElapsedTime,
    "useJobPolling",
    ()=>useJobPolling
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
"use client";
;
function extractProgress(job) {
    const raw = job.progress;
    // Handle numeric progress directly (Bug #110)
    if (typeof raw === "number") {
        return Math.max(0, Math.min(100, Math.round(raw)));
    }
    if (!raw) {
        if (job.status === "processing") return 10;
        if (job.status === "completed") return 100;
        return 0;
    }
    // Try numeric string first
    const num = parseInt(raw);
    if (!isNaN(num) && num >= 0 && num <= 100) return num;
    // Try fraction pattern "2/5"
    const fractionMatch = raw.match(/(\d+)\s*\/\s*(\d+)/);
    if (fractionMatch) {
        const [, done, total] = fractionMatch;
        if (parseInt(total) === 0) return 0;
        return Math.round(parseInt(done) / parseInt(total) * 100);
    }
    // Try percentage pattern "50%"
    const pctMatch = raw.match(/(\d+)%/);
    if (pctMatch) return parseInt(pctMatch[1]);
    // Status-based fallback
    if (job.status === "processing") return 10;
    if (job.status === "completed") return 100;
    return 0;
}
function useJobPolling(options) {
    const { interval = 2000, onProgress, onComplete, onError } = options;
    const [isPolling, setIsPolling] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [currentJob, setCurrentJob] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    const [progress, setProgress] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(0);
    const [statusText, setStatusText] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("");
    const [elapsedTime, setElapsedTime] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(0);
    const [estimatedRemaining, setEstimatedRemaining] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])("");
    const eventSourceRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const pollingRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const startTimeRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const elapsedIntervalRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const isCancelledRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(false);
    const sseReconnectCountRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(0);
    const MAX_SSE_RECONNECTS = 20;
    // Use refs for callbacks to avoid stale closures
    const onProgressRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onProgress);
    const onCompleteRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onComplete);
    const onErrorRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onError);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onProgressRef.current = onProgress;
    }, [
        onProgress
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onCompleteRef.current = onComplete;
    }, [
        onComplete
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        onErrorRef.current = onError;
    }, [
        onError
    ]);
    // Calculate ETA based on progress and elapsed time
    const calculateETA = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((currentProgress, elapsed)=>{
        // Guard against near-zero division (Bug #113)
        if (currentProgress <= 15 || elapsed < 5) {
            return "Calculating...";
        }
        const progressDone = currentProgress - 10; // Subtract initial 10%
        const timePerPercent = elapsed / progressDone;
        const remainingProgress = 100 - currentProgress;
        const estimatedSeconds = Math.round(timePerPercent * remainingProgress);
        if (estimatedSeconds < 60) {
            return `~${estimatedSeconds}s`;
        }
        const minutes = Math.floor(estimatedSeconds / 60);
        const seconds = estimatedSeconds % 60;
        return `~${minutes}m ${seconds}s`;
    }, []);
    // Cleanup SSE connection and timers
    const cleanup = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        isCancelledRef.current = true;
        setIsPolling(false);
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (pollingRef.current) {
            clearTimeout(pollingRef.current);
            pollingRef.current = null;
        }
        if (elapsedIntervalRef.current) {
            clearInterval(elapsedIntervalRef.current);
            elapsedIntervalRef.current = null;
        }
    }, []);
    // Exported stopPolling calls cleanup internally
    const stopPolling = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        cleanup();
    }, [
        cleanup
    ]);
    // ─── Polling fallback (for SSR / browsers without EventSource) ───────────
    const pollFallbackRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(()=>{});
    const pollFallback = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(async (jobId)=>{
        if (isCancelledRef.current) return;
        try {
            // Dynamic import to avoid issues during SSR
            // apiFetch already throws ApiError on non-2xx (Bug #68)
            const { apiFetch } = await __turbopack_context__.A("[project]/src/lib/api.ts [app-ssr] (ecmascript, async loader)");
            const response = await apiFetch(`/jobs/${jobId}`);
            if (isCancelledRef.current) return;
            const job = await response.json();
            setCurrentJob(job);
            const progressNum = extractProgress(job);
            setProgress(progressNum);
            setStatusText(job.status);
            const elapsed = startTimeRef.current ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0;
            setEstimatedRemaining(calculateETA(progressNum, elapsed));
            onProgressRef.current?.(progressNum, job.status, job);
            if (job.status === "completed") {
                setProgress(100);
                onCompleteRef.current?.(job.result);
                cleanup();
            } else if (job.status === "failed") {
                onErrorRef.current?.(job.error || "Job failed");
                cleanup();
            } else if (job.status === "processing" || job.status === "pending") {
                pollingRef.current = setTimeout(()=>pollFallback(jobId), interval);
            }
        } catch (error) {
            console.warn("Job poll error, retrying:", error);
            if (!isCancelledRef.current) {
                pollingRef.current = setTimeout(()=>pollFallback(jobId), interval * 2);
            }
        }
    }, [
        interval,
        calculateETA,
        cleanup
    ]);
    pollFallbackRef.current = pollFallback;
    // ─── SSE implementation ───────────────────────────────────────────────────
    const startSSE = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((jobId)=>{
        const apiBase = (("TURBOPACK compile-time value", "http://localhost:8000/api/v1") || "http://localhost:8000/api/v1").replace(/\/+$/, "");
        const url = `${apiBase}/jobs/${jobId}/stream`;
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;
        eventSource.addEventListener("progress", (e)=>{
            if (isCancelledRef.current) return;
            sseReconnectCountRef.current = 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let data;
            try {
                data = JSON.parse(e.data);
            } catch (parseErr) {
                console.warn("[useJobPolling] Failed to parse SSE progress data:", parseErr);
                return;
            }
            const job = {
                job_id: data.job_id,
                status: data.status,
                progress: data.progress,
                error: data.error,
                result: data.result
            };
            setCurrentJob(job);
            const progressNum = extractProgress(job);
            setProgress(progressNum);
            setStatusText(data.status);
            const elapsed = startTimeRef.current ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0;
            setEstimatedRemaining(calculateETA(progressNum, elapsed));
            onProgressRef.current?.(progressNum, data.status, job);
        });
        eventSource.addEventListener("completed", (e)=>{
            if (isCancelledRef.current) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let data;
            try {
                data = JSON.parse(e.data);
            } catch (parseErr) {
                console.warn("[useJobPolling] Failed to parse SSE completed data:", parseErr);
                return;
            }
            setProgress(100);
            setStatusText("completed");
            onCompleteRef.current?.(data.result);
            cleanup();
        });
        eventSource.addEventListener("failed", (e)=>{
            if (isCancelledRef.current) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let data;
            try {
                data = JSON.parse(e.data);
            } catch (parseErr) {
                console.warn("[useJobPolling] Failed to parse SSE failed data:", parseErr);
                return;
            }
            onErrorRef.current?.(data.error || "Job failed");
            cleanup();
        });
        // heartbeat events are intentionally ignored — they just keep the connection alive
        eventSource.onerror = ()=>{
            if (isCancelledRef.current) return; // Component unmounted — do not reconnect or poll
            sseReconnectCountRef.current++;
            if (sseReconnectCountRef.current > MAX_SSE_RECONNECTS) {
                console.error("[useJobPolling] SSE max reconnects reached, falling back to polling");
                if (elapsedIntervalRef.current) {
                    clearInterval(elapsedIntervalRef.current);
                    elapsedIntervalRef.current = null;
                }
                eventSourceRef.current?.close();
                eventSourceRef.current = null;
                if (!isCancelledRef.current) pollFallbackRef.current(jobId);
                return;
            }
            console.warn(`[useJobPolling] SSE reconnect attempt ${sseReconnectCountRef.current}/${MAX_SSE_RECONNECTS}`);
        };
    }, [
        calculateETA,
        cleanup
    ]);
    // ─── Start (SSE preferred, polling fallback) ─────────────────────────────
    const startPolling = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])((jobId)=>{
        // Reset state from any previous session
        isCancelledRef.current = false;
        setCurrentJob(null);
        setIsPolling(true);
        setProgress(10);
        setStatusText("pending");
        setElapsedTime(0);
        setEstimatedRemaining("Calculating...");
        startTimeRef.current = Date.now();
        // Clear any existing elapsed timer before creating new one
        if (elapsedIntervalRef.current) {
            clearInterval(elapsedIntervalRef.current);
            elapsedIntervalRef.current = null;
        }
        // Elapsed time counter (kept running throughout job)
        elapsedIntervalRef.current = setInterval(()=>{
            if (startTimeRef.current) {
                setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
            }
        }, 1000);
        if (typeof EventSource !== "undefined") {
            // SSE path — primary implementation
            startSSE(jobId);
        } else {
            // Fallback path for SSR or very old browsers
            console.warn("[useJobPolling] EventSource not available, falling back to polling");
            pollFallback(jobId);
        }
    }, [
        startSSE,
        pollFallback
    ]);
    // Cleanup on unmount
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        return ()=>{
            cleanup();
        };
    }, [
        cleanup
    ]);
    return {
        startPolling,
        stopPolling,
        isPolling,
        currentJob,
        progress,
        statusText,
        elapsedTime,
        estimatedRemaining
    };
}
function formatElapsedTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}
}),
"[project]/src/hooks/use-polling.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "usePolling",
    ()=>usePolling
]);
// NOTE: For job-specific polling, prefer useJobPolling which uses SSE.
// This hook is for generic endpoints (e.g., assembly status, product status)
// that do not yet have SSE streaming counterparts.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/src/lib/api.ts [app-ssr] (ecmascript) <locals>");
"use client";
;
;
function usePolling(options) {
    const { endpoint, interval = 3000, enabled = false, onData, onError, shouldStop } = options;
    const [data, setData] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    const [isPolling, setIsPolling] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(false);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useState"])(null);
    const intervalRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(null);
    const isCancelledRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(false);
    const currentIntervalRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(interval);
    const generationRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(0); // Prevents duplicate poll chains
    // Refs for callbacks to avoid stale closures in the poll loop
    const onDataRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onData);
    onDataRef.current = onData;
    const onErrorRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(onError);
    onErrorRef.current = onError;
    const shouldStopRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useRef"])(shouldStop);
    shouldStopRef.current = shouldStop;
    const clearPolling = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        if (intervalRef.current) {
            clearTimeout(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);
    const stopPolling = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        isCancelledRef.current = true;
        clearPolling();
        setIsPolling(false);
    }, [
        clearPolling
    ]);
    const startPolling = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useCallback"])(()=>{
        // Always reset cancelled flag unconditionally so polling can restart
        // even if stopPolling was called before (FE-03)
        isCancelledRef.current = false;
        clearPolling();
        currentIntervalRef.current = interval;
        setIsPolling(true);
        setError(null);
        // Increment generation to invalidate any in-flight poll from a previous chain
        const thisGeneration = ++generationRef.current;
        const poll = async ()=>{
            if (isCancelledRef.current || generationRef.current !== thisGeneration) return;
            try {
                const response = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__["apiGet"])(endpoint);
                if (isCancelledRef.current || generationRef.current !== thisGeneration) return;
                const result = await response.json();
                setData(result);
                setError(null);
                // Reset interval on success
                currentIntervalRef.current = interval;
                onDataRef.current?.(result);
                if (shouldStopRef.current?.(result)) {
                    stopPolling();
                    return;
                }
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                setError(error);
                onErrorRef.current?.(error);
                // Double interval on error (exponential backoff, max 30s)
                currentIntervalRef.current = Math.min(currentIntervalRef.current * 2, 30000);
            }
            // Schedule next poll after current one completes (avoids double-poll)
            if (!isCancelledRef.current && generationRef.current === thisGeneration) {
                intervalRef.current = setTimeout(poll, currentIntervalRef.current);
            }
        };
        // Run immediately, then schedule next after completion
        poll();
    }, [
        endpoint,
        interval,
        stopPolling,
        clearPolling
    ]);
    // Auto-start when enabled becomes true or endpoint changes
    // startPolling internally calls clearPolling, so old polls are cleaned up (Bug #114)
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        if (enabled) {
            startPolling();
        } else {
            stopPolling();
        }
        return ()=>{
            isCancelledRef.current = true;
            clearPolling();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        enabled,
        endpoint,
        interval
    ]);
    // Cleanup on unmount
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        return ()=>{
            isCancelledRef.current = true;
            clearPolling();
        };
    }, [
        clearPolling
    ]);
    return {
        data,
        isPolling,
        error,
        startPolling,
        stopPolling
    };
}
}),
"[project]/src/hooks/index.ts [app-ssr] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
// Custom Hooks - Shared utilities
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$hooks$2f$use$2d$local$2d$storage$2d$config$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/hooks/use-local-storage-config.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$hooks$2f$use$2d$subtitle$2d$settings$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/hooks/use-subtitle-settings.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$hooks$2f$use$2d$job$2d$polling$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/hooks/use-job-polling.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$hooks$2f$use$2d$polling$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/hooks/use-polling.ts [app-ssr] (ecmascript)");
;
;
;
;
}),
"[project]/src/types/video-processing.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// Shared types for video processing across Home and Library pages
__turbopack_context__.s([
    "CAPTION_PRESETS",
    ()=>CAPTION_PRESETS,
    "COLOR_PRESETS",
    ()=>COLOR_PRESETS,
    "DEFAULT_SEGMENT_TRANSFORM",
    ()=>DEFAULT_SEGMENT_TRANSFORM,
    "DEFAULT_SUBTITLE_SETTINGS",
    ()=>DEFAULT_SUBTITLE_SETTINGS,
    "ELEVENLABS_MODELS",
    ()=>ELEVENLABS_MODELS,
    "FONT_OPTIONS",
    ()=>FONT_OPTIONS
]);
const DEFAULT_SUBTITLE_SETTINGS = {
    fontSize: 48,
    fontFamily: "Montserrat",
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 3,
    positionY: 85,
    position: "bottom",
    marginV: 30,
    // Phase 11 defaults
    shadowDepth: 0,
    shadowColor: "#000000",
    borderStyle: 1,
    enableGlow: false,
    glowBlur: 0,
    adaptiveSizing: false,
    opacity: 100
};
const FONT_OPTIONS = [
    {
        value: "var(--font-montserrat), Montserrat, sans-serif",
        label: "Montserrat"
    },
    {
        value: "var(--font-roboto), Roboto, sans-serif",
        label: "Roboto"
    },
    {
        value: "var(--font-oswald), Oswald, sans-serif",
        label: "Oswald"
    },
    {
        value: "var(--font-poppins), Poppins, sans-serif",
        label: "Poppins"
    },
    {
        value: "var(--font-bebas-neue), 'Bebas Neue', sans-serif",
        label: "Bebas Neue"
    },
    {
        value: "var(--font-anton), Anton, sans-serif",
        label: "Anton"
    },
    {
        value: "var(--font-rubik), Rubik, sans-serif",
        label: "Rubik"
    },
    {
        value: "var(--font-nunito), Nunito, sans-serif",
        label: "Nunito"
    },
    {
        value: "var(--font-lato), Lato, sans-serif",
        label: "Lato"
    },
    {
        value: "var(--font-inter), Inter, sans-serif",
        label: "Inter"
    }
];
const COLOR_PRESETS = [
    "#FFFFFF",
    "#000000",
    "#FF0000",
    "#00FF00",
    "#0000FF",
    "#FFFF00",
    "#FF00FF",
    "#00FFFF",
    "#FFA500",
    "#800080"
];
const DEFAULT_SEGMENT_TRANSFORM = {
    rotation: 0,
    scale: 1.0,
    pan_x: 0,
    pan_y: 0,
    flip_h: false,
    flip_v: false,
    opacity: 1.0
};
const CAPTION_PRESETS = [
    {
        id: "bold-white",
        name: "Bold White",
        description: "Large white text, thick black outline. Clean and readable.",
        settings: {
            fontSize: 52,
            fontFamily: "var(--font-montserrat), Montserrat, sans-serif",
            textColor: "#FFFFFF",
            outlineColor: "#000000",
            outlineWidth: 4,
            positionY: 85,
            position: "bottom",
            marginV: 30,
            shadowDepth: 0,
            shadowColor: "#000000",
            borderStyle: 1,
            enableGlow: false,
            glowBlur: 0,
            adaptiveSizing: false
        },
        previewStyle: {
            backgroundColor: "#1a1a2e",
            textSample: "Sample Text"
        }
    },
    {
        id: "neon-glow",
        name: "Neon Glow",
        description: "Cyan text with glow effect. Eye-catching for night/club content.",
        settings: {
            fontSize: 44,
            fontFamily: "var(--font-bebas-neue), 'Bebas Neue', sans-serif",
            textColor: "#00FFFF",
            outlineColor: "#0066FF",
            outlineWidth: 2,
            positionY: 80,
            position: "bottom",
            marginV: 30,
            shadowDepth: 0,
            shadowColor: "#000000",
            borderStyle: 1,
            enableGlow: true,
            glowBlur: 6,
            adaptiveSizing: false
        },
        previewStyle: {
            backgroundColor: "#0a0a1a",
            textSample: "Sample Text"
        }
    },
    {
        id: "minimal",
        name: "Minimal",
        description: "Small, subtle white text. Unobtrusive, video stays the focus.",
        settings: {
            fontSize: 36,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            textColor: "#FFFFFF",
            outlineColor: "#000000",
            outlineWidth: 1,
            positionY: 90,
            position: "bottom",
            marginV: 30,
            shadowDepth: 0,
            shadowColor: "#000000",
            borderStyle: 1,
            enableGlow: false,
            glowBlur: 0,
            adaptiveSizing: false
        },
        previewStyle: {
            backgroundColor: "#2d2d3a",
            textSample: "Sample Text"
        }
    },
    {
        id: "karaoke",
        name: "Karaoke",
        description: "Words highlight in sync with the voice (white → yellow). Submagic/CapCut style.",
        settings: {
            fontSize: 48,
            fontFamily: "var(--font-anton), Anton, sans-serif",
            textColor: "#FFFFFF",
            outlineColor: "#000000",
            outlineWidth: 3,
            positionY: 88,
            position: "bottom",
            marginV: 30,
            shadowDepth: 2,
            shadowColor: "#000000",
            borderStyle: 1,
            enableGlow: false,
            glowBlur: 0,
            adaptiveSizing: false,
            karaoke: true,
            highlightColor: "#FFFF00"
        },
        previewStyle: {
            backgroundColor: "#1a0a2e",
            textSample: "Sample Text"
        }
    },
    {
        id: "shadow-pop",
        name: "Shadow Pop",
        description: "White text with heavy drop shadow. Works on any background.",
        settings: {
            fontSize: 46,
            fontFamily: "var(--font-poppins), Poppins, sans-serif",
            textColor: "#FFFFFF",
            outlineColor: "#333333",
            outlineWidth: 2,
            positionY: 82,
            position: "bottom",
            marginV: 30,
            shadowDepth: 4,
            shadowColor: "#000000",
            borderStyle: 1,
            enableGlow: false,
            glowBlur: 0,
            adaptiveSizing: false
        },
        previewStyle: {
            backgroundColor: "#1e1e2e",
            textSample: "Sample Text"
        }
    },
    {
        id: "warm-retro",
        name: "Warm Retro",
        description: "Warm cream text with orange outline, slight glow. Vintage feel.",
        settings: {
            fontSize: 44,
            fontFamily: "var(--font-oswald), Oswald, sans-serif",
            textColor: "#FFF5E1",
            outlineColor: "#CC6600",
            outlineWidth: 2,
            positionY: 85,
            position: "bottom",
            marginV: 30,
            shadowDepth: 0,
            shadowColor: "#000000",
            borderStyle: 1,
            enableGlow: true,
            glowBlur: 3,
            adaptiveSizing: false
        },
        previewStyle: {
            backgroundColor: "#2e1a0a",
            textSample: "Sample Text"
        }
    }
];
const ELEVENLABS_MODELS = [
    {
        id: "eleven_flash_v2_5",
        name: "Flash v2.5",
        description: "Fastest, lowest cost, 32 languages",
        costPer1kChars: 0.11,
        latencyMs: 75
    },
    {
        id: "eleven_turbo_v2_5",
        name: "Turbo v2.5",
        description: "Fast with higher quality, 32 languages",
        costPer1kChars: 0.11,
        latencyMs: 135
    },
    {
        id: "eleven_multilingual_v2",
        name: "Multilingual v2",
        description: "Highest quality, 29 languages",
        costPer1kChars: 0.22,
        latencyMs: 275
    }
];
}),
"[project]/src/lib/api-fallback.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "checkFallbacks",
    ()=>checkFallbacks,
    "resetFallbackToasts",
    ()=>resetFallbackToasts
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$sonner$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/sonner/dist/index.mjs [app-ssr] (ecmascript)");
;
/**
 * Check an API response for fallback indicators and show info toasts.
 * Call this after any TTS or video processing API response.
 * Uses a dedup mechanism so the same fallback toast is only shown once per session.
 */ const _shownFallbacks = new Set();
function checkFallbacks(data) {
    if (data.tts_fallback === "edge_tts" && !_shownFallbacks.has("tts")) {
        _shownFallbacks.add("tts");
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$sonner$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["toast"].info("Using free Edge TTS", {
            description: data.tts_fallback_reason || "ElevenLabs API key not configured. Add one in Settings for premium voices.",
            duration: 6000
        });
    }
    if (data.analysis_fallback === "local_scoring" && !_shownFallbacks.has("analysis")) {
        _shownFallbacks.add("analysis");
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$sonner$2f$dist$2f$index$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["toast"].info("Using local video analysis", {
            description: data.analysis_fallback_reason || "Gemini API key not configured. Add one in Settings for AI-powered segment selection.",
            duration: 6000
        });
    }
}
function resetFallbackToasts() {
    _shownFallbacks.clear();
}
}),
"[project]/src/lib/platforms.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// Shared platform metadata used by Pipeline Step 4 (PublishDialog) and Settings
// (Connected Social Platforms panel). Keep this in one place so the two UIs
// don't drift — e.g. "instagram-standalone" must map to "Instagram" in both.
__turbopack_context__.s([
    "PLATFORM_CHAR_LIMITS",
    ()=>PLATFORM_CHAR_LIMITS,
    "PLATFORM_NAMES",
    ()=>PLATFORM_NAMES,
    "friendlyPlatformName",
    ()=>friendlyPlatformName
]);
const PLATFORM_CHAR_LIMITS = {
    x: 280,
    twitter: 280,
    bluesky: 300,
    threads: 500,
    instagram: 2200,
    "instagram-standalone": 2200,
    youtube: 5000,
    linkedin: 3000,
    "linkedin-page": 3000,
    facebook: 63206,
    tiktok: 150
};
const PLATFORM_NAMES = {
    x: "X",
    twitter: "X",
    bluesky: "Bluesky",
    threads: "Threads",
    instagram: "Instagram",
    "instagram-standalone": "Instagram",
    youtube: "YouTube",
    linkedin: "LinkedIn",
    "linkedin-page": "LinkedIn Page",
    facebook: "Facebook",
    tiktok: "TikTok"
};
function friendlyPlatformName(type) {
    return PLATFORM_NAMES[type?.toLowerCase?.() ?? ""] ?? type;
}
}),
];

//# sourceMappingURL=src_32ec9132._.js.map