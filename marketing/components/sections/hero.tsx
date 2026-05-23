import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section id="hero" className="py-20 md:py-32 bg-background text-center">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
          Automated video production for indie creators.
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mt-6">
          Edit Factory turns any input — feed, script, idea — into social-media-ready videos. Runs entirely on your desktop. One-time license, no subscription.
        </p>
        <div className="flex gap-4 justify-center mt-10">
          <Button asChild size="lg">
            <a href="/signup">Get Started</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#pricing">See pricing</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
