import { cn } from "@/lib/utils";

/**
 * OmniTrace mark: three source points converging on one resolved node, with
 * the trace line continuing past it. Drawn rather than imported so it inherits
 * currentColor and stays crisp at 20px in the navbar.
 */
export function Logomark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("size-[22px]", className)} aria-hidden focusable="false">
      {/* the three unresolved sources */}
      <circle cx="3.5" cy="5" r="1.6" className="fill-ink-300" />
      <circle cx="3.5" cy="12" r="1.6" className="fill-ink-300" />
      <circle cx="3.5" cy="19" r="1.6" className="fill-ink-300" />
      {/* convergence */}
      <path
        d="M5.1 5.4 12.2 11.4M5.1 12h7.1M5.1 18.6 12.2 12.6"
        className="stroke-ink-500"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* the resolved evidence node */}
      <circle cx="14.4" cy="12" r="3" className="fill-signal-500/15 stroke-signal-500" strokeWidth="1.5" />
      <circle cx="14.4" cy="12" r="0.9" className="fill-signal-400" />
      {/* the trace continuing */}
      <path d="M18 12h3.2" className="stroke-signal-500" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className, showMark = true }: { className?: string; showMark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink-50", className)}>
      {showMark && <Logomark />}
      <span className="text-[15px] font-semibold tracking-[-0.015em]">
        Omni<span className="text-signal-400">Trace</span>
      </span>
    </span>
  );
}
