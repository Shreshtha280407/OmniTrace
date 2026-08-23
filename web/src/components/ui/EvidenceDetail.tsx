"use client";

import { ArrowUpRight, GitBranch, Layers, Quote } from "lucide-react";

import type { EvidenceItem, Relationship } from "@/lib/api/schemas";
import { evidenceTypeLabel, relationshipLabel } from "@/lib/modality";
import { truncateId } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button } from "./Button";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { FieldRow, PanelSection } from "./PanelShell";
import { ModalityBadge } from "./ModalityBadge";
import { SourceLocator } from "./SourceLocator";
import { StatusPill, relationshipTone } from "./StatusPill";

/**
 * EvidenceDetail — the full record for one evidence item.
 *
 * Shared by the workspace inspector and the graph's node inspector so the two
 * cannot disagree about what a piece of evidence is. Everything rendered here
 * comes from the stored document; nothing is derived, inferred or filled in.
 */

export interface EvidenceDetailProps {
  evidence: EvidenceItem;
  /** Edges touching this node, from the query response or the event graph. */
  relationships?: Relationship[];
  /** Resolves a neighbour id to a readable label for the relationship list. */
  evidenceById?: Record<string, EvidenceItem>;
  onViewSource?: () => void;
  onOpenGraph?: () => void;
  onSelectEvidence?: (id: string) => void;
  eventId?: string | null;
  className?: string;
}

