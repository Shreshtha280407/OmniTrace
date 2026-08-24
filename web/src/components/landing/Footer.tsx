"use client";

import Link from "next/link";

import { Wordmark } from "@/components/brand/Wordmark";
import { StatusPill } from "@/components/ui/StatusPill";
import { useHealth } from "@/lib/api/queries";
import { API_BASE_URL, IS_DEMO_MODE } from "@/lib/api";

/**
 * Footer.
 *
 * The status indicator is wired to `GET /health` on the configured backend and
 * reports exactly what that call returned — reachable, unreachable, or still
 * checking. It never says "all systems operational" as decoration, and in demo
 * mode it says so plainly rather than reporting a health it did not measure.
 */

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "Workspace", href: "/workspace" },
      { label: "Workflow", href: "/#workflow" },
      { label: "Provenance", href: "/#provenance" },
    ],
  },
];

/** Not yet written. Rendered as inert text rather than links that 404 —
 *  a placeholder should look like a placeholder. */
const PLACEHOLDER_LINKS = ["Security", "Privacy", "Data retention"];

function BackendStatus() {
  const { data, isLoading, isError } = useHealth();

  if (IS_DEMO_MODE) {
    return (
      <StatusPill tone="caution" size="xs" dot>
        Demo mode · no backend connected
      </StatusPill>
    );
  }
  if (isLoading) {
    return (
      <StatusPill tone="pending" size="xs" dot pulse>
        Checking API
      </StatusPill>
    );
  }
  if (isError || data?.status !== "ok") {
    return (
      <StatusPill tone="fault" size="xs" dot title={API_BASE_URL}>
        API unreachable
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="validated" size="xs" dot title={`${API_BASE_URL}/health returned ok`}>
      API reachable
    </StatusPill>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-ink-800 bg-ink-950">
      <div className="mx-auto max-w-6xl px-6 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_repeat(2,minmax(0,1fr))]">
          <div>
            <Wordmark />
            <p className="mt-3 max-w-xs text-pretty text-ui-xs leading-relaxed text-ink-400">
              Connected multimodal evidence, temporal knowledge, and retrieval-ready provenance.
            </p>
            <div className="mt-5">
              <BackendStatus />
            </div>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h3 className="eyebrow mb-3.5">{column.heading}</h3>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded-xs text-ui-xs text-ink-300 transition-colors hover:text-ink-50"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div>
            <h3 className="eyebrow mb-3.5">Policies</h3>
            <ul className="space-y-2">
              {PLACEHOLDER_LINKS.map((label) => (
                <li key={label} className="text-ui-xs text-ink-500" title="Not published yet">
                  {label}
                  <span className="ml-1.5 font-mono text-[10px] text-ink-600">placeholder</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-ink-800 pt-6 sm:flex-row sm:items-center">
          <p className="text-ui-2xs text-ink-500">
            © {new Date().getFullYear()} OmniTrace. Multimodal evidence pipeline for RAG-ready retrieval.
          </p>
          <p className="font-mono text-[10px] text-ink-600 sm:ml-auto">
            {IS_DEMO_MODE ? "demo fixtures" : API_BASE_URL}
          </p>
        </div>
      </div>
    </footer>
  );
}
