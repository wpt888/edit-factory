"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Save, Settings as SettingsIcon, Eye, EyeOff, BarChart3, Trash2, Star, RefreshCw, Plus, Key, Shield } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { apiGetWithRetry, apiPost, apiPatch, apiDelete, handleApiError } from "@/lib/api"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { useProfile } from "@/contexts/profile-context"
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog"
import { ApiKeyManager } from "@/components/api-key-manager"
import { friendlyPlatformName } from "@/lib/platforms"

interface Voice {
  voice_id: string
  name: string
  language?: string
  category?: string
}

interface TTSSettings {
  provider: string
  voice_id: string
  voice_name?: string
  postiz?: {
    api_url: string
    api_key: string
    enabled: boolean
  }
  buffer?: {
    api_key: string
    organization_id: string
  }
  // tts_settings carries fields this page does not render — voice tuning
  // sliders (Pipeline) and Telegram credentials. Preserve them on save via
  // spread merge; do NOT re-declare them here, they flow through unchanged.
  [key: string]: unknown
}

interface DashboardData {
  stats: {
    projects_count: number
    clips_count: number
    rendered_count: number
  }
  costs: {
    elevenlabs: number
    gemini: number
    total: number
    monthly: number
    monthly_quota: number | null
    quota_remaining: number | null
  }
}

interface ElevenLabsAccount {
  id: string
  label: string
  api_key_hint: string
  is_primary: boolean
  is_active: boolean
  is_env_default?: boolean
  sort_order: number
  character_limit: number | null
  characters_used: number | null
  tier: string | null
  last_error: string | null
  last_checked_at: string | null
}

