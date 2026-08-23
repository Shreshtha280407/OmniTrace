"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";

import {
  ApiError,
  getEvent,
  getEvidenceSource,
  getHealth,
  getJob,
  getSource,
  getSourceEvidence,
  runQuery,
  type JobStatus,
  type QueryRequest,
  type QueryResponse,
  type SemanticEvent,
  type Source,
  type SourceEvidenceResponse,
} from ".";

export const queryKeys = {
  health: ["health"] as const,
  job: (id: string) => ["job", id] as const,
  source: (id: string) => ["source", id] as const,
  sourceEvidence: (id: string) => ["source", id, "evidence"] as const,
  event: (id: string) => ["event", id] as const,
  evidenceSource: (id: string) => ["evidence", id, "source"] as const,
};

/** A 404 or a contract mismatch will not become truthful on retry. Only
 *  transport-level failures are worth repeating. */
function retryOnlyTransient(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) return error.retryable && failureCount < 3;
  return failureCount < 2;
}

export const defaultQueryOptions = {
  retry: retryOnlyTransient,
  retryDelay: (attempt: number) => Math.min(1_000 * 2 ** attempt, 8_000),
  staleTime: 30_000,
  refetchOnWindowFocus: false,
} satisfies Partial<UseQueryOptions>;

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => getHealth({ signal }),
    ...defaultQueryOptions,
    staleTime: 15_000,
    retry: false,
  });
}

export function useSource(sourceId: string | null | undefined) {
  return useQuery<Source>({
    queryKey: queryKeys.source(sourceId ?? ""),
    queryFn: ({ signal }) => getSource(sourceId!, { signal }),
    enabled: Boolean(sourceId),
    ...defaultQueryOptions,
  });
}

export function useSourceEvidence(sourceId: string | null | undefined, limit = 500) {
  return useQuery<SourceEvidenceResponse>({
    queryKey: queryKeys.sourceEvidence(sourceId ?? ""),
    queryFn: ({ signal }) => getSourceEvidence(sourceId!, { limit }, { signal }),
    enabled: Boolean(sourceId),
    ...defaultQueryOptions,
  });
}

export function useEvent(eventId: string | null | undefined) {
  return useQuery<SemanticEvent>({
    queryKey: queryKeys.event(eventId ?? ""),
    queryFn: ({ signal }) => getEvent(eventId!, { signal }),
    enabled: Boolean(eventId),
    ...defaultQueryOptions,
  });
}

export function useEvidenceSource(evidenceId: string | null | undefined) {
  return useQuery<Source>({
    queryKey: queryKeys.evidenceSource(evidenceId ?? ""),
    queryFn: ({ signal }) => getEvidenceSource(evidenceId!, { signal }),
    enabled: Boolean(evidenceId),
    ...defaultQueryOptions,
  });
}

/** Terminal source statuses — polling stops here rather than running forever. */
const TERMINAL_STATUSES = new Set(["ready", "partial_ready", "failed"]);

export function isJobTerminal(job: JobStatus | undefined): boolean {
  if (!job) return false;
  if (Object.values(job.stages).some((s) => s.status === "failed")) return true;
  return TERMINAL_STATUSES.has(job.source_status);
}

/**
 * Job status polling with exponential backoff.
 *
 * The backend runs extraction synchronously inside POST /sources, so in
 * practice the first poll usually already reports a terminal state. The
 * backoff exists for the deployment where that stops being true (a queued
 * runner, a slower box) — it starts at 800ms, doubles to a 15s ceiling, and
 * stops entirely once the job reaches a terminal status. It never invents
 * intermediate progress between polls.
 */
export function useJobStatus(jobId: string | null | undefined, opts: { enabled?: boolean } = {}) {
  const enabled = Boolean(jobId) && (opts.enabled ?? true);

  return useQuery<JobStatus>({
    queryKey: queryKeys.job(jobId ?? ""),
    queryFn: ({ signal }) => getJob(jobId!, { signal }),
    enabled,
    retry: retryOnlyTransient,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (isJobTerminal(job)) return false;
      const polls = query.state.dataUpdateCount;
      return Math.min(800 * 2 ** Math.max(0, polls - 1), 15_000);
    },
  });
}

export function useRunQuery() {
  const client = useQueryClient();
  return useMutation<QueryResponse, ApiError, QueryRequest>({
    mutationFn: (req) => runQuery(req),
    onSuccess: (data) => {
      // The query response already carries the event; seed the cache so the
      // graph route does not refetch what we were just handed.
      if (data.primary_event_id) {
        client.setQueryData(queryKeys.event(data.primary_event_id), (existing: SemanticEvent | undefined) => existing);
      }
    },
  });
}
