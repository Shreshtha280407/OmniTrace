import type {
  EvidenceItem,
  JobStatus,
  QueryResponse,
  Relationship,
  SemanticEvent,
  Source,
} from "./schemas";

/**
 * Demo fixtures — SYNTHETIC DATA.
 *
 * Only ever reachable when NEXT_PUBLIC_DEMO_MODE=true, and every surface that
 * renders them shows a "Demo data" marker. They exist so the interface can be
 * developed and reviewed without an Atlas cluster and four API keys, not so a
 * broken backend can be made to look like a working one.
 *
 * Shapes are held to the same contracts as the live API: prefixed ULID ids,
 * documents with a page and no timestamp, images with a bbox and no timeline,
 * speech with a stable anonymous speaker_id. If a fixture would not validate
 * against schemas.ts, it is a bug in the fixture.
 */

export const DEMO_COLLECTION_ID = "demo_architecture";

const TIMELINE_VIDEO = "tl_01JQZK8V3N7X2M4P6R8T0W9Y1B";
const TIMELINE_AUDIO = "tl_01JQZK9M2P8Q3R5S7T9V1X3Z5C";

export const SRC_VIDEO = "src_01JQZK8V3N7X2M4P6R8T0W9Y2C";
export const SRC_PDF = "src_01JQZK8W4P8Y3N5Q7S9V1X3Z5D";
export const SRC_IMAGE = "src_01JQZK8X5Q9Z4P6R8T0W2Y4A6E";
export const SRC_AUDIO = "src_01JQZK8Y6R0A5Q7S9V1X3Z5B7F";

export const EVT_PRIMARY = "evt_01JQZKA1B2C3D4E5F6G7H8J9K0";

export const DEMO_SOURCES: Record<string, Source> = {
  [SRC_VIDEO]: {
    _id: SRC_VIDEO,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    filename: "architecture-review-2026-03-14.mp4",
    media_type: "video",
    mime_type: "video/mp4",
    sha256: "9f2c4b1ea7d38065c1b47f92ae5310d8b6c04f7391a2e58d3c9047b1f6e2a85c",
    size_bytes: 418_332_160,
    duration_ms: 431_000,
    page_count: null,
    status: "ready",
    storage_path: "data/assets/src_01JQZK8V/raw/architecture-review-2026-03-14.mp4",
    timeline_id: TIMELINE_VIDEO,
    created_at: "2026-03-14T09:12:04.331Z",
  },
  [SRC_PDF]: {
    _id: SRC_PDF,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    filename: "caching-strategy-v2.pdf",
    media_type: "document",
    mime_type: "application/pdf",
    sha256: "3a71ce8042b95df16c07e3a9481b2d5f70c6a8e94d213bf5079ac6e18d40b273",
    size_bytes: 2_284_112,
    duration_ms: null,
    page_count: 12,
    status: "ready",
    storage_path: "data/assets/src_01JQZK8W/raw/caching-strategy-v2.pdf",
    timeline_id: null,
    created_at: "2026-03-14T09:14:51.882Z",
  },
  [SRC_IMAGE]: {
    _id: SRC_IMAGE,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    filename: "whiteboard-cache-topology.png",
    media_type: "image",
    mime_type: "image/png",
    sha256: "c48d013f7a26b9e5308c1d7f4a62be9013d75c8ea240f61b93728ad50e6c1849",
    size_bytes: 3_918_744,
    duration_ms: null,
    page_count: null,
    status: "ready",
    storage_path: "data/assets/src_01JQZK8X/raw/whiteboard-cache-topology.png",
    timeline_id: null,
    created_at: "2026-03-14T09:15:33.104Z",
  },
  [SRC_AUDIO]: {
    _id: SRC_AUDIO,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    filename: "followup-standup.m4a",
    media_type: "audio",
    mime_type: "audio/mp4",
    sha256: "6b90d2fa14c73e85207a9b3d6f1c48e05a97b2d4f8031ce67a495d208bf3e714",
    size_bytes: 11_204_736,
    duration_ms: 197_400,
    page_count: null,
    status: "partial_ready",
    storage_path: "data/assets/src_01JQZK8Y/raw/followup-standup.m4a",
    timeline_id: TIMELINE_AUDIO,
    created_at: "2026-03-15T08:31:12.550Z",
  },
};

