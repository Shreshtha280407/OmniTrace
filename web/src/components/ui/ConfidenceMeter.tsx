import { formatConfidence } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * ConfidenceMeter — a scored value from the API, drawn to scale.
 *
 * A null score renders as an explicit "not scored" rather than an empty bar,
 * because an empty bar reads as zero confidence and zero confidence is a
 * different statement from "this stage does not produce a score".
 */

export interface ConfidenceMeterProps {
  label: string;
  value: number | null | undefined;
  /** Optional 0-1 threshold; the bar above it takes the validated colour. */
  threshold?: number;
  className?: string;
  size?: "sm" | "md";
}

export function ConfidenceMeter({ label, value, threshold = 0.75, className, size = "sm" }: ConfidenceMeterProps) {
  const has = value !== null && value !== undefined && Number.isFinite(value);
  const clamped = has ? Math.max(0, Math.min(1, value as number)) : 0;
  const tone = !has
    ? "bg-ink-500"
    : clamped >= threshold
      ? "bg-validated-500"
      : clamped >= threshold * 0.7
        ? "bg-caution-500"
        : "bg-fault-500";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className={cn("shrink-0 text-ink-300", size === "sm" ? "text-ui-2xs" : "text-ui-xs")}>{label}</span>
      <div
        className={cn(
          "relative flex-1 overflow-hidden rounded-full bg-ink-700",
          size === "sm" ? "h-1" : "h-1.5",
        )}
        role="meter"
        aria-valuenow={has ? clamped : undefined}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-label={label}
        aria-valuetext={has ? formatConfidence(clamped) : "not scored"}
      >
        {has && (
          <div
            className={cn("h-full rounded-full transition-[width] duration-500 ease-cinematic", tone)}
            style={{ width: `${clamped * 100}%` }}
          />
        )}
      </div>
      <span
        className={cn(
          "shrink-0 font-mono tabular",
          size === "sm" ? "text-ui-2xs" : "text-ui-xs",
          has ? "text-ink-100" : "text-ink-400",
        )}
      >
        {has ? formatConfidence(clamped) : "not scored"}
      </span>
    </div>
  );
}

/** Compact inline form for dense lists — no label, no numeric readout. */
export function ConfidenceBar({ value, className }: { value: number | null | undefined; className?: string }) {
  const has = value !== null && value !== undefined && Number.isFinite(value);
  const clamped = has ? Math.max(0, Math.min(1, value as number)) : 0;
  return (
    <span
      className={cn("relative inline-block h-1 w-10 overflow-hidden rounded-full bg-ink-700 align-middle", className)}
      title={has ? `confidence ${formatConfidence(clamped)}` : "not scored"}
    >
      {has && (
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            clamped >= 0.75 ? "bg-validated-500" : clamped >= 0.5 ? "bg-caution-500" : "bg-fault-500",
          )}
          style={{ width: `${clamped * 100}%` }}
        />
      )}
    </span>
  );
}
