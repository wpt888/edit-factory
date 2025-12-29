import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const navLinks = [
  { label: "Functionalitati", href: "/functionalitati" },
  { label: "Cum functioneaza", href: "/cum-functioneaza" },
  { label: "Preturi", href: "/preturi" },
  { label: "Testimoniale", href: "/testimoniale" },
  { label: "Contact", href: "/contact" },
];

export default function PreturiPage() {
  const plans = [
    {
      name: "Gratuit",
      price: "0",
      period: "pentru totdeauna",
      description: "Perfect pentru a testa platforma",
      features: [
        "5 videoclipuri pe luna",
        "Durata maxima 30 secunde",
        "Export 720p",
        "Filigran EditAI",
      ],
      cta: "Incepe Gratuit",
      highlighted: false,
    },
    {
      name: "Pro",
      price: "49",
      period: "pe luna",
      description: "Pentru creatori de continut",
      features: [
        "50 videoclipuri pe luna",
        "Durata maxima 3 minute",
        "Export 1080p",
        "Fara filigran",
        "Subtitrari automate",
        "Suport prioritar",
      ],
      cta: "Alege Pro",
      highlighted: true,
    },
    {
      name: "Business",
      price: "149",
      period: "pe luna",
      description: "Pentru echipe si agentii",
      features: [
        "Videoclipuri nelimitate",
        "Durata nelimitata",
        "Export 4K",
        "API Access",
        "Voiceover TTS",
        "Manager de cont dedicat",
      ],
      cta: "Contacteaza-ne",
      highlighted: false,
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="flex items-center justify-between h-16">
            <Link href="/statsai" className="text-xl md:text-2xl font-bold text-primary">
              EditAI
            </Link>

            <div className="hidden lg:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={`px-4 py-2 text-sm font-medium transition-colors rounded-md hover:bg-accent ${
                    link.href === "/preturi" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex text-muted-foreground hover:text-foreground">
                Autentificare
              </Button>
              <Button size="sm" className="font-semibold">
                Inscrie-te
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-16">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Preturi Simple</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Alege planul potrivit pentru nevoile tale. Fara costuri ascunse.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan, index) => (
              <Card
                key={index}
                className={`bg-card border-border ${plan.highlighted ? 'border-primary ring-2 ring-primary/20' : ''}`}
              >
                <CardContent className="p-6 md:p-8">
                  <h3 className="text-xl font-semibold mb-2">{plan.name}</h3>
                  <div className="mb-4">
                    <span className="text-4xl font-bold">{plan.price} RON</span>
                    <span className="text-muted-foreground ml-2">{plan.period}</span>
                  </div>
                  <p className="text-muted-foreground text-sm mb-6">{plan.description}</p>

                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                          <div className="w-2 h-2 rounded-full bg-primary" />
                        </div>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Button
                    className="w-full"
                    variant={plan.highlighted ? "default" : "outline"}
                  >
                    {plan.cta}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
