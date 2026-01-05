import { Card, CardContent } from "@/components/ui/card";

export default function FunctionalitatiPage() {
  const features = [
    {
      title: "Analiza Video Automata",
      description: "AI-ul nostru analizeaza continutul video si identifica cele mai bune segmente pentru reels.",
    },
    {
      title: "Detectie Scene",
      description: "Detecteaza automat schimbarile de scena si momentele cu impact maxim.",
    },
    {
      title: "Generare Subtitrari",
      description: "Creeaza subtitrari automate folosind recunoastere vocala avansata.",
    },
    {
      title: "Text-to-Speech",
      description: "Genereaza voiceover profesional din text in multiple limbi.",
    },
    {
      title: "Export Optimizat",
      description: "Exporta in formate optimizate pentru Instagram, TikTok si YouTube Shorts.",
    },
    {
      title: "Procesare in Cloud",
      description: "Procesare rapida in cloud, fara a-ti incarca calculatorul.",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="pt-24 pb-16">
        <div className="w-full max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Functionalitati</h1>
          <p className="text-muted-foreground text-lg mb-12 max-w-2xl">
            Descopera toate uneltele pe care EditAI le pune la dispozitie pentru a-ti transforma continutul video.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="bg-card border-border">
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                    <div className="w-5 h-5 rounded bg-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
