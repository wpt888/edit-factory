import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Instrument_Sans,
  Geist_Mono,
  Montserrat,
  Roboto,
  Open_Sans,
  Oswald,
  Bebas_Neue,
} from "next/font/google";
import "./globals.css";
import { NavBarWrapper } from "@/components/navbar-wrapper";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemedToaster } from "@/components/themed-toaster";
import { ProfileProvider } from "@/contexts/profile-context";
import { AuthProvider } from "@/components/auth-provider";
import { DesktopAuthGuard } from "@/components/desktop-auth-guard";
import { DesktopTitleBar } from "@/components/desktop-titlebar";
import { UndoProvider } from "@/contexts/undo-context";

const heading = Bricolage_Grotesque({
  variable: "--font-heading",
  subsets: ["latin"],
});

const sans = Instrument_Sans({
  variable: "--font-sans",
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

// Desktop build tightens corners (see html.desktop in globals.css).
const DESKTOP_BUILD = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";

export const metadata: Metadata = {
  title: "Blipost - Smart Video Editing",
  description: "AI-powered video analysis and automation platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${heading.variable} ${sans.variable} ${geistMono.variable} ${montserrat.variable} ${roboto.variable} ${openSans.variable} ${oswald.variable} ${bebasNeue.variable} antialiased`}
      suppressHydrationWarning
    >
      <body>
        {/* Host pinning (native desktop only): the backend's HttpOnly media cookie is
            SameSite=Lax on 127.0.0.1:8000, so a page opened on "localhost"
            (a different site in cookie terms) silently 401s every source-video
            thumbnail/preview. Browser launches must remain on localhost so the
            Creative SSO cookie can be checked against localhost:3000. */}
        {DESKTOP_BUILD && (
          <script
            dangerouslySetInnerHTML={{
              __html: `if(location.hostname==="localhost"&&window.editFactory?.isDesktop)location.replace(location.href.replace("//localhost","//127.0.0.1"))`,
            }}
          />
        )}
        {/* Anti-flash: the server always renders class="dark" (the default);
            this runs before first paint and strips it when the stored
            preference is light. Key must match theme-provider.tsx. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("blipost-theme")==="light")document.documentElement.classList.remove("dark");if(${DESKTOP_BUILD}&&window.editFactory?.isDesktop)document.documentElement.classList.add("desktop")}catch(e){}`,
          }}
        />
        <ThemeProvider>
          <UndoProvider>
            <AuthProvider>
              <ProfileProvider>
                <DesktopTitleBar />
                <div className="app-scroll">
                  <DesktopAuthGuard>
                    <NavBarWrapper>{children}</NavBarWrapper>
                  </DesktopAuthGuard>
                </div>
              </ProfileProvider>
            </AuthProvider>
            <ThemedToaster />
          </UndoProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
