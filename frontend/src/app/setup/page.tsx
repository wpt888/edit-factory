"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { apiPost, apiGet } from "@/lib/api"
import { ApiError } from "@/lib/api-error"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { CheckCircle, AlertCircle, Loader2, Film, ChevronRight, ChevronLeft, ArrowRight } from "lucide-react"

export default function SetupPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isEditMode = searchParams.get("mode") === "edit"

  // Step tracking
  const [currentStep, setCurrentStep] = useState(1)
  const [checkingLicense, setCheckingLicense] = useState(!isEditMode) // Skip check in edit mode

  // Step 1: License
  const [licenseKey, setLicenseKey] = useState("")
  const [licenseValid, setLicenseValid] = useState(false)
  const [activating, setActivating] = useState(false)
  const [licenseError, setLicenseError] = useState<string | null>(null)

  // Step 2: API Keys
  const [supabaseUrl, setSupabaseUrl] = useState("")
  const [supabaseKey, setSupabaseKey] = useState("")
  const [geminiKey, setGeminiKey] = useState("")
  const [elevenlabsKey, setElevenlabsKey] = useState("")
  const [supabaseStatus, setSupabaseStatus] = useState<"idle" | "testing" | "ok" | "error">("idle")
  const [geminiStatus, setGeminiStatus] = useState<"idle" | "testing" | "ok" | "error">("idle")
  const [elevenlabsStatus, setElevenlabsStatus] = useState<"idle" | "testing" | "ok" | "error">("idle")
  const [supabaseHint, setSupabaseHint] = useState("")
  const [geminiHint, setGeminiHint] = useState("")
  const [elevenlabsHint, setElevenlabsHint] = useState("")

  // Step 3: Crash Reporting
  const [crashReporting, setCrashReporting] = useState(false)

  // Completion
  const [finishing, setFinishing] = useState(false)

  const totalSteps = 3
  const progressPercent = ((currentStep - 1) / totalSteps) * 100

  // First-run guard — redirect away if already activated (not in edit mode)
  useEffect(() => {
    if (isEditMode) {
      setCheckingLicense(false)
      return
    }
    if (process.env.NEXT_PUBLIC_DESKTOP_MODE !== "true") {
      setCheckingLicense(false)
      return
    }

    apiPost("/desktop/license/validate")
      .then(() => {
        // 200 = license valid = setup already done = redirect to app
        router.replace("/librarie")
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          if (err.status === 404) {
            // Not activated — stay on wizard Step 1
            setCheckingLicense(false)
            return
          }
          if (err.status === 403) {
            // License expired — show re-activation in Step 1
            setLicenseError("Your license has expired or is invalid. Please re-activate.")
            setCheckingLicense(false)
            return
          }
        }
        // Network error or unexpected — assume first run, stay on wizard
        setCheckingLicense(false)
      })
  }, [isEditMode, router])

  // Pre-fill current values in edit mode
  useEffect(() => {
    if (!isEditMode) return

    apiGet("/desktop/settings")
      .then((res) => res.json())
      .then((data: { supabase_url?: string; supabase_key?: string; gemini_api_key?: string; elevenlabs_api_key?: string; crash_reporting_enabled?: boolean }) => {
        // Supabase URL is returned unredacted
        if (data.supabase_url) setSupabaseUrl(data.supabase_url)
        // Set hints for redacted keys (e.g., "***1234")
        if (data.supabase_key) setSupabaseHint(data.supabase_key)
        if (data.gemini_api_key) setGeminiHint(data.gemini_api_key)
        if (data.elevenlabs_api_key) setElevenlabsHint(data.elevenlabs_api_key)
        // Pre-fill crash reporting toggle
        if (data.crash_reporting_enabled) setCrashReporting(data.crash_reporting_enabled)
        // In edit mode, license is already valid — skip to step 2
        setLicenseValid(true)
        setCurrentStep(2)
      })
      .catch(() => {
        // Failed to load — start from step 1
      })
  }, [isEditMode])

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      setLicenseError("Please enter a license key")
      return
    }
    setActivating(true)
    setLicenseError(null)
    try {
      await apiPost("/desktop/license/activate", { license_key: licenseKey.trim() })
      setLicenseValid(true)
      toast.success("License activated successfully!")
      // Auto-advance to step 2 after short delay for user to see success
      setTimeout(() => setCurrentStep(2), 800)
    } catch (err: unknown) {
      const msg = err instanceof ApiError
        ? err.detail || "Activation failed"
        : "Network error — please check your internet connection"
      setLicenseError(msg)
    } finally {
      setActivating(false)
    }
  }

  const testConnection = async (service: string) => {
    const setStatus = service === "supabase" ? setSupabaseStatus
      : service === "gemini" ? setGeminiStatus
      : setElevenlabsStatus

    const url = service === "supabase" ? supabaseUrl : ""
    const key = service === "supabase" ? supabaseKey
      : service === "gemini" ? geminiKey
      : elevenlabsKey

    if (!key.trim() && service !== "supabase") {
      toast.warning(`Please enter a ${service} API key first`)
      return
    }
    if (service === "supabase" && (!supabaseUrl.trim() || !supabaseKey.trim())) {
      toast.warning("Please enter both Supabase URL and key")
      return
    }

    setStatus("testing")
    try {
      await apiPost("/desktop/test-connection", {
        service,
        url: url.trim(),
        key: key.trim(),
      })
      setStatus("ok")
      toast.success(`${service.charAt(0).toUpperCase() + service.slice(1)} connected!`)
    } catch (err: unknown) {
      setStatus("error")
      const msg = err instanceof ApiError ? err.detail : "Connection failed"
      toast.error(msg)
    }
  }

  const handleFinish = async () => {
    setFinishing(true)
    try {
      // 1. Write API keys (only non-empty values to avoid overwriting existing)
      const settingsPayload: Record<string, string | boolean> = {
        crash_reporting_enabled: crashReporting,
      }
      if (supabaseUrl.trim()) settingsPayload.supabase_url = supabaseUrl.trim()
      if (supabaseKey.trim()) settingsPayload.supabase_key = supabaseKey.trim()
      if (geminiKey.trim()) settingsPayload.gemini_api_key = geminiKey.trim()
      if (elevenlabsKey.trim()) settingsPayload.elevenlabs_api_key = elevenlabsKey.trim()
      await apiPost("/desktop/settings", settingsPayload)

      // 2. Mark first run complete (only on initial setup, not edit mode)
      if (!isEditMode) {
        await apiPost("/desktop/first-run/complete")
      }

      toast.success(isEditMode ? "Settings updated!" : "Setup complete! Welcome to Edit Factory.")
      router.replace("/librarie")
    } catch {
      toast.error("Failed to save settings. Please try again.")
    } finally {
      setFinishing(false)
    }
  }

  // Non-desktop mode: show informational message
  if (process.env.NEXT_PUBLIC_DESKTOP_MODE !== "true") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <Film className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              The Setup Wizard is only available in desktop mode.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (checkingLicense) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <Film className="mx-auto h-10 w-10" />
          <h1 className="text-2xl font-bold">
            {isEditMode ? "Edit Factory Settings" : "Welcome to Edit Factory"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isEditMode ? "Update your configuration" : "Let's get you set up in just a few steps"}
          </p>
        </div>

        {/* Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Step {currentStep} of {totalSteps}</span>
            <span>{currentStep === 1 ? "License" : currentStep === 2 ? "API Keys" : "Preferences"}</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Step 1: License Activation */}
        {currentStep === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>License Activation</CardTitle>
              <CardDescription>
                Enter your license key to activate Edit Factory
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="license-key">License Key</Label>
                <Input
                  id="license-key"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                  disabled={activating || licenseValid}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !activating && !licenseValid) handleActivate()
                  }}
                />
              </div>

              {licenseError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{licenseError}</AlertDescription>
                </Alert>
              )}

              {licenseValid && (
                <Alert>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <AlertDescription>License activated successfully!</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-between">
                <div />
                {!licenseValid ? (
                  <Button onClick={handleActivate} disabled={activating}>
                    {activating ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Activating...</>
                    ) : (
                      "Activate License"
                    )}
                  </Button>
                ) : (
                  <Button onClick={() => setCurrentStep(2)}>
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: API Keys */}
        {currentStep === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>API Configuration</CardTitle>
              <CardDescription>
                Connect your services. Supabase is required; others are optional.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Supabase URL */}
              <div className="space-y-2">
                <Label htmlFor="supabase-url">
                  Supabase URL <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="supabase-url"
                  value={supabaseUrl}
                  onChange={(e) => { setSupabaseUrl(e.target.value); setSupabaseStatus("idle") }}
                  placeholder="https://your-project.supabase.co"
                />
              </div>

              {/* Supabase Key */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="supabase-key">
                    Supabase Anon Key <span className="text-red-500">*</span>
                  </Label>
                  {supabaseHint && (
                    <span className="text-xs text-muted-foreground">Current: {supabaseHint}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    id="supabase-key"
                    type="password"
                    value={supabaseKey}
                    onChange={(e) => { setSupabaseKey(e.target.value); setSupabaseStatus("idle") }}
                    placeholder={supabaseHint ? "Enter new key to update" : "eyJh..."}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testConnection("supabase")}
                    disabled={supabaseStatus === "testing" || !supabaseUrl.trim() || !supabaseKey.trim()}
                  >
                    {supabaseStatus === "testing" ? <Loader2 className="h-4 w-4 animate-spin" /> :
                     supabaseStatus === "ok" ? <CheckCircle className="h-4 w-4 text-green-500" /> :
                     supabaseStatus === "error" ? <AlertCircle className="h-4 w-4 text-red-500" /> :
                     "Test"}
                  </Button>
                </div>
              </div>

              {/* Gemini */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="gemini-key">Gemini API Key <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  {geminiHint && (
                    <span className="text-xs text-muted-foreground">Current: {geminiHint}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    id="gemini-key"
                    type="password"
                    value={geminiKey}
                    onChange={(e) => { setGeminiKey(e.target.value); setGeminiStatus("idle") }}
                    placeholder={geminiHint ? "Enter new key to update" : "AIza..."}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testConnection("gemini")}
                    disabled={geminiStatus === "testing" || !geminiKey.trim()}
                  >
                    {geminiStatus === "testing" ? <Loader2 className="h-4 w-4 animate-spin" /> :
                     geminiStatus === "ok" ? <CheckCircle className="h-4 w-4 text-green-500" /> :
                     geminiStatus === "error" ? <AlertCircle className="h-4 w-4 text-red-500" /> :
                     "Test"}
                  </Button>
                </div>
              </div>

              {/* ElevenLabs */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="elevenlabs-key">ElevenLabs API Key <span className="text-xs text-muted-foreground">(optional)</span></Label>
                  {elevenlabsHint && (
                    <span className="text-xs text-muted-foreground">Current: {elevenlabsHint}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    id="elevenlabs-key"
                    type="password"
                    value={elevenlabsKey}
                    onChange={(e) => { setElevenlabsKey(e.target.value); setElevenlabsStatus("idle") }}
                    placeholder={elevenlabsHint ? "Enter new key to update" : "sk_..."}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testConnection("elevenlabs")}
                    disabled={elevenlabsStatus === "testing" || !elevenlabsKey.trim()}
                  >
                    {elevenlabsStatus === "testing" ? <Loader2 className="h-4 w-4 animate-spin" /> :
                     elevenlabsStatus === "ok" ? <CheckCircle className="h-4 w-4 text-green-500" /> :
                     elevenlabsStatus === "error" ? <AlertCircle className="h-4 w-4 text-red-500" /> :
                     "Test"}
                  </Button>
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => setCurrentStep(1)} disabled={isEditMode}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Back
                </Button>
                <Button onClick={() => setCurrentStep(3)}>
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Crash Reporting */}
        {currentStep === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
              <CardDescription>
                Help improve Edit Factory by sharing crash reports
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1 pr-4">
                  <p className="text-sm font-medium">Enable Crash Reporting</p>
                  <p className="text-xs text-muted-foreground">
                    Automatically send anonymous crash reports to help improve Edit Factory.
                    Data collected: error messages, stack traces, and OS version.
                    Your video content and API keys are never included.
                  </p>
                </div>
                <Switch
                  checked={crashReporting}
                  onCheckedChange={setCrashReporting}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Defaults to OFF. You can change this anytime in Settings.
              </p>

              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => setCurrentStep(2)}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Back
                </Button>
                <Button onClick={handleFinish} disabled={finishing}>
                  {finishing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                  ) : (
                    <>{isEditMode ? "Save Changes" : "Finish Setup"} <ArrowRight className="ml-1 h-4 w-4" /></>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
