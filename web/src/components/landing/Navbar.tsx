"use client";

import { ArrowRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#system", label: "System" },
  { href: "#workflow", label: "Workflow" },
  { href: "#provenance", label: "Provenance" },
];

/**
 * Sticky marketing navbar. **Open workspace** is the single high-emphasis
 * action and the bridge from the marketing surface into the product.
 *
 * There is deliberately no "Evidence graph" link here. The graph is built from
 * one conversation's evidence bundle, so reaching it from the marketing page
 * lands on an empty canvas with nothing to draw — it belongs inside the
 * conversation that owns the evidence, and that is where the entry point now
 * lives.
 */
export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile sheet on route-ish navigation and on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-all duration-300 ease-state",
        scrolled ? "border-b border-ink-700/80 bg-ink-950/80 backdrop-blur-xl" : "border-b border-transparent",
      )}
    >
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6 sm:px-8" aria-label="Primary">
        <Link href="/" className="shrink-0 rounded-sm" aria-label="OmniTrace home">
          <Wordmark />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-md px-3 py-1.5 text-ui-sm text-ink-200 transition-colors hover:bg-ink-800/70 hover:text-ink-50"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm" variant="marketing" className="hidden sm:inline-flex">
            <Link href="/workspace">
              Open workspace
              <ArrowRight />
            </Link>
          </Button>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="rounded-md p-2 text-ink-200 transition-colors hover:bg-ink-800 hover:text-ink-50 md:hidden"
          >
            {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div id="mobile-nav" className="border-t border-ink-700 bg-ink-950/95 backdrop-blur-xl md:hidden">
          <ul className="mx-auto max-w-6xl px-6 py-3">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-md px-2 py-2.5 text-ui-base text-ink-100 hover:bg-ink-800"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="mt-2 flex flex-col gap-2 border-t border-ink-700 pt-3">
              <Button asChild variant="marketing">
                <Link href="/workspace">Open workspace</Link>
              </Button>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
