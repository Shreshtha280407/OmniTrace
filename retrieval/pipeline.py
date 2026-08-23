"""Full retrieval + generation pipeline, factored out of api/routes/query.py
— architecture doc §08/§09 P7/P8, P9.

api/routes/query.py's run_query() and eval/run.py both need to run the
*exact same* PLAN -> seed channels -> RRF -> expand -> rerank -> generate
sequence — the API route does it live for one request, eval does it in a
loop over every gold case, and P9's three ablations (§09: "A1 no temporal
edges, A2 no multimodal vector channel, A3 no coverage-aware rerank") need
to run it again with one mechanism switched off each time. Duplicating the
orchestration in eval code would let the ablations drift from what the
live endpoint actually does — the whole point of an ablation is that it's
the real pipeline minus one real mechanism, not a reimplementation.

The three ablation flags below thread straight through to the hooks added
to retrieval/expand.py, retrieval/channels.py, and retrieval/rerank.py for
exactly this purpose — see each function's own docstring. All three default
to "off" (full pipeline, nothing ablated), so this function's default
behavior is byte-for-byte what api/routes/query.py ran before P9.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from generate.answer import GenerationError, generate_grounded_answer
from omnitrace.db import RELATIONSHIPS, coll
from retrieval.channels import run_all_channels
from retrieval.expand import expand
from retrieval.fuse import fuse
from retrieval.planner import plan_query
from retrieval.rerank import rerank_bundle

SEED_TOP_K = 20
FUSED_TOP_K = 30
BUNDLE_TOP_K = 20
RELATIONSHIP_DISPLAY_LIMIT = 50


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


async def run_full_pipeline(
    question: str,
    *,
    collection_id: str,
    required_modalities: list[str] | None = None,
    disable_generation: bool = False,
    # P9 ablation hooks — see retrieval/expand.py, retrieval/channels.py,
    # retrieval/rerank.py for what each one actually switches off.
    exclude_edge_types: set[str] | None = None,
    disabled_channels: set[str] | None = None,
    coverage_aware: bool = True,
) -> dict[str, Any]:
    """Same PLAN -> seed -> fuse -> expand -> rerank -> generate sequence
    api/routes/query.py runs per-request, callable directly for eval loops.

    disable_generation skips the (slow, paid) Anthropic call entirely —
    eval's retrieval-only metrics (Recall@K, evidence-set F1, modality
    completeness) don't need a generated answer, only the bundle, so P9's
    per-case eval loop passes this to keep a 12-case x 4-config sweep fast
    and free. The live query endpoint never sets it.
    """
    timings: dict[str, int] = {}

    t0 = time.perf_counter()
    plan = await plan_query(question)
    if required_modalities:
        plan.required_modalities |= set(required_modalities)
    timings["plan"] = int((time.perf_counter() - t0) * 1000)

    t0 = time.perf_counter()
    channel_results = await run_all_channels(
        plan, collection_id=collection_id, top_k=SEED_TOP_K, disabled_channels=disabled_channels
    )
    fused, fuse_trace = fuse(channel_results, weights=plan.channel_weights, top_k=FUSED_TOP_K)
    timings["seed"] = int((time.perf_counter() - t0) * 1000)

    t0 = time.perf_counter()
    seed_ids = [f["_id"] for f in fused]
    expanded, expand_trace = await expand(seed_ids, collection_id=collection_id, exclude_edge_types=exclude_edge_types)
    timings["expand"] = int((time.perf_counter() - t0) * 1000)

    t0 = time.perf_counter()
    edge_confidence_by_id: dict[str, float] = {}
    for eid, etype in expand_trace.get("expanded_via_edge", {}).items():
        edge_confidence_by_id[eid] = 1.0  # structural/graph confidence already filtered to "confirmed" edges only

    candidate_pool = fused + [dict(e, score=0.0) for e in expanded if e["_id"] not in {f["_id"] for f in fused}]
    bundle = rerank_bundle(
        candidate_pool, plan=plan, edge_confidence_by_id=edge_confidence_by_id, top_k=BUNDLE_TOP_K,
        coverage_aware=coverage_aware,
    )
    timings["rerank"] = int((time.perf_counter() - t0) * 1000)

    t0 = time.perf_counter()
    if disable_generation:
        generation = {
            "answer": "", "claims": [], "conflicts": [],
            "missing_information": [], "source_locators": [], "support_label": "none", "validator_warnings": [],
        }
    else:
        try:
            # generate_grounded_answer uses the synchronous Anthropic client —
            # off the event loop, same as every other real network call in this
            # codebase (see pipeline/audio.py, pipeline/visual.py).
            generation = await asyncio.to_thread(generate_grounded_answer, question, bundle)
        except GenerationError as e:
            generation = {
                "answer": "", "claims": [], "conflicts": [],
                "missing_information": [f"generation failed: {e}"],
                "source_locators": [], "support_label": "none", "validator_warnings": [],
            }
    timings["generate"] = int((time.perf_counter() - t0) * 1000)

    bundle_ids = {b["_id"] for b in bundle}
    relationships = await _relationships_touching(bundle_ids, collection_id=collection_id)

    return {
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
        "debug_trace": {**fuse_trace, **expand_trace, "validator_warnings": generation["validator_warnings"]},
    }
