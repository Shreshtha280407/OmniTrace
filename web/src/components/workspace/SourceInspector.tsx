"use client";

import { ArrowLeft, FileSearch, Filter } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfidenceBar } from "@/components/ui/ConfidenceMeter";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { EvidenceDetail } from "@/components/ui/EvidenceDetail";
import { ModalityBadge } from "@/components/ui/ModalityBadge";
import { FieldRow, PanelSection, PanelShell } from "@/components/ui/PanelShell";
import { RunTimeline } from "@/components/ui/RunTimeline";
import { SkeletonEvidenceCard } from "@/components/ui/Skeleton";
import { SourceLocator } from "@/components/ui/SourceLocator";
import { StatusPill, sourceStatusLabel, sourceStatusTone } from "@/components/ui/StatusPill";
import { useJobStatus, useSource, useSourceEvidence } from "@/lib/api/queries";
import type { EvidenceItem } from "@/lib/api/schemas";
import { formatBytes, formatChecksum, formatDuration, formatRelativeTime } from "@/lib/format";
import { MODALITIES, evidenceTypeLabel, modalityMeta } from "@/lib/modality";
import { cn } from "@/lib/utils";

import { SourceViewer } from "./SourceViewer";

/**
 * Focused inspection of one source: its identity record, its ingestion run,
 * and every evidence item derived from it.
 *
 * This is the "show me everything the pipeline extracted from this file" view —
 * the one that makes the extraction auditable rather than a black box.
 */
