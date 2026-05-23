import { Hero } from "@/components/sections/hero";
import { Features } from "@/components/sections/features";
import { Pricing } from "@/components/sections/pricing";
import { Screenshots } from "@/components/sections/screenshots";
import { Comparison } from "@/components/sections/comparison";
import { FAQ } from "@/components/sections/faq";
import { Footer } from "@/components/sections/footer";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <Hero />
      <Features />
      <Pricing />
      <Screenshots />
      <Comparison />
      <FAQ />
      <Footer />
    </main>
  );
}
