import { cn } from "@/lib/utils";

/** A loading placeholder. Sized to the content it stands in for, so the
 *  layout does not jump when real data lands. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton", className)} aria-hidden {...props} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-3/5" : i % 3 === 1 ? "w-11/12" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonEvidenceCard({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-lg border border-ink-600/70 bg-ink-800/50 p-3", className)} aria-hidden>
      <div className="flex items-center gap-2">
        <Skeleton className="h-[22px] w-14 rounded-sm" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="ml-auto h-3 w-10" />
      </div>
      <SkeletonText lines={2} />
      <Skeleton className="h-1 w-full rounded-full" />
    </div>
  );
}

/** Announces to screen readers that content is loading, without spamming
 *  every skeleton element into the accessibility tree. */
export function LoadingRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
