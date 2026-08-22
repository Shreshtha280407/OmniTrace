"""Motor client and collection accessors.

Ordinary (non-Atlas-Search) indexes are created here, at startup, against
collections whose Atlas Search / vector indexes are created separately by
scripts/create_search_indexes.py. Both run in P0, before any evidence
exists, per §11's structural hedge: index builds are asynchronous, and
creating them against empty collections means they're READY long before
the first real query.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo import ASCENDING

from omnitrace.config import get_settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(get_settings().mongodb_uri)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[get_settings().mongodb_db]


# Collection name constants — one place, matches §06 exactly.
SOURCES = "sources"
ASSETS = "assets"
PROCESSING_RUNS = "processing_runs"
EVIDENCE_ITEMS = "evidence_items"
ENTITIES = "entities"
RELATIONSHIPS = "relationships"
SEMANTIC_EVENTS = "semantic_events"
EVALUATION_CASES = "evaluation_cases"

ALL_COLLECTIONS = [
    SOURCES,
    ASSETS,
    PROCESSING_RUNS,
    EVIDENCE_ITEMS,
    ENTITIES,
    RELATIONSHIPS,
    SEMANTIC_EVENTS,
    EVALUATION_CASES,
]


def coll(name: str) -> AsyncIOMotorCollection:
    return get_db()[name]


async def ensure_indexes() -> None:
    """Ordinary indexes — critical-indexes column of §06's collection table,
    minus the Atlas Search / vector indexes (see scripts/create_search_indexes.py).
    Idempotent: create_index is a no-op if an identical index already exists.
    """
    db = get_db()

    await db[SOURCES].create_index("sha256")
    await db[SOURCES].create_index([("collection_id", ASCENDING), ("status", ASCENDING)])

    await db[ASSETS].create_index([("source_id", ASCENDING), ("asset_type", ASCENDING)])
    await db[ASSETS].create_index("parent_asset_id")
    await db[ASSETS].create_index("content_hash")

    await db[PROCESSING_RUNS].create_index([("source_id", ASCENDING), ("stage", ASCENDING)])
    await db[PROCESSING_RUNS].create_index("idempotency_key", unique=True)

    await db[EVIDENCE_ITEMS].create_index([("source_id", ASCENDING), ("node_type", ASCENDING)])
    await db[EVIDENCE_ITEMS].create_index([("location.timeline_id", ASCENDING), ("location.start_ms", ASCENDING)])
    await db[EVIDENCE_ITEMS].create_index("location.page")
    await db[EVIDENCE_ITEMS].create_index("entity_ids")
    await db[EVIDENCE_ITEMS].create_index("collection_id")

    await db[ENTITIES].create_index("normalized_key", unique=True)
    await db[ENTITIES].create_index("aliases")

    await db[RELATIONSHIPS].create_index([("from_id", ASCENDING), ("type", ASCENDING), ("status", ASCENDING)])
    await db[RELATIONSHIPS].create_index([("to_id", ASCENDING), ("type", ASCENDING), ("status", ASCENDING)])

    await db[SEMANTIC_EVENTS].create_index("source_ids")
    await db[SEMANTIC_EVENTS].create_index([("timeline_id", ASCENDING), ("start_ms", ASCENDING)])

    await db[EVALUATION_CASES].create_index("category")


async def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
