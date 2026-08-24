import { z } from "zod";

import {
  EvaluationRunSchema,
  HealthSchema,
  JobStatusSchema,
  QueryResponseSchema,
  SemanticEventSchema,
  SourceCreateResponseSchema,
  SourceEvidenceResponseSchema,
  SourceSchema,
  type EvaluationRun,
  type Health,
  type JobStatus,
  type QueryRequest,
  type QueryResponse,
  type SemanticEvent,
  type Source,
  type SourceCreateResponse,
  type SourceEvidenceResponse,
} from "./schemas";

/**
 * Typed client for the frozen OmniTrace API surface.
 *
 * Failure is a first-class return path here. Nothing in this module ever
 * substitutes a plausible-looking object for a failed request — callers get a
 * typed ApiError carrying the status, the server's detail string and whether
 * a retry is worth offering, and the UI renders that honestly.
 */

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

export const API_PREFIX = "/api/v1";

export const DEFAULT_COLLECTION_ID =
  process.env.NEXT_PUBLIC_COLLECTION_ID ?? "demo_architecture";

export const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export type ApiErrorKind =
  | "network" // request never reached the server
  | "timeout"
  | "not_found" // 404 — the resource genuinely is not there
  | "unavailable" // endpoint not implemented on this backend build (P9)
  | "validation" // 4xx from the server, caller's fault
  | "server" // 5xx
  | "contract"; // 2xx whose body did not match the schema

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly detail: string | null;
  /** Whether re-issuing the identical request could plausibly succeed. */
  readonly retryable: boolean;
  readonly cause_?: unknown;

  constructor(opts: {
    kind: ApiErrorKind;
    message: string;
    status?: number | null;
    detail?: string | null;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.kind = opts.kind;
    this.status = opts.status ?? null;
    this.detail = opts.detail ?? null;
    this.retryable =
      opts.retryable ?? (opts.kind === "network" || opts.kind === "timeout" || opts.kind === "server");
    this.cause_ = opts.cause;
  }

  /** Copy suitable for a UI error state — no stack, no internals. */
  get userMessage(): string {
    switch (this.kind) {
      case "network":
        return `Could not reach the OmniTrace API at ${API_BASE_URL}. Check that the backend is running and NEXT_PUBLIC_API_BASE_URL is correct.`;
      case "timeout":
        return "The request timed out before the backend responded.";
      case "not_found":
        return this.detail ?? "Not found.";
      case "unavailable":
        return this.detail ?? "This endpoint is not available on the connected backend build.";
      case "validation":
        return this.detail ?? "The backend rejected this request.";
      case "server":
        return this.detail ?? "The backend failed while handling this request.";
      case "contract":
        return "The backend returned a response this client does not understand. The API contract may have changed.";
    }
  }
}

/** Injected on every request when present. Configurable so the same client
 *  works against a token-gated deployment without a code change. */
type TokenProvider = () => string | null | undefined | Promise<string | null | undefined>;

let tokenProvider: TokenProvider | null = null;

export function setAuthTokenProvider(provider: TokenProvider | null) {
  tokenProvider = provider;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headerName = process.env.NEXT_PUBLIC_API_AUTH_HEADER ?? "Authorization";
  const scheme = process.env.NEXT_PUBLIC_API_AUTH_SCHEME ?? "Bearer";
  const staticToken = process.env.NEXT_PUBLIC_API_TOKEN;

  let token: string | null | undefined = staticToken;
  if (tokenProvider) {
    token = (await tokenProvider()) ?? staticToken;
  }
  if (!token) return {};
  return { [headerName]: scheme ? `${scheme} ${token}` : token };
}

const DEFAULT_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 120_000);

function classify(status: number): ApiErrorKind {
  if (status === 404) return "not_found";
  if (status === 501 || status === 405) return "unavailable";
  if (status >= 500) return "server";
  return "validation";
}

