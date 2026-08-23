"""P5 acceptance tests — architecture doc §09.

Acceptance: everything becomes findable through the three retrieval
channels. This file splits that into what P5 itself builds and can prove
without live model credentials (entity resolution is deterministic, and
the vector-search *mechanism* is provider-agnostic — seeding synthetic
vectors proves NumpyVectorIndex's cosine ranking is correct without
spending a Voyage call) versus what genuinely needs Voyage configured
(real embeddings actually landing on evidence_items after upload).

Requires MONGODB_URI for every test here; the embedding-specific tests
additionally require VOYAGE_API_KEY and skip cleanly without it.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import httpx
import numpy as np
import pytest
from pymongo import MongoClient

from omnitrace.config import get_settings
from omnitrace.ids import new_id
from retrieval.vector_index import NumpyVectorIndex
from tests.conftest import run_on_server_loop

pytestmark = pytest.mark.asyncio


def _mongo_configured() -> bool:
    uri = get_settings().mongodb_uri
    return bool(uri) and "localhost" not in uri


def _embeddings_ready() -> bool:
    return _mongo_configured() and bool(get_settings().voyage_api_key)


skip_unless_mongo = pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
skip_unless_embeddings = pytest.mark.skipif(not _embeddings_ready(), reason="requires MONGODB_URI and VOYAGE_API_KEY")


def _db():
    s = get_settings()
    return MongoClient(s.mongodb_uri)[s.mongodb_db]


# cleanup_source (tests/conftest.py) also prunes entities the enrich stage
# creates from this source's evidence — critical here specifically, since
# this file's whole point is exercising entity resolution.
from tests.conftest import cleanup_source as _cleanup  # noqa: E402


def _draw_text_image(text: str, path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-f", "lavfi", "-i", "color=c=white:s=640x360:d=1",
            "-vf", f"drawtext=text='{text}':fontsize=28:fontcolor=black:x=(w-text_w)/2:y=(h-text_h)/2",
            "-frames:v", "1", "-update", "1", "-y", str(path),
        ],
        capture_output=True, timeout=30, check=True,
    )


def _make_pdf_bytes(pages_text: list[str]) -> bytes:
    import fitz  # PyMuPDF

    doc = fitz.open()
    for text in pages_text:
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 500, 700), text, fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


# ── pure mechanism test: no model credentials needed ───────────────────────


@skip_unless_mongo
async def test_numpy_vector_index_ranks_by_cosine_similarity(server_loop):
    """Seed three evidence_items with synthetic 8-dim vectors (small dim is
    fine — the query loop never assumes 1024) at known angles from a query
    vector, and confirm NumpyVectorIndex returns them in similarity order.
    This is the acceptance bullet "flipping to NumPy backend returns the
    same top-3" tested at the mechanism level, independent of which
    embedding provider produced the vectors."""
    source_id = new_id("source")
    db = _db()
    query = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

    def _vec_at_angle(similarity: float) -> list[float]:
        # A unit vector at exactly `similarity` cosine similarity to
        # `query` — dot product with [1,0,...,0] is just its first
        # component, so a unit vector with first component `s` has cosine
        # similarity exactly `s` to the query.
        s = max(0.0, min(1.0, similarity))
        rest = (1 - s * s) ** 0.5
        return [s, rest, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

    docs = [
        {"_id": "ev_close", "similarity": 0.95},
        {"_id": "ev_mid", "similarity": 0.5},
        {"_id": "ev_far", "similarity": 0.05},
    ]
    for d in docs:
        db["evidence_items"].insert_one({
            "_id": d["_id"], "source_id": source_id, "collection_id": "test",
            "content": d["_id"], "modality": "speech", "node_type": "semantic_segment",
            "evidence_type": "speech_segment", "location": {}, "member_evidence_ids": [],
            "entity_ids": [], "confidence": {}, "provenance": {"processing_run_id": "run_x", "producer": "test"},
            "embeddings": {"text": {"model": "test", "version": "", "dim": 8, "vector": _vec_at_angle(d["similarity"])}},
        })

    try:
        index = NumpyVectorIndex()
        results = await run_on_server_loop(
            server_loop, index.query(query, path="embeddings.text.vector", top_k=3)
        )
        ranked_ids = [r["_id"] for r in results]
        assert ranked_ids == ["ev_close", "ev_mid", "ev_far"], f"expected similarity-descending order, got {ranked_ids}"
        assert results[0]["score"] > results[1]["score"] > results[2]["score"]
    finally:
        db["evidence_items"].delete_many({"source_id": source_id})


@skip_unless_mongo
async def test_entity_extraction_resolves_identical_mentions_across_sources(live_server_url):
    """Two different sources both mentioning 'PostgreSQL' by exact spelling
    must resolve to the same Entity record — entities.normalized_key is a
    collection-wide (not per-source) unique index, and this is the "entity
    overlap is a linking signal" claim from §02 at its simplest: same
    spelling, same entity, across files."""
    pdf_a = _make_pdf_bytes(["The team chose PostgreSQL for the primary datastore."])
    pdf_b = _make_pdf_bytes(["Backups for PostgreSQL run nightly at 2am."])

    async with httpx.AsyncClient(base_url=live_server_url, timeout=60.0) as client:
        resp_a = await client.post("/api/v1/sources", files={"file": ("doc_a.pdf", pdf_a, "application/pdf")})
        resp_b = await client.post("/api/v1/sources", files={"file": ("doc_b.pdf", pdf_b, "application/pdf")})
        assert resp_a.status_code == 201 and resp_b.status_code == 201
        source_a, source_b = resp_a.json()["source_id"], resp_b.json()["source_id"]

        job_a = (await client.get(f"/api/v1/jobs/{source_a}")).json()
        assert job_a["stages"]["enrich"]["status"] == "ok"

    db = _db()
    item_a = db["evidence_items"].find_one({"source_id": source_a, "content": {"$regex": "PostgreSQL"}})
    item_b = db["evidence_items"].find_one({"source_id": source_b, "content": {"$regex": "PostgreSQL"}})
    assert item_a is not None and item_b is not None
    assert item_a["entity_ids"], "entity extraction must have tagged the PostgreSQL mention"
    assert set(item_a["entity_ids"]) & set(item_b["entity_ids"]), (
        "the same exact-spelled mention in two different sources must resolve to a shared entity"
    )

    entity = db["entities"].find_one({"_id": (set(item_a["entity_ids"]) & set(item_b["entity_ids"])).pop()})
    assert source_a is not None
    assert len(entity["evidence_mentions"]) >= 2

    _cleanup(source_a)
    _cleanup(source_b)


# ── requires VOYAGE_API_KEY ─────────────────────────────────────────────────


@skip_unless_embeddings
async def test_visual_state_gets_multimodal_and_text_embeddings(tmp_path, live_server_url):
    img_path = tmp_path / "diagram.png"
    _draw_text_image("API -> Redis Cache -> PostgreSQL", img_path)
    image_bytes = img_path.read_bytes()

    async with httpx.AsyncClient(base_url=live_server_url, timeout=120.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("architecture.png", image_bytes, "image/png")})
        assert resp.status_code == 201, resp.text
        source_id = resp.json()["source_id"]

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["enrich"]["status"] == "ok", job["stages"].get("enrich")

    db = _db()
    state = db["evidence_items"].find_one({"source_id": source_id, "evidence_type": "visual_state"})
    assert state is not None

    mm = state["embeddings"]["multimodal"]
    assert mm is not None and mm["model"] == get_settings().embed_mm
    assert len(mm["vector"]) == mm["dim"] > 0

    text = state["embeddings"]["text"]
    assert text is not None and text["model"] == get_settings().embed_text
    assert len(text["vector"]) == text["dim"] > 0

    _cleanup(source_id)


@skip_unless_embeddings
async def test_text_vector_search_finds_relevant_speech_segment(tmp_path, live_server_url):
    wav_path = tmp_path / "speech.wav"
    subprocess.run(
        ["espeak", "We propose a Redis cache between the API and the database to cut load.",
         "-w", str(wav_path)], capture_output=True, timeout=30, check=True,
    )
    audio_bytes = wav_path.read_bytes()

    async with httpx.AsyncClient(base_url=live_server_url, timeout=120.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("meeting.wav", audio_bytes, "audio/wav")})
        assert resp.status_code == 201, resp.text
        source_id = resp.json()["source_id"]

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["enrich"]["status"] == "ok", job["stages"].get("enrich")

    from enrich.embed import get_embedding_provider

    provider = get_embedding_provider()
    query_vector = provider.embed_text(["how did they reduce load on the database"])[0]

    index = NumpyVectorIndex()
    results = await index.query(
        query_vector, path="embeddings.text.vector", top_k=5, node_type="semantic_segment", collection_id=get_settings().collection_id,
    )
    assert any(r["source_id"] == source_id for r in results), "the relevant speech segment must be in the top 5"

    _cleanup(source_id)
