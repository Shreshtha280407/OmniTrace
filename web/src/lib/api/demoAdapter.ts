import { ApiError, type UploadProgress } from "./client";
import {
  DEMO_EVENT,
  DEMO_EVIDENCE,
  DEMO_SOURCES,
  EVT_PRIMARY,
  demoJob,
  demoQueryResponse,
} from "./fixtures";
import type {
  EvaluationRun,
  Health,
  JobStatus,
  QueryRequest,
  QueryResponse,
  SemanticEvent,
  Source,
  SourceCreateResponse,
  SourceEvidenceResponse,
} from "./schemas";

/**
 * Demo adapter — opt-in via NEXT_PUBLIC_DEMO_MODE=true, never a fallback.
 *
 * This module deliberately does NOT wrap the live client. There is no path
 * where a failed live request silently degrades into fixtures: `api.ts`
 * chooses one implementation at module load based on the env flag, and the
 * chosen one is the only one that runs. A backend outage in normal mode
 * surfaces as an error state, which is the honest thing to show.
 *
 * Latency below is a deliberate, visible property of the demo: it exists so
 * loading and streaming states can actually be exercised, not to imitate work.
 */

const LATENCY = { fast: 180, normal: 420, query: 1_400 };

function delay<T>(value: T, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(value), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Sources created during this browser session, so an upload in demo mode
 *  produces a source that subsequently resolves rather than 404ing. */
const sessionSources = new Map<string, Source>();

function allSources(): Record<string, Source> {
  return { ...DEMO_SOURCES, ...Object.fromEntries(sessionSources) };
}

const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  mp4: "video", mov: "video", mkv: "video", webm: "video", avi: "video", m4v: "video",
  mp3: "audio", wav: "audio", m4a: "audio", flac: "audio", ogg: "audio", aac: "audio",
  png: "image", jpg: "image", jpeg: "image", webp: "image", bmp: "image", gif: "image", tiff: "image",
  pdf: "document", docx: "document", txt: "document", md: "document", pptx: "document",
};

function fakeUlid(seed: number): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  let n = seed;
  for (let i = 0; i < 26; i += 1) {
    out += alphabet[Math.abs(n) % 32];
    n = Math.floor(n / 3) + i * 977;
  }
  return out;
}

export async function createSource(
  file: File,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<SourceCreateResponse> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mediaType = MEDIA_TYPE_BY_EXT[ext];
  if (!mediaType) {
    // Mirrors the real 400 from api/routes/sources.py so the error path is
    // exercised in demo mode too.
    throw new ApiError({
      kind: "validation",
      status: 400,
      message: "unsupported extension",
      detail: `unsupported file extension: '.${ext}'`,
    });
  }

  // Report progress against the real file size at a fixed byte rate, so the
  // bar reflects the actual file rather than an arbitrary timer.
  const total = file.size;
  const steps = 16;
  for (let i = 1; i <= steps; i += 1) {
    await delay(null, 55, opts.signal);
    const loaded = Math.round((total * i) / steps);
    opts.onProgress?.({ loaded, total, fraction: loaded / total });
  }

  const sourceId = `src_${fakeUlid(file.size + file.name.length)}`;
  sessionSources.set(sourceId, {
    _id: sourceId,
    schema_version: 1,
    collection_id: "demo_architecture",
    filename: file.name,
    media_type: mediaType,
    mime_type: file.type || "application/octet-stream",
    sha256: fakeUlid(file.size * 31).toLowerCase().padEnd(64, "0").slice(0, 64),
    size_bytes: file.size,
    duration_ms: mediaType === "video" || mediaType === "audio" ? 213_000 : null,
    page_count: mediaType === "document" ? 9 : null,
    status: "ready",
    storage_path: `data/assets/${sourceId}/raw/${file.name}`,
    timeline_id: mediaType === "video" || mediaType === "audio" ? `tl_${fakeUlid(file.size)}` : null,
    created_at: new Date().toISOString(),
  });

  return delay(
    { source_id: sourceId, job_id: sourceId, checksum: sessionSources.get(sourceId)!.sha256, status: "ready" },
    LATENCY.normal,
    opts.signal,
  );
}

