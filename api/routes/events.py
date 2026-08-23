"""Event read endpoint — architecture doc §12 API surface, P6.

GET /api/v1/events/{id} — a semantic_events record as-is (built by
link/events.py, populated by scripts/link.py's corpus-wide pass).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from omnitrace.db import SEMANTIC_EVENTS, coll
from omnitrace.models import SemanticEvent

router = APIRouter()


@router.get("/events/{event_id}")
async def get_event(event_id: str) -> dict:
    doc = await coll(SEMANTIC_EVENTS).find_one({"_id": event_id})
    if doc is None:
        raise HTTPException(404, "event not found")
    return SemanticEvent.model_validate(doc).model_dump(by_alias=True, mode="json")