export function EvidenceDetail({
  evidence,
  relationships = [],
  evidenceById = {},
  onViewSource,
  onOpenGraph,
  onSelectEvidence,
  eventId,
  className,
}: EvidenceDetailProps) {
  const outgoing = relationships.filter((r) => r.from_id === evidence._id);
  const incoming = relationships.filter((r) => r.to_id === evidence._id);
  const provenance = evidence.provenance;

  return (
    <div className={cn("divide-y divide-ink-600/50", className)}>
      {/* ── identity ────────────────────────────────────────────────── */}
      <div className="space-y-2.5 px-3 py-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <ModalityBadge modality={evidence.modality} />
          <StatusPill tone={evidence.node_type === "semantic_segment" ? "contextual" : "neutral"} size="xs">
            {evidence.node_type === "semantic_segment" ? "Semantic segment" : "Atomic observation"}
          </StatusPill>
          <span className="text-ui-2xs text-ink-400">{evidenceTypeLabel(evidence.evidence_type)}</span>
          {evidence.score !== null && evidence.score !== undefined && (
            <span className="ml-auto font-mono text-ui-2xs tabular text-ink-300" title="Bundle rerank score">
              {evidence.score.toFixed(4)}
            </span>
          )}
        </div>

        <blockquote className="rounded-md border-l-2 border-signal-600/50 bg-ink-850/60 py-2 pl-2.5 pr-2">
          <Quote className="mb-1 size-3 text-ink-500" aria-hidden />
          <p className="text-pretty text-ui-xs leading-relaxed text-ink-100">
            {evidence.content || <span className="text-ink-400">No content stored for this record.</span>}
          </p>
        </blockquote>

        {evidence.speaker_id && (
          <p className="text-ui-2xs text-ink-300">
            Attributed to <span className="font-mono text-ink-100">{evidence.speaker_id}</span> — a stable anonymous
            identifier, not a verified name.
          </p>
        )}
      </div>

      {/* ── locator ─────────────────────────────────────────────────── */}
      <PanelSection
        title="Source locator"
        action={
          onViewSource && (
            <Button size="xs" variant="secondary" onClick={onViewSource}>
              View source
              <ArrowUpRight />
            </Button>
          )
        }
      >
        <SourceLocator location={evidence.location} variant="block" />
      </PanelSection>

      {/* ── confidence ──────────────────────────────────────────────── */}
      <PanelSection title="Confidence">
        <div className="space-y-1.5">
          <ConfidenceMeter label="Extraction" value={evidence.confidence?.extraction} />
          {evidence.confidence?.alignment !== null && evidence.confidence?.alignment !== undefined && (
            <ConfidenceMeter label="Alignment" value={evidence.confidence.alignment} />
          )}
          {evidence.confidence?.diarization !== null && evidence.confidence?.diarization !== undefined && (
            <ConfidenceMeter label="Diarization" value={evidence.confidence.diarization} threshold={0.6} />
          )}
        </div>
      </PanelSection>

      {/* ── provenance ──────────────────────────────────────────────── */}
      <PanelSection title="Provenance">
        <dl>
          <FieldRow label="Evidence ID" mono title={evidence._id}>
            {evidence._id}
          </FieldRow>
          <FieldRow label="Source ID" mono title={evidence.source_id}>
            {evidence.source_id}
          </FieldRow>
          {provenance ? (
            <>
              <FieldRow label="Producer" mono>
                {provenance.producer}
              </FieldRow>
              <FieldRow label="Model version" mono>
                {provenance.model_version ?? <span className="text-ink-400">none recorded</span>}
              </FieldRow>
              <FieldRow label="Run ID" mono title={provenance.processing_run_id}>
                {truncateId(provenance.processing_run_id, 14, 6)}
              </FieldRow>
              {provenance.config_hash && (
                <FieldRow label="Config hash" mono>
                  {provenance.config_hash}
                </FieldRow>
              )}
              {provenance.derived_from.length > 0 && (
                <FieldRow label="Derived from" mono>
                  {provenance.derived_from.map((id) => truncateId(id, 12, 4)).join(", ")}
                </FieldRow>
              )}
            </>
          ) : (
            <FieldRow label="Provenance">
              <span className="text-caution-400">No provenance record on this document.</span>
            </FieldRow>
          )}
          {evidence.asset_id && (
            <FieldRow label="Asset" mono title={evidence.asset_id}>
              {truncateId(evidence.asset_id, 14, 6)}
            </FieldRow>
          )}
          {evidence.parent_evidence_id && (
            <FieldRow label="Parent evidence" mono>
              <button
                type="button"
                onClick={() => onSelectEvidence?.(evidence.parent_evidence_id!)}
                className="inline-flex items-center gap-1 text-signal-400 hover:text-signal-300 hover:underline"
              >
                <GitBranch className="size-3" aria-hidden />
                {truncateId(evidence.parent_evidence_id, 12, 4)}
              </button>
            </FieldRow>
          )}
        </dl>
      </PanelSection>

      {/* ── membership ──────────────────────────────────────────────── */}
      {(evidence.member_evidence_ids.length > 0 || evidence.entity_ids.length > 0 || eventId) && (
        <PanelSection title="Membership">
          <dl>
            {eventId && (
              <FieldRow label="Event" mono>
                <button
                  type="button"
                  onClick={onOpenGraph}
                  className="inline-flex items-center gap-1 text-signal-400 hover:text-signal-300 hover:underline"
                  disabled={!onOpenGraph}
                >
                  <Layers className="size-3" aria-hidden />
                  {truncateId(eventId, 14, 6)}
                </button>
              </FieldRow>
            )}
            {evidence.entity_ids.length > 0 && (
              <FieldRow label="Entities">
                <div className="flex flex-wrap gap-1">
                  {evidence.entity_ids.map((id) => (
                    <span
                      key={id}
                      className="rounded-sm border border-ink-600 bg-ink-750 px-1.5 py-px font-mono text-[10.5px] text-ink-200"
                    >
                      {id}
                    </span>
                  ))}
                </div>
              </FieldRow>
            )}
            {evidence.member_evidence_ids.length > 0 && (
              <FieldRow label="Members">
                <div className="flex flex-wrap gap-1">
                  {evidence.member_evidence_ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelectEvidence?.(id)}
                      className="rounded-sm border border-ink-600 bg-ink-750 px-1.5 py-px font-mono text-[10.5px] text-ink-200 transition-colors hover:border-signal-600 hover:text-signal-300"
                    >
                      {truncateId(id, 10, 4)}
                    </button>
                  ))}
                </div>
              </FieldRow>
            )}
          </dl>
        </PanelSection>
      )}

      {/* ── relationships ───────────────────────────────────────────── */}
      {(outgoing.length > 0 || incoming.length > 0) && (
        <PanelSection title={`Relationships · ${outgoing.length + incoming.length}`}>
          <ul className="space-y-1">
            {outgoing.map((rel) => (
              <RelationshipRow
                key={rel._id}
                rel={rel}
                direction="out"
                other={evidenceById[rel.to_id]}
                otherId={rel.to_id}
                onSelect={onSelectEvidence}
              />
            ))}
            {incoming.map((rel) => (
              <RelationshipRow
                key={rel._id}
                rel={rel}
                direction="in"
                other={evidenceById[rel.from_id]}
                otherId={rel.from_id}
                onSelect={onSelectEvidence}
              />
            ))}
          </ul>
        </PanelSection>
      )}
    </div>
  );
}

function RelationshipRow({
  rel,
  direction,
  other,
  otherId,
  onSelect,
}: {
  rel: Relationship;
  direction: "in" | "out";
  other: EvidenceItem | undefined;
  otherId: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(otherId)}
        disabled={!onSelect}
        className="group flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left transition-colors hover:bg-ink-750 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span
          aria-hidden
          className={cn("shrink-0 font-mono text-[10px]", direction === "out" ? "text-signal-400" : "text-uv-300")}
          title={direction === "out" ? "outgoing" : "incoming"}
        >
          {direction === "out" ? "→" : "←"}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.04em] text-ink-200">
          {relationshipLabel(rel.type)}
        </span>
        {other && <span className="min-w-0 flex-1 truncate text-ui-2xs text-ink-400">{other.content}</span>}
        <StatusPill tone={relationshipTone(rel.status)} size="xs" className="ml-auto shrink-0">
          {rel.confidence.toFixed(2)}
        </StatusPill>
      </button>
    </li>
  );
}