/** FastAPI returns `{"detail": "..."}` or `{"detail": [{...}]}` for 422. */
async function readDetail(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    const detail = (body as { detail?: unknown })?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d) => (typeof d === "object" && d && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
        .join("; ");
    }
    return detail ? JSON.stringify(detail) : null;
  } catch {
    return null;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(
  path: string,
  // Third type argument left as `unknown` deliberately: with the default,
  // TypeScript binds T to the schema's *input* type, which for any schema
  // using .default()/.catch() is the pre-parse shape (optional fields,
  // unnarrowed enums) rather than the guaranteed post-parse shape callers
  // actually receive.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  // Caller-supplied abort (component unmount, user cancel) must also work.
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener("abort", () => controller.abort(options.signal?.reason), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(await authHeaders()), ...(init.headers ?? {}) },
    });
  } catch (error) {
    if (controller.signal.aborted && (controller.signal.reason as Error)?.name === "TimeoutError") {
      throw new ApiError({ kind: "timeout", message: `Timed out after ${timeoutMs}ms`, cause: error });
    }
    // A user-initiated abort is not an error condition — rethrow untouched so
    // react-query treats it as a cancellation rather than a failed query.
    if (controller.signal.aborted) throw error;
    throw new ApiError({ kind: "network", message: `Request to ${url} failed`, cause: error });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ApiError({
      kind: classify(res.status),
      message: `${res.status} ${res.statusText} for ${path}`,
      status: res.status,
      detail: await readDetail(res),
    });
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    throw new ApiError({ kind: "contract", message: `Response from ${path} was not JSON`, cause: error });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      kind: "contract",
      message: `Response from ${path} failed validation: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

// ── endpoints ──────────────────────────────────────────────────────────────

export interface UploadProgress {
  loaded: number;
  total: number | null;
  /** 0-1, or null when the browser cannot determine the total. */
  fraction: number | null;
}

/**
 * `POST /api/v1/sources`.
 *
 * XHR rather than fetch because upload progress is the point: the backend runs
 * probe and extraction synchronously inside this request, so for a large video
 * this call is genuinely long-lived and the user needs to see real bytes move.
 * Progress here is the browser's own count of bytes written to the socket — it
 * is never simulated, and it stops at 100% of *upload*, which is not the same
 * as extraction being finished.
 */
export function createSource(
  file: File,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal; collectionId?: string } = {},
): Promise<SourceCreateResponse> {
  return new Promise(async (resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    // Which body of evidence this file joins. Omitted, the backend falls back
    // to its configured default — which is what made every conversation share
    // one corpus.
    form.append("collection_id", opts.collectionId ?? DEFAULT_COLLECTION_ID);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${API_PREFIX}/sources`);
    xhr.responseType = "text";

    for (const [key, value] of Object.entries(await authHeaders())) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (event) => {
      opts.onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : null,
        fraction: event.lengthComputable && event.total > 0 ? event.loaded / event.total : null,
      });
    };

    xhr.onerror = () =>
      reject(new ApiError({ kind: "network", message: `Upload to ${API_BASE_URL} failed` }));
    xhr.ontimeout = () => reject(new ApiError({ kind: "timeout", message: "Upload timed out" }));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));

    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const detail = (body as { detail?: unknown })?.detail;
        reject(
          new ApiError({
            kind: classify(xhr.status),
            message: `${xhr.status} on POST ${API_PREFIX}/sources`,
            status: xhr.status,
            detail: typeof detail === "string" ? detail : null,
          }),
        );
        return;
      }
      const parsed = SourceCreateResponseSchema.safeParse(body);
      if (!parsed.success) {
        reject(new ApiError({ kind: "contract", message: "Upload response failed validation", cause: parsed.error }));
        return;
      }
      resolve(parsed.data);
    };

    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export function getJob(jobId: string, options?: RequestOptions): Promise<JobStatus> {
  return request(`${API_PREFIX}/jobs/${encodeURIComponent(jobId)}`, JobStatusSchema, {}, options);
}

export function getSource(sourceId: string, options?: RequestOptions): Promise<Source> {
  return request(`${API_PREFIX}/sources/${encodeURIComponent(sourceId)}`, SourceSchema, {}, options);
}

export function getSourceEvidence(
  sourceId: string,
  params: { limit?: number } = {},
  options?: RequestOptions,
): Promise<SourceEvidenceResponse> {
  const qs = params.limit ? `?limit=${params.limit}` : "";
  return request(
    `${API_PREFIX}/sources/${encodeURIComponent(sourceId)}/evidence${qs}`,
    SourceEvidenceResponseSchema,
    {},
    options,
  );
}

export function getEvent(eventId: string, options?: RequestOptions): Promise<SemanticEvent> {
  return request(`${API_PREFIX}/events/${encodeURIComponent(eventId)}`, SemanticEventSchema, {}, options);
}

export function runQuery(req: QueryRequest, options?: RequestOptions): Promise<QueryResponse> {
  return request(
    `${API_PREFIX}/query`,
    QueryResponseSchema,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collection_id: req.collection_id ?? DEFAULT_COLLECTION_ID,
        question: req.question,
        required_modalities: req.required_modalities?.length ? req.required_modalities : null,
        debug_trace: req.debug_trace ?? false,
      }),
    },
    options,
  );
}

export function getEvidenceSource(evidenceId: string, options?: RequestOptions): Promise<Source> {
  return request(
    `${API_PREFIX}/evidence/${encodeURIComponent(evidenceId)}/source`,
    SourceSchema,
    {},
    options,
  );
}

export function getHealth(options?: RequestOptions): Promise<Health> {
  return request(`/health`, HealthSchema, {}, { timeoutMs: 5000, ...options });
}

/** Backend phase P9. Expect `not_found` from current builds — callers must
 *  present that as "evaluation harness not deployed", not as a failure. */
export function runEvaluation(
  body: { collection_id?: string } = {},
  options?: RequestOptions,
): Promise<EvaluationRun> {
  return request(
    `${API_PREFIX}/evaluations/run`,
    EvaluationRunSchema,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_id: body.collection_id ?? DEFAULT_COLLECTION_ID }),
    },
    options,
  );
}

/** Streams a stored asset. The backend serves binaries from the local asset
 *  store; media elements need a plain URL, not a parsed body. */
/** One rasterised page of a paged document. Lets a PDF be shown as a single
 *  cited page with the stored bounding box drawn over it, exactly like an
 *  image — which the raw file in an <img> could never be. */
export function documentPageUrl(sourceId: string, page: number): string {
  return `${API_BASE_URL}/assets/page/${encodeURIComponent(sourceId)}/${page}`;
}

export function assetUrl(storagePath: string): string {
  return `${API_BASE_URL}/assets/${encodeURI(storagePath.replace(/^\.?\/?data\/assets\/?/, ""))}`;
}
