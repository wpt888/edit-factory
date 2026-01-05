"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Separator } from "@/components/ui/separator";

export default function EditAILanding() {
  const navLinks = [
    { label: "Functionalitati", href: "/functionalitati" },
    { label: "Cum functioneaza", href: "/cum-functioneaza" },
    { label: "Preturi", href: "/preturi" },
    { label: "Testimoniale", href: "/testimoniale" },
    { label: "Contact", href: "/contact" },
  ];

  const features = [
    {
      title: "Analiza in Timp Real",
      description:
        "Obtine instant informatii despre comportamentul vizitatorilor, conversii si performanta vanzarilor.",
    },
    {
      title: "Predictii Bazate pe AI",
      description:
        "Algoritmii nostri de machine learning prezic tendintele si identifica oportunitatile inaintea competitiei.",
    },
    {
      title: "Recomandari Inteligente",
      description:
        "Primesti sugestii actionabile pentru optimizarea site-ului si cresterea ratei de conversie.",
    },
  ];

  const steps = [
    {
      number: "01",
      title: "Conecteaza-ti Site-ul",
      description:
        "Adauga un script simplu pe site si incepe sa colectezi date in cateva minute.",
    },
    {
      number: "02",
      title: "AI-ul Analizeaza Totul",
      description:
        "Algoritmii nostri proceseaza comportamentul vizitatorilor, identifica tipare si detecteaza anomalii.",
    },
    {
      number: "03",
      title: "Obtine Informatii Valoroase",
      description:
        "Primesti recomandari clare si urmaresti cum cresc ratele de conversie.",
    },
  ];

  const testimonials = [
    {
      quote:
        "EditAI a transformat modul in care ne intelegem clientii. Rata de conversie a crescut cu 47% in doar doua luni.",
      name: "Maria Popescu",
      role: "Director Marketing, TechFlow",
      avatar: "MP",
    },
    {
      quote:
        "Predictiile AI sunt incredibil de precise. E ca si cum ai avea un data scientist care lucreaza 24/7 la o fractiune din cost.",
      name: "Andrei Ionescu",
      role: "CEO, Elevate Commerce",
      avatar: "AI",
    },
    {
      quote:
        "In sfarsit, analize care iti spun ce sa faci mai departe. Nu te mai ineci in dashboard-uri fara directie.",
      name: "Elena Dumitrescu",
      role: "Director Marketing, Bloom",
      avatar: "ED",
    },
  ];

  const productLinks = [
    { label: "Dashboard Analize", href: "/dashboard" },
    { label: "Predictii AI", href: "/predictii" },
    { label: "Urmarire Vanzari", href: "/vanzari" },
    { label: "Integratii", href: "/integratii" },
    { label: "Acces API", href: "/api" },
  ];

  const companyLinks = [
    { label: "Despre Noi", href: "/despre" },
    { label: "Cariere", href: "/cariere" },
    { label: "Blog", href: "/blog" },
    { label: "Presa", href: "/presa" },
    { label: "Contact", href: "/contact" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero Section - fara min-h-screen pentru spatiu mai mic */}
      <section className="relative pt-24 pb-20 md:pt-32 md:pb-28 overflow-hidden">
        {/* Unicorn.studio Background Placeholder */}
        <div
          id="unicorn-studio-background"
          className="absolute inset-0 z-0"
          aria-label="Interactive background element - Unicorn.studio integration"
        />

        {/* Hero Content */}
        <div className="relative z-10 w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="max-w-4xl">
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.1] mb-6">
              <span className="block text-foreground">EDITEAZA</span>
              <span className="block text-foreground">INTELIGENT,</span>
              <span className="block text-primary">INTR-UN FINAL.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-xl mb-8">
              Informatii bazate pe AI care transforma datele site-ului tau in venituri.
              Intelege-ti vizitatorii, prezice-le comportamentul si inchide mai multe vanzari.
            </p>
            <Button asChild size="lg" className="text-lg px-8 py-6 font-semibold">
              <Link href="/">Incearca</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Stats Dashboard Section */}
      <section className="py-16 md:py-20 border-y border-border">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            {/* Timp Economisit */}
            <div className="text-center md:text-left">
              <div className="text-5xl md:text-6xl font-black text-primary mb-2">
                85%
              </div>
              <div className="text-lg font-semibold mb-1">Timp Economisit</div>
              <p className="text-sm text-muted-foreground">
                Reduce timpul de editare de la ore la minute cu procesare automata AI
              </p>
            </div>

            {/* Crestere Engagement */}
            <div className="text-center md:text-left">
              <div className="text-5xl md:text-6xl font-black text-primary mb-2">
                3.2x
              </div>
              <div className="text-lg font-semibold mb-1">Crestere Engagement</div>
              <p className="text-sm text-muted-foreground">
                Continutul optimizat de AI genereaza de 3 ori mai multe interactiuni
              </p>
            </div>

            {/* Eficienta */}
            <div className="text-center md:text-left">
              <div className="text-5xl md:text-6xl font-black text-primary mb-2">
                10x
              </div>
              <div className="text-lg font-semibold mb-1">Eficienta Crescuta</div>
              <p className="text-sm text-muted-foreground">
                Creeaza de 10 ori mai mult continut in acelasi timp cu automatizare
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* De ce EditAI Section */}
      <section id="functionalitati" className="py-16 md:py-24 bg-muted/30">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              De ce EditAI?
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Analizele traditionale iti spun ce s-a intamplat. Noi iti spunem ce sa faci mai departe.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="bg-card border-border hover:border-primary/50 transition-colors"
              >
                <CardContent className="p-6 md:p-8">
                  {/* Icon Placeholder */}
                  <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
                    <div className="w-6 h-6 rounded-md bg-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Cum functioneaza Section */}
      <section id="cum-functioneaza" className="py-16 md:py-24">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Cum Functioneaza
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Incepe in cateva minute, vezi rezultate in cateva zile.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Left Column - Image Placeholder */}
            <div className="order-2 lg:order-1">
              <div className="aspect-[4/3] rounded-2xl bg-muted border border-border shadow-lg overflow-hidden">
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-24 h-24 mx-auto mb-4 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-xl bg-primary opacity-60" />
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Previzualizare Dashboard
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Steps */}
            <div className="order-1 lg:order-2 space-y-8 md:space-y-10">
              {steps.map((step, index) => (
                <div key={index} className="flex gap-6">
                  <div className="flex-shrink-0">
                    <div className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                      {step.number}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                    <p className="text-muted-foreground">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Testimoniale Section */}
      <section id="testimoniale" className="py-16 md:py-24 bg-muted/30">
        <div className="w-full max-w-[1000px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Apreciat de Echipe din Toata Lumea
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Alatura-te miilor de companii care folosesc EditAI pentru a-si dezvolta afacerea.
            </p>
          </div>

          <Carousel
            opts={{
              align: "center",
              loop: true,
            }}
            className="w-full"
          >
            <CarouselContent>
              {testimonials.map((testimonial, index) => (
                <CarouselItem key={index} className="md:basis-full">
                  <Card className="bg-card border-border">
                    <CardContent className="p-8 md:p-12 text-center">
                      <blockquote className="text-xl md:text-2xl font-medium mb-8 leading-relaxed">
                        &ldquo;{testimonial.quote}&rdquo;
                      </blockquote>
                      <div className="flex items-center justify-center gap-4">
                        <Avatar className="w-12 h-12">
                          <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                            {testimonial.avatar}
                          </AvatarFallback>
                        </Avatar>
                        <div className="text-left">
                          <p className="font-semibold">{testimonial.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {testimonial.role}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="hidden md:flex -left-4" />
            <CarouselNext className="hidden md:flex -right-4" />
          </Carousel>
        </div>
      </section>

      {/* Preturi Section */}
      <section id="preturi" className="py-16 md:py-24">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Preturi Simple si Transparente
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Alege planul potrivit pentru nevoile tale. Fara costuri ascunse.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Plan Gratuit */}
            <Card className="bg-card border-border">
              <CardContent className="p-6 md:p-8">
                <h3 className="text-xl font-semibold mb-2">Gratuit</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold">0 RON</span>
                  <span className="text-muted-foreground ml-2">pentru totdeauna</span>
                </div>
                <p className="text-muted-foreground text-sm mb-6">Perfect pentru a testa platforma</p>
                <ul className="space-y-3 mb-8">
                  {["5 videoclipuri pe luna", "Durata maxima 30 secunde", "Export 720p", "Filigran EditAI"].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      </div>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" className="w-full">Incepe Gratuit</Button>
              </CardContent>
            </Card>

            {/* Plan Pro */}
            <Card className="bg-card border-primary ring-2 ring-primary/20">
              <CardContent className="p-6 md:p-8">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-semibold">Pro</h3>
                  <Badge>Popular</Badge>
                </div>
                <div className="mb-4">
                  <span className="text-4xl font-bold">49 RON</span>
                  <span className="text-muted-foreground ml-2">pe luna</span>
                </div>
                <p className="text-muted-foreground text-sm mb-6">Pentru creatori de continut</p>
                <ul className="space-y-3 mb-8">
                  {["50 videoclipuri pe luna", "Durata maxima 3 minute", "Export 1080p", "Fara filigran", "Subtitrari automate", "Suport prioritar"].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      </div>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button className="w-full">Alege Pro</Button>
              </CardContent>
            </Card>

            {/* Plan Business */}
            <Card className="bg-card border-border">
              <CardContent className="p-6 md:p-8">
                <h3 className="text-xl font-semibold mb-2">Business</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold">149 RON</span>
                  <span className="text-muted-foreground ml-2">pe luna</span>
                </div>
                <p className="text-muted-foreground text-sm mb-6">Pentru echipe si agentii</p>
                <ul className="space-y-3 mb-8">
                  {["Videoclipuri nelimitate", "Durata nelimitata", "Export 4K", "API Access", "Voiceover TTS", "Manager dedicat"].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      </div>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" className="w-full">Contacteaza-ne</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Integratii Section */}
      <section className="py-16 md:py-24 bg-muted/30">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Se Integreaza cu Uneltele Tale
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Conecteaza EditAI cu platformele tale preferate pentru un flux de lucru fara intreruperi.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {["Instagram", "TikTok", "YouTube", "Google Drive", "Dropbox", "Canva"].map((platform) => (
              <div
                key={platform}
                className="aspect-square rounded-xl bg-card border border-border flex items-center justify-center p-4 hover:border-primary/50 transition-colors"
              >
                <span className="text-sm font-medium text-center">{platform}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-16 md:py-24">
        <div className="w-full max-w-[800px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Intrebari Frecvente
            </h2>
            <p className="text-muted-foreground text-lg">
              Raspunsuri la cele mai comune intrebari despre EditAI.
            </p>
          </div>

          <div className="space-y-4">
            {[
              {
                q: "Cat dureaza procesarea unui videoclip?",
                a: "In medie, un videoclip de 5 minute este procesat in 2-3 minute. Durata depinde de complexitatea editarii si de planul tau."
              },
              {
                q: "Pot anula abonamentul oricand?",
                a: "Da, poti anula abonamentul oricand din contul tau. Nu exista taxe de anulare sau obligatii pe termen lung."
              },
              {
                q: "Ce formate video sunt suportate?",
                a: "Acceptam MP4, MOV, AVI si MKV. Videoclipurile pot fi incarcate direct sau importate din Google Drive si Dropbox."
              },
              {
                q: "Cum functioneaza subtitrarea automata?",
                a: "AI-ul nostru foloseste recunoastere vocala avansata pentru a genera subtitrari in mai multe limbi, inclusiv romana."
              }
            ].map((faq, index) => (
              <Card key={index} className="bg-card border-border">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-2">{faq.q}</h3>
                  <p className="text-muted-foreground text-sm">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24 bg-primary text-primary-foreground">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="text-center">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">
              Pregatit sa incepi?
            </h2>
            <p className="text-primary-foreground/80 text-lg max-w-2xl mx-auto mb-10">
              Incepe perioada de proba gratuita astazi. Nu este nevoie de card.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" variant="secondary" className="text-lg px-8 py-6 font-semibold">
                <Link href="/">Incepe Perioada de Proba</Link>
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="text-lg px-8 py-6 font-semibold border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
              >
                Programeaza un Demo
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/20">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 py-12 md:py-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 md:gap-12">
            {/* Logo + Mission */}
            <div className="sm:col-span-2 lg:col-span-1">
              <Link href="/statsai" className="inline-block mb-4">
                <span className="text-xl font-bold text-primary">EditAI</span>
              </Link>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Oferim companiilor analize bazate pe AI pentru a lua decizii mai inteligente
                si a stimula cresterea.
              </p>
            </div>

            {/* Product Links */}
            <div>
              <h4 className="font-semibold mb-4">Produs</h4>
              <ul className="space-y-3">
                {productLinks.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company Links */}
            <div>
              <h4 className="font-semibold mb-4">Companie</h4>
              <ul className="space-y-3">
                {companyLinks.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Social Icons */}
            <div>
              <h4 className="font-semibold mb-4">Urmareste-ne</h4>
              <div className="flex gap-3">
                {["X", "LI", "GH", "YT"].map((social) => (
                  <div
                    key={social}
                    className="w-10 h-10 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                    aria-label={`Social icon placeholder - ${social}`}
                  >
                    {social}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Separator className="my-8" />

          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
            <p>&copy; 2025 EditAI. Toate drepturile rezervate.</p>
            <div className="flex gap-6">
              <Link href="/politica-confidentialitate" className="hover:text-foreground transition-colors">
                Politica de Confidentialitate
              </Link>
              <Link href="/termeni" className="hover:text-foreground transition-colors">
                Termeni si Conditii
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
