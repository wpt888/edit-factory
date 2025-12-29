import Link from "next/link";
import { Button } from "@/components/ui/button";

const navLinks = [
  { label: "Functionalitati", href: "/functionalitati" },
  { label: "Cum functioneaza", href: "/cum-functioneaza" },
  { label: "Preturi", href: "/preturi" },
  { label: "Testimoniale", href: "/testimoniale" },
  { label: "Contact", href: "/contact" },
];

export default function CumFunctioneazaPage() {
  const steps = [
    {
      number: "01",
      title: "Incarca Videoclipul",
      description: "Trage si plaseaza videoclipul tau in interfata sau selecteaza-l din calculator. Acceptam MP4, MOV, AVI si MKV.",
    },
    {
      number: "02",
      title: "Configureaza Optiunile",
      description: "Seteaza durata dorita, adauga fisiere audio sau subtitrari, si scrie textul pentru voiceover daca doresti.",
    },
    {
      number: "03",
      title: "AI-ul Proceseaza",
      description: "Algoritmii nostri analizeaza videoclipul, detecteaza scenele importante si selecteaza cele mai bune segmente.",
    },
    {
      number: "04",
      title: "Revizuieste si Exporta",
      description: "Previzualizeaza rezultatul, fa ajustari daca e nevoie, apoi descarca videoclipul optimizat pentru social media.",
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
                    link.href === "/cum-functioneaza" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
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
        <div className="w-full max-w-[1000px] mx-auto px-6 md:px-10 lg:px-16">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Cum Functioneaza</h1>
          <p className="text-muted-foreground text-lg mb-12 max-w-2xl">
            In 4 pasi simpli, transformi orice videoclip in continut viral pentru social media.
          </p>

          <div className="space-y-12">
            {steps.map((step, index) => (
              <div key={index} className="flex gap-6 md:gap-8">
                <div className="flex-shrink-0">
                  <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl">
                    {step.number}
                  </div>
                </div>
                <div className="pt-2">
                  <h3 className="text-2xl font-semibold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground text-lg leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-16 text-center">
            <Button asChild size="lg" className="text-lg px-8 py-6 font-semibold">
              <Link href="/">Incearca Acum</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
