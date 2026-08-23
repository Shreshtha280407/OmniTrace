"""Bounded evidence expansion — architecture doc §08/§09 P7.

From each seed: look up which semantic_event(s) already contain it (a
direct member_ids lookup — link/events.py did the clustering, this is a
read), then walk CONFIRMED relationship edges outward up to MAX_HOPS.
Tentative edges never expand a bundle (§02: "only confirmed edges supply
primary proof"). One bounded query per hop — never an unbounded graph
traversal, and never more than MAX_EXPANDED_PER_HOP edges examined per hop.
"""

from __future__ import annotations

from typing import Any

from omnitrace.db import EVIDENCE_ITEMS, RELATIONSHIPS, SEMANTIC_EVENTS, coll

MAX_HOPS = 2
MAX_EXPANDED_PER_HOP = 50


async def expand(seed_ids: list[str], *, collection_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    events = await coll(SEMANTIC_EVENTS).find(
        {"collection_id": collection_id, "member_ids": {"$in": seed_ids}}
    ).to_list(length=None)
    primary_event_id = events[0]["_id"] if events else None

    event_member_ids: set[str] = set()
    for e in events:
        event_member_ids.update(e.get("member_ids", []))

    seed_set = set(seed_ids)
    visited = set(seed_ids) | event_member_ids
    frontier = set(seed_ids)
    edge_type_by_target: dict[str, str] = {}

    for _ in range(MAX_HOPS):
        if not frontier:
            break
        edges = await coll(RELATIONSHIPS).find(
            {
                "collection_id": collection_id,
                "status": "confirmed",
                "$or": [{"from_id": {"$in": list(frontier)}}, {"to_id": {"$in": list(frontier)}}],
            },
            {"from_id": 1, "to_id": 1, "type": 1},
        ).to_list(length=MAX_EXPANDED_PER_HOP)

        next_frontier: set[str] = set()
        for edge in edges:
            for a, b in ((edge["from_id"], edge["to_id"]), (edge["to_id"], edge["from_id"])):
                if a in frontier and b not in visited:
                    next_frontier.add(b)
                    edge_type_by_target[b] = edge["type"]
        visited |= next_frontier
        frontier = next_frontier

    expanded_ids = visited - seed_set
    docs: list[dict[str, Any]] = []
    if expanded_ids:
        docs = await coll(EVIDENCE_ITEMS).find(
            {"_id": {"$in": list(expanded_ids)}, "collection_id": collection_id}
        ).to_list(length=None)

    debug_trace = {
        "primary_event_id": primary_event_id,
        "expanded_via_edge": {d["_id"]: edge_type_by_target[d["_id"]] for d in docs if d["_id"] in edge_type_by_target},
        "expanded_via_event": sorted(event_member_ids - seed_set),
    }
    return docs, debug_trace
