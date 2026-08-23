"""P2 acceptance tests — architecture doc §09.

Acceptance: utterance count and timings roughly match a known script;
semantic segments resolve to real member observations.

Requires MONGODB_URI (real Atlas cluster) and GROQ_API_KEY — skips cleanly
if either is unset. Verification/cleanup use plain synchronous PyMongo
rather than the app's async Motor client — see tests/conftest.py's
docstring for why: the app runs in a real server thread with its own event
loop, and Motor's client is bound to whichever loop first used it, so
reusing the async `coll()` helper from the test's own event loop would hit
the same cross-loop failure the live-server fixture exists to avoid.
Synchronous PyMongo has no event-loop affinity at all.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import httpx
import pytest
from pymongo import MongoClient

from omnitrace.assets import get_asset_store
from omnitrace.config import get_settings

pytestmark = pytest.mark.asyncio


def _ready() -> bool:
    s = get_settings()
    return bool(s.mongodb_uri) and "localhost" not in s.mongodb_uri and bool(s.groq_api_key)


skip_unless_ready = pytest.mark.skipif(not _ready(), reason="requires MONGODB_URI and GROQ_API_KEY")


def _db():
    s = get_settings()
    return MongoClient(s.mongodb_uri)[s.mongodb_db]


def _cleanup(source_id: str) -> None:
    store = get_asset_store()
    for kind in ("raw", "derived"):
        d = store.root / kind / source_id
        if d.exists():
            shutil.rmtree(d)
    db = _db()
    db["sources"].delete_one({"_id": source_id})
    db["processing_runs"].delete_many({"source_id": source_id})
    db["evidence_items"].delete_many({"source_id": source_id})


def _make_speech_wav(text: str, path: Path) -> None:
    subprocess.run(["espeak", text, "-w", str(path)], capture_output=True, timeout=30, check=True)


@skip_unless_ready
async def test_standalone_audio_produces_utterances_and_segments(tmp_path, live_server_url):
    wav_path = tmp_path / "speech.wav"
    _make_speech_wav(
        "We propose a Redis cache between the API and the database. "
        "This should reduce load significantly. "
        "One trade off is cache invalidation complexity.",
        wav_path,
    )
    audio_bytes = wav_path.read_bytes()

    async with httpx.AsyncClient(base_url=live_server_url, timeout=120.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("meeting_audio.wav", audio_bytes, "audio/wav")})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        source_id = body["source_id"]
        assert body["status"] == "ready", f"expected ready, got {body['status']!r}"

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["probe"]["status"] == "ok"
        assert job["stages"]["audio"]["status"] == "ok"

    db = _db()
    utterances = list(
        db["evidence_items"].find(
            {"source_id": source_id, "node_type": "atomic_observation", "evidence_type": "utterance"}
        )
    )
    segments = list(db["evidence_items"].find({"source_id": source_id, "node_type": "semantic_segment"}))

    assert len(utterances) >= 1
    assert len(segments) >= 1
    for u in utterances:
        assert u["location"]["timeline_id"] is not None
        assert u["location"]["start_ms"] is not None
        assert u["speaker_id"] == "spk_01"
        assert u["confidence"]["extraction"] is not None

    utterance_ids = {u["_id"] for u in utterances}
    for seg in segments:
        assert seg["member_evidence_ids"], "segment has no members"
        assert set(seg["member_evidence_ids"]).issubset(utterance_ids)
        assert seg["speaker_id"] == "spk_01"

    # Rough sanity check, not an exact transcript match — TTS pronunciation
    # can shift a word or two.
    all_text = " ".join(u["content"] for u in utterances).lower()
    assert "cache" in all_text
    assert "database" in all_text or "data base" in all_text

    _cleanup(source_id)


@skip_unless_ready
async def test_reupload_audio_is_idempotent(tmp_path, live_server_url):
    wav_path = tmp_path / "dup.wav"
    _make_speech_wav("Short duplicate test clip for idempotency.", wav_path)
    audio_bytes = wav_path.read_bytes()

    async with httpx.AsyncClient(base_url=live_server_url, timeout=120.0) as client:
        first = await client.post("/api/v1/sources", files={"file": ("dup1.wav", audio_bytes, "audio/wav")})
        second = await client.post("/api/v1/sources", files={"file": ("dup2.wav", audio_bytes, "audio/wav")})
        assert first.status_code == 201 and second.status_code == 201
        source_id = first.json()["source_id"]
        assert second.json()["source_id"] == source_id, "identical bytes must reuse the existing source"

    db = _db()
    count = db["evidence_items"].count_documents({"source_id": source_id, "evidence_type": "utterance"})
    assert count >= 1

    # Re-processing must not have duplicated evidence — one insert's worth only.
    run_count = db["processing_runs"].count_documents({"source_id": source_id, "stage": "audio"})
    assert run_count == 1

    _cleanup(source_id)
