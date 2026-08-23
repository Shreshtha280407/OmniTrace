#!/usr/bin/env python3
"""Run the linker — architecture doc §07/§09 P6.

Generates candidates across the whole collection, scores them, persists
confirmed/tentative edges to `relationships`, then clusters confirmed
dynamic edges into `semantic_events`. Corpus-wide batch pass — run once
after ingestion (P1-P5) has processed every source. Unlike probe/audio/
visual/document/enrich, this is never triggered per-upload: cross-file
candidate generation needs the whole evidence set to already exist.

Usage:
    uv run python scripts/link.py [--collection-id demo_architecture]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from link.candidates import generate_all_candidates
from link.events import build_events
from link.score import classify, score_candidate
from omnitrace.config import get_settings
from omnitrace.db import RELATIONSHIPS, close_client, coll
from omnitrace.ids import new_id
from omnitrace.models import Relationship

LINKER_VERSION = "v1"


async def run_linker(collection_id: str) -> dict[str, Any]:
    structural, scorable = await generate_all_candidates(collection_id)

    # A linker run is a deterministic re-derivation of the whole graph for
    # this collection, not an accumulation — clear prior edges first.
    await coll(RELATIONSHIPS).delete_many({"collection_id": collection_id, "linker_version": LINKER_VERSION})

    counts = {"structural": 0, "confirmed": 0, "tentative": 0, "rejected": 0}
    docs: list[dict[str, Any]] = []

    for cand in structural:
        rel = Relationship(
            _id=new_id("relationship"), collection_id=collection_id,
            from_id=cand["from_id"], to_id=cand["to_id"], type=cand["type"],
            status="confirmed", confidence=1.0, same_timeline=False, linker_version=LINKER_VERSION,
        )
        docs.append(rel.model_dump(by_alias=True))
        counts["structural"] += 1

    for cand in scorable:
        signals, confidence = score_candidate(cand)
        status = classify(confidence)
        counts[status] += 1
        if status == "rejected":
            continue
        rel = Relationship(
            _id=new_id("relationship"), collection_id=collection_id,
            from_id=cand["from_id"], to_id=cand["to_id"], type=cand["type"],
            status=status, confidence=confidence, signals=signals,
            same_timeline=cand.get("same_timeline", False), overlap_ms=cand.get("overlap_ms"),
            linker_version=LINKER_VERSION,
        )
        docs.append(rel.model_dump(by_alias=True))

    if docs:
        await coll(RELATIONSHIPS).insert_many(docs)

    event_metrics = await build_events(collection_id)
    return {**counts, **event_metrics}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection-id", default=None)
    args = parser.parse_args()
    collection_id = args.collection_id or get_settings().collection_id

    metrics = await run_linker(collection_id)
    print(f"Linker run for collection_id={collection_id!r}: {metrics}")
    await close_client()


if __name__ == "__main__":
    asyncio.run(main())
