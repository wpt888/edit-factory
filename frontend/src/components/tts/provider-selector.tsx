"use client"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

interface TTSProvider {
  id: string
  name: string
  description: string
  costPer1kChars: number
  available: boolean
  supportsVoiceCloning: boolean
}

const TTS_PROVIDERS: TTSProvider[] = [
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Premium quality, natural-sounding voices",
    costPer1kChars: 0.22,
    available: true,
    supportsVoiceCloning: false
  },
  {
    id: "edge",
    name: "Edge TTS",
    description: "Microsoft Edge voices, completely free",
    costPer1kChars: 0,
    available: true,
    supportsVoiceCloning: false
  },
  {
    id: "coqui",
    name: "Coqui XTTS",
    description: "Voice cloning with 6-second sample",
    costPer1kChars: 0,
    available: true,
    supportsVoiceCloning: true
  },
  {
    id: "kokoro",
    name: "Kokoro TTS",
    description: "Fast lightweight local TTS",
    costPer1kChars: 0,
    available: true,
    supportsVoiceCloning: false
  },
]

interface ProviderSelectorProps {
  value: string
  onChange: (provider: string) => void
  disabled?: boolean
}

export function ProviderSelector({ value, onChange, disabled }: ProviderSelectorProps) {
  return (
    <RadioGroup value={value} onValueChange={onChange} disabled={disabled}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TTS_PROVIDERS.map((provider) => (
          <Card
            key={provider.id}
            className={`cursor-pointer transition-all ${
              value === provider.id
                ? "ring-2 ring-primary border-primary"
                : "hover:border-primary/50"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={() => !disabled && onChange(provider.id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <RadioGroupItem
                  value={provider.id}
                  id={provider.id}
                  disabled={disabled}
                  className="mt-1"
                />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor={provider.id}
                      className="text-base font-semibold cursor-pointer"
                    >
                      {provider.name}
                    </Label>
                    <Badge
                      variant={provider.costPer1kChars === 0 ? "default" : "secondary"}
                      className={
                        provider.costPer1kChars === 0
                          ? "bg-green-500 hover:bg-green-600"
                          : ""
                      }
                    >
                      {provider.costPer1kChars === 0
                        ? "Free"
                        : `$${provider.costPer1kChars.toFixed(2)}/1k chars`}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {provider.description}
                  </p>
                  {provider.supportsVoiceCloning && (
                    <Badge variant="outline" className="text-xs">
                      Voice Cloning Available
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </RadioGroup>
  )
}
