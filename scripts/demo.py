#!/usr/bin/env python3
"""Demo script — architecture doc §09 P10.

Runs four fixed-order queries against a live OmniTrace instance
(uvicorn api.main:app must already be running — this script never boots
its own server, matching how an actual demo runs) and writes a backup
transcript in case the live run fails during presentation (§09 P10
acceptance: "capture a backup transcript of a successful run").

Order matters — §09 P10: "hero query, change-over-time query,
insufficient-evidence query, baseline comparison, in that fixed order."

The Claims + SUPERSEDES layer ("how does information change over time")
is stretch-lane, explicitly deferred — never built in this pass (§09: it's
only attempted after P9 passes, and wasn't reached). The change-over-time
query here therefore runs as an ordinary grounded query against whatever
evidence exists, not a claims/supersedes-aware timeline answer. That
limitation is printed with the query, not silently glossed over — see
README's Limitations section for the full list.

Usage:
    uv run python scripts/demo.py --base-url http://127.0.0.1:8000 [--collection-id demo_architecture]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from baseline.text_rag import baseline_query
from omnitrace.config import get_settings
from omnitrace.db import close_client

TRANSCRIPT_PATH = Path(__file__).resolve().parent.parent / "eval" / "demo_transcript.json"

# Fixed order — §09 P10. The hero query's exact wording matches the
# appendix's (§12) stated hero query so a judge sees the same question the
# architecture doc itself uses as the running example.
DEMO_QUERIES = [
    {
        "id": "hero",
        "question": "What architecture was proposed to reduce database load, who explained it, and where was it shown?",
        "note": None,
    },
    {
        "id": "change_over_time",
        "question": "How did the proposed caching approach change over the course of the discussion?",
        "note": "Claims + SUPERSEDES (stretch lane) was not built in this pass — this runs as an "
                "ordinary grounded query, not a claims-aware timeline answer. See README Limitations.",
    },
    {
        "id": "insufficient_evidence",
        "question": "What was the exact p99 latency measured after the cache was deployed to production?",
        "note": "Expected to return missing_information rather than a fabricated number.",
    },
]


async def _run_query(client: httpx.AsyncClient, question: str, collection_id: str) -> dict[str, Any]:
    resp = await client.post(
        "/api/v1/query", json={"question": question, "collection_id": collection_id, "debug_trace": True}
    )
    resp.raise_for_status()
    return resp.json()


async def run_demo(base_url: str, collection_id: str) -> dict[str, Any]:
    transcript: dict[str, Any] = {"base_url": base_url, "collection_id": collection_id, "queries": []}

    async with httpx.AsyncClient(base_url=base_url, timeout=60.0) as client:
        for spec in DEMO_QUERIES:
            t0 = time.perf_counter()
            result = await _run_query(client, spec["question"], collection_id)
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            entry = {
                "id": spec["id"],
                "question": spec["question"],
                "note": spec["note"],
                "answer": result.get("answer"),
                "support_label": result.get("support_label"),
                "missing_information": result.get("missing_information"),
                "evidence_count": len(result.get("evidence", [])),
                "evidence_modalities": sorted({e.get("modality") for e in result.get("evidence", [])}),
                "elapsed_ms": elapsed_ms,
                "stage_timings_ms": result.get("stage_timings_ms"),
            }
            transcript["queries"].append(entry)
            print(f"[{spec['id']}] {spec['question']}")
            if spec["note"]:
                print(f"  note: {spec['note']}")
            print(f"  answer: {entry['answer'] or '(none — see missing_information)'}")
            print(
                f"  support: {entry['support_label']}, evidence: {entry['evidence_count']} item(s) "
                f"across {entry['evidence_modalities']}"
            )
            print(f"  {elapsed_ms}ms")
            print()

        # Baseline comparison — same hero question, naive fixed-chunk
        # single-vector system, so a judge sees the two side by side.
        hero_question = DEMO_QUERIES[0]["question"]
        t0 = time.perf_counter()
        chunks, warnings = await baseline_query(hero_question, collection_id=collection_id, top_k=5)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        baseline_entry = {
            "id": "baseline_comparison",
            "question": hero_question,
            "chunk_count": len(chunks),
            "warnings": warnings,
            "elapsed_ms": elapsed_ms,
            "top_chunk_preview": chunks[0]["text"][:200] if chunks else None,
        }
        transcript["queries"].append(baseline_entry)
        print(f"[baseline_comparison] {hero_question}")
        print(f"  naive baseline retrieved {len(chunks)} chunk(s) in {elapsed_ms}ms")
        if warnings:
            print(f"  warnings: {warnings}")
        print()

    TRANSCRIPT_PATH.parent.mkdir(parents=True, exist_ok=True)
    TRANSCRIPT_PATH.write_text(json.dumps(transcript, indent=2))
    print(f"wrote backup transcript -> {TRANSCRIPT_PATH}")
    return transcript


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--collection-id", default=None)
    args = parser.parse_args()
    collection_id = args.collection_id or get_settings().collection_id

    await run_demo(args.base_url, collection_id)
    await close_client()


if __name__ == "__main__":
    asyncio.run(main())
