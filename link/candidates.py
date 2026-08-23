"""Candidate relationship generation — architecture doc §07/§09 P6.

Three families, matching §07 exactly:

  - Structural (PART_OF_SEGMENT, DERIVED_FROM): deterministic, no scoring —
    already implicit in member_evidence_ids / parent_evidence_id, just
    materialized here so P7's expand.py has one uniform edge collection to
    hop through instead of two different lookup shapes.
  - Same-timeline (TEMPORALLY_OVERLAPS, EXPLAINS): speech/document text
    paired with a visual_state that shares the *same* timeline_id and
    overlaps or sits within MAX_GAP_MS. The timeline guard is absolute —
    a pair is only ever proposed when both sides carry the identical
    non-null timeline_id.
  - Cross-file (EXPLAINS): text and visual evidence from *different*
    sources, gated on sharing at least one non-stopword entity. "A vector
    neighbour alone is never a candidate" (§07) — this module doesn't even
    look at embeddings; link/score.py's semantic_similarity signal is what
    uses them, only after a candidate already exists.
"""

from __future__ import annotations

from typing import Any

from omnitrace.db import ENTITIES, EVIDENCE_ITEMS, coll

MAX_GAP_MS = 2000
STOPWORD_ENTITY_MENTION_THRESHOLD = 20  # entities mentioned this often can't seed a cross-file candidate alone

LINKABLE_TEXT_TYPES = {"utterance", "speech_segment", "document_section", "document_block", "table"}
TEMPORAL_TEXT_TYPES = {"utterance", "speech_segment"}

_PROJECTION = {
    "_id": 1, "source_id": 1, "location": 1, "entity_ids": 1, "content": 1,
    "confidence": 1, "embeddings.text": 1,
}


def _intervals_related(a_start: int | None, a_end: int | None, b_start: int | None, b_end: int | None) -> tuple[bool, int]:
    if None in (a_start, a_end, b_start, b_end):
        return False, 0
    overlap = min(a_end, b_end) - max(a_start, b_start)
    if overlap > 0:
        return True, overlap
    return (-overlap) <= MAX_GAP_MS, 0


async def generate_structural_candidates(collection_id: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    segments = await coll(EVIDENCE_ITEMS).find(
        {"collection_id": collection_id, "node_type": "semantic_segment"},
        {"_id": 1, "member_evidence_ids": 1},
    ).to_list(length=None)
    for seg in segments:
        for member_id in seg.get("member_evidence_ids", []):
            candidates.append({"from_id": member_id, "to_id": seg["_id"], "type": "PART_OF_SEGMENT"})

    children = await coll(EVIDENCE_ITEMS).find(
        {"collection_id": collection_id, "parent_evidence_id": {"$ne": None}},
        {"_id": 1, "parent_evidence_id": 1},
    ).to_list(length=None)
    for child in children:
        candidates.append({"from_id": child["_id"], "to_id": child["parent_evidence_id"], "type": "DERIVED_FROM"})

    return candidates


async def generate_same_timeline_candidates(collection_id: str) -> list[dict[str, Any]]:
    text_items = await coll(EVIDENCE_ITEMS).find(
        {"collection_id": collection_id, "evidence_type": {"$in": list(TEMPORAL_TEXT_TYPES)}, "location.timeline_id": {"$ne": None}},
        _PROJECTION,
    ).to_list(length=None)
    visual_items = await coll(EVIDENCE_ITEMS).find(
        {"collection_id": collection_id, "evidence_type": "visual_state", "location.timeline_id": {"$ne": None}},
        _PROJECTION,
    ).to_list(length=None)

    by_timeline: dict[str, list[dict]] = {}
    for v in visual_items:
        by_timeline.setdefault(v["location"]["timeline_id"], []).append(v)

    candidates: list[dict[str, Any]] = []
    for t in text_items:
        tl = t["location"]["timeline_id"]
        for v in by_timeline.get(tl, []):
            related, overlap_ms = _intervals_related(
                t["location"].get("start_ms"), t["location"].get("end_ms"),
                v["location"].get("start_ms"), v["location"].get("end_ms"),
            )
            if not related:
                continue
            assert t["location"]["timeline_id"] == v["location"]["timeline_id"], "timeline guard violated"
            same_source = t["source_id"] == v["source_id"]
            base = {
                "same_timeline": True, "cross_file": not same_source,
                "overlap_ms": overlap_ms, "a": t, "b": v,
            }
            candidates.append({"from_id": t["_id"], "to_id": v["_id"], "type": "TEMPORALLY_OVERLAPS", **base})
            # An EXPLAINS candidate rides along the same temporal pairing —
            # link/score.py's higher-weighted semantic bar decides whether
            # it actually clears confirmation, not this module.
            candidates.append({"from_id": t["_id"], "to_id": v["_id"], "type": "EXPLAINS", **base})

    return candidates


async def _stopword_entity_ids() -> set[str]:
    entities = await coll(ENTITIES).find({}, {"_id": 1, "evidence_mentions": 1}).to_list(length=None)
    return {e["_id"] for e in entities if len(e.get("evidence_mentions", [])) >= STOPWORD_ENTITY_MENTION_THRESHOLD}


async def generate_cross_file_candidates(collection_id: str) -> list[dict[str, Any]]:
    text_items = await coll(EVIDENCE_ITEMS).find(
        {"collection_id": collection_id, "evidence_type": {"$in": list(LINKABLE_TEXT_TYPES)}, "entity_ids": {"$ne": []}},
        _PROJECTION,
    ).to_list(length=None)
    visual_items = await coll(EVIDENCE_ITEMS).find(
        {"collection_id": collection_id, "evidence_type": "visual_state", "entity_ids": {"$ne": []}},
        _PROJECTION,
    ).to_list(length=None)
    if not text_items or not visual_items:
        return []

    stopword_ids = await _stopword_entity_ids()

    by_entity: dict[str, list[dict]] = {}
    for v in visual_items:
        for eid in v.get("entity_ids", []):
            by_entity.setdefault(eid, []).append(v)

    seen_pairs: set[tuple[str, str]] = set()
    candidates: list[dict[str, Any]] = []
    for t in text_items:
        matched: dict[str, dict] = {}
        for eid in t.get("entity_ids", []):
            if eid in stopword_ids:
                continue
            for v in by_entity.get(eid, []):
                if v["source_id"] != t["source_id"]:  # same-file pairs are already covered above
                    matched[v["_id"]] = v
        for v in matched.values():
            key = (t["_id"], v["_id"])
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            candidates.append({
                "from_id": t["_id"], "to_id": v["_id"], "type": "EXPLAINS",
                "same_timeline": False, "cross_file": True, "overlap_ms": None, "a": t, "b": v,
            })

    return candidates


async def generate_all_candidates(collection_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (structural, scorable). Structural candidates are written as
    confirmed edges directly (link/score.py never sees them); scorable
    candidates go through score_candidate() + classify()."""
    structural = await generate_structural_candidates(collection_id)
    scorable = await generate_same_timeline_candidates(collection_id)
    scorable += await generate_cross_file_candidates(collection_id)
    return structural, scorable
