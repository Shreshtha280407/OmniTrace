"""P0 acceptance test — architecture doc §09.

Acceptance: round-trip a document through Pydantic <-> Mongo; both Atlas
search indexes exist (PENDING or READY).

Requires MONGODB_URI to point at a real Atlas cluster (or local mongod) —
skips cleanly if it isn't configured yet, so `pytest` doesn't fail hard
before Atlas is wired up.
"""

from __future__ import annotations

import pytest

from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS, close_client, coll, ensure_indexes
from omnitrace.ids import config_hash, new_id
from omnitrace.models import EvidenceItem, Location, Provenance


def _mongo_configured() -> bool:
    uri = get_settings().mongodb_uri
    return bool(uri) and "localhost" not in uri


pytestmark = pytest.mark.asyncio


@pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
async def test_evidence_item_roundtrip():
    await ensure_indexes()

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
    await coll(EVIDENCE_ITEMS).insert_one(doc)

    fetched = await coll(EVIDENCE_ITEMS).find_one({"_id": item.id})
    assert fetched is not None
    roundtripped = EvidenceItem.model_validate(fetched)

    assert roundtripped.content == "Redis Cache"
    assert roundtripped.location.start_ms == 139000
    assert roundtripped.location.timeline_id is not None
    assert roundtripped.location.page is None  # never a fabricated page on video evidence

    await coll(EVIDENCE_ITEMS).delete_one({"_id": item.id})
    await close_client()


@pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
async def test_search_indexes_exist():
    from pymongo import MongoClient

    settings = get_settings()
    client = MongoClient(settings.mongodb_uri)
    names = {ix["name"] for ix in client[settings.mongodb_db][EVIDENCE_ITEMS].list_search_indexes()}
    client.close()

    assert "ev_vec" in names, "run scripts/create_search_indexes.py first"
    assert "ev_text" in names, "run scripts/create_search_indexes.py first"
