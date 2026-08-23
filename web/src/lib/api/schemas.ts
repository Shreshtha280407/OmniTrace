import { z } from "zod";

/**
 * Runtime contracts for the OmniTrace API.
 *
 * These mirror the frozen backend surface (`api/routes/*.py`,
 * `omnitrace/models.py`) field for field. Two rules govern everything here:
 *
 *  1. Optional means optional. A locator that has no `start_ms` is a document
 *     or an image, not a video at zero. Nullable fields stay nullable all the
 *     way to the component that renders them, so the UI can say "no timestamp"
 *     instead of inventing one.
 *  2. Unknown extra keys are preserved, not stripped. The backend is still
 *     growing (P9 evaluations); a response with more fields than we model is
 *     valid, and silently dropping them would hide real data from the
 *     inspector's raw view.
 */

// ── shared value objects (omnitrace/models.py) ─────────────────────────────

export const BBoxSchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
});

export const LocationSchema = z.object({
  timeline_id: z.string().nullish(),
  start_ms: z.number().nullish(),
  end_ms: z.number().nullish(),
  page: z.number().nullish(),
  block_id: z.string().nullish(),
  bbox_norm: BBoxSchema.nullish(),
});

export const ExtractionConfidenceSchema = z.object({
  extraction: z.number().nullish(),
  alignment: z.number().nullish(),
  diarization: z.number().nullish(),
});

export const ProvenanceSchema = z.object({
  processing_run_id: z.string(),
  producer: z.string(),
  model_version: z.string().nullish(),
  config_hash: z.string().nullish(),
  derived_from: z.array(z.string()).default([]),
});

// ── sources ────────────────────────────────────────────────────────────────

export const MEDIA_STATUSES = [
  "uploaded",
  "probing",
  "probed",
  "extracting",
  "partial_ready",
  "ready",
  "failed",
] as const;

export const SourceSchema = z
  .object({
    _id: z.string(),
    schema_version: z.number().optional(),
    collection_id: z.string(),
    filename: z.string(),
    media_type: z.string(),
    mime_type: z.string(),
    sha256: z.string(),
    size_bytes: z.number(),
    duration_ms: z.number().nullish(),
    page_count: z.number().nullish(),
    status: z.enum(MEDIA_STATUSES).catch("uploaded"),
    storage_path: z.string(),
    timeline_id: z.string().nullish(),
    created_at: z.string().nullish(),
  })
  .passthrough();

export type Source = z.infer<typeof SourceSchema>;

/** `POST /api/v1/sources` — note the backend runs probe + extraction inline,
 *  so `status` here already reflects post-extraction state. */
export const SourceCreateResponseSchema = z.object({
  source_id: z.string(),
  job_id: z.string(),
  checksum: z.string(),
  status: z.string(),
});

export type SourceCreateResponse = z.infer<typeof SourceCreateResponseSchema>;

// ── evidence ───────────────────────────────────────────────────────────────

export const EvidenceItemSchema = z
  .object({
    _id: z.string(),
    schema_version: z.number().optional(),
    collection_id: z.string().optional(),
    source_id: z.string(),
    asset_id: z.string().nullish(),
    parent_evidence_id: z.string().nullish(),
    node_type: z.enum(["atomic_observation", "semantic_segment"]).catch("atomic_observation"),
    evidence_type: z.string(),
    modality: z.string(),
    content: z.string().default(""),
    location: LocationSchema.default({}),
    member_evidence_ids: z.array(z.string()).default([]),
    entity_ids: z.array(z.string()).default([]),
    speaker_id: z.string().nullish(),
    confidence: ExtractionConfidenceSchema.default({}),
    provenance: ProvenanceSchema.optional(),
    created_at: z.string().nullish(),
    /** Present on query results only — the reranker's bundle score. */
    score: z.number().nullish(),
  })
  .passthrough();

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const SourceEvidenceResponseSchema = z.object({
  source_id: z.string(),
  count: z.number(),
  evidence: z.array(EvidenceItemSchema),
});

export type SourceEvidenceResponse = z.infer<typeof SourceEvidenceResponseSchema>;

// ── jobs ───────────────────────────────────────────────────────────────────

export const JobStageSchema = z.object({
  status: z.enum(["running", "ok", "failed"]).catch("running"),
  started_at: z.string().nullish(),
  ended_at: z.string().nullish(),
  warnings: z.array(z.string()).default([]),
  error: z.string().nullish(),
});

export type JobStage = z.infer<typeof JobStageSchema>;

export const JobStatusSchema = z.object({
  job_id: z.string(),
  source_id: z.string(),
  source_status: z.enum(MEDIA_STATUSES).catch("uploaded"),
  stages: z.record(z.string(), JobStageSchema).default({}),
});

export type JobStatus = z.infer<typeof JobStatusSchema>;

/** Stage order the runner executes in, per media type
 *  (`pipeline/runner.py` REQUIRED_STAGES). Used to render queued stages that
 *  have no ProcessingRun document yet — a stage the backend has not started
 *  has no row at all, and must show as queued rather than be omitted. */
