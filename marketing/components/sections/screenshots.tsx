import { Card, CardContent } from "@/components/ui/card";

export function Screenshots() {
  return (
    <section id="screenshots" className="py-20 bg-muted/30">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-3xl md:text-4xl font-bold text-center">See it in action</h2>
        <p className="text-muted-foreground text-center mt-4 max-w-2xl mx-auto">
          Real desktop screenshots land with the v13 alpha. Until then, here&apos;s what to expect.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <Card>
            <CardContent>
              <div className="aspect-video bg-muted rounded-md flex items-center justify-center text-muted-foreground text-sm">
                Screenshot coming soon
              </div>
              <p className="mt-3 text-sm text-center text-muted-foreground">Script generation</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="aspect-video bg-muted rounded-md flex items-center justify-center text-muted-foreground text-sm">
                Screenshot coming soon
              </div>
              <p className="mt-3 text-sm text-center text-muted-foreground">Pipeline preview</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="aspect-video bg-muted rounded-md flex items-center justify-center text-muted-foreground text-sm">
                Screenshot coming soon
              </div>
              <p className="mt-3 text-sm text-center text-muted-foreground">Multi-platform export</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
