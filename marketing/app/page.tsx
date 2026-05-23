import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-background text-foreground">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle className="text-3xl">Edit Factory — Production-Ready Video Tools</CardTitle>
          <CardDescription className="text-base mt-2">
            Automated video production for social media creators. Scripts, voiceovers, and assembly — all on your desktop.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Coming soon: full landing page in Phase 90.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
