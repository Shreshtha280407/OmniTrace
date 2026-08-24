import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * StatusPill — the one component allowed to make a claim about state.
 *
 * `tone` is never chosen by vibe: it is derived from an API field by the
 * mapping helpers below. There is no `verified` tone, because no endpoint in
 * this system returns a verification verdict. Confirmed relationships and
 * validated bundles are different, narrower claims and say so.
 */

const pill = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium leading-none transition-colors",
  {
    variants: {
      tone: {
        neutral: "border-ink-550 bg-ink-700/70 text-ink-200",
        active: "border-signal-500/40 bg-signal-900/50 text-signal-300",
        validated: "border-validated-500/40 bg-validated-900/60 text-validated-400",
        caution: "border-caution-500/40 bg-caution-900/60 text-caution-400",
        fault: "border-fault-500/40 bg-fault-900/60 text-fault-400",
        contextual: "border-uv-500/40 bg-uv-800/40 text-uv-300",
        pending: "border-ink-550 bg-ink-700/50 text-ink-300",
      },
      size: {
        xs: "h-[18px] px-1.5 text-[10px] tracking-[0.04em]",
        sm: "h-[22px] px-2 text-ui-2xs",
        md: "h-6 px-2.5 text-ui-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof pill>["tone"]>;

export interface StatusPillProps extends VariantProps<typeof pill> {
  children: React.ReactNode;
  className?: string;
  /** Small leading dot; set `pulse` while a stage is genuinely running. */
  dot?: boolean;
  pulse?: boolean;
  title?: string;
}

export function StatusPill({ children, className, tone, size, dot, pulse, title }: StatusPillProps) {
  return (
    <span className={cn(pill({ tone, size }), className)} title={title}>
      {dot && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full bg-current",
            pulse && "animate-pulse-soft motion-reduce:animate-none",
          )}
        />
      )}
      {children}
    </span>
  );
}

// ── mappings from API values to tone + label ───────────────────────────────

/** `support_label` / claim `support` from POST /query. */
export function supportTone(support: string): StatusTone {
  switch (support) {
    case "high":
      return "validated";
    case "medium":
      return "caution";
    case "low":
      return "caution";
    case "ungrounded":
      // Not a degraded grounded answer — a different kind of answer entirely.
      // "contextual" reads as informational rather than as a warning about
      // weak evidence, because there is no evidence being judged here.
      return "contextual";
    default:
      return "pending"; // "none" — no claims were produced
  }
}

export function supportLabel(support: string): string {
  switch (support) {
    case "high":
      return "High support";
    case "medium":
      return "Partial support";
    case "low":
      return "Low support";
    case "ungrounded":
      return "No sources · general knowledge";
    default:
      return "Insufficient evidence";
  }
}

/** Source status from `omnitrace/models.py` Source.status. */
export function sourceStatusTone(status: string): StatusTone {
  switch (status) {
    case "ready":
      return "validated";
    case "partial_ready":
      return "caution";
    case "failed":
      return "fault";
    case "probing":
    case "extracting":
      return "active";
    default:
      return "pending";
  }
}

export function sourceStatusLabel(status: string): string {
  switch (status) {
    case "uploaded":
      return "Uploaded";
    case "probing":
      return "Probing";
    case "probed":
      return "Probed";
    case "extracting":
      return "Extracting";
    case "partial_ready":
      return "Partially ready";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

/** ProcessingRun status. `queued` is our own label for a required stage that
 *  has no run document yet — the backend omits it entirely. */
export function stageTone(status: "running" | "ok" | "failed" | "queued"): StatusTone {
  switch (status) {
    case "ok":
      return "validated";
    case "failed":
      return "fault";
    case "running":
      return "active";
    default:
      return "pending";
  }
}

/** Relationship status from the linker. */
export function relationshipTone(status: string): StatusTone {
  switch (status) {
    case "confirmed":
      return "active";
    case "tentative":
      return "contextual";
    default:
      return "pending";
  }
}
