"""Coverage-aware bundle rerank — architecture doc §08/§09 P7.

    0.35 fused_seed_rank + 0.20 mean_edge_confidence
  + 0.15 answer_slot_coverage + 0.10 modality_coverage
  + 0.10 extraction_quality  + 0.10 provenance_completeness

This is "ranks whole bundles against the question's answer slots" (§08),
not a fixed per-item re-sort: selection is greedy over what the bundle
*still needs*. slot_coverage and modality_coverage are computed against
what's already been selected, so the second speech utterance ranked by raw
fused_seed_rank alone won't out-rank the one visual_state that still hasn't
made it into the bundle — coverage, not just relevance, decides. §09 P7:
"never drop the coverage term in the reranker."
"""

from __future__ import annotations

from typing import Any

from retrieval.planner import SLOT_MODALITIES, QueryPlan

WEIGHTS = {
    "fused_rank": 0.35,
    "edge_confidence": 0.20,
    "slot_coverage": 0.15,
    "modality_coverage": 0.10,
    "extraction_quality": 0.10,
    "provenance_completeness": 0.10,
}


def _provenance_completeness(item: dict[str, Any]) -> float:
    prov = item.get("provenance") or {}
    loc = item.get("location") or {}
    score = 0.0
    if prov.get("processing_run_id"):
        score += 0.5
    if loc.get("start_ms") is not None or loc.get("page") is not None:
        score += 0.5
    return score


def rerank_bundle(
    candidates: list[dict[str, Any]],
    *,
    plan: QueryPlan,
    edge_confidence_by_id: dict[str, float] | None = None,
    top_k: int = 20,
    coverage_aware: bool = True,
) -> list[dict[str, Any]]:
    """coverage_aware=False is the P9 A3 ablation hook ("no coverage-aware
    rerank") — zeroes the slot_coverage/modality_coverage terms so
    selection degrades to fused-rank-plus-quality only, the same greedy
    loop otherwise. True (the default, and the only mode any pre-P9 caller
    uses) is the full §08 formula, unchanged."""
    edge_confidence_by_id = edge_confidence_by_id or {}
    required_slot_modalities: set[str] = set()
    for slot in plan.answer_slots:
        required_slot_modalities |= SLOT_MODALITIES.get(slot, set())

    max_fused_rank = max((c.get("score", 0.0) for c in candidates), default=0.0) or 1.0

    covered_modalities: set[str] = set()
    covered_slot_modalities: set[str] = set()
    selected: list[dict[str, Any]] = []
    pool = list(candidates)

    while pool and len(selected) < top_k:
        best_item, best_utility = None, -1.0
        for item in pool:
            fused_rank_term = item.get("score", 0.0) / max_fused_rank
            edge_conf = edge_confidence_by_id.get(item["_id"], 1.0)  # a bare seed is its own fully-confident proof
            modality = item.get("modality", "")

            adds_modality = modality in plan.required_modalities and modality not in covered_modalities
            adds_slot = modality in required_slot_modalities and modality not in covered_slot_modalities

            extraction_quality = (item.get("confidence") or {}).get("extraction")
            extraction_quality = extraction_quality if extraction_quality is not None else 1.0

            utility = (
                WEIGHTS["fused_rank"] * fused_rank_term
                + WEIGHTS["edge_confidence"] * edge_conf
                + (WEIGHTS["slot_coverage"] * (1.0 if adds_slot else 0.0) if coverage_aware else 0.0)
                + (WEIGHTS["modality_coverage"] * (1.0 if adds_modality else 0.0) if coverage_aware else 0.0)
                + WEIGHTS["extraction_quality"] * extraction_quality
                + WEIGHTS["provenance_completeness"] * _provenance_completeness(item)
            )
            if utility > best_utility:
                best_item, best_utility = item, utility

        assert best_item is not None
        selected.append({**best_item, "utility": best_utility})
        covered_modalities.add(best_item.get("modality", ""))
        if best_item.get("modality") in required_slot_modalities:
            covered_slot_modalities.add(best_item["modality"])
        pool.remove(best_item)

    return selected
