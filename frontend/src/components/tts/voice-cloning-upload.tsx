"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { API_URL } from "@/lib/api"

interface VoiceCloningUploadProps {
  onVoiceCloned?: (voiceId: string, voiceName: string) => void
}

export function VoiceCloningUpload({ onVoiceCloned }: VoiceCloningUploadProps) {
  const [voiceName, setVoiceName] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setError(null)
    setSuccess(null)

    // Validate audio duration client-side
    const audio = new Audio()
    audio.src = URL.createObjectURL(file)

    audio.addEventListener("loadedmetadata", () => {
      const audioDuration = audio.duration
      setDuration(audioDuration)

      if (audioDuration < 6) {
        setError("Audio sample must be at least 6 seconds long for quality voice cloning")
      } else if (audioDuration > 20) {
        setError("Audio sample should be between 6-20 seconds for best results")
      } else {
        setError(null)
      }

      URL.revokeObjectURL(audio.src)
    })
  }

  const handleUpload = async () => {
    if (!selectedFile || !voiceName.trim()) {
      setError("Please provide both a voice name and audio file")
      return
    }

    if (duration && duration < 6) {
      setError("Audio sample is too short (minimum 6 seconds)")
      return
    }

    setUploading(true)
    setError(null)
    setSuccess(null)

    try {
      const formData = new FormData()
      formData.append("audio_file", selectedFile)
      formData.append("voice_name", voiceName.trim())

      // Get profile ID from localStorage
      const profileId = typeof window !== "undefined"
        ? localStorage.getItem("editai_current_profile_id")
        : null

      const headers: HeadersInit = {}
      if (profileId) {
        headers["X-Profile-Id"] = profileId
      }

      const response = await fetch(`${API_URL}/tts/clone-voice`, {
        method: "POST",
        headers,
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || "Failed to clone voice")
      }

      setSuccess(`Voice "${data.voice_name}" cloned successfully! Voice ID: ${data.voice_id}`)
      setVoiceName("")
      setSelectedFile(null)
      setDuration(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }

      if (onVoiceCloned) {
        onVoiceCloned(data.voice_id, data.voice_name)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload voice sample")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice Cloning</CardTitle>
        <CardDescription>
          Upload a 6-20 second audio sample to create a custom voice clone
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            <strong>Requirements:</strong>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Audio duration: 6-20 seconds (optimal: 10-15 seconds)</li>
              <li>Clear speech without background noise</li>
              <li>Single speaker only</li>
              <li>Supported formats: MP3, WAV, M4A, FLAC</li>
              <li>Maximum file size: 10MB</li>
            </ul>
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="voice-name">Voice Name</Label>
          <Input
            id="voice-name"
            placeholder="e.g., John's Voice"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            disabled={uploading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="audio-file">Audio Sample</Label>
          <Input
            ref={fileInputRef}
            id="audio-file"
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            disabled={uploading}
          />
          {duration && (
            <p className="text-sm text-muted-foreground">
              Duration: {duration.toFixed(1)} seconds
              {duration >= 6 && duration <= 20 && (
                <CheckCircle2 className="inline ml-2 h-4 w-4 text-green-500" />
              )}
            </p>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleUpload}
          disabled={uploading || !selectedFile || !voiceName.trim() || (duration !== null && duration < 6)}
          className="w-full"
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Cloning Voice...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Clone Voice
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
