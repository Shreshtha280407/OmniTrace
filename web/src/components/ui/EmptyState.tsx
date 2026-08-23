import { AlertTriangle, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "./Button";

/**
 * EmptyState — used for empty, unavailable and failed alike.
 *
 * The `tone` distinguishes "there is nothing here yet" from "we could not
 * find out". Conflating those is how an interface ends up implying success
 * during an outage.
 */

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  tone?: "neutral" | "caution" | "fault";
  action?: { label: string; onClick: () => void; loading?: boolean };
  secondaryAction?: { label: string; onClick: () => void };
  /** Raw technical detail — collapsed by default, monospace when shown. */
  detail?: string | null;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  tone = "neutral",
  action,
  secondaryAction,
  detail,
  className,
  compact,
}: EmptyStateProps) {
  const iconTone =
    tone === "fault" ? "text-fault-500" : tone === "caution" ? "text-caution-500" : "text-ink-400";
  const ringTone =
    tone === "fault"
      ? "border-fault-500/25 bg-fault-900/40"
      : tone === "caution"
        ? "border-caution-500/25 bg-caution-900/40"
        : "border-ink-600 bg-ink-800/60";

  const Glyph = Icon ?? (tone === "neutral" ? undefined : AlertTriangle);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2.5 px-4 py-8" : "gap-3.5 px-6 py-14",
        className,
      )}
      role={tone === "fault" ? "alert" : undefined}
    >
      {Glyph && (
        <div className={cn("flex items-center justify-center rounded-lg border", ringTone, compact ? "size-9" : "size-11")}>
          <Glyph className={cn(compact ? "size-4" : "size-5", iconTone)} aria-hidden />
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className={cn("font-medium text-ink-50", compact ? "text-ui-sm" : "text-ui-base")}>{title}</h3>
        {description && (
          <p className={cn("mx-auto max-w-sm text-pretty text-ink-300", compact ? "text-ui-xs" : "text-ui-sm")}>
            {description}
          </p>
        )}
      </div>
      {detail && (
        <details className="w-full max-w-md text-left">
          <summary className="cursor-pointer select-none text-center font-mono text-ui-2xs text-ink-400 hover:text-ink-200">
            Technical detail
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md border border-ink-600 bg-ink-900/80 p-2.5 font-mono text-[11px] leading-relaxed text-ink-300">
            {detail}
          </pre>
        </details>
      )}
      {(action || secondaryAction) && (
        <div className="mt-1 flex items-center gap-2">
          {action && (
            <Button size="sm" variant={tone === "fault" ? "danger" : "secondary"} onClick={action.onClick} loading={action.loading}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button size="sm" variant="ghost" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
