#!/usr/bin/env python3
"""Create the two Atlas Search indexes on evidence_items — §06/§11.

Run this FIRST, against empty collections, before any extraction runs.
Index builds are asynchronous; starting them now means they are READY long
before the first real query instead of racing the demo.

Usage:
    uv run python scripts/create_search_indexes.py
    uv run python scripts/create_search_indexes.py --status   # poll build status
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

# Allow `python3 scripts/create_search_indexes.py` from the repo root without
# needing PYTHONPATH set — this isn't an installed package (pyproject sets
# tool.uv.package = false).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import MongoClient
from pymongo.operations import SearchIndexModel

from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS

VECTOR_INDEX_NAME = "ev_vec"
TEXT_INDEX_NAME = "ev_text"

VECTOR_INDEX_DEFINITION = {
    "fields": [
        {
            "type": "vector",
            "path": "embeddings.text.vector",
            "numDimensions": 1024,
            "similarity": "cosine",
        },
        {
            "type": "vector",
            "path": "embeddings.multimodal.vector",
            "numDimensions": 1024,
            "similarity": "cosine",
        },
        {"type": "filter", "path": "modality"},
        {"type": "filter", "path": "node_type"},
        {"type": "filter", "path": "collection_id"},
    ]
}

TEXT_INDEX_DEFINITION = {
    "mappings": {
        "dynamic": False,
        "fields": {
            "content": {"type": "string"},
            "collection_id": {"type": "token"},
            "modality": {"type": "token"},
            "node_type": {"type": "token"},
        },
    }
}


def create_indexes() -> None:
    settings = get_settings()
    client = MongoClient(settings.mongodb_uri)
    coll = client[settings.mongodb_db][EVIDENCE_ITEMS]

    existing = {ix["name"] for ix in coll.list_search_indexes()}

    models = []
    if VECTOR_INDEX_NAME not in existing:
        models.append(
            SearchIndexModel(definition=VECTOR_INDEX_DEFINITION, name=VECTOR_INDEX_NAME, type="vectorSearch")
        )
    if TEXT_INDEX_NAME not in existing:
        models.append(SearchIndexModel(definition=TEXT_INDEX_DEFINITION, name=TEXT_INDEX_NAME, type="search"))

    if not models:
        print(f"Both indexes already exist: {sorted(existing)}")
    else:
        created = coll.create_search_indexes(models)
        print(f"Requested index creation: {created}")

    print("\nCurrent search indexes:")
    for ix in coll.list_search_indexes():
        print(f"  {ix['name']:10s} type={ix.get('type', 'search'):12s} status={ix.get('status')}")

    client.close()


def poll_status(timeout_s: int = 180, interval_s: int = 5) -> None:
    settings = get_settings()
    client = MongoClient(settings.mongodb_uri)
    coll = client[settings.mongodb_db][EVIDENCE_ITEMS]

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        indexes = list(coll.list_search_indexes())
        statuses = {ix["name"]: ix.get("status") for ix in indexes}
        print(f"[{int(time.time())}] {statuses}")
        if all(s == "READY" for s in statuses.values()) and len(statuses) >= 2:
            print("Both indexes READY.")
            break
        time.sleep(interval_s)
    else:
        print("Timed out waiting for READY — this is not fatal. See §11: "
              "VECTOR_BACKEND=numpy is the structural hedge if a query has "
              "to run before the build finishes.")

    client.close()


if __name__ == "__main__":
    if "--status" in sys.argv:
        poll_status()
    else:
        create_indexes()