export async function getJob(jobId: string, options?: { signal?: AbortSignal }): Promise<JobStatus> {
  const source = allSources()[jobId];
  if (!source) throw new ApiError({ kind: "not_found", status: 404, message: "job not found", detail: "job not found" });
  if (jobId in DEMO_SOURCES) return delay(demoJob(jobId), LATENCY.fast, options?.signal);

  const order: Record<string, string[]> = {
    audio: ["probe", "audio", "enrich"],
    video: ["probe", "audio", "visual", "enrich"],
    image: ["probe", "visual", "enrich"],
    document: ["probe", "document", "enrich"],
  };
  const now = Date.now();
  const stages: JobStatus["stages"] = {};
  (order[source.media_type] ?? ["probe"]).forEach((stage, i) => {
    stages[stage] = {
      status: "ok",
      started_at: new Date(now - 8_000 + i * 1_600).toISOString(),
      ended_at: new Date(now - 8_000 + (i + 1) * 1_600).toISOString(),
      warnings: [],
      error: null,
    };
  });
  return delay({ job_id: jobId, source_id: jobId, source_status: source.status, stages }, LATENCY.fast, options?.signal);
}

export async function getSource(sourceId: string, options?: { signal?: AbortSignal }): Promise<Source> {
  const source = allSources()[sourceId];
  if (!source) {
    throw new ApiError({ kind: "not_found", status: 404, message: "source not found", detail: "source not found" });
  }
  return delay(source, LATENCY.fast, options?.signal);
}

export async function getSourceEvidence(
  sourceId: string,
  params: { limit?: number } = {},
  options?: { signal?: AbortSignal },
): Promise<SourceEvidenceResponse> {
  if (!allSources()[sourceId]) {
    throw new ApiError({ kind: "not_found", status: 404, message: "source not found", detail: "source not found" });
  }
  const evidence = DEMO_EVIDENCE.filter((e) => e.source_id === sourceId).slice(0, params.limit ?? 500);
  return delay({ source_id: sourceId, count: evidence.length, evidence }, LATENCY.normal, options?.signal);
}

export async function getEvent(eventId: string, options?: { signal?: AbortSignal }): Promise<SemanticEvent> {
  if (eventId !== EVT_PRIMARY) {
    throw new ApiError({ kind: "not_found", status: 404, message: "event not found", detail: "event not found" });
  }
  return delay(DEMO_EVENT, LATENCY.normal, options?.signal);
}

export async function runQuery(req: QueryRequest, options?: { signal?: AbortSignal }): Promise<QueryResponse> {
  if (!req.question.trim()) {
    throw new ApiError({ kind: "validation", status: 422, message: "empty question", detail: "question must not be empty" });
  }
  const response = demoQueryResponse(req.question, req.debug_trace ?? false);
  if (req.required_modalities?.length) {
    response.query_plan.required_modalities = Array.from(
      new Set([...response.query_plan.required_modalities, ...req.required_modalities]),
    ).sort();
  }
  return delay(response, LATENCY.query, options?.signal);
}

export async function getEvidenceSource(evidenceId: string, options?: { signal?: AbortSignal }): Promise<Source> {
  const item = DEMO_EVIDENCE.find((e) => e._id === evidenceId);
  if (!item) {
    throw new ApiError({ kind: "not_found", status: 404, message: "evidence not found", detail: "evidence not found" });
  }
  return getSource(item.source_id, options);
}

export async function getHealth(options?: { signal?: AbortSignal }): Promise<Health> {
  return delay({ status: "ok" }, 60, options?.signal);
}

export async function runEvaluation(): Promise<EvaluationRun> {
  // P9 is not built on any backend, and demo mode must not imply otherwise.
  throw new ApiError({
    kind: "unavailable",
    status: 404,
    message: "evaluations not implemented",
    detail: "The evaluation harness (backend phase P9) is not implemented on this build.",
  });
}
