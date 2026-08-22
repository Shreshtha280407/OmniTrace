"""Sequential stage runner — architecture doc §05/§09 P1.

One stage implemented in P1: probe. Extract/normalize/enrich/link/index
(P2-P6) plug into the same shape later: load source, compute an
idempotency key, skip if already done, run the stage body in a thread
(everything here is blocking I/O — ffprobe, PyMuPDF), record the outcome.

No queue (§02 decision ledger: in-process, synchronous, ordered) — a stage
runs to completion inside the request that triggered it. For a four-file
demo corpus this is simpler and has fewer failure modes than a worker pool,
and idempotency keys mean a crash mid-stage is safe to retry by re-calling
the same function.
"""

from __future__ import annotations

import asyncio

from omnitrace.assets import get_asset_store
from omnitrace.db import PROCESSING_RUNS, SOURCES, coll
from omnitrace.ids import config_hash, idempotency_key, new_id
from omnitrace.models import ProcessingRun, utcnow
from pipeline.probe import ProbeError, probe

PROBE_PROCESSOR_VERSION = "v1"


async def run_probe_stage(source_id: str) -> None:
    """Run (or resume) the probe stage for one source.

    Idempotent: if a ProcessingRun with the same idempotency key already
    succeeded, this is a no-op. That makes it safe to call from the upload
    handler on every request without worrying about double-processing a
    re-uploaded or retried source.
    """
    source_doc = await coll(SOURCES).find_one({"_id": source_id})
    if source_doc is None:
        raise ValueError(f"unknown source_id: {source_id}")

    cfg_hash = config_hash({"processor_version": PROBE_PROCESSOR_VERSION})
    key = idempotency_key(
        source_sha256=source_doc["sha256"],
        stage_name="probe",
        processor_version=PROBE_PROCESSOR_VERSION,
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
        processor_version=PROBE_PROCESSOR_VERSION,
        config_hash=cfg_hash,
        status="running",
    )
    await coll(PROCESSING_RUNS).replace_one({"_id": run_id}, run.model_dump(by_alias=True), upsert=True)
    await coll(SOURCES).update_one({"_id": source_id}, {"$set": {"status": "probing"}})

    store = get_asset_store()
    resolved_path = store.resolve(source_doc["storage_path"])

    try:
        # ffprobe/PyMuPDF are blocking calls — run off the event loop so one
        # slow probe doesn't stall every other request this process is serving.
        result = await asyncio.to_thread(probe, source_doc["media_type"], resolved_path)
    except ProbeError as e:
        await coll(PROCESSING_RUNS).update_one(
            {"_id": run_id}, {"$set": {"status": "failed", "error": str(e), "ended_at": utcnow()}}
        )
        # Per §05: the raw source is never removed just because probe failed.
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