// ── evidence ───────────────────────────────────────────────────────────────

const run = (id: string, producer: string, model?: string) => ({
  processing_run_id: id,
  producer,
  model_version: model ?? null,
  config_hash: "b1f4c9d2",
  derived_from: [] as string[],
});

export const EV_UTTERANCE_PROPOSAL = "ev_01JQZKB1C2D3E4F5G6H7J8K9M0";
export const EV_UTTERANCE_LOAD = "ev_01JQZKB2D3E4F5G6H7J8K9M0N1";
export const EV_VISUAL_DIAGRAM = "ev_01JQZKB3E4F5G6H7J8K9M0N1P2";
export const EV_OCR_DIAGRAM = "ev_01JQZKB4F5G6H7J8K9M0N1P2Q3";
export const EV_DOC_TRADEOFF = "ev_01JQZKB5G6H7J8K9M0N1P2Q3R4";
export const EV_DOC_TARGET = "ev_01JQZKB6H7J8K9M0N1P2Q3R4S5";
export const EV_IMAGE_WHITEBOARD = "ev_01JQZKB7J8K9M0N1P2Q3R4S5T6";
export const EV_SEGMENT_CACHE = "ev_01JQZKB8K9M0N1P2Q3R4S5T6V7";
export const EV_AUDIO_FOLLOWUP = "ev_01JQZKB9M0N1P2Q3R4S5T6V7W8";

