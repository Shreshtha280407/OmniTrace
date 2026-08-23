#!/usr/bin/env python3
"""Freeze a processed corpus — architecture doc §09 P10.

"A fresh clone plus the snapshot answers the hero query with no
re-processing" (P10 acceptance). This exports every DB record for one
collection_id (sources, processing_runs, evidence_items, entities,
relationships, semantic_events) to a single JSON file, and tars the
matching data/assets/{raw,derived} directories alongside it — a demo
machine that restores both never has to re-run ASR, vision, OCR, or
embedding calls, which is the whole point of freezing before a demo
rather than re-ingesting live.

This build has no real judge-supplied corpus to freeze yet (§09: dataset
arrives from the judges) — this script is the tooling, ready to run the
moment one exists; scripts/restore.py is its exact inverse.

Usage:
    uv run python scripts/freeze.py --collection-id demo_architecture --out data/snapshots/demo.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tarfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omnitrace.assets import get_asset_store
from omnitrace.config import get_settings
from omnitrace.db import (
    ENTITIES,
    EVIDENCE_ITEMS,
    PROCESSING_RUNS,
    RELATIONSHIPS,
    SEMANTIC_EVENTS,
    SOURCES,
    close_client,
    coll,
)

SNAPSHOT_DIR = Path(__file__).resolve().parent.parent / "data" / "snapshots"
# Order matters for restore.py: sources before everything that references
# a source_id, entities before evidence_items that carry entity_ids, etc.
# is not actually required (Mongo has no FK enforcement) but keeps a human
# reading the JSON file in a sane order.
COLLECTIONS_IN_ORDER = [SOURCES, PROCESSING_RUNS, EVIDENCE_ITEMS, ENTITIES, RELATIONSHIPS, SEMANTIC_EVENTS]


def _json_default(obj: Any) -> Any:
    # datetime -> isoformat; anything else Mongo could hand back that json
    # doesn't know how to serialize surfaces here instead of failing deep
    # inside json.dumps with a less useful traceback.
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    raise TypeError(f"cannot freeze value of type {type(obj)!r}: {obj!r}")


async def freeze(collection_id: str, out_path: Path) -> dict[str, int]:
    snapshot: dict[str, Any] = {"collection_id": collection_id, "collections": {}}
    counts: dict[str, int] = {}

    source_ids: list[str] = []
    for name in COLLECTIONS_IN_ORDER:
        if name == PROCESSING_RUNS:
            # ProcessingRun has no collection_id field of its own (see
            # omnitrace/models.py) — only source_id, so it must be filtered
            # by the source_ids this same pass already collected from
            # SOURCES rather than a direct collection_id match, which would
            # silently match nothing.
            query: dict[str, Any] = {"source_id": {"$in": source_ids}} if source_ids else {"_id": None}
        else:
            query = {"collection_id": collection_id}
        docs = await coll(name).find(query).to_list(length=None)
        snapshot["collections"][name] = docs
        counts[name] = len(docs)
        if name == SOURCES:
            source_ids = [d["_id"] for d in docs]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(snapshot, indent=2, default=_json_default))

    # Tar the on-disk raw/derived assets for exactly these sources — a
    # cold-started machine needs the actual frame/wav/PDF files, not just
    # the DB records pointing at paths that don't exist there yet.
    store = get_asset_store()
    assets_tar_path = out_path.with_suffix(".assets.tar")
    asset_file_count = 0
    with tarfile.open(assets_tar_path, "w") as tar:
        for kind in ("raw", "derived"):
            for source_id in source_ids:
                d = store.root / kind / source_id
                if d.exists():
                    tar.add(d, arcname=f"{kind}/{source_id}")
                    asset_file_count += sum(1 for _ in d.rglob("*") if _.is_file())

    counts["asset_files"] = asset_file_count
    print(f"froze collection_id={collection_id!r}: {counts}")
    print(f"  -> {out_path}")
    print(f"  -> {assets_tar_path}")
    return counts


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection-id", default=None)
    parser.add_argument("--out", default=None, help="output JSON path (default: data/snapshots/<collection_id>.json)")
    args = parser.parse_args()
    collection_id = args.collection_id or get_settings().collection_id
    out_path = Path(args.out) if args.out else SNAPSHOT_DIR / f"{collection_id}.json"

    await freeze(collection_id, out_path)
    await close_client()


if __name__ == "__main__":
    asyncio.run(main())