export const REQUIRED_STAGES: Record<string, string[]> = {
  audio: ["probe", "audio", "enrich"],
  video: ["probe", "audio", "visual", "enrich"],
  image: ["probe", "visual", "enrich"],
  document: ["probe", "document", "enrich"],
};

// ── relationships & events ─────────────────────────────────────────────────

export const RelationshipSignalsSchema = z.object({
  temporal: z.number().nullish(),
  entity: z.number().nullish(),
  semantic: z.number().nullish(),
  parent: z.number().nullish(),
  extraction: z.number().nullish(),
});

export const RelationshipSchema = z
  .object({
    _id: z.string(),
    collection_id: z.string().optional(),
    from_id: z.string(),
    to_id: z.string(),
    type: z.string(),
    status: z.enum(["confirmed", "tentative", "rejected"]).catch("tentative"),
    confidence: z.number().default(0),
    signals: RelationshipSignalsSchema.default({}),
    same_timeline: z.boolean().optional(),
    overlap_ms: z.number().nullish(),
    linker_version: z.string().optional(),
    created_at: z.string().nullish(),
    superseded_by: z.string().nullish(),
  })
  .passthrough();

export type Relationship = z.infer<typeof RelationshipSchema>;

export const SemanticEventSchema = z
  .object({
    _id: z.string(),
    collection_id: z.string().optional(),
    title: z.string(),
    summary: z.string().default(""),
    event_type: z.string().default("discussion"),
    source_ids: z.array(z.string()).default([]),
    timeline_id: z.string().nullish(),
    start_ms: z.number().nullish(),
    end_ms: z.number().nullish(),
    member_ids: z.array(z.string()).default([]),
    claim_ids: z.array(z.string()).default([]),
    cluster_version: z.string().optional(),
    confidence: z.number().default(0),
    created_at: z.string().nullish(),
  })
  .passthrough();

export type SemanticEvent = z.infer<typeof SemanticEventSchema>;

// ── query ──────────────────────────────────────────────────────────────────

export const SUPPORT_LEVELS = ["high", "medium", "low"] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export const ClaimSchema = z.object({
  text: z.string(),
  evidence_ids: z.array(z.string()).default([]),
  support: z.enum(SUPPORT_LEVELS).catch("low"),
});

export type Claim = z.infer<typeof ClaimSchema>;

/** A hydrated locator: `validate.hydrate_locators` returns the whole stored
 *  evidence record under `id` (minus `_id`/embeddings), so this is an
 *  EvidenceItem shape with a different identity key. */
export const SourceLocatorSchema = EvidenceItemSchema.omit({ _id: true })
  .extend({ id: z.string() })
  .passthrough();

export type SourceLocator = z.infer<typeof SourceLocatorSchema>;

export const QueryPlanSchema = z.object({
  answer_slots: z.array(z.string()).default([]),
  required_modalities: z.array(z.string()).default([]),
  entity_ids: z.array(z.string()).default([]),
  channel_weights: z.record(z.string(), z.number()).default({}),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;

/** Stage timings are always returned and always displayed — an invisible
 *  nine-second pause reads as a hang (architecture §01, M8). */
export const StageTimingsSchema = z.record(z.string(), z.number()).default({});

export const QueryResponseSchema = z
  .object({
    answer: z.string().default(""),
    claims: z.array(ClaimSchema).default([]),
    conflicts: z.array(z.string()).default([]),
    missing_information: z.array(z.string()).default([]),
    primary_event_id: z.string().nullish(),
    evidence: z.array(EvidenceItemSchema).default([]),
    relationships: z.array(RelationshipSchema).default([]),
    source_locators: z.array(SourceLocatorSchema).default([]),
    support_label: z.enum(["high", "medium", "low", "none"]).catch("none"),
    stage_timings_ms: StageTimingsSchema,
    query_plan: QueryPlanSchema.default({
      answer_slots: [],
      required_modalities: [],
      entity_ids: [],
      channel_weights: {},
    }),
    debug_trace: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

export type QueryResponse = z.infer<typeof QueryResponseSchema>;

export interface QueryRequest {
  collection_id?: string | null;
  question: string;
  required_modalities?: string[] | null;
  debug_trace?: boolean;
}

// ── health & evaluations ───────────────────────────────────────────────────

export const HealthSchema = z.object({ status: z.string() });
export type Health = z.infer<typeof HealthSchema>;

/** `POST /api/v1/evaluations/run` is specified but belongs to backend phase
 *  P9, which is not yet built. The client models it so the surface is
 *  complete; callers must handle a 404 as "not available", never as failure
 *  of an existing feature. */
export const EvaluationRunSchema = z
  .object({
    run_id: z.string(),
    cases: z.number(),
    metrics: z.record(z.string(), z.number()).default({}),
  })
  .passthrough();

export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;