export const DEMO_EVIDENCE: EvidenceItem[] = [
  {
    _id: EV_UTTERANCE_PROPOSAL,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    source_id: SRC_VIDEO,
    asset_id: "asset_01JQZKC1N2P3Q4R5S6T7V8W9X0",
    parent_evidence_id: null,
    node_type: "atomic_observation",
    evidence_type: "utterance",
    modality: "speech",
    content:
      "So the proposal is a Redis read-through cache in front of the primary Postgres instance. Anything that is read far more often than it is written goes through it — session lookups, the permissions table, the org tree.",
    location: { timeline_id: TIMELINE_VIDEO, start_ms: 104_200, end_ms: 121_900 },
    member_evidence_ids: [],
    entity_ids: ["ent_redis", "ent_postgres"],
    speaker_id: "spk_02",
    confidence: { extraction: 0.94, alignment: 0.91, diarization: 0.78 },
    provenance: run("run_01JQZKD1P2Q3R4S5T6V7W8X9Y0", "pipeline.audio", "whisper-large-v3"),
    created_at: "2026-03-14T09:13:02.118Z",
    score: 0.9412,
  },
  {
    _id: EV_UTTERANCE_LOAD,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    source_id: SRC_VIDEO,
    asset_id: "asset_01JQZKC1N2P3Q4R5S6T7V8W9X0",
    parent_evidence_id: null,
    node_type: "atomic_observation",
    evidence_type: "utterance",
    modality: "speech",
    content:
      "We measured it against last quarter's traffic. Read load on the primary drops about sixty percent, and p99 on the session endpoint goes from four hundred milliseconds to under ninety.",
    location: { timeline_id: TIMELINE_VIDEO, start_ms: 139_400, end_ms: 152_050 },
    member_evidence_ids: [],
    entity_ids: ["ent_postgres"],
    speaker_id: "spk_02",
    confidence: { extraction: 0.92, alignment: 0.89, diarization: 0.74 },
    provenance: run("run_01JQZKD1P2Q3R4S5T6V7W8X9Y0", "pipeline.audio", "whisper-large-v3"),
    created_at: "2026-03-14T09:13:02.401Z",
    score: 0.8874,
  },
  {
    _id: EV_VISUAL_DIAGRAM,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    source_id: SRC_VIDEO,
    asset_id: "asset_01JQZKC2P3Q4R5S6T7V8W9X0Y1",
    parent_evidence_id: null,
    node_type: "atomic_observation",
    evidence_type: "visual_state",
    modality: "video_visual",
    content:
      "Slide showing a three-tier topology: client tier, a Redis cache layer labelled 'read-through', and a Postgres primary with one replica. Arrows run client → cache → primary, with a dashed invalidation arrow returning from primary to cache.",
    location: { timeline_id: TIMELINE_VIDEO, start_ms: 118_000, end_ms: 167_500 },
    member_evidence_ids: [],
    entity_ids: ["ent_redis", "ent_postgres"],
    speaker_id: null,
    confidence: { extraction: 0.88 },
    provenance: run("run_01JQZKD2Q3R4S5T6V7W8X9Y0Z1", "pipeline.visual", "llama-3.2-90b-vision"),
    created_at: "2026-03-14T09:13:44.900Z",
    score: 0.9106,
  },
  {
    _id: EV_OCR_DIAGRAM,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    source_id: SRC_VIDEO,
    asset_id: "asset_01JQZKC2P3Q4R5S6T7V8W9X0Y1",
    parent_evidence_id: EV_VISUAL_DIAGRAM,
    node_type: "atomic_observation",
    evidence_type: "ocr_region",
    modality: "video_visual",
    content: "REDIS · read-through cache · TTL 300s · invalidate on write",
    location: {
      timeline_id: TIMELINE_VIDEO,
      start_ms: 121_000,
      end_ms: 121_000,
      bbox_norm: { x1: 0.312, y1: 0.404, x2: 0.688, y2: 0.521 },
    },
    member_evidence_ids: [],
    entity_ids: ["ent_redis"],
    speaker_id: null,
    confidence: { extraction: 0.96 },
    provenance: run("run_01JQZKD2Q3R4S5T6V7W8X9Y0Z1", "pipeline.visual", "tesseract-5.3"),
    created_at: "2026-03-14T09:13:45.220Z",
    score: 0.8531,
  },
  {
    _id: EV_DOC_TRADEOFF,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    source_id: SRC_PDF,
    asset_id: null,
    parent_evidence_id: null,
    node_type: "atomic_observation",
    evidence_type: "document_block",
    modality: "document",
    content:
      "Trade-offs. A read-through cache introduces a staleness window bounded by the TTL. For permissions data this is unacceptable above ~30s, so permission writes must invalidate synchronously rather than relying on expiry.",
    location: {
      page: 7,
      block_id: "blk_p7_b03",
      bbox_norm: { x1: 0.114, y1: 0.238, x2: 0.886, y2: 0.371 },
    },
    member_evidence_ids: [],
    entity_ids: ["ent_redis"],
    speaker_id: null,
    confidence: { extraction: 0.99 },
    provenance: run("run_01JQZKD3R4S5T6V7W8X9Y0Z1A2", "pipeline.document", "pymupdf-1.24"),
    created_at: "2026-03-14T09:15:01.774Z",
    score: 0.8302,
  },
  {
    _id: EV_DOC_TARGET,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    source_id: SRC_PDF,
    asset_id: null,
    parent_evidence_id: null,
    node_type: "atomic_observation",
    evidence_type: "table",
    modality: "document",
    content:
      "Projected load reduction — Session lookup: 71% fewer primary reads. Permissions: 58%. Org tree: 63%. Aggregate primary read QPS: 12,400 → 4,900.",
    location: {
      page: 4,
      block_id: "blk_p4_t01",
      bbox_norm: { x1: 0.128, y1: 0.512, x2: 0.872, y2: 0.744 },
    },
    member_evidence_ids: [],
    entity_ids: ["ent_postgres"],
    speaker_id: null,
    confidence: { extraction: 0.97 },
    provenance: run("run_01JQZKD3R4S5T6V7W8X9Y0Z1A2", "pipeline.document", "pymupdf-1.24"),
    created_at: "2026-03-14T09:15:01.902Z",
    score: 0.8790,
  },
  {
    _id: EV_IMAGE_WHITEBOARD,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    source_id: SRC_IMAGE,
    asset_id: "asset_01JQZKC3Q4R5S6T7V8W9X0Y1Z2",
    parent_evidence_id: null,
    node_type: "atomic_observation",
    evidence_type: "visual_state",
    modality: "image",
    content:
      "Whiteboard photograph. Hand-drawn boxes labelled 'app', 'redis', 'pg-primary', 'pg-replica'. A circled note beside the cache box reads 'invalidate on write — not TTL'.",
    location: { bbox_norm: { x1: 0.208, y1: 0.146, x2: 0.795, y2: 0.812 } },
    member_evidence_ids: [],
    entity_ids: ["ent_redis", "ent_postgres"],
    speaker_id: null,
    confidence: { extraction: 0.81 },
    provenance: run("run_01JQZKD4S5T6V7W8X9Y0Z1A2B3", "pipeline.visual", "llama-3.2-90b-vision"),
    created_at: "2026-03-14T09:15:48.330Z",
    score: 0.7218,
  },
  {
    _id: EV_SEGMENT_CACHE,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    source_id: SRC_VIDEO,
    asset_id: null,
    parent_evidence_id: null,
    node_type: "semantic_segment",
    evidence_type: "semantic_segment",
    modality: "speech",
    content:
      "Discussion of the read-through cache proposal: the topology, the measured reduction in primary read load, and the objection that permissions data cannot tolerate TTL-based staleness.",
    location: { timeline_id: TIMELINE_VIDEO, start_ms: 104_200, end_ms: 188_600 },
    member_evidence_ids: [EV_UTTERANCE_PROPOSAL, EV_UTTERANCE_LOAD],
    entity_ids: ["ent_redis", "ent_postgres"],
    speaker_id: null,
    confidence: { extraction: 0.9 },
    provenance: run("run_01JQZKD5T6V7W8X9Y0Z1A2B3C4", "enrich.segment", "v1"),
    created_at: "2026-03-14T09:16:20.010Z",
    score: 0.9033,
  },
  {
    _id: EV_AUDIO_FOLLOWUP,
    schema_version: 1,
    collection_id: DEMO_COLLECTION_ID,
    source_id: SRC_AUDIO,
    asset_id: "asset_01JQZKC4R5S6T7V8W9X0Y1Z2A3",
    parent_evidence_id: null,
    node_type: "atomic_observation",
    evidence_type: "utterance",
    modality: "speech",
    content:
      "Following up on the cache decision — we are going with synchronous invalidation for permissions, TTL for everything else. That was the only open objection from Thursday.",
    location: { timeline_id: TIMELINE_AUDIO, start_ms: 42_800, end_ms: 54_100 },
    member_evidence_ids: [],
    entity_ids: ["ent_redis"],
    speaker_id: "spk_01",
    confidence: { extraction: 0.9, alignment: 0.86, diarization: 0.7 },
    provenance: run("run_01JQZKD6V7W8X9Y0Z1A2B3C4D5", "pipeline.audio", "whisper-large-v3"),
    created_at: "2026-03-15T08:32:04.660Z",
    score: 0.6944,
  },
];

