"""Retrieval seed channels — architecture doc §08/§09 P7.

Four independent channels behind one interface, each returning a ranked
list of evidence dicts. retrieval/fuse.py combines their rankings; no
channel here knows about any other, and any channel that can't run (Atlas
Search/vector index not READY, no VOYAGE_API_KEY configured) returns an
empty list rather than raising — RRF still runs on whichever channels did
contribute (§11's own fallback posture, applied at query time).
"""

from __future__ import annotations

from typing import Any

from enrich.embed import get_embedding_provider
from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS, coll
from retrieval.planner import QueryPlan
from retrieval.vector_index import get_vector_index

TEXT_SEARCH_INDEX = "ev_text"
_RESULT_FIELDS = {
    "content": 1, "modality": 1, "node_type": 1, "evidence_type": 1,
    "location": 1, "source_id": 1, "entity_ids": 1, "confidence": 1, "provenance": 1,
}


async def lexical_channel(question: str, *, collection_id: str, top_k: int = 20) -> list[dict[str, Any]]:
    pipeline = [
        {
            "$search": {
                "index": TEXT_SEARCH_INDEX,
                "compound": {
                    "must": [{"text": {"query": question, "path": "content"}}],
                    "filter": [{"equals": {"path": "collection_id", "value": collection_id}}],
                },
            }
        },
        {"$limit": top_k},
        {"$project": {**_RESULT_FIELDS, "score": {"$meta": "searchScore"}}},
    ]
    try:
        return await coll(EVIDENCE_ITEMS).aggregate(pipeline).to_list(length=top_k)
    except Exception:  # noqa: BLE001 — Atlas Search unavailable; other channels still run
        return []


async def text_vector_channel(question: str, *, collection_id: str, top_k: int = 20) -> list[dict[str, Any]]:
    if not get_settings().voyage_api_key:
        return []
    try:
        provider = get_embedding_provider()
        vector = provider.embed_query_text([question])[0]
        index = get_vector_index()
        return await index.query(vector, path="embeddings.text.vector", top_k=top_k, collection_id=collection_id)
    except Exception:  # noqa: BLE001
        return []


async def visual_vector_channel(question: str, *, collection_id: str, top_k: int = 20) -> list[dict[str, Any]]:
    if not get_settings().voyage_api_key:
        return []
    try:
        provider = get_embedding_provider()
        vector = provider.embed_multimodal_query_text([question])[0]
        index = get_vector_index()
        return await index.query(vector, path="embeddings.multimodal.vector", top_k=top_k, collection_id=collection_id)
    except Exception:  # noqa: BLE001
        return []


async def structured_channel(plan: QueryPlan, *, collection_id: str, top_k: int = 20) -> list[dict[str, Any]]:
    """Entity / modality filters — no free-text scoring, so an
    unconstrained query (no matched entities, no required modality) has
    nothing to filter on and correctly contributes nothing rather than
    dumping the whole collection as a "seed"."""
    mongo_filter: dict[str, Any] = {"collection_id": collection_id}
    if plan.entity_ids:
        mongo_filter["entity_ids"] = {"$in": plan.entity_ids}
    if plan.required_modalities:
        mongo_filter["modality"] = {"$in": list(plan.required_modalities)}
    if len(mongo_filter) == 1:  # only collection_id present — no real constraint
        return []

    docs = await coll(EVIDENCE_ITEMS).find(mongo_filter, _RESULT_FIELDS).to_list(length=top_k * 3)
    docs.sort(key=lambda d: (d.get("confidence") or {}).get("extraction") or 0.0, reverse=True)
    return docs[:top_k]


async def run_all_channels(plan: QueryPlan, *, collection_id: str, top_k: int = 20) -> dict[str, list[dict[str, Any]]]:
    import asyncio

    lexical, text_vec, visual_vec, structured = await asyncio.gather(
        lexical_channel(plan.question, collection_id=collection_id, top_k=top_k),
        text_vector_channel(plan.question, collection_id=collection_id, top_k=top_k),
        visual_vector_channel(plan.question, collection_id=collection_id, top_k=top_k),
        structured_channel(plan, collection_id=collection_id, top_k=top_k),
    )
    return {"lexical": lexical, "text_vector": text_vec, "visual_vector": visual_vec, "structured": structured}
