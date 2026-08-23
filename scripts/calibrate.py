#!/usr/bin/env python3
"""Calibrate the linker's confirm/tentative thresholds — architecture doc
§07/§09 P6, run once at the end of P6 (~20 minutes).

Always dumps every generated candidate + its signal breakdown to
eval/candidates.csv — the linker already computes these, this step is a
write, not new work (§07). If eval/gold.yaml exists (hand-labelled pairs;
schema below), sweeps the confirm threshold 0.50-0.95 in steps of 0.05
against those labels, picks confirm at the F1 maximum and tentative one
band (0.05) below, and writes eval/threshold_sweep.json with the full
curve — turning "we picked 0.8" into a measured, F1-justified number.

Without eval/gold.yaml — the judges haven't supplied a dataset yet, so
there's nothing to label against — this falls back to recording the
*prior* already in LINK_CONFIRM/LINK_TENTATIVE, with "method": "prior" in
the output. It never fabricates a measured-sounding number it didn't
actually compute (§09 P9 evaluation-honesty rule, applied a phase early:
report what's real, or say plainly that it isn't measured yet).

eval/gold.yaml schema (create this once a corpus + labels exist):
    pairs:
      - from_id: ev_...
        to_id: ev_...
        label: true   # true = should be a confirmed relationship

Usage:
    uv run python scripts/calibrate.py [--collection-id demo_architecture]
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from link.candidates import generate_all_candidates
from link.score import score_candidate
from omnitrace.config import get_settings
from omnitrace.db import close_client

EVAL_DIR = Path(__file__).resolve().parent.parent / "eval"
THRESHOLD_STEPS = [round(0.50 + 0.05 * i, 2) for i in range(10)]  # 0.50 .. 0.95


def _dump_candidates_csv(scored: list[tuple[dict[str, Any], Any, float]]) -> None:
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    path = EVAL_DIR / "candidates.csv"
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "from_id", "to_id", "type", "cross_file", "confidence",
            "temporal", "entity", "semantic", "parent", "extraction",
        ])
        for cand, signals, confidence in scored:
            writer.writerow([
                cand["from_id"], cand["to_id"], cand["type"], cand.get("cross_file", False),
                round(confidence, 4), signals.temporal, signals.entity, signals.semantic,
                signals.parent, signals.extraction,
            ])
    print(f"wrote {len(scored)} candidates to {path}")


def _load_gold() -> dict[tuple[str, str], bool] | None:
    gold_path = EVAL_DIR / "gold.yaml"
    if not gold_path.exists():
        return None
    import yaml

    data = yaml.safe_load(gold_path.read_text()) or {}
    return {(p["from_id"], p["to_id"]): bool(p["label"]) for p in data.get("pairs", [])}


def _sweep(scored: list[tuple[dict[str, Any], Any, float]], gold: dict[tuple[str, str], bool]) -> list[dict[str, Any]]:
    labelled = [
        (confidence, gold[(cand["from_id"], cand["to_id"])])
        for cand, _, confidence in scored
        if (cand["from_id"], cand["to_id"]) in gold
    ]
    curve = []
    for threshold in THRESHOLD_STEPS:
        tp = sum(1 for conf, label in labelled if conf >= threshold and label)
        fp = sum(1 for conf, label in labelled if conf >= threshold and not label)
        fn = sum(1 for conf, label in labelled if conf < threshold and label)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        curve.append({
            "threshold": threshold, "precision": precision, "recall": recall,
            "f1": f1, "labelled_pairs": len(labelled),
        })
    return curve


async def calibrate(collection_id: str) -> dict[str, Any]:
    _, scorable = await generate_all_candidates(collection_id)
    scored: list[tuple[dict[str, Any], Any, float]] = []
    for cand in scorable:
        signals, confidence = score_candidate(cand)
        scored.append((cand, signals, confidence))
    _dump_candidates_csv(scored)

    gold = _load_gold()
    settings = get_settings()

    if gold is None:
        result: dict[str, Any] = {
            "method": "prior",
            "note": "eval/gold.yaml not found — no hand-labelled pairs yet (dataset not supplied). "
                    "Using the existing LINK_CONFIRM/LINK_TENTATIVE prior, not a measured value.",
            "confirm": settings.link_confirm,
            "tentative": settings.link_tentative,
            "curve": [],
        }
    else:
        curve = _sweep(scored, gold)
        labelled_curve = [c for c in curve if c["labelled_pairs"] > 0]
        if not labelled_curve:
            result = {
                "method": "prior",
                "note": "eval/gold.yaml exists but none of its pairs matched a generated candidate — using the prior.",
                "confirm": settings.link_confirm,
                "tentative": settings.link_tentative,
                "curve": curve,
            }
        else:
            best = max(labelled_curve, key=lambda c: c["f1"])
            best_idx = THRESHOLD_STEPS.index(best["threshold"])
            tentative_idx = max(0, best_idx - 1)
            result = {
                "method": "measured",
                "confirm": best["threshold"],
                "tentative": THRESHOLD_STEPS[tentative_idx],
                "precision": best["precision"],
                "recall": best["recall"],
                "f1": best["f1"],
                "labelled_pairs": best["labelled_pairs"],
                "curve": curve,
            }

    out_path = EVAL_DIR / "threshold_sweep.json"
    out_path.write_text(json.dumps(result, indent=2))
    print(f"wrote {out_path}: method={result.get('method')} confirm={result.get('confirm')} tentative={result.get('tentative')}")
    return result


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection-id", default=None)
    args = parser.parse_args()
    collection_id = args.collection_id or get_settings().collection_id
    await calibrate(collection_id)
    await close_client()


if __name__ == "__main__":
    asyncio.run(main())
