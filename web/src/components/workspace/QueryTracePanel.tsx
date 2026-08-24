"use client";

import { Network, Radar } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModalityBadge } from "@/components/ui/ModalityBadge";
import { FieldRow, PanelSection } from "@/components/ui/PanelShell";
import { StatusPill, supportLabel, supportTone } from "@/components/ui/StatusPill";
import { formatMs, truncateId } from "@/lib/format";
import { MODALITIES, modalityMeta } from "@/lib/modality";
import { cn } from "@/lib/utils";

import { useWorkspace } from "./WorkspaceProvider";

/**
 * How the last answer was produced: plan, modality coverage, stage timings,
 * primary event, and the full reranked bundle.
 *
 * This used to be a permanent third column in the chat. It now lives on the
 * evidence graph, next to the graph modes and the path legend — the retrieval
 * story was split across two surfaces and neither was complete. Clicking any
 * bundle row opens that evidence at its stored locator.
 */
export function QueryTrace() {
  const { latestResponse } = useWorkspace();

  if (!latestResponse) {
    return (
      <EmptyState
        compact
        icon={Radar}
        title="No query yet"
        description="Run a question and the retrieval plan, stage timings and support assessment appear here."
      />
    );
  }

  const plan = latestResponse.query_plan;
  const timings = latestResponse.stage_timings_ms;
  const totalMs = Object.values(timings).reduce((sum, ms) => sum + ms, 0);
  const maxMs = Math.max(1, ...Object.values(timings));

  const retrievedModalities = new Set(latestResponse.evidence.map((e) => e.modality));

  return (
    <div className="divide-y divide-ink-600/50">
      <PanelSection title="Support">
        <div className="flex items-center gap-2">
          <StatusPill tone={supportTone(latestResponse.support_label)} size="md" dot>
            {supportLabel(latestResponse.support_label)}
          </StatusPill>
        </div>
        <p className="mt-2 text-ui-2xs leading-relaxed text-ink-400">
          Derived from the per-claim support levels: high only when every claim is high, low if any claim is low.
        </p>
      </PanelSection>

      <PanelSection title="Query plan">
        <dl>
          <FieldRow label="Answer slots">
            <div className="flex flex-wrap gap-1">
              {plan.answer_slots.length === 0 ? (
                <span className="text-ink-400">none extracted</span>
              ) : (
                plan.answer_slots.map((slot) => (
                  <span
                    key={slot}
                    className="rounded-sm border border-signal-600/40 bg-signal-900/40 px-1.5 py-px font-mono text-[10px] text-signal-300"
                  >
                    {slot}
                  </span>
                ))
              )}
            </div>
          </FieldRow>

          <FieldRow label="Entities">
            {plan.entity_ids.length === 0 ? (
              <span className="text-ink-400">no entity matched</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {plan.entity_ids.map((id) => (
                  <span key={id} className="rounded-sm border border-ink-600 bg-ink-750 px-1.5 py-px font-mono text-[10px] text-ink-200">
                    {id}
                  </span>
                ))}
              </div>
            )}
          </FieldRow>

          <FieldRow label="Channel weights">
            <div className="space-y-1">
              {Object.entries(plan.channel_weights).map(([channel, weight]) => (
                <div key={channel} className="flex items-center gap-2">
                  <span className="w-[74px] shrink-0 font-mono text-[10px] text-ink-300">{channel}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700">
                    <div
                      className={cn("h-full rounded-full", weight > 1 ? "bg-signal-500" : "bg-ink-400")}
                      style={{ width: `${Math.min(100, (weight / 2) * 100)}%` }}
                    />
                  </div>
                  <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular text-ink-200">
                    ×{weight}
                  </span>
                </div>
              ))}
            </div>
          </FieldRow>
        </dl>
      </PanelSection>

      {/* Requested vs retrieved — a required modality that produced nothing is
          a coverage gap, and it is stated rather than glossed over. */}
      <PanelSection title="Modality coverage">
        <ul className="space-y-1.5">
          {MODALITIES.map((modality) => {
            const required = plan.required_modalities.includes(modality);
            const retrieved = retrievedModalities.has(modality);
            const count = latestResponse.evidence.filter((e) => e.modality === modality).length;
            return (
              <li key={modality} className="flex items-center gap-2">
                <ModalityBadge modality={modality} />
                <span className="flex-1 text-ui-2xs text-ink-300">
                  {required ? "required" : "not required"}
                </span>
                <span
                  className={cn(
                    "font-mono text-[10px] tabular",
                    required && !retrieved ? "text-caution-400" : "text-ink-300",
                  )}
                >
                  {required && !retrieved ? "gap · 0" : count}
                </span>
              </li>
            );
          })}
        </ul>
      </PanelSection>

      <PanelSection title="Stage timings">
        <ul className="space-y-1.5">
          {Object.entries(timings).map(([stage, ms]) => (
            <li key={stage} className="flex items-center gap-2">
              <span className="w-[62px] shrink-0 font-mono text-[10px] text-ink-300">{stage}</span>
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700">
                <div className="h-full rounded-full bg-uv-400" style={{ width: `${(ms / maxMs) * 100}%` }} />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular text-ink-200">
                {formatMs(ms)}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-2 border-t border-ink-600/50 pt-1.5">
            <span className="w-[62px] shrink-0 font-mono text-[10px] text-ink-400">total</span>
            <span className="ml-auto font-mono text-[10px] tabular text-ink-100">{formatMs(totalMs)}</span>
          </li>
        </ul>
      </PanelSection>

      <PanelSection title="Primary event">
        {latestResponse.primary_event_id ? (
          <div className="space-y-2.5">
            <p className="font-mono text-ui-2xs text-ink-100" title={latestResponse.primary_event_id}>
              {truncateId(latestResponse.primary_event_id, 18, 6)}
            </p>
            <Button asChild size="sm" variant="secondary" className="w-full">
              <Link href={`/workspace/graph?event=${encodeURIComponent(latestResponse.primary_event_id)}`}>
                <Network />
                Explore graph
              </Link>
            </Button>
          </div>
        ) : (
          <p className="text-ui-2xs leading-relaxed text-ink-400">
            No event was reached by graph expansion for this query. The bundle was assembled from seed retrieval alone.
          </p>
        )}
      </PanelSection>

      <PanelSection title={`Bundle · ${latestResponse.evidence.length}`}>
        <BundleList />
      </PanelSection>
    </div>
  );
}

/** Every item the reranker put in the bundle, cited or not — the cited subset
 *  is marked, so it is visible how much context backed an answer beyond what
 *  the model chose to reference. */
function BundleList() {
  const { latestResponse, openSourceDrawer } = useWorkspace();
  if (!latestResponse) return null;

  const citedIds = new Set(latestResponse.claims.flatMap((c) => c.evidence_ids));

  return (
    <ul className="space-y-1">
      {latestResponse.evidence.map((item) => {
        const meta = modalityMeta(item.modality);
        const cited = citedIds.has(item._id);
        return (
          <li key={item._id}>
            <button
              type="button"
              onClick={() => openSourceDrawer(item._id)}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ink-750"
            >
              <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", meta.dot)} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-ui-2xs leading-relaxed text-ink-200">{item.content}</span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  {cited && (
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-signal-400">cited</span>
                  )}
                  {item.score !== null && item.score !== undefined && (
                    <span className="font-mono text-[9.5px] tabular text-ink-500">{item.score.toFixed(3)}</span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
