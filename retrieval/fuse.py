"""Weighted Reciprocal Rank Fusion — architecture doc §08/§09 P7.

score(i) = Σ_c  w_c / (K + rank_c(i))   — rank is 1-indexed per channel.
Weights come from the query plan's channel_weights, so "where was it
shown" lifts the visual channel exactly as §08 specifies. Per-source and
per-type caps run after fusion, before truncating to top_k, so one
talkative transcript can't crowd out every other modality from the seed
set that retrieval/expand.py and retrieval/rerank.py build on.
"""

from __future__ import annotations

from typing import Any

RRF_K = 60
MAX_PER_SOURCE = 5
MAX_PER_TYPE = 8


def fuse(
    channel_results: dict[str, list[dict[str, Any]]],
    *,
    weights: dict[str, float],
    top_k: int = 30,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    scores: dict[str, float] = {}
    items: dict[str, dict[str, Any]] = {}
    contributions: dict[str, list[str]] = {}

    for channel, results in channel_results.items():
        w = weights.get(channel, 1.0)
        for rank, item in enumerate(results, start=1):
            item_id = item["_id"]
            items.setdefault(item_id, item)
            scores[item_id] = scores.get(item_id, 0.0) + w / (RRF_K + rank)
            contributions.setdefault(item_id, []).append(channel)

    ranked_ids = sorted(scores, key=lambda i: scores[i], reverse=True)

    capped: list[str] = []
    per_source: dict[str, int] = {}
    per_type: dict[str, int] = {}
    for item_id in ranked_ids:
        item = items[item_id]
        source_id = item.get("source_id", "")
        etype = item.get("evidence_type", "")
        if per_source.get(source_id, 0) >= MAX_PER_SOURCE:
            continue
        if per_type.get(etype, 0) >= MAX_PER_TYPE:
            continue
        capped.append(item_id)
        per_source[source_id] = per_source.get(source_id, 0) + 1
        per_type[etype] = per_type.get(etype, 0) + 1
        if len(capped) >= top_k:
            break

    fused = [dict(items[i], score=scores[i]) for i in capped]
    debug_trace = {
        "channel_ranks": {i: contributions[i] for i in capped},
        "rrf": {i: round(scores[i], 6) for i in capped},
    }
    return fused, debug_trace
