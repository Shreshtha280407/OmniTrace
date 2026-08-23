"use client";

import { Clock, Layers, ShieldCheck, Waypoints } from "lucide-react";

import { ConfidenceMeter } from "@/components/ui/ConfidenceMeter";
import { GraphLegend } from "@/components/ui/GraphLegend";
import { ModalityBadge } from "@/components/ui/ModalityBadge";
import { FieldRow, PanelSection } from "@/components/ui/PanelShell";
import { StatusPill } from "@/components/ui/StatusPill";
import type { QueryResponse, SemanticEvent } from "@/lib/api/schemas";
import { formatConfidence, formatTimecode, truncateId } from "@/lib/format";
import { MODALITIES, relationshipLabel } from "@/lib/modality";
import { cn } from "@/lib/utils";

import type { GraphStats } from "./model";

export interface GraphFilters {
  modalities: string[];
  relationshipTypes: string[];
  minConfidence: number;
  sourceIds: string[];
  /** Null when the scrubber is off; otherwise a window in ms. */
  timeWindow: { startMs: number; endMs: number } | null;
  includeUntimed: boolean;
  statuses: ("confirmed" | "tentative")[];
}

export const DEFAULT_FILTERS: GraphFilters = {
  modalities: [],
  relationshipTypes: [],
  minConfidence: 0,
  sourceIds: [],
  timeWindow: null,
  includeUntimed: true,
  statuses: ["confirmed", "tentative"],
};

/**
 * Investigation context rail.
 *
 * Everything numeric here is computed from the loaded graph, so the panel can
 * never claim coverage the data does not have. "Provenance completeness" is
 * the fraction of evidence nodes carrying a producer record — a real
 * measurement, not a badge.
 */