export const DEMO_EVIDENCE_BY_ID: Record<string, EvidenceItem> = Object.fromEntries(
  DEMO_EVIDENCE.map((e) => [e._id, e]),
);

// ── relationships ──────────────────────────────────────────────────────────

const rel = (
  id: string,
  from_id: string,
  to_id: string,
  type: string,
  status: "confirmed" | "tentative",
  confidence: number,
  signals: Relationship["signals"],
  extra: Partial<Relationship> = {},
): Relationship => ({
  _id: id,
  collection_id: DEMO_COLLECTION_ID,
  from_id,
  to_id,
  type,
  status,
  confidence,
  signals,
  same_timeline: extra.same_timeline ?? false,
  overlap_ms: extra.overlap_ms ?? null,
  linker_version: "v1",
  created_at: "2026-03-14T09:17:10.000Z",
  superseded_by: null,
});

export const DEMO_RELATIONSHIPS: Relationship[] = [
  rel(
    "rel_01JQZKE1W8X9Y0Z1A2B3C4D5E6",
    EV_UTTERANCE_PROPOSAL,
    EV_VISUAL_DIAGRAM,
    "TEMPORALLY_ALIGNS",
    "confirmed",
    0.93,
    { temporal: 0.97, entity: 0.88, semantic: 0.84, parent: null, extraction: 0.91 },
    { same_timeline: true, overlap_ms: 3_900 },
  ),
  rel(
    "rel_01JQZKE2X9Y0Z1A2B3C4D5E6F7",
    EV_VISUAL_DIAGRAM,
    EV_OCR_DIAGRAM,
    "PART_OF_EVENT",
    "confirmed",
    0.99,
    { temporal: 1.0, entity: 0.95, semantic: 0.9, parent: 1.0, extraction: 0.96 },
    { same_timeline: true, overlap_ms: 0 },
  ),
  rel(
    "rel_01JQZKE3Y0Z1A2B3C4D5E6F7G8",
    EV_DOC_TRADEOFF,
    EV_UTTERANCE_PROPOSAL,
    "EXPLAINS",
    "confirmed",
    0.86,
    { temporal: null, entity: 0.91, semantic: 0.89, parent: null, extraction: 0.97 },
  ),
  rel(
    "rel_01JQZKE4Z1A2B3C4D5E6F7G8H9",
    EV_DOC_TARGET,
    EV_UTTERANCE_LOAD,
    "EXPLAINS",
    "confirmed",
    0.9,
    { temporal: null, entity: 0.87, semantic: 0.93, parent: null, extraction: 0.96 },
  ),
  rel(
    "rel_01JQZKE5A2B3C4D5E6F7G8H9J0",
    EV_IMAGE_WHITEBOARD,
    EV_VISUAL_DIAGRAM,
    "VISUALLY_MATCHES",
    "tentative",
    0.64,
    { temporal: null, entity: 0.79, semantic: 0.71, parent: null, extraction: 0.84 },
  ),
  rel(
    "rel_01JQZKE6B3C4D5E6F7G8H9J0K1",
    EV_SEGMENT_CACHE,
    EV_UTTERANCE_PROPOSAL,
    "PART_OF_EVENT",
    "confirmed",
    0.98,
    { temporal: 1.0, entity: 0.94, semantic: 0.96, parent: 1.0, extraction: 0.93 },
    { same_timeline: true },
  ),
  rel(
    "rel_01JQZKE7C4D5E6F7G8H9J0K1M2",
    EV_AUDIO_FOLLOWUP,
    EV_DOC_TRADEOFF,
    "MENTIONS",
    "tentative",
    0.58,
    { temporal: null, entity: 0.72, semantic: 0.66, parent: null, extraction: 0.9 },
  ),
  rel(
    "rel_01JQZKE8D5E6F7G8H9J0K1M2N3",
    EV_OCR_DIAGRAM,
    EV_DOC_TRADEOFF,
    "SAME_EVENT",
    "confirmed",
    0.81,
    { temporal: null, entity: 0.9, semantic: 0.77, parent: null, extraction: 0.97 },
  ),
];

