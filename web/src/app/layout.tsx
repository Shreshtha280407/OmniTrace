import type { Metadata, Viewport } from "next";
import { Instrument_Serif, JetBrains_Mono, Manrope } from "next/font/google";

import { Providers } from "@/components/Providers";

import "./globals.css";

/**
 * Type system.
 *
 * Manrope carries the product: semi-geometric, quiet, dense at 13px.
 * Instrument Serif is the editorial voice — high stroke contrast, used only
 * for major marketing headings, never inside the workspace.
 * JetBrains Mono is reserved for identifiers, timecodes, checksums and
 * telemetry; if it is monospace on this site, it is a machine value.
 */
const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const display = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400"],
  style: ["normal", "italic"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "OmniTrace — Trace every answer back to the evidence",
    template: "%s · OmniTrace",
  },
  description:
    "OmniTrace turns video, audio, images and documents into connected, time-aware evidence — so every AI answer can be inspected, verified and revisited.",
  openGraph: {
    title: "OmniTrace",
    description: "Connected multimodal evidence, temporal knowledge, and retrieval-ready provenance.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#090B0F",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable} dark`} suppressHydrationWarning>
      <body className="min-h-dvh bg-ink-900 text-ink-100">
        {/* First tab stop on every page. */}
        <a
          href="#main"
          className="sr-only z-50 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-md focus:bg-signal-500 focus:px-4 focus:py-2 focus:text-ui-sm focus:font-medium focus:text-ink-950"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
