import { FlaskConical } from "lucide-react";

import { IS_DEMO_MODE } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Marks synthetic data. Rendered wherever demo fixtures are visible — never
 * suppressed, never subtle enough to miss. If this is on screen, nothing on
 * the screen came from a real backend.
 */
export function DemoBadge({ className, variant = "inline" }: { className?: string; variant?: "inline" | "banner" }) {
  if (!IS_DEMO_MODE) return null;

  if (variant === "banner") {
    return (
      <div
        role="status"
        className={cn(
          "flex items-center gap-2 border-b border-caution-500/30 bg-caution-900/50 px-3 py-1.5 text-ui-2xs text-caution-400",
          className,
        )}
      >
        <FlaskConical className="size-3.5 shrink-0" aria-hidden />
        <span>
          <strong className="font-medium">Demo mode.</strong> Every source, evidence item, relationship and answer on
          this screen is synthetic fixture data. No backend is connected.
        </span>
      </div>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-caution-500/35 bg-caution-900/50 px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.08em] text-caution-400",
        className,
      )}
      title="Synthetic fixture data — no backend connected"
    >
      <FlaskConical className="size-2.5" aria-hidden />
      Demo data
    </span>
  );
}