export function SourceInspector({ sourceId }: { sourceId: string }) {
  const source = useSource(sourceId);
  const evidence = useSourceEvidence(sourceId);
  const job = useJobStatus(sourceId);

  const [modalityFilter, setModalityFilter] = useState<string[]>([]);
  const [nodeTypeFilter, setNodeTypeFilter] = useState<"all" | "atomic_observation" | "semantic_segment">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = evidence.data?.evidence ?? [];

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (modalityFilter.length > 0 && !modalityFilter.includes(item.modality)) return false;
      if (nodeTypeFilter !== "all" && item.node_type !== nodeTypeFilter) return false;
      return true;
    });
  }, [items, modalityFilter, nodeTypeFilter]);

  const selected = selectedId ? items.find((i) => i._id === selectedId) : undefined;

  const counts = useMemo(() => {
    const byModality: Record<string, number> = {};
    items.forEach((item) => {
      byModality[item.modality] = (byModality[item.modality] ?? 0) + 1;
    });
    return {
      byModality,
      atomic: items.filter((i) => i.node_type === "atomic_observation").length,
      segments: items.filter((i) => i.node_type === "semantic_segment").length,
    };
  }, [items]);

  if (source.isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <ErrorState
          error={source.error}
          title="Could not load this source"
          onRetry={() => void source.refetch()}
          retrying={source.isFetching}
        />
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_theme(spacing.inspector)]">
      {/* ── main column ───────────────────────────────────────────── */}
      <PanelShell
        as="main"
        label="Source detail"
        className="min-h-0"
        title={
          <div className="flex min-w-0 items-center gap-2">
            <Button asChild size="icon-sm" variant="ghost" aria-label="Back to workspace">
              <Link href="/workspace">
                <ArrowLeft />
              </Link>
            </Button>
            <span className="truncate text-ui-sm font-medium text-ink-50">
              {source.data?.filename ?? sourceId}
            </span>
          </div>
        }
        actions={
          source.data && (
            <StatusPill tone={sourceStatusTone(source.data.status)} size="xs" dot>
              {sourceStatusLabel(source.data.status)}
            </StatusPill>
          )
        }
      >
        <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
          {/* identity */}
          {source.isLoading ? (
            <div className="skeleton h-40 rounded-lg" />
          ) : source.data ? (
            <section className="rounded-xl border border-ink-600/70 bg-ink-850/60 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ModalityBadge modality={mediaTypeToModality(source.data.media_type)} variant="full" />
                <span className="font-mono text-ui-2xs text-ink-400">{source.data.mime_type}</span>
                <span className="ml-auto font-mono text-ui-2xs text-ink-400">
                  {formatRelativeTime(source.data.created_at)}
                </span>
              </div>
              <dl className="grid gap-x-6 sm:grid-cols-2">
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
                <FieldRow label="Collection" mono>
                  {source.data.collection_id}
                </FieldRow>
                <FieldRow label="Storage" mono>
                  {source.data.storage_path}
                </FieldRow>
              </dl>
            </section>
          ) : null}

          {/* ingestion run */}
          <RunTimeline job={job.data} mediaType={source.data?.media_type} />

          {/* evidence */}
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="eyebrow">
                Evidence · {filtered.length}
                {filtered.length !== items.length && <span className="text-ink-500"> of {items.length}</span>}
              </h2>

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Filter className="size-3 text-ink-500" aria-hidden />
                {MODALITIES.filter((m) => counts.byModality[m]).map((modality) => {
                  const on = modalityFilter.includes(modality);
                  const meta = modalityMeta(modality);
                  return (
                    <button
                      key={modality}
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={() =>
                        setModalityFilter((current) =>
                          current.includes(modality)
                            ? current.filter((m) => m !== modality)
                            : [...current, modality],
                        )
                      }
                      className={cn(
                        "inline-flex h-[22px] items-center gap-1 rounded-sm border px-1.5 font-mono text-ui-2xs uppercase",
                        on ? cn(meta.border, meta.bg, meta.text) : "border-ink-600 text-ink-400 hover:text-ink-200",
                      )}
                    >
                      {meta.short}
                      <span className="tabular opacity-70">{counts.byModality[modality]}</span>
                    </button>
                  );
                })}

                <span className="mx-0.5 h-4 w-px bg-ink-600" aria-hidden />

                {(
                  [
                    ["all", `All ${items.length}`],
                    ["atomic_observation", `Atomic ${counts.atomic}`],
                    ["semantic_segment", `Segments ${counts.segments}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNodeTypeFilter(value)}
                    aria-pressed={nodeTypeFilter === value}
                    className={cn(
                      "h-[22px] rounded-sm border px-1.5 text-ui-2xs transition-colors",
                      nodeTypeFilter === value
                        ? "border-signal-600/40 bg-signal-900/40 text-signal-300"
                        : "border-ink-600 text-ink-400 hover:text-ink-200",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {evidence.isLoading ? (
              <div className="space-y-2" role="status" aria-live="polite">
                <span className="sr-only">Loading evidence</span>
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonEvidenceCard key={i} />
                ))}
              </div>
            ) : evidence.isError ? (
              <ErrorState
                error={evidence.error}
                title="Could not load evidence for this source"
                onRetry={() => void evidence.refetch()}
                retrying={evidence.isFetching}
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                compact
                icon={FileSearch}
                title={items.length === 0 ? "No evidence extracted" : "No evidence matches these filters"}
                description={
                  items.length === 0
                    ? "The pipeline has not produced any evidence items for this source. Check the processing trace above for a failed or queued stage."
                    : "Clear a filter to see the rest of this source's evidence."
                }
                action={
                  items.length > 0
                    ? {
                        label: "Clear filters",
                        onClick: () => {
                          setModalityFilter([]);
                          setNodeTypeFilter("all");
                        },
                      }
                    : undefined
                }
              />
            ) : (
              <ul className="space-y-2">
                {filtered.map((item) => (
                  <li key={item._id}>
                    <EvidenceRow
                      item={item}
                      selected={selectedId === item._id}
                      onSelect={() => setSelectedId(item._id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </PanelShell>

      {/* ── inspector column ──────────────────────────────────────── */}
      <aside className="hidden min-h-0 border-l border-ink-600/70 bg-ink-850/60 lg:block">
        <div className="h-full overflow-y-auto">
          {selected && source.data ? (
            <div>
              <div className="border-b border-ink-600/70 p-3">
                <SourceViewer source={source.data} evidence={selected} />
              </div>
              <EvidenceDetail evidence={selected} evidenceById={Object.fromEntries(items.map((i) => [i._id, i]))} />
            </div>
          ) : (
            <EmptyState
              compact
              icon={FileSearch}
              title="Select an evidence item"
              description="Its locator, confidence, provenance chain and position in the source appear here."
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function EvidenceRow({
  item,
  selected,
  onSelect,
}: {
  item: EvidenceItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = modalityMeta(item.modality);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors duration-150",
        selected
          ? "border-signal-600/50 bg-ink-800"
          : "border-ink-600/70 bg-ink-850/50 hover:border-ink-550 hover:bg-ink-800/60",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <ModalityBadge modality={item.modality} />
        <span className="text-ui-2xs text-ink-400">{evidenceTypeLabel(item.evidence_type)}</span>
        {item.node_type === "semantic_segment" && (
          <StatusPill tone="contextual" size="xs">
            segment · {item.member_evidence_ids.length}
          </StatusPill>
        )}
        <span className="ml-auto flex items-center gap-2">
          <ConfidenceBar value={item.confidence?.extraction} />
          <SourceLocator location={item.location} />
        </span>
      </div>
      <p className="line-clamp-3 text-pretty text-ui-xs leading-relaxed text-ink-200">
        {item.content || <span className="text-ink-400">No content stored.</span>}
      </p>
      {item.speaker_id && <p className="mt-1.5 font-mono text-[10px] text-ink-400">{item.speaker_id}</p>}
    </button>
  );
}

/** Source media_type is a different axis from evidence modality, but for the
 *  header badge the mapping is unambiguous. */
function mediaTypeToModality(mediaType: string): string {
  switch (mediaType) {
    case "video":
      return "video_visual";
    case "audio":
      return "speech";
    case "image":
      return "image";
    default:
      return "document";
  }
}
