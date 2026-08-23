import { Clock, Crop, FileText, MapPin } from "lucide-react";

import { formatTimecode } from "@/lib/format";
import type { EvidenceItem, SourceLocator as SourceLocatorType } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/**
 * SourceLocator — where a piece of evidence physically is.
 *
 * The rule from §06 is enforced here rather than trusted upstream: a record is
 * time-located OR page-located, never both and never neither-rendered-as-zero.
 * If the stored location has no usable coordinates, this says "no locator
 * stored" — it does not fall back to 00:00.0 or page 1.
 */

type AnyEvidence = Pick<EvidenceItem, "location" | "modality"> | SourceLocatorType;

export type LocatorKind = "time" | "page" | "region" | "none";

export function locatorKind(location: EvidenceItem["location"] | undefined): LocatorKind {
  if (!location) return "none";
  if (location.start_ms !== null && location.start_ms !== undefined) return "time";
  if (location.page !== null && location.page !== undefined) return "page";
  if (location.bbox_norm) return "region";
  return "none";
}

/** Plain-text form, for aria labels, tooltips and the graph inspector. */
export function locatorText(location: EvidenceItem["location"] | undefined): string {
  const kind = locatorKind(location);
  if (!location || kind === "none") return "no locator stored";
  if (kind === "time") {
    const start = formatTimecode(location.start_ms);
    const end = location.end_ms !== null && location.end_ms !== undefined && location.end_ms !== location.start_ms
      ? `–${formatTimecode(location.end_ms)}`
      : "";
    return `${start}${end}`;
  }
  if (kind === "page") {
    const box = location.bbox_norm ? " · region" : "";
    return `p.${String(location.page).padStart(2, "0")}${box}`;
  }
  return "region";
}

export interface SourceLocatorProps {
  location: EvidenceItem["location"] | undefined;
  className?: string;
  /** `inline` for chips and lists, `block` for the inspector. */
  variant?: "inline" | "block";
}

export function SourceLocator({ location, className, variant = "inline" }: SourceLocatorProps) {
  const kind = locatorKind(location);
  const Icon = kind === "time" ? Clock : kind === "page" ? FileText : kind === "region" ? Crop : MapPin;

  if (variant === "inline") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 font-mono text-ui-2xs tabular",
          kind === "none" ? "text-ink-400" : "text-ink-200",
          className,
        )}
      >
        <Icon className="size-3 shrink-0" aria-hidden />
        {locatorText(location)}
      </span>
    );
  }

  const bbox = location?.bbox_norm;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        <Icon className={cn("size-3.5", kind === "none" ? "text-ink-400" : "text-signal-400")} aria-hidden />
        <span
          className={cn("font-mono text-ui-xs tabular", kind === "none" ? "text-ink-400" : "text-ink-50")}
        >
          {locatorText(location)}
        </span>
      </div>
      {location?.timeline_id && (
        <div className="telemetry pl-[22px]">timeline {location.timeline_id}</div>
      )}
      {location?.block_id && <div className="telemetry pl-[22px]">block {location.block_id}</div>}
      {bbox && (
        <div className="telemetry pl-[22px]">
          bbox [{bbox.x1.toFixed(3)}, {bbox.y1.toFixed(3)}] → [{bbox.x2.toFixed(3)}, {bbox.y2.toFixed(3)}]
        </div>
      )}
    </div>
  );
}

/** True when this evidence can be positioned on a wall-clock timeline. Used by
 *  the graph scrubber, which must not filter out documents by pretending they
 *  have a time. */
export function isTimeBearing(item: AnyEvidence): boolean {
  return item.location?.start_ms !== null && item.location?.start_ms !== undefined;
}
