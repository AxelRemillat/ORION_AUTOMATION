import type { Metadata, Viewport } from "next";
import {
  Barlow_Condensed,
  Bricolage_Grotesque,
  IBM_Plex_Mono,
  Instrument_Sans,
} from "next/font/google";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

/** Titres — grotesque a fort caractere, un peu condense. */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

/** Texte courant. */
const sans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

/**
 * Scene VERSUS des actions du jour : condense, tres gras, italique.
 * Charge ici parce que next/font exige un appel au niveau module — mais la
 * variable ne sert que dans ce bloc.
 */
const versus = Barlow_Condensed({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-versus",
  weight: ["700", "800"],
  style: ["italic", "normal"],
});

/** Chiffres, identifiants, libelles techniques. */
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "PROSPECT",
  description: "Outil de prospection freelance",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9f3fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1b26" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` : le script ci-dessous pose data-theme avant
    // l'hydratation, donc <html> differe du rendu serveur.
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable} ${mono.variable} ${versus.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
