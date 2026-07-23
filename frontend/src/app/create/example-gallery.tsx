"use client";

import { useEffect, useState } from "react";
import { Play, Square, WandSparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { ExploreMediaGallery } from "./explore-media-gallery";

export type ExampleMode = "image" | "video" | "soundtrack";

interface VoiceExample {
  id: string;
  title: string;
  narration: string;
}

const VOICE_EXAMPLES: VoiceExample[] = [
  {
    id: "voice-product-hook",
    title: "Product hook",
    narration:
      "Nu e doar un produs nou. Este detaliul simplu care îți face fiecare zi mai ușoară, mai rapidă și mult mai bine organizată.",
  },
  {
    id: "voice-calm-story",
    title: "Calm brand story",
    narration:
      "În fiecare dimineață alegem lucrurile care ne fac să ne simțim bine. Formule curate, gesturi simple și timp păstrat pentru tine.",
  },
  {
    id: "voice-energetic-launch",
    title: "Energetic launch",
    narration:
      "A sosit momentul să ieși în evidență. Descoperă noua colecție, alege varianta ta preferată și transformă ideea în acțiune.",
  },
  {
    id: "voice-natural-testimonial",
    title: "Natural testimonial",
    narration:
      "L-am încercat din curiozitate, dar a rămas în rutina mea pentru că este simplu, confortabil și chiar face ce promite.",
  },
];

function VoiceExampleCard({
  example,
  speaking,
  onPreview,
  onUseNarration,
}: {
  example: VoiceExample;
  speaking: boolean;
  onPreview: (example: VoiceExample) => void;
  onUseNarration: (narration: string) => void;
}) {
  return (
    <Card
      data-testid="example-soundtrack"
      className="gap-0 overflow-hidden py-0"
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <div
          className="flex h-20 items-center justify-center gap-1 rounded-md border border-border bg-surface-canvas px-3"
          aria-hidden="true"
        >
          {[18, 32, 46, 28, 54, 36, 22, 42, 26, 50, 20, 34].map((height, index) => (
            <span
              key={`${example.id}:${index}`}
              className="w-1 rounded-full bg-primary/55"
              style={{ height }}
            />
          ))}
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{example.title}</p>
              <Badge variant="outline">Example</Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {example.narration}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={speaking}
              onClick={() => onPreview(example)}
            >
              {speaking ? <Square className="size-3 fill-current" /> : <Play className="size-4" />}
              {speaking ? "Stop preview" : "Preview voice"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onUseNarration(example.narration)}
            >
              <WandSparkles className="size-4" />
              Use this narration
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ExampleGallery({
  mode,
  onUsePrompt,
}: {
  mode: ExampleMode;
  onUsePrompt: (prompt: string) => void;
}) {
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (mode !== "soundtrack") {
    return <ExploreMediaGallery />;
  }

  const previewVoice = (example: VoiceExample) => {
    if (!("speechSynthesis" in window)) {
      toast.info("Voice preview is not available in this browser.");
      return;
    }

    window.speechSynthesis.cancel();
    if (speakingId === example.id) {
      setSpeakingId(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(example.narration);
    utterance.lang = "ro-RO";
    utterance.rate = 0.96;
    utterance.pitch = 1;
    const romanianVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith("ro"));
    if (romanianVoice) utterance.voice = romanianVoice;
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(example.id);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <section className="space-y-4" aria-labelledby="voice-examples-heading">
      <div>
        <h2 id="voice-examples-heading" className="font-heading text-lg font-semibold">
          Explore voice ideas
        </h2>
        <p className="text-sm text-muted-foreground">
          Preview a Romanian voice direction before generating it with ElevenLabs.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {VOICE_EXAMPLES.map((example) => (
          <VoiceExampleCard
            key={example.id}
            example={example}
            speaking={speakingId === example.id}
            onPreview={previewVoice}
            onUseNarration={onUsePrompt}
          />
        ))}
      </div>
    </section>
  );
}
