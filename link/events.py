"""Semantic event clustering — architecture doc §07/§09 P6.

Connected components over CONFIRMED dynamic edges only (TEMPORALLY_OVERLAPS,
EXPLAINS, VISUALIZES) — structural edges (PART_OF_SEGMENT, DERIVED_FROM)
are lineage, not co-occurrence, and don't participate. Split a component on
a >45s internal time gap. HDBSCAN is explicitly dropped (§07 decision
ledger): "deterministic, explainable in one sentence, roughly ten lines of
code" — that's _connected_components + _split_on_time_gap below; the rest
of this file is data plumbing around them.

Topic-change splitting (the other half of §07's split criterion) is not
implemented — it would need real topic modeling, disproportionate for this
build's time budget. Only the time-gap split runs. This is a scope
narrowing worth naming explicitly, not a silent gap: a component that
drifts topic without ever exceeding the time gap stays one event.
"""

from __future__ import annotations

from typing import Any

from omnitrace.db import EVIDENCE_ITEMS, RELATIONSHIPS, SEMANTIC_EVENTS, coll
from omnitrace.ids import new_id
from omnitrace.models import SemanticEvent

EVENT_SPLIT_GAP_MS = 45_000
CLUSTER_VERSION = "v1"
_DYNAMIC_EDGE_TYPES = {"TEMPORALLY_OVERLAPS", "EXPLAINS", "VISUALIZES"}


def _connected_components(node_ids: set[str], edges: list[tuple[str, str]]) -> list[set[str]]:
    parent = {n: n for n in node_ids}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for a, b in edges:
        if a in parent and b in parent:
            union(a, b)

    groups: dict[str, set[str]] = {}
    for n in node_ids:
        groups.setdefault(find(n), set()).add(n)
    return list(groups.values())


def _split_on_time_gap(members: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    if not members:
        return []
    groups: list[list[dict[str, Any]]] = [[members[0]]]
    for prev, cur in zip(members, members[1:]):
        prev_end = (prev.get("location") or {}).get("end_ms")
        cur_start = (cur.get("location") or {}).get("start_ms")
        if prev_end is not None and cur_start is not None and (cur_start - prev_end) > EVENT_SPLIT_GAP_MS:
            groups.append([cur])
        else:
            groups[-1].append(cur)
    return groups


async def build_events(collection_id: str) -> dict[str, Any]:
    edges = await coll(RELATIONSHIPS).find(
        {"collection_id": collection_id, "status": "confirmed", "type": {"$in": list(_DYNAMIC_EDGE_TYPES)}},
        {"from_id": 1, "to_id": 1},
    ).to_list(length=None)

    # Rebuild is a deterministic re-derivation, not an accumulation — clear
    # this collection_id's prior events before writing fresh ones.
    await coll(SEMANTIC_EVENTS).delete_many({"collection_id": collection_id, "cluster_version": CLUSTER_VERSION})

    if not edges:
        return {"events_created": 0, "components_found": 0}

    node_ids = {e["from_id"] for e in edges} | {e["to_id"] for e in edges}
    docs = await coll(EVIDENCE_ITEMS).find(
        {"_id": {"$in": list(node_ids)}}, {"_id": 1, "source_id": 1, "location": 1, "content": 1}
    ).to_list(length=None)
    by_id = {d["_id"]: d for d in docs}

    components = _connected_components(node_ids, [(e["from_id"], e["to_id"]) for e in edges])

    created = 0
    for component in components:
        members = sorted(
            (by_id[m] for m in component if m in by_id),
            key=lambda d: (d.get("location") or {}).get("start_ms")
            if (d.get("location") or {}).get("start_ms") is not None else -1,
        )
        if not members:
            continue
        for sub in _split_on_time_gap(members):
            timed = [m for m in sub if (m.get("location") or {}).get("start_ms") is not None]
            starts = [m["location"]["start_ms"] for m in timed]
            ends = [m["location"]["end_ms"] for m in timed if m["location"].get("end_ms") is not None]
            timelines = {m["location"].get("timeline_id") for m in timed if m["location"].get("timeline_id")}

            event = SemanticEvent(
                _id=new_id("semantic_event"),
                collection_id=collection_id,
                title=(sub[0].get("content") or "Untitled event")[:80],
                summary=" / ".join((m.get("content") or "")[:60] for m in sub[:3] if m.get("content")),
                source_ids=sorted({m["source_id"] for m in sub}),
                timeline_id=next(iter(timelines)) if len(timelines) == 1 else None,
                start_ms=min(starts) if starts else None,
                end_ms=max(ends) if ends else None,
                member_ids=[m["_id"] for m in sub],
                cluster_version=CLUSTER_VERSION,
                confidence=1.0,
            )
            await coll(SEMANTIC_EVENTS).insert_one(event.model_dump(by_alias=True))
            created += 1

    return {"events_created": created, "components_found": len(components)}
