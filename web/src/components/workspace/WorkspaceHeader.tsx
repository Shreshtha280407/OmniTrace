"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FileText, Image as ImageIcon, Mic, Network, Paperclip, Video } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

import { useWorkspace } from "./WorkspaceProvider";

/**
 * The conversation's own top bar.
 *
 * Holds the two things that are scoped to *this* conversation rather than to
 * the app: its evidence graph, and the files it holds.
 *
 * The graph link lives here and not on the marketing navbar because the graph
 * is drawn from one conversation's evidence bundle — reached from anywhere
 * else it has nothing to draw.
 */
export function WorkspaceHeader() {
  const { sessionSources, openSourceFile, activeSession } = useWorkspace();

  // Deliberately only files the conversation has actually taken on. A file
  // staged in the composer is not in the conversation yet — it can still be
  // removed before the question is sent — and listing it here made the count
  // jump the moment a file was picked. The composer shows staged files; this
  // shows what the conversation holds.
  const count = sessionSources.length;

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-600/70 bg-ink-900/80 px-3 backdrop-blur sm:px-4">
      <p className="min-w-0 flex-1 truncate text-ui-sm text-ink-200">
        {activeSession?.turns.length ? activeSession.title : ""}
      </p>

      <Button asChild size="xs" variant="ghost" className="shrink-0">
        <Link href="/workspace/graph">
          <Network />
          <span className="hidden sm:inline">Evidence graph</span>
        </Link>
      </Button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={count === 1 ? "1 file in this chat" : `${count} files in this chat`}
            className={cn(
              "relative inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors",
              "border-ink-600 text-ink-200 hover:border-ink-500 hover:bg-ink-700/70 hover:text-ink-50",
              "data-[state=open]:border-signal-600/50 data-[state=open]:bg-ink-700/70 data-[state=open]:text-ink-50",
            )}
          >
            <Paperclip className="size-3.5" aria-hidden />
            {count > 0 && (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 min-w-[15px] rounded-full border border-ink-900 bg-signal-500 px-1 text-[9px] font-semibold leading-[14px] text-ink-950"
              >
                {count}
              </span>
            )}
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-ink-600 bg-ink-850 p-1 shadow-raised data-[state=open]:animate-fade-in"
          >
            <DropdownMenu.Label className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
              Files in this chat
            </DropdownMenu.Label>

            {count === 0 ? (
              <p className="px-2 pb-2 pt-1 text-pretty text-ui-xs leading-relaxed text-ink-300">
                No files yet. Attach a video, recording, image or document and answers here will be grounded in it.
              </p>
            ) : (
              <>
                {sessionSources.map((file) => (
                  <DropdownMenu.Item
                    key={file.sourceId}
                    onSelect={() => openSourceFile(file.sourceId)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-ui-sm text-ink-100 outline-none data-[highlighted]:bg-ink-700/80 data-[highlighted]:text-ink-50"
                  >
                    <FileIcon mediaType={file.mediaType} />
                    <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                    <span className="shrink-0 font-mono text-[10px] uppercase text-ink-400">{file.mediaType}</span>
                  </DropdownMenu.Item>
                ))}
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function FileIcon({ mediaType }: { mediaType: string }) {
  const className = "size-3.5 shrink-0";
  if (mediaType === "video") return <Video className={cn(className, "text-modality-visual")} aria-hidden />;
  if (mediaType === "audio") return <Mic className={cn(className, "text-modality-speech")} aria-hidden />;
  if (mediaType === "image") return <ImageIcon className={cn(className, "text-modality-image")} aria-hidden />;
  return <FileText className={cn(className, "text-modality-document")} aria-hidden />;
}
