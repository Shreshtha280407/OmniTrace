"""Deterministic query planner — architecture doc §08/§09 P7.

Slot extraction from interrogatives, entity matching against the
`entities` collection (same normalize_key as enrich/entities.py, so
"Postgres" in a question resolves the same way it did at ingestion time),
and a required-modality list derived from which slots fired. Runs in
well under a millisecond and cannot fail in a way that blocks retrieval.

§09 P7 cut-line 1 explicitly drops the optional model-based planner
("the deterministic path is default anyway") — this build takes that cut:
there is no LLM call on the query-planning path at all, only the
deterministic slot/entity extraction below.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from enrich.entities import candidate_phrases, normalize_key
from omnitrace.db import ENTITIES, coll

DEFAULT_CHANNEL_WEIGHTS = {"lexical": 1.0, "text_vector": 1.0, "visual_vector": 1.0, "structured": 1.0}

_WHO_RE = re.compile(r"\bwho\b", re.I)
_WHERE_SHOWN_RE = re.compile(r"\bwhere\b.*\b(shown|displayed|visible|screen|diagram|slide)\b", re.I)
_TRADEOFF_RE = re.compile(r"\b(trade[- ]?offs?|risks?|drawbacks?|downsides?|concerns?)\b", re.I)
_ARCHITECTURE_RE = re.compile(r"\b(architecture|design|propose[ds]?|approach)\b", re.I)

# answer_slot -> the modalities that can plausibly satisfy it. Used both to
# build required_modalities here and (retrieval/rerank.py) to score
# slot_coverage per candidate.
SLOT_MODALITIES: dict[str, set[str]] = {
    "who": {"speech"},
    "where_shown": {"video_visual", "image"},
    "document_tradeoff": {"document"},
    "architecture": {"speech", "video_visual", "document"},
    "general": set(),
}


@dataclass
class QueryPlan:
    question: str
    answer_slots: list[str] = field(default_factory=list)
    required_modalities: set[str] = field(default_factory=set)
    entity_ids: list[str] = field(default_factory=list)
    channel_weights: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_CHANNEL_WEIGHTS))
    source: str = "deterministic"


async def _match_entities(question: str) -> list[str]:
    phrases = candidate_phrases(question)
    keys = {normalize_key(p) for p in phrases if normalize_key(p)}
    if not keys:
        return []
    docs = await coll(ENTITIES).find({"normalized_key": {"$in": list(keys)}}, {"_id": 1}).to_list(length=None)
    return [d["_id"] for d in docs]


async def plan_query(question: str) -> QueryPlan:
    plan = QueryPlan(question=question)

    if _WHO_RE.search(question):
        plan.answer_slots.append("who")
    if _WHERE_SHOWN_RE.search(question):
        plan.answer_slots.append("where_shown")
        plan.channel_weights["visual_vector"] *= 2.0  # §08: "where was it shown" lifts visual
    if _TRADEOFF_RE.search(question):
        plan.answer_slots.append("document_tradeoff")
    if _ARCHITECTURE_RE.search(question):
        plan.answer_slots.append("architecture")
    if not plan.answer_slots:
        plan.answer_slots.append("general")
        plan.required_modalities.update({"speech", "video_visual", "image", "document"})

    for slot in plan.answer_slots:
        plan.required_modalities |= SLOT_MODALITIES.get(slot, set())

    plan.entity_ids = await _match_entities(question)
    return plan
