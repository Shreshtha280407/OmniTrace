"""Query endpoint — architecture doc §08/§12 API surface, P7 + P8.

POST /api/v1/query runs the full pipeline in one request, matching the
system-view diagram exactly: PLAN → four seed channels → weighted RRF →
bounded expansion → coverage-aware rerank → GENERATION → VALIDATORS →
response. No layer here is permitted to take over another's responsibility
(§03 hard boundaries) — this file only translates the HTTP request/response
shape; the actual orchestration lives in retrieval/pipeline.py (P9 factored
it out so eval/run.py's per-case loop and this endpoint run the identical
sequence — see that module's docstring), and the per-stage logic lives in
retrieval/ and generate/.

GET /api/v1/evidence/{id}/source resolves one evidence item back to its
originating Source record — the primary-provenance-reachability read path
a UI would use for "show me where this came from".
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS, SOURCES, coll
from retrieval.pipeline import run_full_pipeline

router = APIRouter()


class QueryRequest(BaseModel):
    collection_id: str | None = None
    question: str
    required_modalities: list[str] | None = None
    debug_trace: bool = False


@router.post("/query")
async def run_query(req: QueryRequest) -> dict[str, Any]:
    settings = get_settings()
    collection_id = req.collection_id or settings.collection_id

    result = await run_full_pipeline(
        req.question, collection_id=collection_id, required_modalities=req.required_modalities
    )
    if not req.debug_trace:
        result = {k: v for k, v in result.items() if k != "debug_trace"}
    return result


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
