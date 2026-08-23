"""Query endpoint — architecture doc §08/§12 API surface, P7 + P8.

POST /api/v1/query runs the full pipeline in one request, matching the
system-view diagram exactly: PLAN → four seed channels → weighted RRF →
bounded expansion → coverage-aware rerank → GENERATION → VALIDATORS →
response. No layer here is permitted to take over another's responsibility
(§03 hard boundaries) — this file only orchestrates; the actual logic
lives in retrieval/ and generate/.

GET /api/v1/evidence/{id}/source resolves one evidence item back to its
originating Source record — the primary-provenance-reachability read path
a UI would use for "show me where this came from".
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from generate.answer import GenerationError, generate_grounded_answer
from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS, RELATIONSHIPS, SOURCES, coll
from retrieval.channels import run_all_channels
from retrieval.expand import expand
from retrieval.fuse import fuse
from retrieval.planner import plan_query
from retrieval.rerank import rerank_bundle

router = APIRouter()

SEED_TOP_K = 20
FUSED_TOP_K = 30
BUNDLE_TOP_K = 20
RELATIONSHIP_DISPLAY_LIMIT = 50


class QueryRequest(BaseModel):
    collection_id: str | None = None
    question: str
    required_modalities: list[str] | None = None
    debug_trace: bool = False


def _clean(doc: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in doc.items() if k != "embeddings"}


async def _relationships_touching(bundle_ids: set[str], *, collection_id: str) -> list[dict[str, Any]]:
    docs = await coll(RELATIONSHIPS).find(
        {
            "collection_id": collection_id,
            "status": {"$in": ["confirmed", "tentative"]},
            "$or": [{"from_id": {"$in": list(bundle_ids)}}, {"to_id": {"$in": list(bundle_ids)}}],
        },
        {"from_id": 1, "to_id": 1, "type": 1, "status": 1, "confidence": 1, "signals": 1},
    ).to_list(length=RELATIONSHIP_DISPLAY_LIMIT)
    return docs


@router.post("/query")
async def run_query(req: QueryRequest) -> dict[str, Any]:
    settings = get_settings()
    collection_id = req.collection_id or settings.collection_id
    timings: dict[str, int] = {}

    t0 = time.perf_counter()
    plan = await plan_query(req.question)
    if req.required_modalities:
        plan.required_modalities |= set(req.required_modalities)
    timings["plan"] = int((time.perf_counter() - t0) * 1000)

    t0 = time.perf_counter()
    channel_results = await run_all_channels(plan, collection_id=collection_id, top_k=SEED_TOP_K)
    fused, fuse_trace = fuse(channel_results, weights=plan.channel_weights, top_k=FUSED_TOP_K)
    timings["seed"] = int((time.perf_counter() - t0) * 1000)

    t0 = time.perf_counter()
    seed_ids = [f["_id"] for f in fused]
    expanded, expand_trace = await expand(seed_ids, collection_id=collection_id)
    timings["expand"] = int((time.perf_counter() - t0) * 1000)

    t0 = time.perf_counter()
    edge_confidence_by_id: dict[str, float] = {}
    for eid, etype in expand_trace.get("expanded_via_edge", {}).items():
        edge_confidence_by_id[eid] = 1.0  # structural/graph confidence already filtered to "confirmed" edges only

    candidate_pool = fused + [dict(e, score=0.0) for e in expanded if e["_id"] not in {f["_id"] for f in fused}]
    bundle = rerank_bundle(candidate_pool, plan=plan, edge_confidence_by_id=edge_confidence_by_id, top_k=BUNDLE_TOP_K)
    timings["rerank"] = int((time.perf_counter() - t0) * 1000)

    t0 = time.perf_counter()
    try:
        # generate_grounded_answer uses the synchronous Anthropic client —
        # off the event loop, same as every other real network call in this
        # codebase (see pipeline/audio.py, pipeline/visual.py).
        generation = await asyncio.to_thread(generate_grounded_answer, req.question, bundle)
    except GenerationError as e:
        generation = {
            "answer": "", "claims": [], "conflicts": [],
            "missing_information": [f"generation failed: {e}"],
            "source_locators": [], "support_label": "none", "validator_warnings": [],
        }
    timings["generate"] = int((time.perf_counter() - t0) * 1000)

    bundle_ids = {b["_id"] for b in bundle}
    relationships = await _relationships_touching(bundle_ids, collection_id=collection_id)

    response: dict[str, Any] = {
        "answer": generation["answer"],
        "claims": generation["claims"],
        "conflicts": generation["conflicts"],
        "missing_information": generation["missing_information"],
        "primary_event_id": expand_trace.get("primary_event_id"),
        "evidence": [_clean(b) for b in bundle],
        "relationships": relationships,
        "source_locators": generation["source_locators"],
        "support_label": generation["support_label"],
        "stage_timings_ms": timings,
        "query_plan": {
            "answer_slots": plan.answer_slots,
            "required_modalities": sorted(plan.required_modalities),
            "entity_ids": plan.entity_ids,
            "channel_weights": plan.channel_weights,
        },
    }
    if req.debug_trace:
        response["debug_trace"] = {**fuse_trace, **expand_trace, "validator_warnings": generation["validator_warnings"]}

    return response


@router.get("/evidence/{evidence_id}/source")
async def get_evidence_source(evidence_id: str) -> dict[str, Any]:
    evidence_doc = await coll(EVIDENCE_ITEMS).find_one({"_id": evidence_id}, {"source_id": 1})
    if evidence_doc is None:
        raise HTTPException(404, "evidence not found")

    source_doc = await coll(SOURCES).find_one({"_id": evidence_doc["source_id"]})
    if source_doc is None:
        raise HTTPException(404, "evidence's source no longer exists — provenance broken")

    from omnitrace.models import Source

    return Source.model_validate(source_doc).model_dump(by_alias=True, mode="json")
