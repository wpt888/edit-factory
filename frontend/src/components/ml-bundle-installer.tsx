"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Loader2, CheckCircle2, AlertTriangle, Download } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { API_URL } from "@/lib/api"

// TODO(phase-87): replace temporary status probe with /desktop/ml/check structured endpoint

type InstallState =
  | { kind: "idle" }
  | { kind: "downloading"; percent: number; downloaded: number; total: number }
  | { kind: "verifying" }
  | { kind: "unpacking" }
  | { kind: "installed"; version: string }
  | { kind: "error"; message: string; stage?: string }

export function MLBundleInstaller() {
  const [state, setState] = useState<InstallState>({ kind: "idle" })
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef<boolean>(false)

  // LD-23 status probe on mount (best-effort)
  // TODO(phase-87): replace temporary status probe with /desktop/ml/check structured endpoint
  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      try {
        const res = await fetch(`${API_URL}/desktop/ml/status`, { method: "GET" })
        if (!res.ok) return
        const body = await res.json()
        if (cancelled) return
        if (body?.installed) {
          setState({ kind: "installed", version: body.version || "0.1.0" })
        }
      } catch {
        // Silent failure — Phase 87 will provide the real probe. Falls back to idle.
      }
    }
    probe()
    return () => { cancelled = true }
  }, [])

  // LD-26 cleanup on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  const handleFrame = (frame: string) => {
    const lines = frame.split("\n")
    let evt = ""
    let data = ""
    for (const line of lines) {
      if (line.startsWith("event:")) evt = line.slice(6).trim()
      else if (line.startsWith("data:")) data = line.slice(5).trim()
    }
    if (!evt || !data) return
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(data) } catch { return }

    if (evt === "progress") {
      const stage = parsed.stage as string
      if (stage === "download") {
        setState({
          kind: "downloading",
          percent: Number(parsed.percent ?? 0),
          downloaded: Number(parsed.downloaded ?? 0),
          total: Number(parsed.total ?? 0),
        })
      } else if (stage === "verify") {
        setState({ kind: "verifying" })
      } else if (stage === "unpack") {
        setState({ kind: "unpacking" })
      }
    } else if (evt === "done") {
      const version = (parsed.version as string) || "0.1.0"
      setState({ kind: "installed", version })
      toast.success("Advanced voice features installed")
    } else if (evt === "error") {
      const message = (parsed.error as string) || "Install failed"
      const stage = parsed.stage as string | undefined
      setState({ kind: "error", message, stage })
      toast.error("Install failed", { description: message })
    }
  }

  const handleInstall = async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      // Auth header — mirrors api.ts pattern (lines 41-58)
      const headers: Record<string, string> = {}
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getSession()
        if (data.session?.access_token) {
          headers["Authorization"] = `Bearer ${data.session.access_token}`
        }
      } catch { /* unauthenticated dev mode is fine */ }
      const profileId = typeof window !== "undefined" ? localStorage.getItem("editai_current_profile_id") : null
      if (profileId) headers["X-Profile-Id"] = profileId

      abortRef.current = new AbortController()
      setState({ kind: "downloading", percent: 0, downloaded: 0, total: 0 })

      const response = await fetch(`${API_URL}/desktop/ml/download`, {
        method: "POST",
        headers,
        signal: abortRef.current.signal,
      })

      // LD-29: Handle non-2xx responses that are NOT SSE
      if (response.status === 409) {
        toast.error("Install already in progress")
        setState({ kind: "idle" })
        return
      }
      if (response.status === 400) {
        const body = await response.json().catch(() => ({}))
        const msg = (body as { detail?: string })?.detail || "Unsupported platform"
        toast.error(msg)
        setState({ kind: "error", message: msg })
        return
      }
      if (response.status >= 500) {
        setState({ kind: "error", message: "Server error — try again later" })
        return
      }
      if (!response.ok) {
        setState({ kind: "error", message: `Unexpected status: ${response.status}` })
        return
      }

      // SSE parsing via fetch + ReadableStream (LD-21 — raw fetch required for POST-based SSE)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            handleFrame(frame)
          }
        }
      } finally {
        try { reader.releaseLock() } catch { /* ignore */ }
      }
    } catch (err: unknown) {
      const aborted = (err as Error)?.name === "AbortError"
      if (!aborted) {
        const message = (err as Error)?.message || "Network error"
        setState({ kind: "error", message })
      }
    } finally {
      inFlightRef.current = false
    }
  }

  // LD-25: button disabled while not idle or error — prevents double-click
  const buttonDisabled = state.kind !== "idle" && state.kind !== "error"

  return (
    <Card data-testid="ml-bundle-installer">
      <CardHeader>
        <CardTitle>Install Advanced Voice Features</CardTitle>
        <CardDescription>
          Downloads a ~1.5 GB optional bundle (PyTorch + Whisper + Coqui XTTS) for voice mute, voice clone, and other Pro-tier features. Resumes automatically if interrupted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.kind === "idle" && (
          <Button onClick={handleInstall} disabled={buttonDisabled} data-testid="ml-install-button">
            <Download className="mr-2 h-4 w-4" />
            Install
          </Button>
        )}
        {state.kind === "downloading" && (
          <div className="space-y-2" data-testid="ml-installer-downloading">
            <Progress value={state.percent} className="h-2 w-full" />
            <p className="text-sm text-muted-foreground">
              Downloading ML bundle... ({state.percent}%
              {state.total > 0 && ` — ${(state.downloaded / 1024 / 1024).toFixed(1)} MB / ${(state.total / 1024 / 1024).toFixed(1)} MB`})
            </p>
            <Button disabled={buttonDisabled} variant="outline" size="sm" className="text-xs" onClick={() => { abortRef.current?.abort(); setState({ kind: "idle" }); inFlightRef.current = false }}>
              Cancel
            </Button>
          </div>
        )}
        {state.kind === "verifying" && (
          <div className="flex items-center gap-2" data-testid="ml-installer-verifying">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Verifying SHA256...</span>
          </div>
        )}
        {state.kind === "unpacking" && (
          <div className="flex items-center gap-2" data-testid="ml-installer-unpacking">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Installing files...</span>
          </div>
        )}
        {state.kind === "installed" && (
          <div className="flex items-center gap-2 text-success" data-testid="ml-installer-installed">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Installed (v{state.version})</span>
          </div>
        )}
        {state.kind === "error" && (
          <div className="space-y-3" data-testid="ml-installer-error">
            <div className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 mt-0.5" />
              <span className="text-sm">{state.message}</span>
            </div>
            <Button onClick={handleInstall} variant="outline" data-testid="ml-retry-button">
              Retry
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default MLBundleInstaller