// ── event ──────────────────────────────────────────────────────────────────

export const DEMO_EVENT: SemanticEvent = {
  _id: EVT_PRIMARY,
  collection_id: DEMO_COLLECTION_ID,
  title: "Read-through cache proposal and its staleness objection",
  summary:
    "A Redis read-through cache is proposed in front of the Postgres primary, presented with a topology slide and a measured load-reduction table, and challenged on permissions staleness. Resolved the following day in favour of synchronous invalidation for permissions.",
  event_type: "discussion",
  source_ids: [SRC_VIDEO, SRC_PDF, SRC_IMAGE, SRC_AUDIO],
  timeline_id: TIMELINE_VIDEO,
  start_ms: 104_200,
  end_ms: 188_600,
  member_ids: DEMO_EVIDENCE.map((e) => e._id),
  claim_ids: [],
  cluster_version: "v1",
  confidence: 0.88,
  created_at: "2026-03-14T09:17:44.120Z",
};

// ── jobs ───────────────────────────────────────────────────────────────────

export function demoJob(sourceId: string): JobStatus {
  const source = DEMO_SOURCES[sourceId];
  const mediaType = source?.media_type ?? "video";
  const base = "2026-03-14T09:12:0";
  const stages: JobStatus["stages"] = {};
  const order: Record<string, string[]> = {
    audio: ["probe", "audio", "enrich"],
    video: ["probe", "audio", "visual", "enrich"],
    image: ["probe", "visual", "enrich"],
    document: ["probe", "document", "enrich"],
  };
  (order[mediaType] ?? ["probe"]).forEach((stage, i) => {
    // The audio source is deliberately left mid-flight so the processing
    // trace has a genuinely queued stage to render in demo mode.
    const incomplete = sourceId === SRC_AUDIO && stage === "enrich";
    if (incomplete) return;
    stages[stage] = {
      status: "ok",
      started_at: `${base}${i}.000Z`,
      ended_at: `${base}${i + 1}.${String(240 + i * 137).padStart(3, "0")}Z`,
      warnings: stage === "visual" ? ["3 frames below sharpness threshold, skipped"] : [],
      error: null,
    };
  });
  return {
    job_id: sourceId,
    source_id: sourceId,
    source_status: source?.status ?? "ready",
    stages,
  };
}

