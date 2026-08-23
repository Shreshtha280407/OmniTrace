#!/usr/bin/env python3
"""Restore a frozen corpus — the exact inverse of scripts/freeze.py, P10.

Loads a snapshot JSON + its sibling .assets.tar back into a fresh
environment: upserts every DB record by _id (idempotent — restoring twice
is safe, matching this codebase's idempotency-by-content-hash philosophy
everywhere else), and extracts the tarred raw/derived asset files back
under ASSET_ROOT. After this, the collection answers queries with zero
re-processing — no ASR, vision, OCR, or embedding calls happen here.

Usage:
    uv run python scripts/restore.py --snapshot data/snapshots/demo_architecture.json
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
from omnitrace.db import close_client, coll, ensure_indexes


async def restore(snapshot_path: Path) -> dict[str, int]:
    snapshot = json.loads(snapshot_path.read_text())
    collection_id = snapshot["collection_id"]
    counts: dict[str, int] = {}

    await ensure_indexes()  # a truly fresh cluster needs these before any query runs

    for name, docs in snapshot["collections"].items():
        for doc in docs:
            await coll(name).replace_one({"_id": doc["_id"]}, doc, upsert=True)
        counts[name] = len(docs)

    assets_tar_path = snapshot_path.with_suffix(".assets.tar")
    asset_file_count = 0
    if assets_tar_path.exists():
        store = get_asset_store()
        with tarfile.open(assets_tar_path, "r") as tar:
            # filter="data" (Python 3.12+) refuses path traversal / absolute
            # members outright — the same guard LocalAssetStore.resolve()
            # already applies to normal reads, applied here too since this
            # extracts from a file that could in principle come from anywhere.
            tar.extractall(store.root, filter="data")
            asset_file_count = sum(1 for m in tar.getmembers() if m.isfile())
    counts["asset_files"] = asset_file_count

    print(f"restored collection_id={collection_id!r}: {counts}")
    return counts


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    args = parser.parse_args()

    await restore(Path(args.snapshot))
    await close_client()


if __name__ == "__main__":
    asyncio.run(main())
