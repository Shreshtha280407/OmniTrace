"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { ModalityBadge } from "@/components/ui/ModalityBadge";
import { FieldRow, PanelSection } from "@/components/ui/PanelShell";
import { SkeletonText } from "@/components/ui/Skeleton";
import { SourceLocator } from "@/components/ui/SourceLocator";
import { StatusPill, sourceStatusLabel, sourceStatusTone } from "@/components/ui/StatusPill";
import { useEvidenceSource } from "@/lib/api/queries";
import { formatBytes, formatChecksum, formatDuration, truncateId } from "@/lib/format";
import { evidenceTypeLabel } from "@/lib/modality";

import { SourceViewer } from "./SourceViewer";
import { useWorkspace } from "./WorkspaceProvider";

/**
 * Source drawer.
 *
 * Opened by **View source** on an evidence card. Resolves the evidence to its
 * originating Source through `GET /api/v1/evidence/{id}/source` — the backend's
 * own provenance-reachability path — and then opens it at the stored locator.
 */
export function SourceDrawer() {
  const { sourceDrawerEvidenceId, closeSourceDrawer, evidenceById } = useWorkspace();
  const evidence = sourceDrawerEvidenceId ? evidenceById[sourceDrawerEvidenceId] : undefined;
  const source = useEvidenceSource(sourceDrawerEvidenceId);

  const open = Boolean(sourceDrawerEvidenceId);

  // Radix handles Escape, but the workspace also binds Escape globally; this
  // keeps the two in agreement about what "close the top-most panel" means.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSourceDrawer();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, closeSourceDrawer]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && closeSourceDrawer()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-ink-850 shadow-drawer duration-300 data-[state=open]:animate-fade-in"
          aria-describedby={undefined}
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-600 px-4">
            <Dialog.Title className="text-ui-sm font-medium text-ink-50">Source</Dialog.Title>
            {evidence && <ModalityBadge modality={evidence.modality} />}
            <Dialog.Close asChild>
              <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Close source">
                <X />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!evidence ? (
              <ErrorState
                compact
                error={new Error("This evidence item is not in the current bundle, so its source cannot be resolved.")}
                title="Evidence not available"
              />
            ) : source.isLoading ? (
              <div className="space-y-4 p-4" role="status" aria-live="polite">
                <span className="sr-only">Resolving source</span>
                <div className="skeleton aspect-video w-full rounded-lg" />
                <SkeletonText lines={4} />
              </div>
            ) : source.isError ? (
              <ErrorState
                error={source.error}
                title="Could not resolve this evidence to its source"
                onRetry={() => void source.refetch()}
                retrying={source.isFetching}
              />
            ) : source.data ? (
              <div>
                <div className="p-4">
                  <SourceViewer source={source.data} evidence={evidence} />
                </div>

                <div className="divide-y divide-ink-600/50 border-t border-ink-600/70">
                  <PanelSection title="Locator">
                    <SourceLocator location={evidence.location} variant="block" />
                  </PanelSection>

                  <PanelSection title="Cited content">
                    <blockquote className="rounded-md border-l-2 border-signal-600/50 bg-ink-900/60 py-2 pl-2.5 pr-2 text-pretty text-ui-xs leading-relaxed text-ink-100">
                      {evidence.content || <span className="text-ink-400">No content stored.</span>}
                    </blockquote>
                    <p className="mt-2 text-ui-2xs text-ink-400">
                      {evidenceTypeLabel(evidence.evidence_type)}
                      {evidence.speaker_id && ` · ${evidence.speaker_id}`}
                    </p>
                  </PanelSection>

                  <PanelSection
                    title="Source record"
                    action={
                      <Button asChild size="xs" variant="ghost">
                        <Link href={`/workspace/sources/${encodeURIComponent(source.data._id)}`}>
                          Inspect source
                          <ExternalLink />
                        </Link>
                      </Button>
                    }
                  >
                    <dl>
                      <FieldRow label="Filename">{source.data.filename}</FieldRow>
                      <FieldRow label="Status">
                        <StatusPill tone={sourceStatusTone(source.data.status)} size="xs" dot>
                          {sourceStatusLabel(source.data.status)}
                        </StatusPill>
                      </FieldRow>
                      <FieldRow label="Media type" mono>
                        {source.data.media_type} · {source.data.mime_type}
                      </FieldRow>
                      <FieldRow label="Size" mono>
                        {formatBytes(source.data.size_bytes)}
                      </FieldRow>
                      {source.data.duration_ms !== null && source.data.duration_ms !== undefined && (
                        <FieldRow label="Duration" mono>
                          {formatDuration(source.data.duration_ms)}
                        </FieldRow>
                      )}
                      {source.data.page_count !== null && source.data.page_count !== undefined && (
                        <FieldRow label="Pages" mono>
                          {source.data.page_count}
                        </FieldRow>
                      )}
                      <FieldRow label="Checksum" mono title={source.data.sha256}>
                        {formatChecksum(source.data.sha256)}
                      </FieldRow>
                      <FieldRow label="Source ID" mono title={source.data._id}>
                        {source.data._id}
                      </FieldRow>
                      {source.data.timeline_id && (
                        <FieldRow label="Timeline" mono>
                          {source.data.timeline_id}
                        </FieldRow>
                      )}
                      <FieldRow label="Storage path" mono>
                        {source.data.storage_path}
                      </FieldRow>
                    </dl>
                  </PanelSection>

                  {evidence.provenance && (
                    <PanelSection title="Producer chain">
                      <dl>
                        <FieldRow label="Producer" mono>
                          {evidence.provenance.producer}
                        </FieldRow>
                        <FieldRow label="Model" mono>
                          {evidence.provenance.model_version ?? <span className="text-ink-400">none recorded</span>}
                        </FieldRow>
                        <FieldRow label="Run" mono title={evidence.provenance.processing_run_id}>
                          {truncateId(evidence.provenance.processing_run_id, 16, 6)}
                        </FieldRow>
                        {evidence.asset_id && (
                          <FieldRow label="Parent asset" mono title={evidence.asset_id}>
                            {truncateId(evidence.asset_id, 16, 6)}
                          </FieldRow>
                        )}
                      </dl>
                    </PanelSection>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
