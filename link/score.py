"""Relationship scoring — architecture doc §07/§09 P6.

R = 0.40·temporal_alignment + 0.25·entity_overlap + 0.20·semantic_similarity
    + 0.10·parent_source_strength + 0.05·extraction_quality

Cross-file candidates have no meaningful temporal signal (different
timelines share no clock) — temporal weight drops to 0 and the remaining
four renormalise to sum to 1, exactly as §07 specifies. These weights are
*priors*, not derived constants (§07 correction H5) — scripts/calibrate.py
sweeps LINK_CONFIRM against hand-labelled pairs once real data exists;
until then the README must say "prior", not "measured".
"""

from __future__ import annotations

from typing import Any

import numpy as np

from omnitrace.config import get_settings
from omnitrace.models import RelationshipSignals

WEIGHTS_SAME_FILE = {"temporal": 0.40, "entity": 0.25, "semantic": 0.20, "parent": 0.10, "extraction": 0.05}
_CROSS_FILE_BASE = {k: v for k, v in WEIGHTS_SAME_FILE.items() if k != "temporal"}
_CROSS_FILE_SUM = sum(_CROSS_FILE_BASE.values())
WEIGHTS_CROSS_FILE = {**{k: v / _CROSS_FILE_SUM for k, v in _CROSS_FILE_BASE.items()}, "temporal": 0.0}


def _temporal_alignment(overlap_ms: int | None, a_loc: dict[str, Any], b_loc: dict[str, Any]) -> float:
    """Normalised by the *shorter* interval so containment (a speech
    segment wholly inside a stable visual state) scores higher than a
    brief accidental overlap at an edge (§07)."""
    if not overlap_ms or overlap_ms <= 0:
        return 0.0
    a_dur = (a_loc.get("end_ms") or 0) - (a_loc.get("start_ms") or 0)
    b_dur = (b_loc.get("end_ms") or 0) - (b_loc.get("start_ms") or 0)
    positive_durations = [d for d in (a_dur, b_dur) if d > 0]
    if not positive_durations:
        return 0.0
    shorter = min(positive_durations)
    return max(0.0, min(1.0, overlap_ms / shorter))


def _entity_overlap(a_entities: list[str] | None, b_entities: list[str] | None) -> float:
    a, b = set(a_entities or []), set(b_entities or [])
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _semantic_similarity(a_embeddings: dict[str, Any] | None, b_embeddings: dict[str, Any] | None) -> float:
    """Cosine similarity between text embeddings. Degrades to 0 (not an
    error) when either side hasn't been embedded yet — e.g. no
    VOYAGE_API_KEY configured — matching enrich/embed.py's own
    graceful-degradation posture."""
    a_vec = ((a_embeddings or {}).get("text") or {}).get("vector")
    b_vec = ((b_embeddings or {}).get("text") or {}).get("vector")
    if not a_vec or not b_vec:
        return 0.0
    a = np.array(a_vec, dtype=np.float32)
    b = np.array(b_vec, dtype=np.float32)
    denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9
    return float(max(0.0, min(1.0, np.dot(a, b) / denom)))


def _extraction_quality(a_confidence: dict[str, Any] | None, b_confidence: dict[str, Any] | None) -> float:
    values = []
    for c in (a_confidence, b_confidence):
        v = (c or {}).get("extraction")
        values.append(v if v is not None else 1.0)
    return sum(values) / len(values)


def score_candidate(candidate: dict[str, Any]) -> tuple[RelationshipSignals, float]:
    """candidate carries the two evidence docs under "a"/"b" (light
    projections from link/candidates.py) plus cross_file/overlap_ms.
    Returns (signals, weighted confidence in [0, 1])."""
    a, b = candidate["a"], candidate["b"]
    cross_file = bool(candidate.get("cross_file", False))
    weights = WEIGHTS_CROSS_FILE if cross_file else WEIGHTS_SAME_FILE

    temporal = 0.0 if cross_file else _temporal_alignment(candidate.get("overlap_ms"), a.get("location") or {}, b.get("location") or {})
    entity = _entity_overlap(a.get("entity_ids"), b.get("entity_ids"))
    semantic = _semantic_similarity(a.get("embeddings"), b.get("embeddings"))
    parent = 0.5 if cross_file else 1.0
    extraction = _extraction_quality(a.get("confidence"), b.get("confidence"))

    signals = RelationshipSignals(temporal=temporal, entity=entity, semantic=semantic, parent=parent, extraction=extraction)
    confidence = (
        weights["temporal"] * temporal
        + weights["entity"] * entity
        + weights["semantic"] * semantic
        + weights["parent"] * parent
        + weights["extraction"] * extraction
    )
    return signals, confidence


def classify(confidence: float) -> str:
    settings = get_settings()
    if confidence >= settings.link_confirm:
        return "confirmed"
    if confidence >= settings.link_tentative:
        return "tentative"
    return "rejected"
