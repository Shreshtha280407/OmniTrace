"""P0 acceptance test — architecture doc §09.

Acceptance: round-trip a document through Pydantic <-> Mongo; both Atlas
search indexes exist (PENDING or READY).

Requires MONGODB_URI to point at a real Atlas cluster (or local mongod) —
skips cleanly if it isn't configured yet.

Uses plain synchronous PyMongo directly rather than the app's async Motor
client — see tests/conftest.py's docstring for why a shared async client
isn't safe to reuse across pytest-asyncio's per-test event loops. This test
predates the app entirely (it's exercising the schema/DB layer directly,
not an endpoint), so there's no live_server_url fixture involved here.
"""

from __future__ import annotations

import pytest
from pymongo import MongoClient

from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS
from omnitrace.ids import config_hash, new_id
from omnitrace.models import EvidenceItem, Location, Provenance


def _mongo_configured() -> bool:
    uri = get_settings().mongodb_uri
    return bool(uri) and "localhost" not in uri


def _db():
    s = get_settings()
    return MongoClient(s.mongodb_uri)[s.mongodb_db]


@pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
def test_evidence_item_roundtrip():
    db = _db()

    run_id = new_id("processing_run")
    item = EvidenceItem(
        _id=new_id("evidence_item"),
        collection_id="test_collection",
        source_id=new_id("source"),
        node_type="atomic_observation",
        evidence_type="ocr_region",
        modality="video_visual",
        content="Redis Cache",
        location=Location(
            timeline_id=new_id("timeline"),
            start_ms=139000,
            end_ms=144200,
            bbox_norm={"x1": 0.31, "y1": 0.18, "x2": 0.49, "y2": 0.24},
        ),
        provenance=Provenance(
            processing_run_id=run_id,
            producer="paddleocr_adapter",
            config_hash=config_hash({"lang": "en"}),
        ),
    )

    doc = item.model_dump(by_alias=True)
    db[EVIDENCE_ITEMS].insert_one(doc)

    fetched = db[EVIDENCE_ITEMS].find_one({"_id": item.id})
    assert fetched is not None
    roundtripped = EvidenceItem.model_validate(fetched)

    assert roundtripped.content == "Redis Cache"
    assert roundtripped.location.start_ms == 139000
    assert roundtripped.location.timeline_id is not None
    assert roundtripped.location.page is None  # never a fabricated page on video evidence

    db[EVIDENCE_ITEMS].delete_one({"_id": item.id})


@pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
def test_search_indexes_exist():
    names = {ix["name"] for ix in _db()[EVIDENCE_ITEMS].list_search_indexes()}
    assert "ev_vec" in names, "run scripts/create_search_indexes.py first"
    assert "ev_text" in names, "run scripts/create_search_indexes.py first"
