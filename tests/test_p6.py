"""P6 acceptance tests — architecture doc §09.

Acceptance: no TEMPORALLY_OVERLAPS edge crosses two different timeline_id
values (tested directly — this is the one guard that's never allowed to
degrade, per §09's cut-line: "Never drop the timeline guard"); a confirmed
EXPLAINS edge forms between temporally-aligned, entity-overlapping speech
and visual evidence with a legible signal breakdown; connected-component
event clustering splits correctly on a >45s time gap.

The clustering/candidate math is tested as pure functions (no DB). The
full linker run (scripts/link.py) needs a real Atlas cluster; that test is
gated on MONGODB_URI like every other phase's DB-backed tests.
"""

from __future__ import annotations

import pytest
from pymongo import MongoClient

from link.candidates import generate_same_timeline_candidates
from link.events import _connected_components, _split_on_time_gap
from link.score import classify, score_candidate
from omnitrace.config import get_settings
from omnitrace.ids import new_id
from scripts.link import run_linker
from tests.conftest import run_on_server_loop


def _mongo_configured() -> bool:
    uri = get_settings().mongodb_uri
    return bool(uri) and "localhost" not in uri


skip_unless_mongo = pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")


def _db():
    s = get_settings()
    return MongoClient(s.mongodb_uri)[s.mongodb_db]


# ── pure-function tests: no DB, no network ─────────────────────────────────


def test_connected_components_groups_transitively():
    nodes = {"a", "b", "c", "d"}
    edges = [("a", "b"), ("b", "c")]
    components = _connected_components(nodes, edges)
    sizes = sorted(len(c) for c in components)
    assert sizes == [1, 3], "a-b-c must merge into one component, d stays alone"


def test_split_on_time_gap_breaks_at_45s():
    members = [
        {"_id": "e1", "location": {"start_ms": 0, "end_ms": 1000}},
        {"_id": "e2", "location": {"start_ms": 2000, "end_ms": 3000}},       # 1s gap — same event
        {"_id": "e3", "location": {"start_ms": 3000 + 50_000, "end_ms": 3000 + 51_000}},  # 50s gap — new event
    ]
    groups = _split_on_time_gap(members)
    assert len(groups) == 2
    assert [m["_id"] for m in groups[0]] == ["e1", "e2"]
    assert [m["_id"] for m in groups[1]] == ["e3"]


def test_score_candidate_cross_file_has_zero_temporal_weight():
    a = {"location": {"start_ms": 0, "end_ms": 1000}, "entity_ids": ["ent_x"], "embeddings": {}, "confidence": {}}
    b = {"location": {"start_ms": 0, "end_ms": 1000}, "entity_ids": ["ent_x"], "embeddings": {}, "confidence": {}}
    signals, _ = score_candidate({"a": a, "b": b, "cross_file": True, "overlap_ms": 1000})
    assert signals.temporal == 0.0, "cross-file candidates must never get temporal credit (§07)"


def test_classify_respects_configured_thresholds():
    settings = get_settings()
    assert classify(settings.link_confirm) == "confirmed"
    assert classify(settings.link_confirm - 0.01) != "confirmed"
    assert classify(0.0) == "rejected"


# ── DB-backed: real timeline guard + full linker run ────────────────────────


@pytest.mark.asyncio
@skip_unless_mongo
async def test_same_timeline_candidates_never_cross_timelines(server_loop):
    collection_id = "test_p6_" + new_id("source")[-8:]
    db = _db()
    tl_a, tl_b = new_id("timeline"), new_id("timeline")
    docs = [
        {"_id": "ev_speech_a", "source_id": "src_a", "collection_id": collection_id, "evidence_type": "speech_segment",
         "modality": "speech", "node_type": "semantic_segment", "content": "x", "member_evidence_ids": [],
         "entity_ids": [], "confidence": {}, "provenance": {"processing_run_id": "r", "producer": "t"},
         "location": {"timeline_id": tl_a, "start_ms": 0, "end_ms": 1000}},
        {"_id": "ev_visual_b", "source_id": "src_b", "collection_id": collection_id, "evidence_type": "visual_state",
         "modality": "video_visual", "node_type": "atomic_observation", "content": "y", "member_evidence_ids": [],
         "entity_ids": [], "confidence": {}, "provenance": {"processing_run_id": "r", "producer": "t"},
         "location": {"timeline_id": tl_b, "start_ms": 0, "end_ms": 1000}},  # same absolute time, DIFFERENT timeline
    ]
    db["evidence_items"].insert_many(docs)
    try:
        candidates = await run_on_server_loop(server_loop, generate_same_timeline_candidates(collection_id))
        assert candidates == [], "identical absolute timestamps on different timelines must never form a candidate"
    finally:
        db["evidence_items"].delete_many({"collection_id": collection_id})


@pytest.mark.asyncio
@skip_unless_mongo
async def test_explains_edge_confirmed_with_signal_breakdown(server_loop):
    collection_id = "test_p6_" + new_id("source")[-8:]
    db = _db()
    timeline_id = new_id("timeline")
    speech_id, visual_id = new_id("evidence_item"), new_id("evidence_item")
    entity_id = new_id("entity")

    db["entities"].insert_one({
        "_id": entity_id, "collection_id": collection_id, "canonical_name": "Redis",
        "entity_type": "concept", "aliases": ["Redis"], "normalized_key": "test_redis_" + entity_id[-6:],
        "evidence_mentions": [speech_id, visual_id], "resolution_confidence": 1.0,
    })
    shared_vector = [1.0, 0.0, 0.0, 0.0]
    common = {
        "collection_id": collection_id, "member_evidence_ids": [], "entity_ids": [entity_id],
        "confidence": {"extraction": 0.9}, "provenance": {"processing_run_id": "r", "producer": "t"},
        "embeddings": {"text": {"model": "test", "version": "", "dim": 4, "vector": shared_vector}},
    }
    db["evidence_items"].insert_many([
        {**common, "_id": speech_id, "source_id": "src_a", "evidence_type": "speech_segment", "modality": "speech",
         "node_type": "semantic_segment", "content": "We proposed Redis for caching.",
         "location": {"timeline_id": timeline_id, "start_ms": 1000, "end_ms": 5000}},
        {**common, "_id": visual_id, "source_id": "src_a", "evidence_type": "visual_state", "modality": "video_visual",
         "node_type": "atomic_observation", "content": "[diagram] Redis cache architecture",
         "location": {"timeline_id": timeline_id, "start_ms": 2000, "end_ms": 4000}},
    ])

    try:
        metrics = await run_on_server_loop(server_loop, run_linker(collection_id))
        assert metrics["confirmed"] >= 1, f"expected at least one confirmed edge, got {metrics}"

        edge = db["relationships"].find_one({
            "collection_id": collection_id, "type": "EXPLAINS", "status": "confirmed",
            "from_id": speech_id, "to_id": visual_id,
        })
        assert edge is not None, "a confirmed EXPLAINS edge must exist from the speech segment to the visual state"
        assert edge["signals"]["temporal"] > 0.0
        assert edge["signals"]["entity"] > 0.0
        assert edge["signals"]["semantic"] > 0.0
    finally:
        db["evidence_items"].delete_many({"collection_id": collection_id})
        db["relationships"].delete_many({"collection_id": collection_id})
        db["semantic_events"].delete_many({"collection_id": collection_id})
        db["entities"].delete_one({"_id": entity_id})
