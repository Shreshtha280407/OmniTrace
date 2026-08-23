"""Canonical evidence envelope and collection schemas — architecture doc §06.

These are the Pydantic models every collection round-trips through. Fields
owned by later phases (embeddings, entity_ids, relationship signals, event
membership) are declared now because the collections and their Atlas indexes
are created in P0, before any data exists — but P0/P1 code only ever
populates the Source / Asset / ProcessingRun / EvidenceItem(atomic_observation)
fields that ingestion and probing produce. Nothing here is a promise that
P2-P9 logic exists yet.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = 1


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── shared value objects ──────────────────────────────────────────────────


class Location(BaseModel):
    """Native location of a piece of evidence. Time is integer milliseconds;
    document coordinates are normalised [0,1] boxes. A record is either
    time-located (video/audio) or page-located (documents) — never both, and
    never a fabricated timestamp on a document. See §06 Location rules."""

    timeline_id: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    page: int | None = None
    block_id: str | None = None
    bbox_norm: dict[str, float] | None = None  # {x1,y1,x2,y2} in [0,1]


class ExtractionConfidence(BaseModel):
    extraction: float | None = None
    alignment: float | None = None
    diarization: float | None = None


class Provenance(BaseModel):
    processing_run_id: str
    producer: str
    model_version: str | None = None
    config_hash: str | None = None
    derived_from: list[str] = Field(default_factory=list)


class EmbeddingRef(BaseModel):
    model: str
    version: str = ""
    dim: int
    vector: list[float]


class Embeddings(BaseModel):
    text: EmbeddingRef | None = None
    multimodal: EmbeddingRef | None = None


# ── sources & assets ──────────────────────────────────────────────────────


class Source(BaseModel):
    """Immutable file identity. One row per uploaded file, keyed by content
    hash so a re-upload of identical bytes is detected, not duplicated."""

    id: str = Field(alias="_id")
    schema_version: int = SCHEMA_VERSION
    collection_id: str
    filename: str
    media_type: str  # video | audio | image | document
    mime_type: str
    sha256: str
    size_bytes: int
    duration_ms: int | None = None
    page_count: int | None = None
    # Extraction stages are added incrementally (P2 audio, P3 visual, P4
    # document); "partial_ready"/"ready" are computed by
    # pipeline.runner.recompute_source_status by comparing completed
    # ProcessingRuns against the stage list required for this media_type —
    # see REQUIRED_STAGES there.
    status: Literal["uploaded", "probing", "probed", "extracting", "partial_ready", "ready", "failed"] = "uploaded"
    storage_path: str
    # One timeline per video/audio source, generated once (first extraction
    # stage) and reused by every evidence item derived from it — §06: "A
    # video-derived frame, OCR region, and utterance share the parent's
    # timeline_id but keep distinct evidence IDs." Null for images/documents.
    timeline_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow)

    model_config = {"populate_by_name": True}


class Asset(BaseModel):
    """Raw or derived binary metadata — parent chain lives here, not the bytes."""

    id: str = Field(alias="_id")
    source_id: str
    asset_type: str  # raw | frame | page_image | audio_wav | crop | thumbnail
    parent_asset_id: str | None = None
    storage_path: str
    content_hash: str | None = None
    created_at: datetime = Field(default_factory=utcnow)

    model_config = {"populate_by_name": True}


class ProcessingRun(BaseModel):
    """One row per (source, stage) execution — the idempotency and lineage
    record. `idempotency_key` is unique-indexed so a retried stage upserts
    rather than duplicating evidence."""

    id: str = Field(alias="_id")
    source_id: str
    stage: str  # probe | extract | normalize | enrich | link | index
    idempotency_key: str
    producer: str
    processor_version: str = "v1"
    config_hash: str | None = None
    status: Literal["running", "ok", "failed"] = "running"
    started_at: datetime = Field(default_factory=utcnow)
    ended_at: datetime | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None

    model_config = {"populate_by_name": True}


# ── evidence fabric ────────────────────────────────────────────────────────


class EvidenceItem(BaseModel):
    """Atomic observation or semantic segment — the envelope from §06/§13.
    node_type distinguishes the two; segments additionally populate
    member_evidence_ids."""

    id: str = Field(alias="_id")
    schema_version: int = SCHEMA_VERSION
    collection_id: str
    source_id: str
    asset_id: str | None = None
    parent_evidence_id: str | None = None
    node_type: Literal["atomic_observation", "semantic_segment"]
    evidence_type: str  # utterance | ocr_region | visual_state | document_block | table ...
    modality: str  # speech | video_visual | image | document
    content: str
    location: Location
    member_evidence_ids: list[str] = Field(default_factory=list)
    entity_ids: list[str] = Field(default_factory=list)
    # Speech evidence only. §11 speaker integrity: a stable anonymous ID
    # (e.g. "spk_01") unless a real name was verified from an explicit
    # self-introduction — never a model-inferred guess.
    speaker_id: str | None = None
    confidence: ExtractionConfidence = Field(default_factory=ExtractionConfidence)
    provenance: Provenance
    embeddings: Embeddings = Field(default_factory=Embeddings)
    created_at: datetime = Field(default_factory=utcnow)

    model_config = {"populate_by_name": True}


class Entity(BaseModel):
    id: str = Field(alias="_id")
    collection_id: str
    canonical_name: str
    entity_type: str = "concept"
    aliases: list[str] = Field(default_factory=list)
    normalized_key: str
    evidence_mentions: list[str] = Field(default_factory=list)
    resolution_confidence: float = 1.0

    model_config = {"populate_by_name": True}


class RelationshipSignals(BaseModel):
    temporal: float | None = None
    entity: float | None = None
    semantic: float | None = None
    parent: float | None = None
    extraction: float | None = None


class Relationship(BaseModel):
    """Typed, directed, scored, versioned edge — populated starting P6.
    Declared here because the collection and its indexes are created in P0."""

    id: str = Field(alias="_id")
    collection_id: str
    from_id: str
    to_id: str
    type: str  # EXPLAINS | TEMPORALLY_OVERLAPS | SHOWS | MENTIONS | ...
    status: Literal["confirmed", "tentative", "rejected"] = "tentative"
    confidence: float = 0.0
    signals: RelationshipSignals = Field(default_factory=RelationshipSignals)
    same_timeline: bool = False
    overlap_ms: int | None = None
    linker_version: str = "v1"
    config_hash: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    valid_from: datetime = Field(default_factory=utcnow)
    superseded_by: str | None = None

    model_config = {"populate_by_name": True}


class SemanticEvent(BaseModel):
    """Cluster membership over confirmed edges — populated starting P6."""

    id: str = Field(alias="_id")
    collection_id: str
    title: str
    summary: str = ""
    event_type: str = "discussion"
    source_ids: list[str] = Field(default_factory=list)
    timeline_id: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    member_ids: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)
    cluster_version: str = "v1"
    confidence: float = 0.0
    embedding: EmbeddingRef | None = None
    created_at: datetime = Field(default_factory=utcnow)

    model_config = {"populate_by_name": True}


class EvaluationCase(BaseModel):
    id: str = Field(alias="_id")
    collection_id: str
    category: str
    question: str
    gold_evidence_ids: list[str] = Field(default_factory=list)
    system_version: str = "v1"

    model_config = {"populate_by_name": True}
