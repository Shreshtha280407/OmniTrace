#!/usr/bin/env python3
"""Evaluation harness — architecture doc §07/§09 P9.

Runs every case in eval/gold.yaml against the full OmniTrace pipeline
(retrieval/pipeline.py — same code path as POST /api/v1/query), the same
pipeline with each of three mechanisms ablated in turn, and the naive
baseline/text_rag.py, then writes measured metrics to eval/results.json
and eval/results.md.

Without eval/gold.yaml — the judges haven't supplied a dataset yet, so
there is nothing to score against — this writes an honest "not measured"
result instead of fabricating numbers, the same §09 P9 evaluation-honesty
rule scripts/calibrate.py already applies one phase early for link scoring.

eval/gold.yaml schema (create this once a corpus + labelled cases exist):
    cases:
      - id: q1
        category: architecture            # free text, for grouping in the report
        question: "..."
        collection_id: demo_architecture  # optional, defaults to --collection-id
        gold_evidence_ids: [ev_..., ev_...]
        required_modalities: [speech, video_visual, document]   # optional
        gold_relationship_pairs: [[ev_a, ev_b]]                 # optional

Metric definitions (exact, so a reader never has to guess what a number
means):
  - recall_at_5 / recall_at_10: |gold_evidence_ids ∩ top-K returned evidence
    ids| / |gold_evidence_ids|, per case, averaged. Baseline has no evidence
    granularity (it returns text chunks, not evidence records), so its
    recall is a fair proxy: |gold source_ids ∩ retrieved chunk source_ids|
    / |gold source_ids| — "did it find the right source", not "the right
    evidence item", stated explicitly in the report.
  - evidence_f1: precision/recall over the full returned bundle vs.
    gold_evidence_ids (full system only — the baseline's chunk-vs-evidence
    granularity mismatch makes this undefined for it, reported as null).
  - modality_completeness_rate: fraction of cases (that declared
    required_modalities) whose returned bundle covered every required
    modality.
  - link_precision / link_recall: only over cases that declare
    gold_relationship_pairs, comparing against the relationships the query
    endpoint actually returns for that bundle.
  - provenance_exact_match: only meaningful when generation ran (source
    locators exist) — fraction of returned source_locators whose location
    fields match the stored evidence_item's location exactly. Reported as
    null for cases/systems where generation didn't run (e.g. no
    ANTHROPIC_API_KEY, or --no-generation).
  - latency p50/p95: wall-clock per case, milliseconds.

Usage:
    uv run python eval/run.py [--collection-id demo_architecture] [--with-generation]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from baseline.text_rag import baseline_query
from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS, close_client, coll
from retrieval.pipeline import run_full_pipeline

EVAL_DIR = Path(__file__).resolve().parent

# name -> kwargs threaded into run_full_pipeline's P9 ablation hooks.
# "full" (no kwargs) is always run first and is what POST /api/v1/query
# actually does — see retrieval/pipeline.py's docstring for why this can't
# drift from the live endpoint.
SYSTEM_CONFIGS: dict[str, dict[str, Any]] = {
    "full": {},
    "A1_no_temporal_edges": {"exclude_edge_types": {"TEMPORALLY_OVERLAPS"}},
    "A2_no_multimodal_vector": {"disabled_channels": {"visual_vector"}},
    "A3_no_coverage_rerank": {"coverage_aware": False},
}


def load_gold(gold_path: Path) -> list[dict[str, Any]] | None:
    if not gold_path.exists():
        return None
    import yaml

    data = yaml.safe_load(gold_path.read_text()) or {}
    return data.get("cases", [])


def _recall_at_k(gold_ids: list[str], ranked_ids: list[str], k: int) -> float | None:
    if not gold_ids:
        return None
    top = set(ranked_ids[:k])
    return len(top & set(gold_ids)) / len(gold_ids)


def _set_f1(gold_ids: list[str], predicted_ids: list[str]) -> float | None:
    if not gold_ids:
        return None
    if not predicted_ids:
        return 0.0
    inter = set(gold_ids) & set(predicted_ids)
    precision = len(inter) / len(predicted_ids)
    recall = len(inter) / len(gold_ids)
    return 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0


async def _gold_source_ids(gold_evidence_ids: list[str]) -> set[str]:
    if not gold_evidence_ids:
        return set()
    docs = await coll(EVIDENCE_ITEMS).find(
        {"_id": {"$in": gold_evidence_ids}}, {"source_id": 1}
    ).to_list(length=None)
    return {d["source_id"] for d in docs}


async def _run_case_full(
    case: dict[str, Any], *, collection_id: str, ablation_kwargs: dict[str, Any], with_generation: bool
) -> dict[str, Any]:
    t0 = time.perf_counter()
    result = await run_full_pipeline(
        case["question"],
        collection_id=case.get("collection_id", collection_id),
        required_modalities=case.get("required_modalities"),
        disable_generation=not with_generation,
        **ablation_kwargs,
    )
    latency_ms = (time.perf_counter() - t0) * 1000

    predicted_ids = [e["_id"] for e in result["evidence"]]
    gold_ids = case.get("gold_evidence_ids", [])
    metrics: dict[str, Any] = {
        "recall_at_5": _recall_at_k(gold_ids, predicted_ids, 5),
        "recall_at_10": _recall_at_k(gold_ids, predicted_ids, 10),
        "evidence_f1": _set_f1(gold_ids, predicted_ids),
        "modality_complete": None,
        "link_precision": None,
        "link_recall": None,
        "provenance_exact_match": None,
        "latency_ms": latency_ms,
    }

    required_modalities = case.get("required_modalities")
    if required_modalities:
        returned_modalities = {e.get("modality") for e in result["evidence"]}
        metrics["modality_complete"] = set(required_modalities) <= returned_modalities

    gold_pairs = case.get("gold_relationship_pairs")
    if gold_pairs:
        returned_pairs = {(r["from_id"], r["to_id"]) for r in result["relationships"]}
        returned_pairs |= {(r["to_id"], r["from_id"]) for r in result["relationships"]}
        gold_set = {tuple(p) for p in gold_pairs}
        tp = len(gold_set & returned_pairs)
        metrics["link_precision"] = tp / len(returned_pairs) if returned_pairs else 0.0
        metrics["link_recall"] = tp / len(gold_set) if gold_set else None

    if with_generation and result.get("source_locators"):
        evidence_by_id = {e["_id"]: e for e in result["evidence"]}
        matches = 0
        for loc in result["source_locators"]:
            ev = evidence_by_id.get(loc.get("evidence_id"))
            if ev is not None and ev.get("location") == loc.get("location"):
                matches += 1
        metrics["provenance_exact_match"] = matches / len(result["source_locators"])

    return metrics


async def _run_case_baseline(case: dict[str, Any], *, collection_id: str) -> dict[str, Any]:
    t0 = time.perf_counter()
    chunks, warnings = await baseline_query(
        case["question"], collection_id=case.get("collection_id", collection_id), top_k=10
    )
    latency_ms = (time.perf_counter() - t0) * 1000

    gold_source_ids = await _gold_source_ids(case.get("gold_evidence_ids", []))
    retrieved_source_ids = [c["source_id"] for c in chunks]
    metrics: dict[str, Any] = {
        "recall_at_5": _recall_at_k(list(gold_source_ids), retrieved_source_ids, 5) if gold_source_ids else None,
        "recall_at_10": _recall_at_k(list(gold_source_ids), retrieved_source_ids, 10) if gold_source_ids else None,
        "evidence_f1": None,  # granularity mismatch — see module docstring
        "modality_complete": None,  # baseline is text-only by construction
        "link_precision": None,
        "link_recall": None,
        "provenance_exact_match": None,
        "latency_ms": latency_ms,
        "warnings": warnings,
    }
    return metrics


def _percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    idx = min(len(s) - 1, max(0, round(p / 100 * (len(s) - 1))))
    return s[idx]


def _aggregate(per_case: list[dict[str, Any]]) -> dict[str, Any]:
    def _mean(key: str) -> float | None:
        vals = [c[key] for c in per_case if c.get(key) is not None]
        return statistics.fmean(vals) if vals else None

    def _rate(key: str) -> float | None:
        vals = [bool(c[key]) for c in per_case if c.get(key) is not None]
        return sum(vals) / len(vals) if vals else None

    latencies = [c["latency_ms"] for c in per_case if c.get("latency_ms") is not None]
    return {
        "recall_at_5": _mean("recall_at_5"),
        "recall_at_10": _mean("recall_at_10"),
        "evidence_f1": _mean("evidence_f1"),
        "modality_completeness_rate": _rate("modality_complete"),
        "link_precision": _mean("link_precision"),
        "link_recall": _mean("link_recall"),
        "provenance_exact_match": _mean("provenance_exact_match"),
        "latency_p50_ms": _percentile(latencies, 50),
        "latency_p95_ms": _percentile(latencies, 95),
        "n_cases": len(per_case),
    }


def _write_markdown(result: dict[str, Any], path: Path) -> None:
    lines = [
        "# OmniTrace P9 evaluation results",
        "",
        f"n={result['n_cases']} cases · dataset: {result['dataset_note']}",
        "",
        "| System | Recall@5 | Recall@10 | Evidence F1 | Modality-complete | Link P | Link R | Provenance match | p50 ms | p95 ms |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]

    def fmt(v: Any) -> str:
        if v is None:
            return "—"
        if isinstance(v, float):
            return f"{v:.3f}"
        return str(v)

    for name, agg in result["systems"].items():
        lines.append(
            f"| {name} | {fmt(agg['recall_at_5'])} | {fmt(agg['recall_at_10'])} | {fmt(agg['evidence_f1'])} | "
            f"{fmt(agg['modality_completeness_rate'])} | {fmt(agg['link_precision'])} | {fmt(agg['link_recall'])} | "
            f"{fmt(agg['provenance_exact_match'])} | {fmt(agg['latency_p50_ms'])} | {fmt(agg['latency_p95_ms'])} |"
        )
    path.write_text("\n".join(lines) + "\n")


async def run_eval(collection_id: str, *, gold_path: Path | None = None, with_generation: bool = False) -> dict[str, Any]:
    gold_path = gold_path or (EVAL_DIR / "gold.yaml")
    cases = load_gold(gold_path)

    if cases is None:
        result = {
            "method": "not_measured",
            "note": "eval/gold.yaml not found — no dataset supplied yet. This is not a zero score; "
                    "it is an honest statement that nothing has been measured (§09 P9 evaluation-honesty rule).",
            "systems": {},
            "n_cases": 0,
            "dataset_note": "none",
        }
        (EVAL_DIR / "results.json").write_text(json.dumps(result, indent=2))
        # Overwrite results.md too — a stale Markdown table left over from an
        # earlier measured run would silently disagree with results.json the
        # moment gold.yaml disappears (or was never there on a fresh clone).
        (EVAL_DIR / "results.md").write_text(
            "# OmniTrace P9 evaluation results\n\n"
            "**Not measured.** eval/gold.yaml not found — no dataset supplied yet. "
            "This file intentionally reports nothing rather than a fabricated number.\n"
        )
        print(f"wrote {EVAL_DIR / 'results.json'}: method=not_measured (no eval/gold.yaml)")
        return result

    if not cases:
        raise ValueError("eval/gold.yaml exists but declares zero cases — nothing to evaluate")

    per_case_by_system: dict[str, list[dict[str, Any]]] = {name: [] for name in SYSTEM_CONFIGS}
    per_case_by_system["baseline"] = []

    for case in cases:
        for name, kwargs in SYSTEM_CONFIGS.items():
            metrics = await _run_case_full(case, collection_id=collection_id, ablation_kwargs=kwargs, with_generation=with_generation)
            per_case_by_system[name].append(metrics)
        per_case_by_system["baseline"].append(await _run_case_baseline(case, collection_id=collection_id))

    result = {
        "method": "measured",
        "note": f"generation {'ran' if with_generation else 'skipped (--with-generation not passed) — retrieval metrics only'}",
        "dataset_note": f"{len(cases)} case(s) from {gold_path.name}",
        "n_cases": len(cases),
        "systems": {name: _aggregate(per_case) for name, per_case in per_case_by_system.items()},
    }
    (EVAL_DIR / "results.json").write_text(json.dumps(result, indent=2))
    _write_markdown(result, EVAL_DIR / "results.md")
    print(f"wrote {EVAL_DIR / 'results.json'} and {EVAL_DIR / 'results.md'}: {len(cases)} case(s), "
          f"{len(SYSTEM_CONFIGS) + 1} system(s)")
    return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection-id", default=None)
    parser.add_argument("--gold-path", default=None)
    parser.add_argument("--with-generation", action="store_true", help="also call the real Anthropic model per case (slower, costs money)")
    args = parser.parse_args()
    collection_id = args.collection_id or get_settings().collection_id
    gold_path = Path(args.gold_path) if args.gold_path else None

    await run_eval(collection_id, gold_path=gold_path, with_generation=args.with_generation)
    await close_client()


if __name__ == "__main__":
    asyncio.run(main())
