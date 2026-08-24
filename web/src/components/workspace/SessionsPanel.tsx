"use client";

import { AlertTriangle, MessageSquarePlus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/Button";
import { DemoBadge } from "@/components/ui/DemoBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PanelShell } from "@/components/ui/PanelShell";
import { formatRelativeTime } from "@/lib/format";
import { searchSessions } from "@/lib/sessions";
import { cn } from "@/lib/utils";

import { useWorkspace } from "./WorkspaceProvider";

/**
 * Left rail: investigations and the collection this workspace is pointed at.
 *
 * The persistence banner is the important detail here — if a write to
 * localStorage failed, the rail says so rather than showing a list that will
 * be gone on reload.
 */
export function SessionsPanel({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const {
    sessions,
    activeSessionId,
    selectSession,
    startSession,
    deleteSession,
    persistence,
    hydrated,
  } = useWorkspace();

  const [query, setQuery] = useState("");
  const filtered = useMemo(() => searchSessions(sessions, query), [sessions, query]);

  return (
    <PanelShell
      as="aside"
      label="Investigations"
      className="h-full border-r border-ink-600/70 bg-ink-850/60"
      title={
        <Link href="/" className="rounded-sm" aria-label="OmniTrace home">
          <Wordmark />
        </Link>
      }
      subheader={
        <div className="space-y-2">
          <Button
            variant="secondary"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              startSession();
              onNavigate?.();
            }}
          >
            <MessageSquarePlus />
            New investigation
          </Button>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search investigations"
              aria-label="Search investigations"
              className="h-8 w-full rounded-md border border-ink-600 bg-ink-800 pl-8 pr-2.5 text-ui-xs text-ink-50 placeholder:text-ink-400 focus:border-signal-500/50 focus:outline-none focus:ring-1 focus:ring-signal-500/25"
            />
          </div>
        </div>
      }
    >
      {!persistence.healthy && persistence.reason && (
        <div className="m-2 flex items-start gap-2 rounded-md border border-caution-500/30 bg-caution-900/40 p-2.5">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-caution-400" aria-hidden />
          <p className="text-ui-2xs leading-relaxed text-caution-400">{persistence.reason}</p>
        </div>
      )}

      {!hydrated ? (
        <div className="space-y-1 p-2" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-11 rounded-md" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          compact
          title={query ? "No matches" : "No investigations yet"}
          description={
            query
              ? `Nothing matches “${query}”.`
              : "Ask a question below to start one. Investigations are stored in this browser."
          }
        />
      ) : (
        <ul className="p-1.5">
          {filtered.map((session) => {
            const last = session.turns[session.turns.length - 1];
            const active = session.id === activeSessionId;
            return (
              <li key={session.id} className="group/row relative">
                <button
                  type="button"
                  onClick={() => {
                    selectSession(session.id);
                    onNavigate?.();
                  }}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "w-full rounded-md px-2.5 py-2 pr-8 text-left transition-colors duration-150",
                    active ? "bg-ink-700/90 text-ink-50" : "text-ink-200 hover:bg-ink-750/70",
                  )}
                >
                  <span className="block truncate text-ui-xs font-medium">{session.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-ui-2xs text-ink-400">
                    <span>{formatRelativeTime(session.updatedAt)}</span>
                    {session.turns.length > 0 && (
                      <>
                        <span aria-hidden>·</span>
                        <span>
                          {session.turns.length} {session.turns.length === 1 ? "query" : "queries"}
                        </span>
                      </>
                    )}
                    {last?.error && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-fault-400">failed</span>
                      </>
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => deleteSession(session.id)}
                  aria-label={`Delete investigation “${session.title}”`}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1.5 text-ink-400 opacity-0 transition-all hover:bg-ink-600 hover:text-fault-400 focus-visible:opacity-100 group-hover/row:opacity-100"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

/**
 * The collection selector. Exactly one collection exists per backend
 * deployment (it is a server setting, not a client one), so this shows what is
 * connected rather than offering a switch that cannot work.
 */
