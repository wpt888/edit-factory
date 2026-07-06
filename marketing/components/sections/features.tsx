import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Sparkles, Mic, Aperture, Layers, HardDrive, BadgeCheck } from "lucide-react";

const features = [
  {
    icon: Sparkles,
    title: "AI script generation",
    description: "Gemini-powered script variants tuned for reels, TikTok, YouTube Shorts.",
  },
  {
    icon: Mic,
    title: "Voice cloning & TTS",
    description: "Bring your own ElevenLabs key. Optional offline voice cloning via downloadable ML bundle.",
  },
  {
    icon: Aperture,
    title: "Multi-platform export",
    description: "Render once, export to vertical 9:16, square 1:1, horizontal 16:9.",
  },
  {
    icon: Layers,
    title: "Batch production",
    description: "Generate dozens of variants from a single source — perfect for content sprints.",
  },
  {
    icon: HardDrive,
    title: "Local-first",
    description: "Your media, your machine. Cloud Sync optional.",
  },
  {
    icon: BadgeCheck,
    title: "One-time license",
    description: "Pay once, own it. No monthly fees, no vendor lock-in.",
  },
];

export function Features() {
  return (
    <section id="features" className="py-20 bg-muted/30">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-3xl md:text-4xl font-bold text-center">Why Blipost</h2>
        <p className="text-muted-foreground text-center mt-4 max-w-2xl mx-auto">
          Built for indie creators who want production-grade output without subscription fatigue.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title}>
                <CardHeader>
                  <Icon className="size-8 text-primary mb-3" />
                  <CardTitle>{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
