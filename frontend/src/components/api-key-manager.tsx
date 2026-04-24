"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Trash2, Star, Plus, Key, Eye, EyeOff } from "lucide-react"
import { apiGetWithRetry, apiPost, apiDelete, handleApiError } from "@/lib/api"
import { toast } from "sonner"
import { useProfile } from "@/contexts/profile-context"

interface VaultKey {
  id: string
  service: string
  label: string
  api_key_hint: string
  is_primary: boolean
  is_active: boolean
  is_env_default?: boolean
  sort_order: number
  quota_limit?: number | null
  quota_used?: number | null
  tier?: string | null
  last_error?: string | null
}

interface ApiKeyManagerProps {
  service: string
  label: string
  description?: string
}

export function ApiKeyManager({ service, label, description }: ApiKeyManagerProps) {
  const { currentProfile } = useProfile()
  const [keys, setKeys] = useState<VaultKey[]>([])
  const [loading, setLoading] = useState(false)
  const [newLabel, setNewLabel] = useState("")
  const [newKey, setNewKey] = useState("")
  const [showNewKey, setShowNewKey] = useState(false)
  const [adding, setAdding] = useState(false)
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, string>>({})
  const [secretLoading, setSecretLoading] = useState<string | null>(null)

  const loadKeys = useCallback(async () => {
    if (!currentProfile) return
    setLoading(true)
    try {
      const response = await apiGetWithRetry(`/api-keys/${service}/`)
      const data = await response.json()
      setKeys(data.keys || [])
      setVisibleSecrets({})
    } catch (error) {
      handleApiError(error, `Error loading ${label} keys`)
    } finally {
      setLoading(false)
    }
  }, [currentProfile, service, label])

  useEffect(() => {
    loadKeys()
  }, [loadKeys])

  const handleAdd = async () => {
    if (!newLabel.trim() || !newKey.trim()) {
      toast.error("Label and API key are required")
      return
    }
    setAdding(true)
    setTestStatus("idle")
    try {
      // Validate first — never persist a key that fails provider auth
      const validateRes = await apiPost(`/api-keys/${service}/validate`, { api_key: newKey.trim() })
      const validateData = await validateRes.json()
      if (!validateData.connected) {
        setTestStatus("error")
        toast.error(`${label} key invalid: ${validateData.error || "Authentication failed"}`)
        return
      }
      // Key is valid — persist it
      await apiPost(`/api-keys/${service}/`, {
        label: newLabel.trim(),
        api_key: newKey.trim(),
      })
      setTestStatus("success")
      toast.success(`${label} key validated and added`)
      setNewLabel("")
      setNewKey("")
      setTimeout(() => setTestStatus("idle"), 4000)
      loadKeys()
    } catch (error) {
      setTestStatus("error")
      handleApiError(error, `Failed to add ${label} key`)
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (keyId: string) => {
    if (!confirm("Delete this API key?")) return
    setActionLoading(keyId)
    try {
      await apiDelete(`/api-keys/${service}/${keyId}`)
      toast.success("Key deleted")
      loadKeys()
    } catch (error) {
      handleApiError(error, "Failed to delete key")
    } finally {
      setActionLoading(null)
    }
  }

  const handleSetPrimary = async (keyId: string) => {
    setActionLoading(keyId)
    try {
      await apiPost(`/api-keys/${service}/${keyId}/set-primary`, {})
      toast.success("Primary key updated")
      loadKeys()
    } catch (error) {
      handleApiError(error, "Failed to set primary")
    } finally {
      setActionLoading(null)
    }
  }

  const handleToggleSecret = async (keyId: string) => {
    if (visibleSecrets[keyId]) {
      setVisibleSecrets((prev) => {
        const next = { ...prev }
        delete next[keyId]
        return next
      })
      return
    }

    setSecretLoading(keyId)
    try {
      const response = await apiGetWithRetry(`/api-keys/${service}/${keyId}/secret`)
      const data = await response.json()
      setVisibleSecrets((prev) => ({ ...prev, [keyId]: data.api_key || "" }))
    } catch (error) {
      handleApiError(error, `Failed to reveal ${label} key`)
    } finally {
      setSecretLoading(null)
    }
  }

  const dbKeys = keys.filter(k => !k.is_env_default)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1">
            <Key className="h-4 w-4 text-emerald-300" />
            <h3 className="text-sm font-semibold tracking-wide text-foreground">
              {label}
            </h3>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              API Credentials
            </p>
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {dbKeys.length}/3 keys
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No keys configured. Using .env fallback if available.
        </p>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div
              key={key.id}
              className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-colors ${
                key.is_primary
                  ? "border-green-500 bg-green-500/5"
                  : !key.is_active
                    ? "opacity-50 bg-muted/50 border-transparent"
                    : "border-muted bg-muted/30"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{key.label}</span>
                  {key.is_primary && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-600 text-white">
                      ACTIV
                    </span>
                  )}
                  {key.is_env_default && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                      .env
                    </span>
                  )}
                  {!key.is_active && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                      Disabled
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-muted-foreground font-mono break-all">
                    {visibleSecrets[key.id] || key.api_key_hint}
                  </span>
                  {key.last_error && (
                    <span className="text-xs text-red-500 truncate max-w-[150px]" title={key.last_error}>
                      {key.last_error}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleToggleSecret(key.id)}
                  disabled={secretLoading === key.id}
                  title={visibleSecrets[key.id] ? "Hide key" : "Show key"}
                >
                  {secretLoading === key.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : visibleSecrets[key.id] ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
                {!key.is_primary && key.is_active && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => handleSetPrimary(key.id)}
                    disabled={actionLoading === key.id}
                  >
                    {actionLoading === key.id ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Star className="mr-1 h-3 w-3" />
                    )}
                    Foloseste
                  </Button>
                )}
                {!key.is_env_default && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-500 hover:text-red-600"
                    onClick={() => handleDelete(key.id)}
                    disabled={actionLoading === key.id}
                    title="Delete key"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Key Form */}
      {dbKeys.length < 3 && (
        <div className="pt-3 border-t space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Label (e.g. Production)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="h-9 text-sm"
            />
            <div className="relative">
              <Input
                type={showNewKey ? "text" : "password"}
                placeholder="API Key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="h-9 text-sm pr-10"
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-9 w-9"
                onClick={() => setShowNewKey(!showNewKey)}
              >
                {showNewKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          <Button
            size="sm"
            className="w-full h-9"
            onClick={handleAdd}
            disabled={adding || !newLabel.trim() || !newKey.trim()}
          >
            {adding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {adding ? "Validating…" : `Test & Add ${label} Key`}
          </Button>
          {testStatus === "success" && (
            <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded-md border border-green-500/30">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-green-600 dark:text-green-400">Key validated and added</span>
            </div>
          )}
          {testStatus === "error" && (
            <div className="flex items-center gap-2 p-2 bg-red-500/10 rounded-md border border-red-500/30">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-xs text-red-600 dark:text-red-400">Validation failed — key not saved</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