export default function SettingsPage() {
  const { currentProfile, isLoading: profileLoading } = useProfile()

  const [provider, setProvider] = useState("elevenlabs")
  const [voiceId, setVoiceId] = useState("")
  const voiceIdRef = useRef(voiceId); // Bug #60: stable ref for async callbacks
  voiceIdRef.current = voiceId;
  const [voices, setVoices] = useState<Voice[]>([])
  const [, setLoadingVoices] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)

  // Postiz settings state
  const [postizUrl, setPostizUrl] = useState("")
  const [postizKey, setPostizKey] = useState("")
  const [postizEnabled, setPostizEnabled] = useState(false)
  const [postizCredentialsReady, setPostizCredentialsReady] = useState(false)
  // Tracks whether the *saved* profile has complete Postiz credentials on the server.
  // Integrations are fetched based on this (not the live form state), because
  // /postiz/integrations on the backend always uses the stored profile creds —
  // typing in the form does not change what the backend uses.
  const [postizSavedConfigured, setPostizSavedConfigured] = useState(false)
  // Snapshot of what the server actually has — used to detect an unsaved dirty form.
  const [savedPostizUrl, setSavedPostizUrl] = useState("")
  const [savedPostizKey, setSavedPostizKey] = useState("")

  // Connected social platforms panel — shows accounts from Postiz for the active profile
  interface PostizIntegration {
    id: string
    name: string
    type: string
    identifier?: string | null
    picture?: string | null
    disabled: boolean
  }
  const [integrations, setIntegrations] = useState<PostizIntegration[]>([])
  const [integrationsLoading, setIntegrationsLoading] = useState(false)
  const [integrationsError, setIntegrationsError] = useState<string | null>(null)
  const integrationsRequestSeq = useRef(0)

  // Connected Buffer channels panel — mirrors Postiz integrations card
  interface BufferChannel {
    id: string
    name: string
    service: string          // "tiktok" | "instagram" | "facebook" | "youtube" | "linkedin" | "twitter"
    type: string             // "account" | "page" | "business"
    avatar?: string | null
    is_disconnected?: boolean
  }
  const [bufferChannels, setBufferChannels] = useState<BufferChannel[]>([])
  const [bufferChannelsLoading, setBufferChannelsLoading] = useState(false)
  const [bufferChannelsError, setBufferChannelsError] = useState<string | null>(null)
  const bufferChannelsRequestSeq = useRef(0)

  // Buffer settings state
  const [bufferKey, setBufferKey] = useState("")
  const [bufferOrgId, setBufferOrgId] = useState("")
  const [savedBufferKey, setSavedBufferKey] = useState("")
  const [savedBufferOrgId, setSavedBufferOrgId] = useState("")
  const [bufferSavedConfigured, setBufferSavedConfigured] = useState(false)
  const [bufferTestingConnection, setBufferTestingConnection] = useState(false)
  const [bufferConnectionStatus, setBufferConnectionStatus] = useState<"idle" | "success" | "error">("idle")
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle")
  const [showPostizKey, setShowPostizKey] = useState(false)
  const [showBufferKey, setShowBufferKey] = useState(false)

  // Dashboard state
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(true)

  // Quota state
  const [monthlyQuota, setMonthlyQuota] = useState<string>("")

  // Template & Branding state
  const [templateName, setTemplateName] = useState<string>("product_spotlight")
  const [primaryColor, setPrimaryColor] = useState<string>("#FF0000")
  const [accentColor, setAccentColor] = useState<string>("#FFFF00")
  const [templateCta, setTemplateCta] = useState<string>("Comanda acum!")
  const [availableTemplates, setAvailableTemplates] = useState<{name: string, display_name: string}[]>([])

  // ElevenLabs accounts state
  const [elAccounts, setElAccounts] = useState<ElevenLabsAccount[]>([])
  const [elAccountsLoading, setElAccountsLoading] = useState(false)
  const [newAccountLabel, setNewAccountLabel] = useState("")
  const [newAccountKey, setNewAccountKey] = useState("")
  const [showNewAccountKey, setShowNewAccountKey] = useState(false)
  const [addingAccount, setAddingAccount] = useState(false)
  const [accountActionLoading, setAccountActionLoading] = useState<string | null>(null)
  const [visibleElSecrets, setVisibleElSecrets] = useState<Record<string, string>>({})
  const [elSecretLoading, setElSecretLoading] = useState<string | null>(null)

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    description: string
    confirmLabel: string
    variant: "destructive" | "default"
    onConfirm: () => void
    loading?: boolean
  }>({ open: false, title: "", description: "", confirmLabel: "", variant: "default", onConfirm: () => {} })

  // Desktop version state
  const [appVersion, setAppVersion] = useState<string | null>(null)

  // Crash reporting state
  const [crashReporting, setCrashReporting] = useState(false)
  const [crashReportingLoading, setCrashReportingLoading] = useState(false)

  // Load ElevenLabs accounts (subscription info auto-fetched by backend)
  const loadAccounts = useCallback(async () => {
    if (!currentProfile) return
    setElAccountsLoading(true)
    try {
      const response = await apiGetWithRetry("/elevenlabs-accounts/")
      const data = await response.json()
      setElAccounts(data.accounts || [])
      setVisibleElSecrets({})
    } catch (error) {
      handleApiError(error, "Error loading ElevenLabs accounts")
    } finally {
      setElAccountsLoading(false)
    }
  }, [currentProfile])

  // Load current profile TTS settings
  useEffect(() => {
    if (profileLoading || !currentProfile) return
    const controller = new AbortController()
    setPostizCredentialsReady(false)
    setPostizUrl("")
    setPostizKey("")
    setPostizEnabled(false)
    setPostizSavedConfigured(false)
    setSavedPostizUrl("")
    setSavedPostizKey("")
    setIntegrations([])
    setIntegrationsError(null)
    integrationsRequestSeq.current += 1
    setBufferChannels([])
    setBufferChannelsError(null)
    bufferChannelsRequestSeq.current += 1

    const loadSettings = async () => {
      try {
        const response = await apiGetWithRetry(`/profiles/${currentProfile.id}`, { signal: controller.signal })
        if (controller.signal.aborted) return

        const data = await response.json()
        const ttsSettings = data.tts_settings || {}

        setProvider("elevenlabs")
        if (ttsSettings.voice_id) {
          setVoiceId(ttsSettings.voice_id)
        }

        const postizSettings = ttsSettings.postiz || {}
        const loadedUrl = postizSettings.api_url || ""
        const loadedKey = postizSettings.api_key || ""
        setPostizUrl(loadedUrl)
        setPostizKey(loadedKey)
        setPostizEnabled(postizSettings.enabled || false)
        setPostizSavedConfigured(Boolean(loadedUrl && loadedKey))
        setSavedPostizUrl(loadedUrl)
        setSavedPostizKey(loadedKey)

        const bufferSettings = ttsSettings.buffer || {}
        const loadedBufferKey = bufferSettings.api_key || ""
        const loadedBufferOrgId = bufferSettings.organization_id || ""
        setBufferKey(loadedBufferKey)
        setBufferOrgId(loadedBufferOrgId)
        setSavedBufferKey(loadedBufferKey)
        setSavedBufferOrgId(loadedBufferOrgId)
        setBufferSavedConfigured(Boolean(loadedBufferKey && loadedBufferOrgId))

        if (data.monthly_quota_usd !== undefined && data.monthly_quota_usd !== null) {
          setMonthlyQuota(data.monthly_quota_usd.toString())
        }

        const videoSettings = data.video_template_settings || {}
        setTemplateName(videoSettings.template_name || "product_spotlight")
        setPrimaryColor(videoSettings.primary_color || "#FF0000")
        setAccentColor(videoSettings.accent_color || "#FFFF00")
        setTemplateCta(videoSettings.cta_text || "Comanda acum!")
      } catch (error) {
        if (controller.signal.aborted) return
        handleApiError(error, "Error loading settings")
      } finally {
        if (!controller.signal.aborted) {
          setPostizCredentialsReady(true)
        }
        setInitialLoad(false)
      }
    }

    const loadTemplates = async () => {
      try {
        const tmplRes = await apiGetWithRetry("/profiles/templates", { signal: controller.signal })
        if (controller.signal.aborted) return
        const tmplData = await tmplRes.json()
        if (Array.isArray(tmplData)) {
          setAvailableTemplates(tmplData)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn("Failed to load templates:", err)
      }
    }

    loadSettings()
    loadAccounts()
    loadTemplates()
    return () => { controller.abort() }
  }, [currentProfile, profileLoading, loadAccounts])

  // Load dashboard data
  useEffect(() => {
    if (profileLoading || !currentProfile) return
    const controller = new AbortController()

    const loadDashboard = async () => {
      setDashboardLoading(true)
      try {
        const response = await apiGetWithRetry(`/profiles/${currentProfile.id}/dashboard?time_range=30d`, { signal: controller.signal })
        if (controller.signal.aborted) return

        const data = await response.json()
        setDashboard(data)
      } catch (error) {
        if (controller.signal.aborted) return
        handleApiError(error, "Error loading dashboard")
      } finally {
        setDashboardLoading(false)
      }
    }

    loadDashboard()
    return () => { controller.abort() }
  }, [currentProfile, profileLoading])

  // Load voices when provider changes
  useEffect(() => {
    if (initialLoad) return

    const loadVoices = async () => {
      setLoadingVoices(true)
      try {
        const response = await apiGetWithRetry(`/tts/voices?provider=${provider}`)

        const data = await response.json()
        setVoices(data.voices || [])

        // Reset voice selection if current voice not available in new provider (Bug #60: use ref)
        if (voiceIdRef.current && !data.voices.find((v: Voice) => v.voice_id === voiceIdRef.current)) {
          setVoiceId("")
        }
      } catch (error) {
        handleApiError(error, "Error loading voices")
        setVoices([])
      } finally {
        setLoadingVoices(false)
      }
    }

    loadVoices()
  }, [provider, initialLoad])

  // Fetch app version and crash reporting state when running in desktop mode
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DESKTOP_MODE !== 'true') return
    apiGetWithRetry('/desktop/version')
      .then((res) => res.json())
      .then((data: { version: string }) => setAppVersion(data.version))
      .catch(() => {}) // Non-critical — silently ignore errors
    apiGetWithRetry('/desktop/settings')
      .then((res) => res.json())
      .then((data: { crash_reporting_enabled?: boolean }) => setCrashReporting(data.crash_reporting_enabled ?? false))
      .catch(() => {}) // Non-critical — silently ignore errors
  }, [])

  const handleCrashReportingToggle = async (enabled: boolean) => {
    setCrashReportingLoading(true)
    setCrashReporting(enabled) // Optimistic update
    try {
      const res = await apiPost('/desktop/crash-reporting', { enabled })
      if (!res.ok) {
        setCrashReporting(!enabled) // Revert on error
        toast.error('Failed to update crash reporting setting')
      }
    } catch {
      setCrashReporting(!enabled) // Revert on error
      toast.error('Failed to update crash reporting setting')
    } finally {
      setCrashReportingLoading(false)
    }
  }

  const handleSave = async () => {
    if (!currentProfile) {
      toast.error("No profile selected")
      return
    }

    setSaving(true)
    try {
      // Read-then-merge: tts_settings holds fields this page does not render
      // (voice tuning from Pipeline, telegram creds). Overwriting wholesale
      // silently wipes them. Mirror the pipeline page's merge pattern.
      let existingTts: Record<string, unknown> = {}
      try {
        const res = await apiGetWithRetry(`/profiles/${currentProfile.id}`)
        const profileData = await res.json()
        existingTts = (profileData?.tts_settings ?? {}) as Record<string, unknown>
      } catch (e) {
        console.warn("Could not fetch existing tts_settings for merge; proceeding with form values only", e)
      }

      const selectedVoice = voices.find(v => v.voice_id === voiceId)

      const ttsSettings: TTSSettings = {
        ...existingTts,
        provider: "elevenlabs",
        voice_id: voiceId,
        postiz: {
          api_url: postizUrl,
          api_key: postizKey,
          enabled: postizEnabled,
        },
        buffer: {
          api_key: bufferKey,
          organization_id: bufferOrgId,
        },
      }

      if (selectedVoice) {
        ttsSettings.voice_name = selectedVoice.name
      }

      // Build update payload
      const updates: Record<string, unknown> = {
        tts_settings: ttsSettings,
        video_template_settings: {
          template_name: templateName,
          primary_color: primaryColor,
          accent_color: accentColor,
          font_family: "",
          cta_text: templateCta,
        },
      }

      // Add quota if entered
      const quotaValue = parseFloat(monthlyQuota)
      if (!isNaN(quotaValue) && quotaValue >= 0) {
        updates.monthly_quota_usd = quotaValue
      }

      await apiPatch(`/profiles/${currentProfile.id}`, updates)

      toast.success("Settings saved successfully (TTS, Postiz, and Template)")
      const nowConfigured = Boolean(postizUrl && postizKey)
      setPostizSavedConfigured(nowConfigured)
      setSavedPostizUrl(postizUrl)
      setSavedPostizKey(postizKey)
      if (nowConfigured) {
        fetchIntegrations()
      } else {
        setIntegrations([])
      }
      const bufferNowConfigured = Boolean(bufferKey && bufferOrgId)
      setBufferSavedConfigured(bufferNowConfigured)
      setSavedBufferKey(bufferKey)
      setSavedBufferOrgId(bufferOrgId)
    } catch (error) {
      handleApiError(error, "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const fetchIntegrations = useCallback(async () => {
    if (!currentProfile) return
    const requestSeq = ++integrationsRequestSeq.current
    setIntegrationsLoading(true)
    setIntegrationsError(null)
    try {
      const response = await apiGetWithRetry("/postiz/integrations")
      const data = (await response.json()) as PostizIntegration[]
      if (requestSeq !== integrationsRequestSeq.current) return
      setIntegrations(data || [])
    } catch (error) {
      if (requestSeq !== integrationsRequestSeq.current) return
      setIntegrationsError(error instanceof Error ? error.message : "Failed to load")
      setIntegrations([])
    } finally {
      if (requestSeq === integrationsRequestSeq.current) {
        setIntegrationsLoading(false)
      }
    }
  }, [currentProfile])

  const fetchBufferChannels = useCallback(async () => {
    if (!currentProfile) return
    const requestSeq = ++bufferChannelsRequestSeq.current
    setBufferChannelsLoading(true)
    setBufferChannelsError(null)
    try {
      const response = await apiGetWithRetry("/buffer/channels")
      const data = (await response.json()) as BufferChannel[]
      if (requestSeq !== bufferChannelsRequestSeq.current) return
      setBufferChannels(data || [])
    } catch (error) {
      if (requestSeq !== bufferChannelsRequestSeq.current) return
      setBufferChannelsError(error instanceof Error ? error.message : "Failed to load")
      setBufferChannels([])
    } finally {
      if (requestSeq === bufferChannelsRequestSeq.current) {
        setBufferChannelsLoading(false)
      }
    }
  }, [currentProfile])

  // Fetch integrations only when the *saved* profile has complete creds.
  // Intentionally excludes live form state (postizUrl/postizKey) — the backend
  // /postiz/integrations uses the stored profile creds, so refetching on every
  // keystroke would show another profile's / env-fallback's connected accounts.
  useEffect(() => {
    if (!currentProfile) return
    if (!postizCredentialsReady) return
    if (postizSavedConfigured) fetchIntegrations()
    else {
      setIntegrations([])
      setIntegrationsLoading(false)
    }
  }, [currentProfile, postizSavedConfigured, postizCredentialsReady, fetchIntegrations])

  useEffect(() => {
    if (!currentProfile) return
    if (!postizCredentialsReady) return
    if (bufferSavedConfigured) fetchBufferChannels()
    else {
      setBufferChannels([])
      setBufferChannelsLoading(false)
    }
  }, [currentProfile, bufferSavedConfigured, postizCredentialsReady, fetchBufferChannels])

  const handleTestConnection = async () => {
    if (!postizUrl || !postizKey) {
      toast.warning("Please enter Postiz API URL and API Key first")
      return
    }

    setTestingConnection(true)
    setConnectionStatus("idle")

    try {
      // Validate what is currently in the form — do NOT use saved creds.
      // /postiz/validate constructs a one-off publisher and never touches state.
      const response = await apiPost("/postiz/validate", {
        api_url: postizUrl,
        api_key: postizKey,
      })

      const data = await response.json()
      if (data.connected) {
        setConnectionStatus("success")
        toast.success(
          `Credentials valid. ${data.integrations_count} social account(s) available. Saving…`
        )
        // Auto-persist on successful validation so users don't need a separate
        // Save click. handleSave reads current form state, so the just-validated
        // values are what get written. The integrations panel refresh happens
        // inside handleSave once the profile is persisted.
        await handleSave()
      } else {
        setConnectionStatus("error")
        toast.error(`Connection failed: ${data.error || "Unknown error"}`)
      }
    } catch (error) {
      setConnectionStatus("error")
      handleApiError(error, "Connection test failed")
    } finally {
      setTestingConnection(false)
    }
  }

  const handleTestBufferConnection = async () => {
    if (!bufferKey || !bufferOrgId) {
      toast.warning("Please enter Buffer API Key and Organization ID first")
      return
    }
    setBufferTestingConnection(true)
    setBufferConnectionStatus("idle")
    try {
      const response = await apiPost("/buffer/validate", {
        api_key: bufferKey,
        organization_id: bufferOrgId,
      })
      const data = await response.json()
      if (data.connected) {
        setBufferConnectionStatus("success")
        toast.success(`Buffer credentials valid. ${data.channels_count} channel(s) connected. Saving…`)
        await handleSave()
        fetchBufferChannels()
      } else {
        setBufferConnectionStatus("error")
        toast.error(`Buffer connection failed: ${data.error || "Unknown error"}`)
      }
    } catch (error) {
      setBufferConnectionStatus("error")
      handleApiError(error, "Buffer connection test failed")
    } finally {
      setBufferTestingConnection(false)
    }
  }

  // ElevenLabs account handlers
  const handleAddAccount = async () => {
    if (!newAccountLabel.trim() || !newAccountKey.trim()) {
      toast.warning("Please enter both a label and API key")
      return
    }

    setAddingAccount(true)
    try {
      const response = await apiPost("/elevenlabs-accounts/", {
        label: newAccountLabel.trim(),
        api_key: newAccountKey.trim(),
      })

      const data = await response.json()
      const tier = data.subscription?.tier || "unknown"
      toast.success(`Account added! Tier: ${tier}`)

      setNewAccountLabel("")
      setNewAccountKey("")
      setShowNewAccountKey(false)
      loadAccounts()
    } catch (error) {
      handleApiError(error, "Failed to add account")
    } finally {
      setAddingAccount(false)
    }
  }

  const handleDeleteAccount = (accountId: string) => {
    setConfirmDialog({
      open: true,
      title: "Delete ElevenLabs Account",
      description: "Delete this ElevenLabs account?",
      confirmLabel: "Delete",
      variant: "destructive",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }))
        setAccountActionLoading(accountId)
        try {
          await apiDelete(`/elevenlabs-accounts/${accountId}`)
          loadAccounts()
        } catch (error) {
          handleApiError(error, "Failed to delete account")
        } finally {
          setAccountActionLoading(null)
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }))
        }
      },
    })
  }

  const handleSetPrimary = async (accountId: string) => {
    setAccountActionLoading(accountId)
    try {
      await apiPost(`/elevenlabs-accounts/${accountId}/set-primary`)
      loadAccounts()
    } catch (error) {
      handleApiError(error, "Failed to set primary account")
    } finally {
      setAccountActionLoading(null)
    }
  }

  const handleRefreshAccount = async (accountId: string) => {
    setAccountActionLoading(accountId)
    try {
      const response = await apiPost(`/elevenlabs-accounts/${accountId}/refresh`)
      const data = await response.json()
      if (data.account) {
        setElAccounts(prev => prev.map(a => a.id === accountId ? { ...a, ...data.account } : a))
      }
    } catch (error) {
      handleApiError(error, "Failed to refresh account")
    } finally {
      setAccountActionLoading(null)
    }
  }

  const handleToggleElSecret = async (accountId: string) => {
    if (visibleElSecrets[accountId]) {
      setVisibleElSecrets((prev) => {
        const next = { ...prev }
        delete next[accountId]
        return next
      })
      return
    }

    setElSecretLoading(accountId)
    try {
      const response = await apiGetWithRetry(`/elevenlabs-accounts/${accountId}/secret`)
      const data = await response.json()
      setVisibleElSecrets((prev) => ({ ...prev, [accountId]: data.api_key || "" }))
    } catch (error) {
      handleApiError(error, "Failed to reveal ElevenLabs key")
    } finally {
      setElSecretLoading(null)
    }
  }

  if (profileLoading || initialLoad) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!currentProfile) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Please select a profile to configure settings
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-8 w-8" />
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Configure TTS settings for {currentProfile.name}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Profile Activity
          </CardTitle>
          <CardDescription>
            Video production and API usage for {currentProfile.name} (last 30 days)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dashboardLoading ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : dashboard ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Projects */}
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{dashboard.stats.projects_count}</div>
                <div className="text-sm text-muted-foreground">Projects</div>
              </div>

              {/* Clips */}
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{dashboard.stats.clips_count}</div>
                <div className="text-sm text-muted-foreground">Clips Generated</div>
              </div>

              {/* Rendered */}
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{dashboard.stats.rendered_count}</div>
                <div className="text-sm text-muted-foreground">Clips Rendered</div>
              </div>

              {/* Monthly Costs */}
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">${dashboard.costs.monthly.toFixed(2)}</div>
                <div className="text-sm text-muted-foreground">This Month</div>
              </div>
            </div>
          ) : (
            <p className="text-center text-muted-foreground">Failed to load dashboard data</p>
          )}

          {/* Quota Progress (if quota set) */}
          {dashboard && dashboard.costs.monthly_quota && dashboard.costs.monthly_quota > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex justify-between text-sm mb-2">
                <span>Monthly Quota Usage</span>
                <span>
                  ${dashboard.costs.monthly.toFixed(2)} / ${dashboard.costs.monthly_quota.toFixed(2)}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full ${
                    (dashboard.costs.monthly / dashboard.costs.monthly_quota) > 0.9
                      ? 'bg-red-500'
                      : (dashboard.costs.monthly / dashboard.costs.monthly_quota) > 0.7
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                  }`}
                  style={{
                    width: `${Math.min(100, (dashboard.costs.monthly / dashboard.costs.monthly_quota) * 100)}%`
                  }}
                />
              </div>
              {dashboard.costs.quota_remaining !== null && (
                <p className="text-xs text-muted-foreground mt-1">
                  ${dashboard.costs.quota_remaining.toFixed(2)} remaining this month
                </p>
              )}
            </div>
          )}

          {/* Cost Breakdown */}
          {dashboard && dashboard.costs.total > 0 && (
            <div className="mt-4 pt-4 border-t">
              <h4 className="text-sm font-medium mb-2">Cost Breakdown (All Time)</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ElevenLabs TTS:</span>
                  <span>${dashboard.costs.elevenlabs.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gemini Vision:</span>
                  <span>${dashboard.costs.gemini.toFixed(4)}</span>
                </div>
              </div>
              <div className="flex justify-between font-medium mt-2 pt-2 border-t">
                <span>Total:</span>
                <span>${dashboard.costs.total.toFixed(4)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ElevenLabs API Keys Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            ElevenLabs API Keys
          </CardTitle>
          <CardDescription>
            Manage multiple API keys with automatic failover when credits run out
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {elAccountsLoading ? (
            <div className="flex items-center justify-center h-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : elAccounts.length === 0 ? (
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-sm text-muted-foreground">
                No API keys configured. Using default .env API key.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Add accounts below for automatic failover when credits run out.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {elAccounts.map((account) => (
                <div
                  key={account.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-colors ${
                    account.is_primary
                      ? "border-green-500 bg-green-500/5"
                      : !account.is_active
                        ? "opacity-50 bg-muted/50 border-transparent"
                        : "border-muted bg-muted/30"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{account.label}</span>
                      {account.is_primary && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-600 text-white">
                          ACTIV
                        </span>
                      )}
                      {account.is_env_default && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                          .env
                        </span>
                      )}
                      {!account.is_active && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                          Disabled
                        </span>
                      )}
                      {account.tier && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-foreground">
                          {account.tier}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground font-mono">
                        {visibleElSecrets[account.id] || account.api_key_hint}
                      </span>
                      {account.character_limit && account.characters_used !== null && (
                        <div className="flex items-center gap-1.5 flex-1 max-w-[200px]">
                          <div className="flex-1 bg-muted rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${
                                (account.characters_used! / account.character_limit) > 0.9
                                  ? 'bg-red-500'
                                  : (account.characters_used! / account.character_limit) > 0.7
                                    ? 'bg-yellow-500'
                                    : 'bg-green-500'
                              }`}
                              style={{
                                width: `${Math.min(100, (account.characters_used! / account.character_limit) * 100)}%`
                              }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {Math.round((account.characters_used! / account.character_limit) * 100)}%
                          </span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {account.characters_used!.toLocaleString()} / {account.character_limit.toLocaleString()}
                          </span>
                        </div>
                      )}
                      {account.last_error && (
                        <span className="text-xs text-red-500 truncate max-w-[150px]" title={account.last_error}>
                          {account.last_error}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!account.is_primary && account.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => handleSetPrimary(account.id)}
                        disabled={accountActionLoading === account.id}
                      >
                        {accountActionLoading === account.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Star className="mr-1 h-3 w-3" />
                        )}
                        Foloseste
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleToggleElSecret(account.id)}
                      disabled={elSecretLoading === account.id}
                      title={visibleElSecrets[account.id] ? "Hide key" : "Show key"}
                    >
                      {elSecretLoading === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : visibleElSecrets[account.id] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRefreshAccount(account.id)}
                      disabled={accountActionLoading === account.id}
                      title="Refresh subscription info"
                    >
                      {accountActionLoading === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    {!account.is_env_default && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600"
                        onClick={() => handleDeleteAccount(account.id)}
                        disabled={accountActionLoading === account.id}
                        title="Delete account"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add Account Form */}
          {elAccounts.filter(a => !a.is_env_default).length < 3 && (
            <div className="pt-3 border-t space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Account
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Label</label>
                  <Input
                    value={newAccountLabel}
                    onChange={(e) => setNewAccountLabel(e.target.value)}
                    placeholder="e.g. Main Account"
                    disabled={addingAccount}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">API Key</label>
                  <div className="flex gap-1">
                    <Input
                      type={showNewAccountKey ? "text" : "password"}
                      value={newAccountKey}
                      onChange={(e) => setNewAccountKey(e.target.value)}
                      placeholder="sk_..."
                      disabled={addingAccount}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => setShowNewAccountKey(!showNewAccountKey)}
                    >
                      {showNewAccountKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                onClick={handleAddAccount}
                disabled={addingAccount || !newAccountLabel.trim() || !newAccountKey.trim()}
                size="sm"
              >
                {addingAccount ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Validating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Test & Add Account
                  </>
                )}
              </Button>
            </div>
          )}
          {elAccounts.filter(a => !a.is_env_default).length >= 3 && (
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Maximum 3 accounts reached. Delete an account to add a new one.
            </p>
          )}
        </CardContent>
      </Card>

      <Card key={`elevenlabs-accounts-${currentProfile.id}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Keys
          </CardTitle>
          <CardDescription>
            Per-profile API keys for AI services. Falls back to .env defaults if empty.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ApiKeyManager key={`gemini-${currentProfile.id}`} service="gemini" label="Gemini AI" description="Google Gemini for script generation and image analysis" />
          <div className="border-t" />
          <ApiKeyManager key={`fal-${currentProfile.id}`} service="fal" label="fal.ai" description="Image generation service" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-sm font-semibold tracking-wide text-foreground">
              Postiz
            </span>
            <span>Publishing</span>
          </CardTitle>
          <CardDescription>
            Configure social media publishing credentials for {currentProfile.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Postiz API URL</label>
            <Input
              value={postizUrl}
              onChange={(e) => setPostizUrl(e.target.value)}
              placeholder="https://postiz.example.com"
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Postiz domain (e.g.: https://postiz.nortia.ro). API paths are added automatically.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Postiz API Key</label>
            <div className="flex gap-2">
              <Input
                type={showPostizKey ? "text" : "password"}
                value={postizKey}
                onChange={(e) => setPostizKey(e.target.value)}
                placeholder="pk_live_..."
                disabled={saving}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowPostizKey(!showPostizKey)}
              >
                {showPostizKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your Postiz API key (found in Postiz settings)
            </p>
          </div>

          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testingConnection || !postizUrl || !postizKey}
            >
              {testingConnection ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !postizUrl || !postizKey}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
            {connectionStatus === "success" && (
              <span className="text-sm text-green-600">Connected</span>
            )}
            {connectionStatus === "error" && (
              <span className="text-sm text-red-600">Connection failed</span>
            )}
          </div>

          {postizUrl && postizKey && (() => {
            // Distinguish three states clearly so "verified" never implies "saved":
            //   - saved + verified (post-save, both form and server agree)
            //   - unsaved + verified (Test Connection worked but form differs from saved)
            //   - unsaved (typed, not yet tested or saved)
            const formMatchesSaved =
              postizSavedConfigured &&
              postizUrl === savedPostizUrl &&
              postizKey === savedPostizKey
            const verified = connectionStatus === "success"
            let dotClass = "bg-yellow-500"
            let label = "Credentials entered — click Save to persist for this profile."
            if (formMatchesSaved && verified) {
              dotClass = "bg-green-500"
              label = "Credentials saved and verified for this profile."
            } else if (formMatchesSaved) {
              dotClass = "bg-green-500"
              label = "Credentials saved for this profile."
            } else if (verified) {
              dotClass = "bg-yellow-500"
              label = "Credentials verified but not saved yet — click Save to persist."
            }
            return (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                <div className={`w-2 h-2 rounded-full ${dotClass}`} />
                <span className="text-sm">{label}</span>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* Connected Social Platforms — shows the Postiz accounts available for the active profile.
          Scoped by X-Profile-Id header in apiGetWithRetry, so switching profile auto-refreshes. */}
      <Card key={`postiz-integrations-${currentProfile.id}`}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Connected Social Platforms</CardTitle>
              <CardDescription>
                Accounts linked in Postiz for <span className="font-medium">{currentProfile.name}</span>.
                {integrations.length > 0 && ` ${integrations.length} connected.`}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchIntegrations}
              disabled={integrationsLoading || !postizSavedConfigured}
            >
              {integrationsLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!postizSavedConfigured ? (
            <p className="text-sm text-muted-foreground">
              Save Postiz credentials above to see connected social platforms for this profile.
            </p>
          ) : integrationsError ? (
            <p className="text-sm text-red-600">Could not load integrations: {integrationsError}</p>
          ) : integrationsLoading && integrations.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading integrations…
            </div>
          ) : integrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No social platforms connected in Postiz for this profile yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* TODO: render one card per integration.
                  Each `integration` has: { id, name, type, identifier?, picture?, disabled }.
                  - `name` is the display name of the account (e.g. "Nortia Official")
                  - `identifier` is the handle (e.g. "@nortia_official") — may be null
                  - `type` is the platform type (e.g. "instagram-standalone", "tiktok")
                    → use `friendlyPlatformName(integration.type)` for the badge label
                  - `picture` is an avatar URL — may be null, so handle a fallback
                  See `frontend/src/components/PublishDialog.tsx` for how Step 4 styles these. */}
              {integrations
                .slice()
                .sort((a, b) =>
                  friendlyPlatformName(a.type).localeCompare(friendlyPlatformName(b.type)) ||
                  a.name.localeCompare(b.name)
                )
                .map((integration) => (
                <div
                  key={integration.id}
                  className={`rounded-md border p-3 transition-colors ${
                    integration.disabled ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {integration.picture ? (
                      <img
                        src={integration.picture}
                        alt={integration.name}
                        className="h-11 w-11 rounded-full object-cover border shrink-0"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                        {integration.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{integration.name}</p>
                          {integration.identifier && (
                            <p className="truncate text-xs text-muted-foreground">{integration.identifier}</p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                          {friendlyPlatformName(integration.type)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-sm font-semibold tracking-wide text-foreground">
              Buffer
            </span>
            <span>Publishing</span>
          </CardTitle>
          <CardDescription>
            Publish videos to TikTok and other platforms via Buffer
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Buffer API Key</label>
            <div className="flex gap-2">
              <Input
                type={showBufferKey ? "text" : "password"}
                value={bufferKey}
                onChange={(e) => setBufferKey(e.target.value)}
                placeholder="_Prk3..."
                disabled={saving}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowBufferKey(!showBufferKey)}
              >
                {showBufferKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              API key from Buffer Settings &gt; API
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Organization ID</label>
            <Input
              value={bufferOrgId}
              onChange={(e) => setBufferOrgId(e.target.value)}
              placeholder="68bc238..."
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Found in Buffer URL or via API. Example: 68bc238742a5996dc29f1aab
            </p>
          </div>

          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={handleTestBufferConnection}
              disabled={bufferTestingConnection || !bufferKey || !bufferOrgId}
            >
              {bufferTestingConnection ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !bufferKey || !bufferOrgId}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
            {bufferConnectionStatus === "success" && (
              <span className="text-sm text-green-600">Connected</span>
            )}
            {bufferConnectionStatus === "error" && (
              <span className="text-sm text-red-600">Connection failed</span>
            )}
          </div>

          {bufferKey && bufferOrgId && (() => {
            const formMatchesSaved =
              bufferSavedConfigured &&
              bufferKey === savedBufferKey &&
              bufferOrgId === savedBufferOrgId
            const verified = bufferConnectionStatus === "success"
            let dotClass = "bg-yellow-500"
            let label = "Credentials entered — click Save to persist for this profile."
            if (formMatchesSaved && verified) {
              dotClass = "bg-green-500"
              label = "Credentials saved and verified for this profile."
            } else if (formMatchesSaved) {
              dotClass = "bg-green-500"
              label = "Credentials saved for this profile."
            } else if (verified) {
              dotClass = "bg-yellow-500"
              label = "Credentials verified but not saved yet — click Save to persist."
            }
            return (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                <div className={`w-2 h-2 rounded-full ${dotClass}`} />
                <span className="text-sm">{label}</span>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* Connected Buffer Channels — mirrors the Postiz integrations card above */}
      <Card key={`buffer-channels-${currentProfile.id}`}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Connected Buffer Channels</CardTitle>
              <CardDescription>
                Channels linked in Buffer for <span className="font-medium">{currentProfile.name}</span>.
                {bufferChannels.length > 0 && ` ${bufferChannels.length} connected.`}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchBufferChannels}
              disabled={bufferChannelsLoading || !bufferSavedConfigured}
            >
              {bufferChannelsLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!bufferSavedConfigured ? (
            <p className="text-sm text-muted-foreground">
              Save Buffer credentials above to see connected channels for this profile.
            </p>
          ) : bufferChannelsError ? (
            <p className="text-sm text-red-600">Could not load channels: {bufferChannelsError}</p>
          ) : bufferChannelsLoading && bufferChannels.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading channels…
            </div>
          ) : bufferChannels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No channels connected in Buffer for this profile yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {bufferChannels
                .slice()
                .sort((a, b) =>
                  friendlyPlatformName(a.service).localeCompare(friendlyPlatformName(b.service)) ||
                  a.name.localeCompare(b.name)
                )
                .map((channel) => (
                <div key={channel.id} className="rounded-md border p-3 transition-colors">
                  <div className="flex items-start gap-3">
                    {channel.avatar ? (
                      <img
                        src={channel.avatar}
                        alt={channel.name}
                        className="h-11 w-11 rounded-full object-cover border shrink-0"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                        {channel.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{channel.name}</p>
                          <p className="truncate text-xs text-muted-foreground capitalize">{channel.type}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                          {friendlyPlatformName(channel.service)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage Limits</CardTitle>
          <CardDescription>
            Set monthly spending limits for API usage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Monthly Cost Quota (USD)</label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">$</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={monthlyQuota}
                onChange={(e) => setMonthlyQuota(e.target.value)}
                placeholder="0.00"
                className="w-32"
                disabled={saving}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Set to 0 for unlimited. TTS generation will be blocked when quota is exceeded.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Template & Branding */}
      <Card>
        <CardHeader>
          <CardTitle>Template &amp; Branding</CardTitle>
          <CardDescription>
            Choose a video template and brand colors for {currentProfile.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Template selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Video Template</label>
            <Select value={templateName} onValueChange={setTemplateName} disabled={saving}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {availableTemplates.map((t) => (
                  <SelectItem key={t.name} value={t.name}>{t.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Color pickers */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Primary Color (CTA)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  disabled={saving}
                  className="h-9 w-16 rounded border border-input cursor-pointer"
                />
                <span className="text-xs text-muted-foreground font-mono">{primaryColor}</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Accent Color (Sale Price)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  disabled={saving}
                  className="h-9 w-16 rounded border border-input cursor-pointer"
                />
                <span className="text-xs text-muted-foreground font-mono">{accentColor}</span>
              </div>
            </div>
          </div>

          {/* CTA text */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Default CTA Text</label>
            <Input
              value={templateCta}
              onChange={(e) => setTemplateCta(e.target.value)}
              disabled={saving}
              className="w-full max-w-sm"
              placeholder="e.g. Comanda acum!"
            />
            <p className="text-xs text-muted-foreground">
              Pre-fills the CTA field when generating videos for this profile.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Settings
            </>
          )}
        </Button>
      </div>

      {process.env.NEXT_PUBLIC_DESKTOP_MODE === "true" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Crash Reporting
            </CardTitle>
            <CardDescription>
              Help improve Edit Factory by automatically sending crash reports
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Send crash reports</p>
                <p className="text-xs text-muted-foreground">
                  Stack traces are sent to help diagnose issues. API keys and sensitive data are automatically scrubbed before sending.
                </p>
              </div>
              <Switch
                checked={crashReporting}
                onCheckedChange={handleCrashReportingToggle}
                disabled={crashReportingLoading}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {process.env.NEXT_PUBLIC_DESKTOP_MODE === "true" && (
        <Card>
          <CardHeader>
            <CardTitle>Setup Wizard</CardTitle>
            <CardDescription>
              Re-run the setup wizard to update your license, API keys, or preferences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href="/setup?mode=edit">Open Setup Wizard</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {appVersion && (
        <div className="text-center text-xs text-muted-foreground mt-8 pb-4">
          Edit Factory v{appVersion}
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        loading={confirmDialog.loading}
      />
    </div>
  )
}
