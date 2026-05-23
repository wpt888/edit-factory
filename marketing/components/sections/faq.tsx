"use client"

import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

export function FAQ() {
  return (
    <section id="faq" className="py-20 bg-muted/30">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-3xl md:text-4xl font-bold text-center">Frequently asked questions</h2>
        <Accordion type="single" collapsible className="max-w-3xl mx-auto mt-12 px-4">
          <AccordionItem value="item-1">
            <AccordionTrigger>What&apos;s the difference between BYOAK and a subscription?</AccordionTrigger>
            <AccordionContent>
              BYOAK = &quot;Bring Your Own API Key.&quot; You pay Edit Factory once for the software and use your own Gemini / ElevenLabs / fal.ai keys at provider pricing. There&apos;s no monthly markup. You can switch providers anytime. Subscription tools bundle the same APIs with their own margin and lock you into their pricing tiers — we don&apos;t.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>What&apos;s the ~1.5 GB optional ML bundle for?</AccordionTrigger>
            <AccordionContent>
              The bundle adds offline voice cloning (Coqui XTTS), source-voice removal (Silero VAD), and high-quality local transcription (Whisper). You don&apos;t need it for the core workflow — Gemini scripts + ElevenLabs TTS + Edge TTS work without it. Download it from Settings → ML Features when you want offline voice features.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger>What&apos;s Cloud Sync and do I need it?</AccordionTrigger>
            <AccordionContent>
              Cloud Sync ($39/yr add-on) keeps your projects, scripts, and renders synced across multiple Edit Factory installs and gives you an off-machine backup. Skip it if you work from one device and back up your own drive — the desktop app is fully functional without it.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-4">
            <AccordionTrigger>Why does Windows show a SmartScreen warning when I install?</AccordionTrigger>
            <AccordionContent>
              We ship Edit Factory unsigned in v13 to keep the price down. Windows SmartScreen warns about any unsigned installer until enough users run it. Click &quot;More info&quot; → &quot;Run anyway&quot; to install. We sign installers in v14.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-5">
            <AccordionTrigger>What&apos;s your refund policy?</AccordionTrigger>
            <AccordionContent>
              30-day no-questions refund. Email us and we&apos;ll refund through Lemon Squeezy — you keep the install on your machine until the refund clears.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-6">
            <AccordionTrigger>Can I use Edit Factory on more than one device?</AccordionTrigger>
            <AccordionContent>
              Starter: 1 device. Pro: up to 5 devices (deactivate old ones from your /account/license page). Cloud Sync makes multi-device painless because projects stay in sync; without Cloud Sync you can still move files manually.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </section>
  );
}
