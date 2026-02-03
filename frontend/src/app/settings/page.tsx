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
import { Loader2, Save, Settings as SettingsIcon } from "lucide-react"
import { apiGet, apiPatch } from "@/lib/api"
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
}

export default function SettingsPage() {
  const { currentProfile, isLoading: profileLoading } = useProfile()

  const [provider, setProvider] = useState("edge")
  const [voiceId, setVoiceId] = useState("")
  const [voices, setVoices] = useState<Voice[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)

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
      } catch (error) {
        console.error("Failed to load settings:", error)
      } finally {
        setInitialLoad(false)
      }
    }

    loadSettings()
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

      alert("TTS settings saved successfully")
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

          <div className="flex justify-end pt-4">
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
        </CardContent>
      </Card>
    </div>
  )
}
