"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { CornerDownLeft, MessageSquarePlus, Network, Search, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { formatRelativeTime } from "@/lib/format";
import { searchSessions } from "@/lib/sessions";
import { cn } from "@/lib/utils";

import { useWorkspace } from "./WorkspaceProvider";

/**
 * Cmd/Ctrl+K palette: jump between investigations, start a new one, or move to
 * the graph. Full keyboard control — arrows move, Enter runs, Escape closes.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { sessions, selectSession, startSession, latestResponse } = useWorkspace();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const items = useMemo(() => {
    const actions = [
      {
        id: "new",
        label: "New investigation",
        hint: "Start a fresh session",
        icon: MessageSquarePlus,
        run: () => startSession(),
      },
      {
        id: "graph",
        label: "Open evidence graph",
        hint: latestResponse?.primary_event_id ? "Focused on the current event" : "No event selected",
        icon: Network,
        run: () =>
          router.push(
            latestResponse?.primary_event_id
              ? `/workspace/graph?event=${encodeURIComponent(latestResponse.primary_event_id)}`
              : "/workspace/graph",
          ),
      },
    ];

    const matched = searchSessions(sessions, query).slice(0, 8).map((session) => ({
      id: session.id,
      label: session.title,
      hint: `${formatRelativeTime(session.updatedAt)} · ${session.turns.length} ${session.turns.length === 1 ? "query" : "queries"}`,
      icon: Table2,
      run: () => selectSession(session.id),
    }));

    const needle = query.trim().toLowerCase();
    const filteredActions = needle
      ? actions.filter((a) => a.label.toLowerCase().includes(needle))
      : actions;

    return [...filteredActions, ...matched];
  }, [sessions, query, startSession, selectSession, router, latestResponse]);

  useEffect(() => setIndex(0), [query, open]);

  const run = (i: number) => {
    items[i]?.run();
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-[18vh] z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-ink-550 bg-ink-800 shadow-raised"
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(index);
            }
          }}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>

          <div className="flex items-center gap-2.5 border-b border-ink-600 px-3.5">
            <Search className="size-4 shrink-0 text-ink-400" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search investigations or run a command…"
              aria-label="Search investigations or run a command"
              className="h-12 w-full bg-transparent text-ui-base text-ink-50 placeholder:text-ink-400 focus:outline-none"
            />
            <kbd className="shrink-0 rounded-xs border border-ink-600 bg-ink-750 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
              esc
            </kbd>
          </div>

          <ul role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-1.5">
            {items.length === 0 ? (
              <li className="px-3 py-6 text-center text-ui-xs text-ink-400">No matches</li>
            ) : (
              items.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === index}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => run(i)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                      i === index ? "bg-ink-700" : "hover:bg-ink-750",
                    )}
                  >
                    <item.icon className="size-3.5 shrink-0 text-ink-400" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui-xs text-ink-50">{item.label}</span>
                      <span className="block truncate text-ui-2xs text-ink-400">{item.hint}</span>
                    </span>
                    {i === index && <CornerDownLeft className="size-3 shrink-0 text-ink-400" aria-hidden />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
