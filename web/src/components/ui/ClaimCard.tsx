"use client";

import { AlertTriangle } from "lucide-react";

import type { Claim, EvidenceItem } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import { EvidenceChip } from "./EvidenceChip";
import { StatusPill, supportLabel, supportTone } from "./StatusPill";

/**
 * ClaimCard — one generated claim and the evidence it cites.
 *
 * The support pill reflects the model's own per-claim `support` field, passed
 * through by the validators. Citations are the actual `evidence_ids` on the
 * claim; when one is not present in the returned bundle the chip says so
 * rather than being quietly dropped.
 */

export interface ClaimCardProps {
  claim: Claim;
  index: number;
  evidenceById: Record<string, EvidenceItem>;
  onSelectEvidence: (evidenceId: string) => void;
  activeEvidenceId?: string | null;
  className?: string;
}

export function ClaimCard({
  claim,
  index,
  evidenceById,
  onSelectEvidence,
  activeEvidenceId,
  className,
}: ClaimCardProps) {
  const orphaned = claim.evidence_ids.filter((id) => !evidenceById[id]);

  return (
    <article
      className={cn(
        "group rounded-lg border border-ink-600/70 bg-ink-800/50 p-3 transition-colors duration-150 hover:border-ink-550",
        className,
      )}
      aria-label={`Claim ${index + 1}`}
    >
      <div className="mb-2 flex items-start gap-2.5">
        <span className="mt-[3px] shrink-0 font-mono text-ui-2xs tabular text-ink-400">
          {String(index + 1).padStart(2, "0")}
        </span>
        <p className="flex-1 text-pretty text-ui-sm leading-relaxed text-ink-50">{claim.text}</p>
        <StatusPill tone={supportTone(claim.support)} size="xs" className="mt-[1px] shrink-0">
          {supportLabel(claim.support).replace(" support", "")}
        </StatusPill>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pl-[26px]">
        <span className="text-ui-2xs text-ink-400">Cites</span>
        {claim.evidence_ids.map((id, i) => (
          <EvidenceChip
            key={id}
            evidenceId={id}
            evidence={evidenceById[id]}
            index={i}
            active={activeEvidenceId === id}
            onClick={() => onSelectEvidence(id)}
          />
        ))}
      </div>

      {orphaned.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 pl-[26px] text-ui-2xs text-fault-400">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
          {orphaned.length} cited {orphaned.length === 1 ? "id is" : "ids are"} not in the returned bundle and cannot be
          opened.
        </p>
      )}
    </article>
  );
}

/** Conflicts and gaps are product strengths, not error states — they get a
 *  deliberate, calm presentation rather than a red banner. */
export function DisclosureList({
  title,
  items,
  tone,
  icon: Icon,
}: {
  title: string;
  items: string[];
  tone: "caution" | "contextual";
  icon: React.ComponentType<{ className?: string }>;
}) {
  if (items.length === 0) return null;
  const border = tone === "caution" ? "border-caution-500/25" : "border-uv-500/25";
  const bg = tone === "caution" ? "bg-caution-900/25" : "bg-uv-800/20";
  const text = tone === "caution" ? "text-caution-400" : "text-uv-300";

  return (
    <div className={cn("rounded-lg border p-3", border, bg)}>
      <div className={cn("mb-2 flex items-center gap-2", text)}>
        <Icon className="size-3.5" />
        <h4 className="font-mono text-ui-2xs uppercase tracking-[0.14em]">{title}</h4>
        <span className="ml-auto font-mono text-ui-2xs tabular opacity-70">{items.length}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-pretty text-ui-xs leading-relaxed text-ink-200">
            <span aria-hidden className={cn("mt-[7px] size-1 shrink-0 rounded-full", text.replace("text-", "bg-"))} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
