/**
 * GenerateAiSegmentDialog (D2) — generate a video segment with AI on Blipost
 * platform credits, where no footage fits a phrase.
 *
 * Self-contained: fetches the credit balance (GET /platform/me), submits the job
 * (POST /platform/videos), polls (GET /platform/videos/{id}), and on "done" hands
 * back a full SegmentOption so the caller can drop it straight into the timeline.
 * Without a connected Blipost token the form is disabled with a hint — nothing
 * crashes. Money path is credits only (no BYOK here).
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { toast } from "sonner";
import { Sparkles, Loader2, Coins, AlertTriangle, XCircle } from "lucide-react";
import type { SegmentOption } from "@/components/timeline-editor";

// Rates from the platform contract (credits per second).
const MODELS = [
  { value: "wan-2.5", label: "Wan 2.5", rate: 7 },
  { value: "kling-2.5-turbo", label: "Kling 2.5 Turbo", rate: 9 },
];
const DURATIONS = [5, 10];

interface GeneratedPayload {
  status: string;
  segment_id?: string;
  source_video_id?: string;
  keywords?: string[];
  duration?: number;
  thumbnail_path?: string;
  error?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrompt: string;
  onGenerated: (segment: SegmentOption) => void;
}

type Phase = "idle" | "submitting" | "generating" | "failed";

export function GenerateAiSegmentDialog({ open, onOpenChange, initialPrompt, onGenerated }: Props) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [model, setModel] = useState("wan-2.5");
  const [durationSec, setDurationSec] = useState(5);
  const [connected, setConnected] = useState<boolean | null>(null); // null = still checking
  const [balance, setBalance] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [cost, setCost] = useState<number | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const estCost = (MODELS.find((m) => m.value === model)?.rate ?? 0) * durationSec;
  const busy = phase === "submitting" || phase === "generating";

  // Reset + fetch balance whenever the dialog opens.
  useEffect(() => {
    if (!open) {
      if (pollRef.current) clearTimeout(pollRef.current);
      return;
    }
    setPrompt(initialPrompt);
    setPhase("idle");
    setError("");
    setCost(null);
    setConnected(null);
    (async () => {
      try {
        const res = await apiGet("/platform/me");
        const data = await res.json();
        setConnected(!!data.connected && !data.error);
        setBalance(typeof data.balance === "number" ? data.balance : null);
      } catch {
        setConnected(false);
      }
    })();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [open, initialPrompt]);

  // Keywords for the generated segment come from the ORIGINAL phrase (not the
  // possibly-edited prompt), so a reused clip still matches that phrase.
  const keywordsFromPhrase = useCallback(
    () =>
      (initialPrompt || "")
        .split(/\s+/)
        .map((w) => w.replace(/[.,!?"'—-]/g, "").toLowerCase())
        .filter((w) => w.length > 3)
        .slice(0, 6),
    [initialPrompt],
  );

  const poll = useCallback(
    (jobId: string) => {
      const start = Date.now();
      const tick = async () => {
        if (Date.now() - start > 300000) {
          setPhase("failed");
          setError("Generation timed out. Credits are refunded automatically on the platform.");
          return;
        }
        try {
          const res = await apiGet(`/platform/videos/${jobId}`);
          const data: GeneratedPayload = await res.json();
          if (data.status === "done" && data.segment_id) {
            onGenerated({
              id: data.segment_id,
              source_video_id: data.source_video_id ?? "",
              keywords: data.keywords ?? [],
              duration: data.duration ?? 0,
              start_time: 0,
              end_time: data.duration ?? 0,
              thumbnail_path: data.thumbnail_path,
            });
            toast.success("AI clip added to the timeline");
            onOpenChange(false);
            return;
          }
          if (data.status === "failed") {
            setPhase("failed");
            setError(data.error || "Generation failed. Credits were refunded automatically.");
            return;
          }
        } catch {
          // Transient poll error — keep trying until the timeout above.
        }
        pollRef.current = setTimeout(tick, 3000);
      };
      pollRef.current = setTimeout(tick, 3000);
    },
    [onGenerated, onOpenChange],
  );

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setPhase("submitting");
    setError("");
    try {
      const res = await apiPost("/platform/videos", {
        prompt: prompt.trim(),
        model,
        duration_sec: durationSec,
        aspect_ratio: "9:16",
        keywords: keywordsFromPhrase(),
      });
      const data = await res.json();
      setCost(data.credit_cost ?? null);
      if (typeof data.remaining === "number") setBalance(data.remaining);
      setPhase("generating");
      poll(data.job_id);
    } catch (err) {
      setPhase("failed");
      setError(err instanceof ApiError ? err.message : "Could not start generation.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Generate segment with AI
          </DialogTitle>
        </DialogHeader>

        {connected === false ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <AlertTriangle className="h-8 w-8 text-yellow-500" />
            <p className="text-sm font-medium">Blipost account not connected</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Connect your Blipost account in Settings to generate AI video on platform credits.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Balance */}
            <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Coins className="h-4 w-4" /> Credit balance
              </span>
              <span className="font-semibold tabular-nums">
                {connected === null ? "…" : balance ?? "—"}
              </span>
            </div>

            {/* Prompt */}
            <div className="space-y-1.5">
              <Label className="text-xs">Prompt</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="Describe the clip to generate..."
                disabled={busy}
              />
            </div>

            {/* Model + duration */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Model</Label>
                <Select value={model} onValueChange={setModel} disabled={busy}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label} ({m.rate}/s)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Duration</Label>
                <Select value={String(durationSec)} onValueChange={(v) => setDurationSec(Number(v))} disabled={busy}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((d) => (
                      <SelectItem key={d} value={String(d)}>{d}s</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Cost line */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {cost != null ? "Charged" : "Estimated cost"}
              </span>
              <span className="font-semibold tabular-nums">
                {cost != null ? cost : `≈ ${estCost}`} credits
              </span>
            </div>

            {phase === "generating" && (
              <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Generating… this can take a minute.</span>
              </div>
            )}

            {phase === "failed" && error && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={busy || !prompt.trim() || connected === null}
            >
              {busy ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {phase === "submitting" ? "Submitting…" : "Generating…"}</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Generate ({estCost} credits)</>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
