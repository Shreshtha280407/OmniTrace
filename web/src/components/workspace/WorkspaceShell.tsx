"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/Button";
import { DemoBadge } from "@/components/ui/DemoBadge";
import { cn } from "@/lib/utils";

import { CommandPalette } from "./CommandPalette";
import { Conversation } from "./Conversation";
import { SessionsPanel } from "./SessionsPanel";
import { SourceDrawer } from "./SourceDrawer";
import { useWorkspace } from "./WorkspaceProvider";

/**
 * Two-panel workspace shell: investigations rail, conversation.
 *
 * There was a third column holding the query trace. It has moved to the
 * evidence graph, where the rest of the retrieval story already lives — the
 * graph modes, the path legend and the channel weights were all over there
 * while the trace sat in the chat, and neither surface was complete on its own.
 * Removing it also gives the conversation the full width, which is what a chat
 * wants.
 *
 * Evidence is now reached by opening it: a citation, or **View source** under
 * an answer, opens the source drawer at the stored locator.
 */
export function WorkspaceShell() {
  const { selectedEvidenceId, sourceDrawerEvidenceId, selectEvidence } = useWorkspace();
  const [railOpen, setRailOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (event.key === "Escape") {
        // Innermost first: drawer, then the rail, then the selection.
        if (sourceDrawerEvidenceId) return; // the drawer handles its own Escape
        if (railOpen) {
          setRailOpen(false);
          return;
        }
        if (selectedEvidenceId) selectEvidence(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [railOpen, selectedEvidenceId, selectEvidence, sourceDrawerEvidenceId]);

  return (
    <>
      <DemoBadge variant="banner" />

      {/* mobile top bar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-600/70 bg-ink-850 px-3 lg:hidden">
        <Button size="icon-sm" variant="ghost" onClick={() => setRailOpen(true)} aria-label="Open investigations">
          <Menu />
        </Button>
        <Wordmark showMark={false} />
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[theme(spacing.rail)_minmax(0,1fr)]">
        {/* ── left rail ─────────────────────────────────────────── */}
        <div className="hidden min-h-0 lg:block">
          <SessionsPanel />
        </div>

        <SlideOver open={railOpen} onClose={() => setRailOpen(false)} side="left" label="Investigations">
          <SessionsPanel onNavigate={() => setRailOpen(false)} />
        </SlideOver>

        {/* ── conversation ──────────────────────────────────────── */}
        <main id="main" className="flex min-h-0 min-w-0 flex-col">
          <Conversation />
        </main>

      </div>

      <SourceDrawer />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}

/**
 * Slide-over for the two outer panels below `lg`.
 *
 * Rendered only when open so the panels are not duplicated in the
 * accessibility tree alongside their desktop counterparts.
 */
function SlideOver({
  open,
  onClose,
  side,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  label: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label={`Close ${label.toLowerCase()}`}
      />
      <div
        role="dialog"
        aria-label={label}
        aria-modal="true"
        className={cn(
          "absolute inset-y-0 w-[min(20rem,88vw)] animate-fade-in bg-ink-850 shadow-drawer",
          side === "left" ? "left-0" : "right-0",
        )}
      >
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label={`Close ${label.toLowerCase()}`}
          className={cn("absolute top-2 z-10", side === "left" ? "right-2" : "left-2")}
        >
          <X />
        </Button>
        {children}
      </div>
    </div>
  );
}