export function GraphContextRail({
  event,
  stats,
  filters,
  onFiltersChange,
  response,
  sourceNames,
  nodeCount,
  visibleCount,
}: {
  event: SemanticEvent | null;
  stats: GraphStats;
  filters: GraphFilters;
  onFiltersChange: (next: GraphFilters) => void;
  response: QueryResponse | null;
  sourceNames: Map<string, string>;
  nodeCount: number;
  visibleCount: number;
}) {
  const patch = (partial: Partial<GraphFilters>) => onFiltersChange({ ...filters, ...partial });

  const toggle = <K extends "modalities" | "relationshipTypes" | "sourceIds">(key: K, value: string) => {
    const current = filters[key] as string[];
    patch({
      [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    } as Partial<GraphFilters>);
  };

  return (
    <div className="divide-y divide-ink-600/50">
      {/* ── what we are looking at ─────────────────────────────── */}
      <PanelSection title="Investigation">
        {event ? (
          <>
            <h3 className="text-pretty text-ui-sm font-medium leading-snug text-ink-50">{event.title}</h3>
            {event.summary && (
              <p className="mt-1.5 text-pretty text-ui-2xs leading-relaxed text-ink-300">{event.summary}</p>
            )}
            <dl className="mt-3">
              <FieldRow label="Event ID" mono title={event._id}>
                {truncateId(event._id, 16, 6)}
              </FieldRow>
              <FieldRow label="Type" mono>
                {event.event_type}
              </FieldRow>
              <FieldRow label="Members" mono>
                {event.member_ids.length}
              </FieldRow>
              <FieldRow label="Confidence" mono>
                {formatConfidence(event.confidence)}
              </FieldRow>
            </dl>
          </>
        ) : (
          <p className="text-ui-2xs leading-relaxed text-ink-400">
            No event selected. The graph shows the evidence bundle and relationships returned by the most recent query.
          </p>
        )}
      </PanelSection>

      {/* ── sources ─────────────────────────────────────────────── */}
      {sourceNames.size > 0 && (
        <PanelSection title={`Sources · ${sourceNames.size}`}>
          <ul className="space-y-1">
            {[...sourceNames.entries()].map(([id, name]) => {
              const on = filters.sourceIds.length === 0 || filters.sourceIds.includes(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggle("sourceIds", id)}
                    aria-pressed={filters.sourceIds.includes(id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-ink-750",
                      !on && "opacity-45",
                    )}
                  >
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", on ? "bg-signal-500" : "bg-ink-500")} />
                    <span className="min-w-0 flex-1 truncate text-ui-2xs text-ink-200" title={name}>
                      {name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {filters.sourceIds.length > 0 && (
            <button
              type="button"
              onClick={() => patch({ sourceIds: [] })}
              className="mt-1.5 text-ui-2xs text-signal-400 hover:underline"
            >
              Show all sources
            </button>
          )}
        </PanelSection>
      )}

      {/* ── temporal range ──────────────────────────────────────── */}
      <PanelSection title="Temporal range">
        {stats.timeRange ? (
          <p className="font-mono text-ui-2xs tabular text-ink-100">
            {formatTimecode(stats.timeRange.startMs)} → {formatTimecode(stats.timeRange.endMs)}
          </p>
        ) : (
          <p className="text-ui-2xs text-ink-400">
            No time-bearing evidence in this graph. Documents and images carry no timeline position.
          </p>
        )}
      </PanelSection>

      {/* ── evidence by modality ────────────────────────────────── */}
      <PanelSection title="Evidence by modality">
        <ul className="space-y-1.5">
          {MODALITIES.map((modality) => {
            const count = stats.byModality[modality] ?? 0;
            const active = filters.modalities.length === 0 || filters.modalities.includes(modality);
            return (
              <li key={modality}>
                <button
                  type="button"
                  onClick={() => toggle("modalities", modality)}
                  aria-pressed={filters.modalities.includes(modality)}
                  disabled={count === 0}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-1 py-0.5 transition-colors",
                    count > 0 && "hover:bg-ink-750",
                    (!active || count === 0) && "opacity-40",
                  )}
                >
                  <ModalityBadge modality={modality} />
                  <span className="ml-auto font-mono text-ui-2xs tabular text-ink-200">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PanelSection>

      {/* ── relationships ───────────────────────────────────────── */}
      <PanelSection title={`Relationships · ${stats.confirmedCount + stats.tentativeCount}`}>
        <div className="mb-2.5 flex gap-1.5">
          {(["confirmed", "tentative"] as const).map((status) => {
            const on = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() =>
                  patch({
                    statuses: on
                      ? (filters.statuses.filter((s) => s !== status) as GraphFilters["statuses"])
                      : ([...filters.statuses, status] as GraphFilters["statuses"]),
                  })
                }
                className={cn(
                  "flex-1 rounded-sm border px-1.5 py-1 text-ui-2xs transition-colors",
                  on
                    ? status === "confirmed"
                      ? "border-signal-500/40 bg-signal-900/50 text-signal-300"
                      : "border-uv-500/40 bg-uv-800/40 text-uv-300"
                    : "border-ink-600 text-ink-400",
                )}
              >
                {status} · {status === "confirmed" ? stats.confirmedCount : stats.tentativeCount}
              </button>
            );
          })}
        </div>

        <ul className="space-y-1">
          {stats.byRelationshipType.map(({ type, count, confirmed }) => {
            const on = filters.relationshipTypes.length === 0 || filters.relationshipTypes.includes(type);
            return (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => toggle("relationshipTypes", type)}
                  aria-pressed={filters.relationshipTypes.includes(type)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-ink-750",
                    !on && "opacity-40",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-200" title={type}>
                    {relationshipLabel(type)}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular text-ink-400">
                    {confirmed}
                    <span className="text-ink-600">/{count}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 space-y-2 border-t border-ink-600/50 pt-2.5">
          <ConfidenceMeter
            label="Mean confirmed"
            value={stats.meanConfirmedConfidence}
            threshold={0.7}
          />
          <div>
            <label htmlFor="min-confidence" className="mb-1 block text-ui-2xs text-ink-400">
              Minimum edge confidence · {filters.minConfidence.toFixed(2)}
            </label>
            <input
              id="min-confidence"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={filters.minConfidence}
              onChange={(e) => patch({ minConfidence: Number(e.target.value) })}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-ink-700 accent-signal-500"
            />
          </div>
        </div>
      </PanelSection>

      {/* ── health ──────────────────────────────────────────────── */}
      <PanelSection title="Graph health">
        <div className="space-y-2">
          <ConfidenceMeter
            label="Provenance"
            value={stats.provenanceCompleteness}
            threshold={0.999}
          />
          <p className="text-ui-2xs leading-relaxed text-ink-400">
            Share of evidence nodes carrying a producer record. Anything below 1.00 means some evidence cannot be
            traced to the run that made it.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <StatusPill tone="neutral" size="xs">
              {visibleCount} of {nodeCount} nodes shown
            </StatusPill>
          </div>
        </div>
      </PanelSection>

      {/* ── coverage against the query ──────────────────────────── */}
      {response && <CoveragePanel response={response} />}

      <PanelSection title="Legend">
        <GraphLegend
          modalities={Object.keys(stats.byModality)}
          relationshipTypes={stats.byRelationshipType}
          signals={stats.signals}
          compact
        />
      </PanelSection>
    </div>
  );
}

/**
 * Evidence coverage: what the query plan asked for against what retrieval
 * actually returned. A requested modality with nothing behind it is named as a
 * gap rather than omitted.
 */
function CoveragePanel({ response }: { response: QueryResponse }) {
  const retrieved = new Set(response.evidence.map((e) => e.modality));
  const required = response.query_plan.required_modalities;
  const cited = new Set(response.claims.flatMap((c) => c.evidence_ids));
  const gaps = required.filter((m) => !retrieved.has(m));

  return (
    <PanelSection title="Evidence coverage">
      <ul className="space-y-1.5">
        {required.length === 0 ? (
          <li className="text-ui-2xs text-ink-400">The plan required no specific modality.</li>
        ) : (
          required.map((modality) => {
            const has = retrieved.has(modality);
            const count = response.evidence.filter((e) => e.modality === modality).length;
            return (
              <li key={modality} className="flex items-center gap-2">
                <ModalityBadge modality={modality} />
                <span className="ml-auto font-mono text-[10px] tabular">
                  {has ? (
                    <span className="text-ink-200">{count} retrieved</span>
                  ) : (
                    <span className="text-caution-400">gap · none retrieved</span>
                  )}
                </span>
              </li>
            );
          })
        )}
      </ul>

      <dl className="mt-3 space-y-0.5 border-t border-ink-600/50 pt-2.5">
        <FieldRow label="Cited" mono>
          {cited.size} of {response.evidence.length} bundle items
        </FieldRow>
        <FieldRow label="Missing info" mono>
          {response.missing_information.length === 0 ? (
            <span className="text-ink-400">none reported</span>
          ) : (
            <span className="text-caution-400">{response.missing_information.length} reported</span>
          )}
        </FieldRow>
        <FieldRow label="Conflicts" mono>
          {response.conflicts.length === 0 ? (
            <span className="text-ink-400">none reported</span>
          ) : (
            <span className="text-uv-300">{response.conflicts.length} reported</span>
          )}
        </FieldRow>
      </dl>

      {gaps.length > 0 && (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-md border border-caution-500/25 bg-caution-900/25 p-2 text-ui-2xs leading-relaxed text-caution-400">
          <ShieldCheck className="mt-px size-3 shrink-0" aria-hidden />
          {gaps.length} required {gaps.length === 1 ? "modality" : "modalities"} returned no evidence. The answer above
          rests on the remaining modalities only.
        </p>
      )}
    </PanelSection>
  );
}
