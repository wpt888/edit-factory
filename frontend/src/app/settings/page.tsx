"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Save, Settings as SettingsIcon, Eye, EyeOff, BarChart3 } from "lucide-react"
import { apiGet, apiPatch } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { ProviderSelector } from "@/components/tts/provider-selector"
import { VoiceCloningUpload } from "@/components/tts/voice-cloning-upload"
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

export default function SettingsPage() {
  const { currentProfile, isLoading: profileLoading } = useProfile()

  const [provider, setProvider] = useState("edge")
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

  // Load current profile TTS settings
  useEffect(() => {
    if (profileLoading || !currentProfile) return

    const loadSettings = async () => {
      try {
        const response = await apiGet(`/profiles/${currentProfile.id}`)
        if (!response.ok) throw new Error("Failed to load profile settings")

        const data = await response.json()
        const ttsSettings = data.tts_settings || {}

        if (ttsSettings.provider) {
          setProvider(ttsSettings.provider)
        }
        if (ttsSettings.voice_id) {
          setVoiceId(ttsSettings.voice_id)
        }

        // Load Postiz settings
        const postizSettings = ttsSettings.postiz || {}
        setPostizUrl(postizSettings.api_url || "")
        setPostizKey(postizSettings.api_key || "")
        setPostizEnabled(postizSettings.enabled || false)
      } catch (error) {
        console.error("Failed to load settings:", error)
      } finally {
        setInitialLoad(false)
      }
    }

    loadSettings()
  }, [currentProfile, profileLoading])

  // Load dashboard data
  useEffect(() => {
    if (profileLoading || !currentProfile) return

    const loadDashboard = async () => {
      setDashboardLoading(true)
      try {
        const response = await apiGet(`/profiles/${currentProfile.id}/dashboard?time_range=30d`)
        if (!response.ok) throw new Error("Failed to load dashboard")

        const data = await response.json()
        setDashboard(data)
      } catch (error) {
        console.error("Failed to load dashboard:", error)
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
        const response = await apiGet(`/tts/voices?provider=${provider}`, { skipAuth: true })
        if (!response.ok) throw new Error("Failed to load voices")

        const data = await response.json()
        setVoices(data.voices || [])

        // Reset voice selection if current voice not available in new provider
        if (voiceId && !data.voices.find((v: Voice) => v.voice_id === voiceId)) {
          setVoiceId("")
        }
      } catch (error) {
        console.error("Failed to load voices:", error)
        alert("Failed to load voices for selected provider")
        setVoices([])
      } finally {
        setLoadingVoices(false)
      }
    }

    loadVoices()
  }, [provider, initialLoad])

  const handleSave = async () => {
    if (!currentProfile) {
      alert("No profile selected")
      return
    }

    setSaving(true)
    try {
      const ttsSettings: TTSSettings = {
        provider,
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

      const response = await apiPatch(`/profiles/${currentProfile.id}`, {
        tts_settings: ttsSettings,
      })

      if (!response.ok) throw new Error("Failed to save settings")

      alert("Settings saved successfully (TTS and Postiz)")
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const handleVoiceCloned = async (newVoiceId: string, newVoiceName: string) => {
    alert(`Voice "${newVoiceName}" is ready to use`)

    // Reload voices to include the new cloned voice
    setLoadingVoices(true)
    try {
      const response = await apiGet(`/tts/voices?provider=${provider}`, { skipAuth: true })
      if (response.ok) {
        const data = await response.json()
        setVoices(data.voices || [])
        setVoiceId(newVoiceId)
      }
    } catch (error) {
      console.error("Failed to reload voices:", error)
    } finally {
      setLoadingVoices(false)
    }
  }

  const handleTestConnection = async () => {
    if (!postizUrl || !postizKey) {
      alert("Please enter Postiz API URL and API Key first")
      return
    }

    setTestingConnection(true)
    setConnectionStatus("idle")

    try {
      // Test using the current profile's credentials (will use saved or env fallback)
      const response = await apiGet("/postiz/status")
      if (!response.ok) throw new Error("Connection failed")

      const data = await response.json()
      if (data.connected) {
        setConnectionStatus("success")
        alert(`Connected successfully! Found ${data.integrations_count} social media accounts.`)
      } else {
        setConnectionStatus("error")
        alert(`Connection failed: ${data.error || "Unknown error"}`)
      }
    } catch (error) {
      setConnectionStatus("error")
      alert(error instanceof Error ? error.message : "Connection test failed")
    } finally {
      setTestingConnection(false)
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

      <Card>
        <CardHeader>
          <CardTitle>Text-to-Speech Provider</CardTitle>
          <CardDescription>
            Choose your preferred TTS provider and voice for video generation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <ProviderSelector
              value={provider}
              onChange={setProvider}
              disabled={saving}
            />
          </div>

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
                No voices available for this provider
              </p>
            )}
          </div>

          {provider === "coqui" && (
            <div className="pt-4 border-t">
              <VoiceCloningUpload onVoiceCloned={handleVoiceCloned} />
            </div>
          )}
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
