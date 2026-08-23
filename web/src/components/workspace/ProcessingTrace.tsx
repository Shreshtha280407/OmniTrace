"use client";

import { RunTimeline } from "@/components/ui/RunTimeline";
import { ErrorState } from "@/components/ui/ErrorState";
import { useJobStatus, useSource } from "@/lib/api/queries";

/**
 * Live processing trace for one ingested source.
 *
 * Status comes entirely from `GET /api/v1/jobs/{id}`, polled with exponential
 * backoff until the job reaches a terminal state (see `useJobStatus`). The
 * media type comes from the source record and decides which stages are
 * *required* — that is what lets the timeline show a stage as queued instead of
 * pretending the pipeline is shorter than it is.
 */
export function ProcessingTrace({ jobId, onRetry }: { jobId: string; onRetry?: () => void }) {
  const job = useJobStatus(jobId);
  const source = useSource(jobId); // job_id === source_id by backend design

  if (job.isError) {
    return (
      <ErrorState
        compact
        error={job.error}
        title="Could not read job status"
        onRetry={() => void job.refetch()}
        retrying={job.isFetching}
      />
    );
  }

  if (job.isLoading) {
    return (
      <div className="rounded-lg border border-ink-600/70 bg-ink-850/70 p-3" role="status" aria-live="polite">
        <span className="sr-only">Loading processing trace</span>
        <div className="skeleton mb-2 h-3 w-32" />
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-4 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return <RunTimeline dense job={job.data} mediaType={source.data?.media_type} onRetry={onRetry} />;
}
