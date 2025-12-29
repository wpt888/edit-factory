import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const navLinks = [
  { label: "Functionalitati", href: "/functionalitati" },
  { label: "Cum functioneaza", href: "/cum-functioneaza" },
  { label: "Preturi", href: "/preturi" },
  { label: "Testimoniale", href: "/testimoniale" },
  { label: "Contact", href: "/contact" },
];

export default function ContactPage() {
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
                    link.href === "/contact" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
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
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Contact</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Ai intrebari? Suntem aici sa te ajutam. Completeaza formularul si te contactam in cel mai scurt timp.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <Card className="bg-card border-border">
              <CardContent className="p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-6">Trimite un Mesaj</h2>
                <form className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nume</Label>
                      <Input id="name" placeholder="Numele tau" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" placeholder="email@exemplu.ro" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="subject">Subiect</Label>
                    <Input id="subject" placeholder="Despre ce este vorba?" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Mesaj</Label>
                    <Textarea
                      id="message"
                      placeholder="Scrie mesajul tau aici..."
                      className="min-h-[150px]"
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    Trimite Mesaj
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-semibold mb-3">Email</h3>
                <p className="text-muted-foreground">contact@editai.ro</p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-3">Telefon</h3>
                <p className="text-muted-foreground">+40 123 456 789</p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-3">Adresa</h3>
                <p className="text-muted-foreground">
                  Strada Exemplu 123<br />
                  Bucuresti, Romania
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-3">Program</h3>
                <p className="text-muted-foreground">
                  Luni - Vineri: 09:00 - 18:00<br />
                  Sambata - Duminica: Inchis
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
