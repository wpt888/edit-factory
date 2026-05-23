import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getCheckoutUrl } from "@/lib/lemon-squeezy";

export function Pricing() {
  return (
    <section id="pricing" className="py-20">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-3xl md:text-4xl font-bold text-center">Simple pricing</h2>
        <p className="text-muted-foreground text-center mt-4 max-w-2xl mx-auto">
          Pay once for the desktop app. Add Cloud Sync if you work across devices.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">

          {/* Tier 1 — Starter */}
          <Card>
            <CardHeader>
              <CardDescription>Starter</CardDescription>
              <CardTitle className="text-4xl">$79</CardTitle>
              <CardDescription>one-time</CardDescription>
            </CardHeader>
            <Separator className="my-4" />
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li>AI scripts</li>
                <li>Edge-TTS</li>
                <li>Basic export</li>
                <li>1 device</li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full">
                <a href={getCheckoutUrl("starter")}>Buy Starter</a>
              </Button>
            </CardFooter>
          </Card>

          {/* Tier 2 — Pro */}
          <Card className="border-primary border-2 md:scale-105 relative">
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most popular</Badge>
            <CardHeader>
              <CardDescription>Pro</CardDescription>
              <CardTitle className="text-4xl">$149</CardTitle>
              <CardDescription>one-time</CardDescription>
            </CardHeader>
            <Separator className="my-4" />
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li>Everything in Starter</li>
                <li>ElevenLabs BYOAK</li>
                <li>Voice cloning unlock</li>
                <li>Multi-platform export</li>
                <li>1–5 device activations</li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full">
                <a href={getCheckoutUrl("pro")}>Buy Pro</a>
              </Button>
            </CardFooter>
          </Card>

          {/* Tier 3 — Cloud Sync */}
          <Card>
            <CardHeader>
              <CardDescription>Cloud Sync</CardDescription>
              <CardTitle className="text-4xl">
                $39<span className="text-base text-muted-foreground">/yr</span>
              </CardTitle>
              <CardDescription>add-on to Starter or Pro</CardDescription>
            </CardHeader>
            <Separator className="my-4" />
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li>Sync projects across devices</li>
                <li>Off-machine backup</li>
                <li>Optional — desktop fully works without it</li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button asChild variant="outline" className="w-full">
                <a href={getCheckoutUrl("cloud_sync")}>Add Cloud Sync</a>
              </Button>
            </CardFooter>
          </Card>

        </div>
      </div>
    </section>
  );
}
