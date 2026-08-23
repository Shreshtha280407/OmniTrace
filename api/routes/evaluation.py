"""Evaluation endpoint — architecture doc §12 API surface (frozen), P9.

POST /api/v1/evaluations/run triggers the same eval/run.py harness the CLI
runs, synchronously in-request — consistent with this build's "no queue"
decision (§02): every long-running pass in this codebase (ingestion, the
P6 linker) runs to completion inside the request that triggered it rather
than being handed off to a background worker.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from eval.run import run_eval
from omnitrace.config import get_settings

router = APIRouter()


class EvaluationRunRequest(BaseModel):
    collection_id: str | None = None
    with_generation: bool = False


@router.post("/evaluations/run")
async def run_evaluations(req: EvaluationRunRequest) -> dict[str, Any]:
    settings = get_settings()
    collection_id = req.collection_id or settings.collection_id
    result = await run_eval(collection_id, gold_path=Path("eval/gold.yaml"), with_generation=req.with_generation)
    return result
