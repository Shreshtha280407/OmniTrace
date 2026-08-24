"""Sequential stage runner — architecture doc §05/§07/§09.

One shared `run_stage` helper drives every extraction stage (probe, audio,
visual, and later document): load the source, compute an idempotency key,
skip if already done, run the stage body off the event loop, persist
whatever evidence it produced, and recompute the source's overall status.
Stage bodies (pipeline/audio.py, pipeline/visual.py) return a ProcessorResult
— the same shape §07 specifies: observations produced, metrics, warnings.

No queue (§02 decision ledger: in-process, synchronous, ordered) — a stage
runs to completion inside the request that triggered it.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

from pydantic import BaseModel, Field

from omnitrace.assets import get_asset_store
from omnitrace.db import EVIDENCE_ITEMS, PROCESSING_RUNS, SOURCES, coll
from omnitrace.ids import config_hash, idempotency_key, new_id
from omnitrace.models import EvidenceItem, ProcessingRun, utcnow
from pipeline.probe import ProbeError, probe

# Which ProcessingRun stages must reach "ok" before a source of this
# media_type is considered fully "ready". Only lists stages that actually
# exist yet — listing a stage before it's implemented would strand every
# source of that media_type at "partial_ready" forever (no ProcessingRun
# will ever appear for a stage nothing runs). "enrich" (P5) runs after
# extraction for every modality — see run_extraction_stages.
REQUIRED_STAGES: dict[str, list[str]] = {
    "audio": ["probe", "audio", "enrich"],
    "video": ["probe", "audio", "visual", "enrich"],
    "image": ["probe", "visual", "enrich"],
    "document": ["probe", "document", "enrich"],
}


class ProcessorResult(BaseModel):
    """§07 processor contract, minus `assets` (stages that derive new binary
    assets — e.g. extracted frames — write them via AssetStore directly and
    reference the path in provenance; nothing here needs a separate list)."""

    evidence_items: list[EvidenceItem] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


StageFn = Callable[[dict, str], Awaitable[ProcessorResult]]  # (source_doc, run_id) -> ProcessorResult


async def ensure_timeline_id(source_id: str) -> str:
    """Get-or-create the one timeline_id shared by every evidence item
    derived from this source (§06). Idempotent — safe to call from every
    stage that needs it."""
    doc = await coll(SOURCES).find_one({"_id": source_id}, {"timeline_id": 1})
    if doc and doc.get("timeline_id"):
        return doc["timeline_id"]
    tl_id = new_id("timeline")
    await coll(SOURCES).update_one({"_id": source_id}, {"$set": {"timeline_id": tl_id}})
    return tl_id


async def recompute_source_status(source_id: str) -> str:
    """Derive the source's coarse status from its ProcessingRun records —
    never hand-set to "ready"/"partial_ready" anywhere else, so this stays
    the single source of truth as more stages land in later phases."""
    source_doc = await coll(SOURCES).find_one({"_id": source_id}, {"media_type": 1, "status": 1})
    if source_doc is None:
        raise ValueError(f"unknown source_id: {source_id}")

    if source_doc.get("status") == "failed":
        return "failed"  # a hard failure (e.g. probe) is terminal

    required = REQUIRED_STAGES.get(source_doc["media_type"], ["probe"])
    runs = await coll(PROCESSING_RUNS).find(
        {"source_id": source_id, "stage": {"$in": required}}, {"stage": 1, "status": 1}
    ).to_list(length=len(required))
    by_stage = {r["stage"]: r["status"] for r in runs}

    if any(by_stage.get(s) == "failed" for s in required):
        new_status = "failed"
    elif all(by_stage.get(s) == "ok" for s in required):
        new_status = "ready"
    elif any(by_stage.get(s) == "ok" for s in required):
        new_status = "partial_ready"
    else:
        new_status = "extracting"

    await coll(SOURCES).update_one({"_id": source_id}, {"$set": {"status": new_status}})
    return new_status


async def run_stage(
    source_id: str,
    *,
    stage: str,
    producer: str,
    processor_version: str,
    config: dict[str, Any],
    body: StageFn,
) -> None:
    """Run (or skip, if already done) one extraction stage for one source.

    `body(source_doc, run_id) -> ProcessorResult` does the actual work —
    `run_id` is this stage's own ProcessingRun id, so the body can stamp it
    into each EvidenceItem's provenance.processing_run_id. Running off the
    event loop is the body's own responsibility (wrap blocking calls in
    asyncio.to_thread — see pipeline/audio.py and pipeline/visual.py).
    """
    source_doc = await coll(SOURCES).find_one({"_id": source_id})
    if source_doc is None:
        raise ValueError(f"unknown source_id: {source_id}")

    cfg_hash = config_hash(config)
    key = idempotency_key(
        source_id=source_id,
        source_sha256=source_doc["sha256"],
        stage_name=stage,
        processor_version=processor_version,
        config_hash=cfg_hash,
        schema_version=source_doc["schema_version"],
    )

    existing_run = await coll(PROCESSING_RUNS).find_one({"idempotency_key": key})
    if existing_run is not None and existing_run["status"] == "ok":
        return

    run_id = existing_run["_id"] if existing_run is not None else new_id("processing_run")
    run = ProcessingRun(
        _id=run_id,
        source_id=source_id,
        stage=stage,
        idempotency_key=key,
        producer=producer,
        processor_version=processor_version,
        config_hash=cfg_hash,
        status="running",
    )
    await coll(PROCESSING_RUNS).replace_one({"_id": run_id}, run.model_dump(by_alias=True), upsert=True)
    await coll(SOURCES).update_one({"_id": source_id}, {"$set": {"status": "extracting"}})

    try:
        result = await body(source_doc, run_id)
    except Exception as e:  # noqa: BLE001 — any stage failure is recorded, never silently swallowed
        await coll(PROCESSING_RUNS).update_one(
            {"_id": run_id}, {"$set": {"status": "failed", "error": str(e), "ended_at": utcnow()}}
        )
        await recompute_source_status(source_id)
        return

    if result.evidence_items:
        docs = [item.model_dump(by_alias=True) for item in result.evidence_items]
        await coll(EVIDENCE_ITEMS).insert_many(docs)

    await coll(PROCESSING_RUNS).update_one(
        {"_id": run_id},
        {"$set": {"status": "ok", "ended_at": utcnow(), "metrics": result.metrics, "warnings": result.warnings}},
    )
    await recompute_source_status(source_id)


async def run_probe_stage(source_id: str) -> None:
    """Probe stage — P1. Kept separate from run_stage's ProcessorResult
    shape because it writes scalar fields onto the Source record
    (duration_ms/page_count), not evidence_items."""
    source_doc = await coll(SOURCES).find_one({"_id": source_id})
    if source_doc is None:
        raise ValueError(f"unknown source_id: {source_id}")

    processor_version = "v1"
    cfg_hash = config_hash({"processor_version": processor_version})
    key = idempotency_key(
        source_id=source_id,
        source_sha256=source_doc["sha256"],
        stage_name="probe",
        processor_version=processor_version,
        config_hash=cfg_hash,
        schema_version=source_doc["schema_version"],
    )

    existing_run = await coll(PROCESSING_RUNS).find_one({"idempotency_key": key})
    if existing_run is not None and existing_run["status"] == "ok":
        return

    run_id = existing_run["_id"] if existing_run is not None else new_id("processing_run")
    run = ProcessingRun(
        _id=run_id,
        source_id=source_id,
        stage="probe",
        idempotency_key=key,
        producer="probe_adapter",
        processor_version=processor_version,
        config_hash=cfg_hash,
        status="running",
    )
    await coll(PROCESSING_RUNS).replace_one({"_id": run_id}, run.model_dump(by_alias=True), upsert=True)
    await coll(SOURCES).update_one({"_id": source_id}, {"$set": {"status": "probing"}})

    store = get_asset_store()
    resolved_path = store.resolve(source_doc["storage_path"])

    try:
        result = await asyncio.to_thread(probe, source_doc["media_type"], resolved_path)
    except ProbeError as e:
        await coll(PROCESSING_RUNS).update_one(
            {"_id": run_id}, {"$set": {"status": "failed", "error": str(e), "ended_at": utcnow()}}
        )
        await coll(SOURCES).update_one({"_id": source_id}, {"$set": {"status": "failed"}})
        return

    field_update: dict = {"status": "probed"}
    if "duration_ms" in result:
        field_update["duration_ms"] = result["duration_ms"]
    if "page_count" in result:
        field_update["page_count"] = result["page_count"]

    await coll(SOURCES).update_one({"_id": source_id}, {"$set": field_update})
    await coll(PROCESSING_RUNS).update_one(
        {"_id": run_id}, {"$set": {"status": "ok", "ended_at": utcnow(), "metrics": result}}
    )


async def run_extraction_stages(source_id: str) -> None:
    """Dispatch the extraction stages applicable to this source's
    media_type, after probe has succeeded. Called from the upload handler
    so "upload and you're done" still holds once a modality's stage exists;
    stages not yet implemented (document -> P4) are silently absent from
    the dispatch table and simply don't run.
    """
    from enrich.embed import run_enrich_stage  # local imports: avoid a
    from pipeline.audio import run_audio_stage  # circular import at module load time
    from pipeline.document import run_document_stage
    from pipeline.visual import run_visual_stage

    source_doc = await coll(SOURCES).find_one({"_id": source_id})
    if source_doc is None or source_doc["status"] != "probed":
        return

    media_type = source_doc["media_type"]
    if media_type in ("audio", "video"):
        await run_audio_stage(source_id)
    if media_type in ("video", "image"):
        await run_visual_stage(source_id)
    if media_type == "document":
        await run_document_stage(source_id)

    # Enrichment (P5) runs after extraction, regardless of modality — it
    # only needs evidence_items to already exist, which every modality's
    # extraction stage(s) above just produced.
    await run_enrich_stage(source_id)

    await recompute_source_status(source_id)
