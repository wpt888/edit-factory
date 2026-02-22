"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Save, Settings as SettingsIcon, Eye, EyeOff, BarChart3, Trash2, Star, RefreshCw, Plus, Key } from "lucide-react"
import { apiGetWithRetry, apiPost, apiPatch, apiDelete, handleApiError } from "@/lib/api"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { useProfile } from "@/contexts/profile-context"

interface Voice {
  voice_id: string
  name: string
  language?: string
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
  const [voices, setVoices] = useState<Voice[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)

  // Postiz settings state
  const [postizUrl, setPostizUrl] = useState("")
  const [postizKey, setPostizKey] = useState("")
  const [postizEnabled, setPostizEnabled] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle")
  const [showApiKey, setShowApiKey] = useState(false)

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

  // Load ElevenLabs accounts
  const loadAccounts = useCallback(async () => {
    if (!currentProfile) return
    setElAccountsLoading(true)
    try {
      const response = await apiGetWithRetry("/elevenlabs-accounts/")
      if (response.ok) {
        const data = await response.json()
        setElAccounts(data.accounts || [])
      }
    } catch (error) {
      handleApiError(error, "Eroare la incarcarea conturilor ElevenLabs")
    } finally {
      setElAccountsLoading(false)
    }
  }, [currentProfile])

  // Load current profile TTS settings
  useEffect(() => {
    if (profileLoading || !currentProfile) return

    const loadSettings = async () => {
      try {
        const response = await apiGetWithRetry(`/profiles/${currentProfile.id}`)
        if (!response.ok) throw new Error("Failed to load profile settings")

        const data = await response.json()
        const ttsSettings = data.tts_settings || {}

        // Always use elevenlabs
        setProvider("elevenlabs")
        if (ttsSettings.voice_id) {
          setVoiceId(ttsSettings.voice_id)
        }

        // Load Postiz settings
        const postizSettings = ttsSettings.postiz || {}
        setPostizUrl(postizSettings.api_url || "")
        setPostizKey(postizSettings.api_key || "")
        setPostizEnabled(postizSettings.enabled || false)

        // Load monthly quota
        if (data.monthly_quota_usd !== undefined && data.monthly_quota_usd !== null) {
          setMonthlyQuota(data.monthly_quota_usd.toString())
        }

        // Load template settings
        const videoSettings = data.video_template_settings || {}
        setTemplateName(videoSettings.template_name || "product_spotlight")
        setPrimaryColor(videoSettings.primary_color || "#FF0000")
        setAccentColor(videoSettings.accent_color || "#FFFF00")
        setTemplateCta(videoSettings.cta_text || "Comanda acum!")
      } catch (error) {
        handleApiError(error, "Eroare la incarcarea setarilor")
      } finally {
        setInitialLoad(false)
      }
    }

    // Fetch available template presets
    const loadTemplates = async () => {
      try {
        const tmplRes = await apiGetWithRetry("/profiles/templates")
        if (tmplRes.ok) {
          const tmplData = await tmplRes.json()
          if (Array.isArray(tmplData)) {
            setAvailableTemplates(tmplData)
          }
        }
      } catch (err) {
        console.warn("Failed to load templates:", err)
      }
    }

    loadSettings()
    loadAccounts()
    loadTemplates()
  }, [currentProfile, profileLoading, loadAccounts])

  // Load dashboard data
  useEffect(() => {
    if (profileLoading || !currentProfile) return

    const loadDashboard = async () => {
      setDashboardLoading(true)
      try {
        const response = await apiGetWithRetry(`/profiles/${currentProfile.id}/dashboard?time_range=30d`)
        if (!response.ok) throw new Error("Failed to load dashboard")

        const data = await response.json()
        setDashboard(data)
      } catch (error) {
        handleApiError(error, "Eroare la incarcarea dashboard-ului")
      } finally {
        setDashboardLoading(false)
      }
    }

    loadDashboard()
  }, [currentProfile, profileLoading])

  // Load voices when provider changes
  useEffect(() => {
    if (initialLoad) return

    const loadVoices = async () => {
      setLoadingVoices(true)
      try {
        const response = await apiGetWithRetry(`/tts/voices?provider=${provider}`)
        if (!response.ok) throw new Error("Failed to load voices")

        const data = await response.json()
        setVoices(data.voices || [])

        // Reset voice selection if current voice not available in new provider
        if (voiceId && !data.voices.find((v: Voice) => v.voice_id === voiceId)) {
          setVoiceId("")
        }
      } catch (error) {
        handleApiError(error, "Eroare la incarcarea vocilor")
        setVoices([])
      } finally {
        setLoadingVoices(false)
      }
    }

    loadVoices()
  }, [provider, initialLoad])

