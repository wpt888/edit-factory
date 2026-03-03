import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat, Roboto, Open_Sans, Oswald, Bebas_Neue } from "next/font/google";
import "./globals.css";
import { NavBarWrapper } from "@/components/navbar-wrapper";
import { Toaster } from "sonner";
import { ProfileProvider } from "@/contexts/profile-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Subtitle fonts
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "EditAI - Smart Video Editing",
  description: "AI-powered video analysis and automation platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${montserrat.variable} ${roboto.variable} ${openSans.variable} ${oswald.variable} ${bebasNeue.variable} antialiased`}
      >
        <ProfileProvider>
          <NavBarWrapper />
          {children}
        </ProfileProvider>
        <Toaster
          position="top-right"
          richColors
          closeButton
          theme="dark"
        />
      </body>
    </html>
  );
}
