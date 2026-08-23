"""Naive text-only RAG baseline — architecture doc §09 P9.

Fairness is the point: this baseline sees only the same raw ASR text, OCR
text, and native document text every OmniTrace source already extracts
(pipeline/audio.py's `utterance`, pipeline/visual.py's `ocr_region`, and
pipeline/document.py's `document_block` evidence) — never any of the
derived structure the full system builds on top of that (visual-state
summaries, diagram facts, semantic segments, cross-modal edges, events).
Fixed 500-word chunks with 50-word overlap (word count stands in for
"token" here — no tokenizer dependency is worth adding for a deliberately
dumb baseline), single text-vector similarity search, top-K, done. No
states, no edges, no events, no expansion — exactly the §09 P9 spec.

Chunks are built in memory per eval run, never persisted — this baseline
is a comparison harness, not a second production index to keep in sync.

Degrades the same way every other Voyage-backed path in this codebase does
(enrich/embed.py, retrieval/channels.py): no VOYAGE_API_KEY -> returns no
results with a warning, never raises.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from enrich.embed import get_embedding_provider
from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS, coll

CHUNK_WORDS = 500
OVERLAP_WORDS = 50

# The raw-text evidence_types this baseline is allowed to see — the literal
# ASR/OCR/document-text tier, never anything the full system's own
# processing added on top (visual_state summaries, diagram_fact,
# document_section, speech_segment, table).
RAW_TEXT_EVIDENCE_TYPES = {"utterance", "ocr_region", "document_block"}


def chunk_words(text: str, *, size: int = CHUNK_WORDS, overlap: int = OVERLAP_WORDS) -> list[str]:
    words = text.split()
    if not words:
        return []
    step = max(1, size - overlap)
    chunks: list[str] = []
    for start in range(0, len(words), step):
        chunk = words[start : start + size]
        if not chunk:
            break
        chunks.append(" ".join(chunk))
        if start + size >= len(words):
            break
    return chunks


async def raw_text_chunks(collection_id: str) -> list[dict[str, Any]]:
    """One evidence stream per source_id, in Mongo's natural (insertion)
    order — good enough for a baseline that explicitly doesn't model
    document/timeline structure — concatenated then chunked. Concatenating
    per-source keeps a chunk from splicing together unrelated sources,
    without claiming any smarter boundary than that."""
    items = await coll(EVIDENCE_ITEMS).find(
        {"collection_id": collection_id, "evidence_type": {"$in": list(RAW_TEXT_EVIDENCE_TYPES)}},
        {"content": 1, "source_id": 1},
    ).to_list(length=None)

    by_source: dict[str, list[str]] = {}
    for it in items:
        if it.get("content"):
            by_source.setdefault(it["source_id"], []).append(it["content"])

    chunks: list[dict[str, Any]] = []
    for source_id, texts in by_source.items():
        full_text = " ".join(texts)
        for i, chunk_text in enumerate(chunk_words(full_text)):
            chunks.append({"chunk_id": f"{source_id}_chunk{i}", "source_id": source_id, "text": chunk_text})
    return chunks


async def baseline_query(question: str, *, collection_id: str, top_k: int = 5) -> tuple[list[dict[str, Any]], list[str]]:
    """Returns (ranked_chunks, warnings). Each ranked chunk carries
    chunk_id/source_id/text/score. warnings mirrors the rest of this
    codebase's graceful-degradation contract — this never raises."""
    settings = get_settings()
    if not settings.voyage_api_key:
        return [], ["VOYAGE_API_KEY not set — baseline cannot embed, returning no results"]

    chunks = await raw_text_chunks(collection_id)
    if not chunks:
        return [], ["no raw-text evidence in this collection yet"]

    provider = get_embedding_provider()
    try:
        query_vec = np.array(provider.embed_query_text([question])[0], dtype=np.float32)
        chunk_vecs = np.array(provider.embed_text([c["text"] for c in chunks]), dtype=np.float32)
    except Exception as e:  # noqa: BLE001 — same degrade-not-raise contract as enrich/embed.py
        return [], [f"embedding call failed: {e}"]

    chunk_norm = chunk_vecs / (np.linalg.norm(chunk_vecs, axis=1, keepdims=True) + 1e-9)
    query_norm = query_vec / (np.linalg.norm(query_vec) + 1e-9)
    scores = chunk_norm @ query_norm

    order = np.argsort(-scores)[:top_k]
    results = []
    for idx in order:
        c = dict(chunks[int(idx)])
        c["score"] = float(scores[idx])
        results.append(c)
    return results, []
