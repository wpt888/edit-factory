import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function TestimonialePage() {
  const testimonials = [
    {
      quote: "EditAI a transformat modul in care ne intelegem clientii. Rata de conversie a crescut cu 47% in doar doua luni.",
      name: "Maria Popescu",
      role: "Director Marketing, TechFlow",
      avatar: "MP",
    },
    {
      quote: "Predictiile AI sunt incredibil de precise. E ca si cum ai avea un data scientist care lucreaza 24/7 la o fractiune din cost.",
      name: "Andrei Ionescu",
      role: "CEO, Elevate Commerce",
      avatar: "AI",
    },
    {
      quote: "In sfarsit, analize care iti spun ce sa faci mai departe. Nu te mai ineci in dashboard-uri fara directie.",
      name: "Elena Dumitrescu",
      role: "Director Marketing, Bloom",
      avatar: "ED",
    },
    {
      quote: "Am redus timpul de editare video de la 3 ore la 15 minute. EditAI este un game-changer pentru agentia noastra.",
      name: "Stefan Mihai",
      role: "Fondator, Creative Studio",
      avatar: "SM",
    },
    {
      quote: "Calitatea reels-urilor generate este impresionanta. Clientii nostri sunt incantati de rezultate.",
      name: "Alexandra Radu",
      role: "Social Media Manager",
      avatar: "AR",
    },
    {
      quote: "Cel mai bun tool de editare video pe care l-am folosit. Simplu, rapid si rezultate profesionale.",
      name: "Cristian Popa",
      role: "Content Creator",
      avatar: "CP",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="pt-24 pb-16">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Ce Spun Clientii</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Mii de creatori si companii folosesc EditAI zilnic pentru a-si transforma continutul.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="bg-card border-border">
                <CardContent className="p-6">
                  <blockquote className="text-foreground mb-6 leading-relaxed">
                    &ldquo;{testimonial.quote}&rdquo;
                  </blockquote>
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-sm">
                        {testimonial.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-sm">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground">{testimonial.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
