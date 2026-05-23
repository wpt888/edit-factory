export function Comparison() {
  return (
    <section id="comparison" className="py-20">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-3xl md:text-4xl font-bold text-center">How we compare</h2>
        <p className="text-muted-foreground text-center mt-4 max-w-2xl mx-auto">
          Subscription tools bundle the same APIs with their own margin and lock you into pricing tiers. We don&apos;t.
        </p>
        <div className="mt-12 max-w-5xl mx-auto overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">Edit Factory vs SaaS competitors comparison</caption>
            <thead className="bg-muted">
              <tr>
                <th scope="col" className="text-left p-4">Feature</th>
                <th scope="col" className="text-left p-4">Edit Factory</th>
                <th scope="col" className="text-left p-4">Captions.ai (or similar)</th>
                <th scope="col" className="text-left p-4">Submagic (or similar)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <th scope="row" className="text-left p-4 font-medium">Price model</th>
                <td className="p-4">One-time $79–$149</td>
                <td className="p-4">$29/mo+</td>
                <td className="p-4">$16/mo+</td>
              </tr>
              <tr className="border-b">
                <th scope="row" className="text-left p-4 font-medium">Runs offline</th>
                <td className="p-4">✓ (local-first)</td>
                <td className="p-4">✗ (cloud only)</td>
                <td className="p-4">✗ (cloud only)</td>
              </tr>
              <tr className="border-b">
                <th scope="row" className="text-left p-4 font-medium">Bring your own API key</th>
                <td className="p-4">✓ (Gemini, ElevenLabs)</td>
                <td className="p-4">✗</td>
                <td className="p-4">✗</td>
              </tr>
              <tr className="border-b">
                <th scope="row" className="text-left p-4 font-medium">Source data ownership</th>
                <td className="p-4">✓ (your machine)</td>
                <td className="p-4">✗ (their cloud)</td>
                <td className="p-4">✗ (their cloud)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