  const handleSave = async () => {
    if (!currentProfile) {
      toast.error("No profile selected")
      return
    }

    setSaving(true)
    try {
      const ttsSettings: TTSSettings = {
        provider: "elevenlabs",
        voice_id: voiceId,
        postiz: {
          api_url: postizUrl,
          api_key: postizKey,
          enabled: postizEnabled,
        },
      }

      // Add voice name if available
      const selectedVoice = voices.find(v => v.voice_id === voiceId)
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

      const response = await apiPatch(`/profiles/${currentProfile.id}`, updates)

      if (!response.ok) throw new Error("Failed to save settings")

      toast.success("Settings saved successfully (TTS, Postiz, and Template)")
    } catch (error) {
      handleApiError(error, "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    if (!postizUrl || !postizKey) {
      toast.warning("Please enter Postiz API URL and API Key first")
      return
    }

    setTestingConnection(true)
    setConnectionStatus("idle")

    try {
      // Test using the current profile's credentials (will use saved or env fallback)
      const response = await apiGetWithRetry("/postiz/status")
      if (!response.ok) throw new Error("Connection failed")

      const data = await response.json()
      if (data.connected) {
        setConnectionStatus("success")
        toast.success(`Connected successfully! Found ${data.integrations_count} social media accounts.`)
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

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || "Failed to add account")
      }

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

  const handleDeleteAccount = async (accountId: string) => {
    if (!confirm("Delete this ElevenLabs account?")) return

    setAccountActionLoading(accountId)
    try {
      const response = await apiDelete(`/elevenlabs-accounts/${accountId}`)
      if (!response.ok) throw new Error("Failed to delete account")
      loadAccounts()
    } catch (error) {
      handleApiError(error, "Failed to delete account")
    } finally {
      setAccountActionLoading(null)
    }
  }

  const handleSetPrimary = async (accountId: string) => {
    setAccountActionLoading(accountId)
    try {
      const response = await apiPost(`/elevenlabs-accounts/${accountId}/set-primary`)
      if (!response.ok) throw new Error("Failed to set primary")
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
      if (!response.ok) throw new Error("Failed to refresh")
      loadAccounts()
    } catch (error) {
      handleApiError(error, "Failed to refresh account")
    } finally {
      setAccountActionLoading(null)
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
              <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
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
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    !account.is_active ? "opacity-50 bg-muted/50" : "bg-muted/30"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{account.label}</span>
                      {account.is_primary && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                          Primary
                        </span>
                      )}
                      {!account.is_active && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          Disabled
                        </span>
                      )}
                      {account.tier && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          {account.tier}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground font-mono">
                        {account.api_key_hint}
                      </span>
                      {account.character_limit && account.characters_used !== null && (
                        <div className="flex items-center gap-1.5 flex-1 max-w-[200px]">
                          <div className="flex-1 bg-gray-200 rounded-full h-1.5 dark:bg-gray-700">
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
                    {!account.is_primary && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleSetPrimary(account.id)}
                        disabled={accountActionLoading === account.id}
                        title="Set as primary"
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
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
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add Account Form */}
          {elAccounts.length < 3 && (
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
                    Add Account
                  </>
                )}
              </Button>
            </div>
          )}
          {elAccounts.length >= 3 && (
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Maximum 3 accounts reached. Delete an account to add a new one.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ElevenLabs Voice</CardTitle>
          <CardDescription>
            Select the ElevenLabs voice for video generation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Voice Selection</label>
            <Select
              value={voiceId}
              onValueChange={setVoiceId}
              disabled={loadingVoices || saving || voices.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingVoices ? "Loading voices..." : "Select a voice"} />
              </SelectTrigger>
              <SelectContent>
                {voices.map((voice) => (
                  <SelectItem key={voice.voice_id} value={voice.voice_id}>
                    {voice.name}
                    {voice.language && ` (${voice.language})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {voices.length === 0 && !loadingVoices && (
              <p className="text-sm text-muted-foreground">
                No voices available. Check your ElevenLabs API key.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Postiz Publishing</CardTitle>
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
              placeholder="https://api.postiz.com"
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              The URL of your Postiz API server
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Postiz API Key</label>
            <div className="flex gap-2">
              <Input
                type={showApiKey ? "text" : "password"}
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
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
            {connectionStatus === "success" && (
              <span className="text-sm text-green-600">Connected</span>
            )}
            {connectionStatus === "error" && (
              <span className="text-sm text-red-600">Connection failed</span>
            )}
          </div>

          {postizUrl && postizKey && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
              <div className={`w-2 h-2 rounded-full ${connectionStatus === "success" ? "bg-green-500" : "bg-yellow-500"}`} />
              <span className="text-sm">
                {connectionStatus === "success"
                  ? "Credentials configured and verified"
                  : "Credentials configured (not yet verified)"}
              </span>
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
          disabled={saving || !voiceId}
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
    </div>
  )
}