// ── query ──────────────────────────────────────────────────────────────────

const CITED = [
  EV_UTTERANCE_PROPOSAL,
  EV_UTTERANCE_LOAD,
  EV_VISUAL_DIAGRAM,
  EV_OCR_DIAGRAM,
  EV_DOC_TARGET,
  EV_DOC_TRADEOFF,
];

export function demoQueryResponse(question: string, debugTrace: boolean): QueryResponse {
  const response: QueryResponse = {
    answer:
      "A Redis read-through cache placed in front of the Postgres primary is the architecture that reduced database load. Speaker 2 introduced it at 01:44 of the architecture review, and the topology was shown on screen from 01:58 to 02:47 as a three-tier diagram. The accompanying strategy document projects aggregate primary read QPS falling from 12,400 to 4,900, and the speaker states a measured ~60% reduction in read load with p99 on the session endpoint dropping from 400 ms to under 90 ms. The document also records the one objection: permissions data cannot tolerate TTL-based staleness and requires synchronous invalidation on write.",
    claims: [
      {
        text: "The architecture is a Redis read-through cache in front of the Postgres primary.",
        evidence_ids: [EV_UTTERANCE_PROPOSAL, EV_VISUAL_DIAGRAM, EV_OCR_DIAGRAM],
        support: "high",
      },
      {
        text: "Speaker 2 explained the proposal during the architecture review.",
        evidence_ids: [EV_UTTERANCE_PROPOSAL, EV_UTTERANCE_LOAD],
        support: "high",
      },
      {
        text: "It was shown on screen as a three-tier topology diagram with a read-through cache layer.",
        evidence_ids: [EV_VISUAL_DIAGRAM, EV_OCR_DIAGRAM],
        support: "high",
      },
      {
        text: "Projected aggregate primary read QPS falls from 12,400 to 4,900.",
        evidence_ids: [EV_DOC_TARGET],
        support: "medium",
      },
      {
        text: "Permissions data requires synchronous invalidation rather than TTL expiry.",
        evidence_ids: [EV_DOC_TRADEOFF],
        support: "high",
      },
    ],
    conflicts: [
      "The spoken figure (~60% read-load reduction) and the document table (aggregate 12,400 → 4,900 QPS, ~60.5%) agree in magnitude but were measured against different traffic windows; neither source states which window the other used.",
    ],
    missing_information: [
      "No evidence in this collection states who approved the proposal or when it was scheduled for implementation.",
    ],
    primary_event_id: EVT_PRIMARY,
    evidence: DEMO_EVIDENCE,
    relationships: DEMO_RELATIONSHIPS,
    source_locators: CITED.map((id) => {
      const { _id, ...rest } = DEMO_EVIDENCE_BY_ID[id];
      return { id: _id, ...rest };
    }),
    support_label: "medium",
    stage_timings_ms: { plan: 3, seed: 412, expand: 118, rerank: 47, generate: 4_286 },
    query_plan: {
      answer_slots: ["who", "where_shown", "architecture"],
      required_modalities: ["document", "image", "speech", "video_visual"],
      entity_ids: ["ent_redis", "ent_postgres"],
      channel_weights: { lexical: 1, text_vector: 1, visual_vector: 2, structured: 1 },
    },
    debug_trace: debugTrace
      ? {
          question,
          channel_hits: { lexical: 20, text_vector: 20, visual_vector: 14, structured: 9 },
          fused_top_k: 30,
          rrf_k: 60,
          expanded_via_edge: {
            [EV_IMAGE_WHITEBOARD]: "VISUALLY_MATCHES",
            [EV_AUDIO_FOLLOWUP]: "MENTIONS",
          },
          primary_event_id: EVT_PRIMARY,
          expansion_hops: 2,
          validator_warnings: [],
        }
      : null,
  };
  return response;
}
