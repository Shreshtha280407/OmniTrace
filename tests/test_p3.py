"""P3 acceptance tests — architecture doc §09.

Acceptance: OCR finds real tokens with boxes; near-duplicate images are not
silently merged when OCR differs (the state-merge unit tests below check
this directly, with no network dependency); a standalone image produces a
visual_state + OCR regions end to end.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import httpx
import pytest
from pymongo import MongoClient

from omnitrace.config import get_settings
from pipeline.visual import _State, _cap_state_count, _merge_into_states
from tests.conftest import make_test_video


def _ready() -> bool:
    s = get_settings()
    return bool(s.mongodb_uri) and "localhost" not in s.mongodb_uri and bool(s.groq_api_key)


skip_unless_ready = pytest.mark.skipif(not _ready(), reason="requires MONGODB_URI and GROQ_API_KEY")


def _db():
    # Plain synchronous PyMongo for verification/cleanup — see
    # tests/conftest.py's docstring for why the async `coll()` helper isn't
    # safe to reuse once the app runs in the live_server_url fixture's own
    # thread and event loop.
    s = get_settings()
    return MongoClient(s.mongodb_uri)[s.mongodb_db]


# cleanup_source (tests/conftest.py) also prunes entities the auto-
# triggered enrich stage creates from this source's evidence — see its
# docstring for why that matters beyond just evidence_items/assets.
from tests.conftest import cleanup_source as _cleanup  # noqa: E402


def _draw_text_image(text: str, path: Path, *, bg: str = "white") -> None:
    subprocess.run(
        [
            "ffmpeg", "-f", "lavfi", "-i", f"color=c={bg}:s=640x360:d=1",
            "-vf", f"drawtext=text='{text}':fontsize=28:fontcolor=black:x=(w-text_w)/2:y=(h-text_h)/2",
            "-frames:v", "1", "-update", "1", "-y", str(path),
        ],
        capture_output=True, timeout=30, check=True,
    )


# ── pure-function unit tests: no network, no DB ────────────────────────────


def test_ocr_veto_prevents_merging_visually_similar_but_textually_different_frames(tmp_path):
    """Two frames with an identical plain background but different visible
    text must NOT collapse into one visual state, even though a plain
    solid-color background can make their pHash distance small. This is the
    exact near-duplicate trap described in §08/§09: a changed label or
    arrow must survive as distinct evidence."""
    img1 = tmp_path / "a.png"
    img2 = tmp_path / "b.png"
    _draw_text_image("API -> Redis Cache -> PostgreSQL", img1)
    _draw_text_image("API -> Read Replica -> PostgreSQL", img2)

    states = _merge_into_states([(img1, 0.0), (img2, 5.0)])
    assert len(states) == 2, "textually different frames must not be merged into one state"


def test_identical_frames_do_merge():
    """Sanity check the other direction — the merge rule isn't just always
    splitting. Reuse one frame as two candidates at different timestamps."""
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        img = Path(d) / "same.png"
        _draw_text_image("Cache architecture proposal", img)
        states = _merge_into_states([(img, 0.0), (img, 3.0)])
    assert len(states) == 1, "identical frames should merge into a single state"
    assert states[0].end_s == 3.0


def test_cap_state_count_chunk_merges_down_to_the_cap():
    fake_states = [_State.__new__(_State) for _ in range(10)]
    for i, s in enumerate(fake_states):
        s.start_s = float(i)
        s.end_s = float(i)
    capped = _cap_state_count(fake_states, cap=3)
    assert len(capped) <= 3


# ── end-to-end: real Mongo + Groq ──────────────────────────────────────────


@pytest.mark.asyncio
@skip_unless_ready
async def test_standalone_image_produces_visual_state_and_ocr_regions(tmp_path, live_server_url):
    img_path = tmp_path / "diagram.png"
    _draw_text_image("API -> Redis Cache -> PostgreSQL", img_path)
    image_bytes = img_path.read_bytes()

    async with httpx.AsyncClient(base_url=live_server_url, timeout=120.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("architecture.png", image_bytes, "image/png")})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        source_id = body["source_id"]
        assert body["status"] == "ready", f"expected ready, got {body['status']!r}"

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["probe"]["status"] == "ok"
        assert job["stages"]["visual"]["status"] == "ok"

    db = _db()
    states = list(db["evidence_items"].find({"source_id": source_id, "evidence_type": "visual_state"}))
    ocr_regions = list(db["evidence_items"].find({"source_id": source_id, "evidence_type": "ocr_region"}))

    assert len(states) == 1, "a standalone image is exactly one visual state"
    assert states[0]["modality"] == "image"
    assert states[0]["location"]["timeline_id"] is None, "images are never assigned a fake timeline"

    assert len(ocr_regions) >= 1, "OCR must find the literal on-screen text"
    ocr_text = " ".join(r["content"] for r in ocr_regions)
    assert "Redis" in ocr_text or "redis" in ocr_text.lower()
    for region in ocr_regions:
        box = region["location"]["bbox_norm"]
        assert box is not None
        assert 0.0 <= box["x1"] < box["x2"] <= 1.0
        assert 0.0 <= box["y1"] < box["y2"] <= 1.0
        assert region["parent_evidence_id"] == states[0]["_id"]

    _cleanup(source_id)


@pytest.mark.asyncio
@skip_unless_ready
async def test_video_audio_and_visual_evidence_share_one_timeline(tmp_path, live_server_url):
    """§06: 'A video-derived frame, OCR region, and utterance share the
    parent's timeline_id but keep distinct evidence IDs.' A video upload
    now triggers both P2 (audio) and P3 (visual) automatically — this is
    the integration point where that claim is either true or isn't."""
    video_path = tmp_path / "meeting.mp4"
    make_test_video("We propose a Redis cache for the database.", "API -> Redis Cache -> Database", video_path)
    video_bytes = video_path.read_bytes()

    async with httpx.AsyncClient(base_url=live_server_url, timeout=120.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("meeting.mp4", video_bytes, "video/mp4")})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        source_id = body["source_id"]
        assert body["status"] == "ready", f"expected ready, got {body['status']!r}: check job stages"

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["probe"]["status"] == "ok"
        assert job["stages"]["audio"]["status"] == "ok"
        assert job["stages"]["visual"]["status"] == "ok"

    db = _db()
    source = db["sources"].find_one({"_id": source_id})
    assert source["timeline_id"] is not None

    utterances = list(db["evidence_items"].find({"source_id": source_id, "evidence_type": "utterance"}))
    states = list(db["evidence_items"].find({"source_id": source_id, "evidence_type": "visual_state"}))
    assert len(utterances) >= 1, "audio route must have produced at least one utterance"
    assert len(states) >= 1, "visual route must have produced at least one visual state"

    all_timed_evidence = utterances + states
    timeline_ids = {e["location"]["timeline_id"] for e in all_timed_evidence}
    assert timeline_ids == {source["timeline_id"]}, (
        "every utterance and visual state from one video must share exactly the source's timeline_id"
    )
    # ...and every one of them keeps its own distinct evidence ID.
    assert len({e["_id"] for e in all_timed_evidence}) == len(all_timed_evidence)

    _cleanup(source_id)
