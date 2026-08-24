"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FileSearch } from "lucide-react";

import { ModalityBadge } from "@/components/ui/ModalityBadge";
import { locatorText } from "@/components/ui/SourceLocator";
import type { EvidenceItem } from "@/lib/api/schemas";
import { evidenceTypeLabel } from "@/lib/modality";

import { useWorkspace } from "./WorkspaceProvider";

/**
 * **View source** — shown under an answer only when that answer actually rests
 * on files.
 *
 * The condition is the point. An answer produced with no sources in the
 * conversation is general knowledge and has nothing to open; offering the
 * control there would imply a provenance that does not exist. So the caller
 * renders this only for a grounded answer with a non-empty bundle, and every
 * row here opens the file *at the position the evidence was found* — a
 * timestamp seeks the player, a page and bounding box open and highlight the
 * region.
 */
export function AnswerSources({ evidence }: { evidence: EvidenceItem[] }) {
  const { openSourceDrawer } = useWorkspace();
  if (evidence.length === 0) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-600/70 px-2.5 py-1.5 text-ui-xs text-ink-200 transition-colors hover:border-signal-600/50 hover:bg-ink-800 hover:text-ink-50 data-[state=open]:border-signal-600/50 data-[state=open]:bg-ink-800"
        >
          <FileSearch className="size-3.5" aria-hidden />
          View source
          <span className="font-mono text-[10px] tabular text-ink-400">{evidence.length}</span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 max-h-[min(24rem,60vh)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-ink-600 bg-ink-850 p-1 shadow-raised data-[state=open]:animate-fade-in"
        >
          <DropdownMenu.Label className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
            Evidence this answer rests on
          </DropdownMenu.Label>

          {evidence.map((item) => (
            <DropdownMenu.Item
              key={item._id}
              onSelect={() => openSourceDrawer(item._id)}
              className="flex cursor-pointer flex-col gap-1 rounded-md px-2 py-2 outline-none data-[highlighted]:bg-ink-700/80"
            >
              <span className="flex items-center gap-2">
                <ModalityBadge modality={item.modality} />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-400">
                  {evidenceTypeLabel(item.evidence_type)}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular text-signal-300">
                  {locatorText(item.location)}
                </span>
              </span>
              <span className="line-clamp-2 text-pretty text-ui-xs leading-relaxed text-ink-100">
                {item.content || <span className="text-ink-400">No content stored.</span>}
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
