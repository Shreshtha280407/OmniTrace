"use client";

import { forwardRef } from "react";

import type { EvidenceItem } from "@/lib/api/schemas";
import { modalityMeta } from "@/lib/modality";
import { truncateId } from "@/lib/format";
import { cn } from "@/lib/utils";

import { locatorText } from "./SourceLocator";

/**
 * EvidenceChip — an inline citation inside a claim.
 *
 * Clicking one is the primary way a reader moves from a sentence to the thing
 * that backs it, so it is a real button with a descriptive accessible name,
 * not a decorated span. The visible text stays short (modality + locator);
 * the full evidence id lives in the accessible name and the title.
 */

export interface EvidenceChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  evidence: EvidenceItem | undefined;
  evidenceId: string;
  /** Index within the claim, rendered as a superscript marker. */
  index?: number;
  active?: boolean;
}

export const EvidenceChip = forwardRef<HTMLButtonElement, EvidenceChipProps>(
  ({ evidence, evidenceId, index, active, className, ...props }, ref) => {
    const meta = modalityMeta(evidence?.modality);
    const locator = locatorText(evidence?.location);

    // An id cited but absent from the bundle is a real condition worth showing
    // rather than hiding — the validators strip these, so seeing one means
    // something upstream changed.
    const missing = !evidence;

    const label = missing
      ? `Evidence ${evidenceId} — not present in the returned bundle`
      : `${meta.label} evidence at ${locator}, id ${evidenceId}`;

    return (
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        data-evidence-id={evidenceId}
        className={cn(
          "group/chip inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-[1px] align-baseline font-mono text-[10.5px] leading-[16px] tabular transition-colors duration-150",
          missing
            ? "border-fault-500/40 bg-fault-900/50 text-fault-400"
            : cn(meta.border, meta.bg, meta.text, "hover:border-current/60"),
          active && !missing && "ring-1 ring-signal-500/60",
          className,
        )}
        {...props}
      >
        {index !== undefined && (
          <span className="text-ink-300 group-hover/chip:text-current">{index + 1}</span>
        )}
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", missing ? "bg-fault-500" : meta.dot)} />
        <span className="truncate">{missing ? truncateId(evidenceId, 8, 4) : locator}</span>
      </button>
    );
  },
);
EvidenceChip.displayName = "EvidenceChip";
