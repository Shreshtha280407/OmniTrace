"""P1 acceptance tests — architecture doc §09.

Acceptance: upload any file, source reaches durable state with correct
probe metadata; re-upload of same bytes is idempotent; a corrupt file
fails at probe with the raw source still stored.

Requires MONGODB_URI to point at a real Atlas cluster — skips cleanly if
it isn't configured yet. Uses the live_server_url fixture + plain
synchronous PyMongo for verification/cleanup — see tests/conftest.py's
docstring for why an in-process ASGI transport + the app's async Motor
client isn't safe here once a video upload triggers P2/P3 extraction.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import httpx
import pytest
from pymongo import MongoClient

from omnitrace.assets import get_asset_store
from omnitrace.config import get_settings
from tests.conftest import make_test_video

pytestmark = pytest.mark.asyncio


def _mongo_configured() -> bool:
    uri = get_settings().mongodb_uri
    return bool(uri) and "localhost" not in uri


skip_unless_mongo = pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")


def _db():
    s = get_settings()
    return MongoClient(s.mongodb_uri)[s.mongodb_db]


def _cleanup(source_id: str) -> None:
    import shutil

    store = get_asset_store()
    # Remove both raw and derived assets — a video source (P1's own video
    # test included) now produces derived files too (extracted WAV, visual
    # state frames) once P2/P3 auto-trigger on upload, not just the raw
    # upload P1 originally had to worry about.
    for kind in ("raw", "derived"):
        d = store.root / kind / source_id
        if d.exists():
            shutil.rmtree(d)
    db = _db()
    db["sources"].delete_one({"_id": source_id})
    db["processing_runs"].delete_many({"source_id": source_id})
    db["evidence_items"].delete_many({"source_id": source_id})


def _make_pdf_bytes(pages: int) -> bytes:
    import fitz  # PyMuPDF

    doc = fitz.open()
    for _ in range(pages):
        doc.new_page()
    data = doc.tobytes()
    doc.close()
    return data


@skip_unless_mongo
async def test_pdf_upload_probes_correct_page_count(live_server_url):
    pdf_bytes = _make_pdf_bytes(pages=3)
    async with httpx.AsyncClient(base_url=live_server_url, timeout=60.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("test_doc.pdf", pdf_bytes, "application/pdf")})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        source_id = body["source_id"]
        assert body["job_id"] == source_id
        # "ready" once both probe and document (P4) succeed — see
        # REQUIRED_STAGES in pipeline/runner.py. These pages are blank (no
        # text, no images), so the document stage takes the scanned/OCR-
        # fallback path; that's fine here, it's still expected to complete.
        assert body["status"] == "ready", f"expected ready, got {body['status']!r}"

        source = (await client.get(f"/api/v1/sources/{source_id}")).json()
        assert source["page_count"] == 3
        assert source["status"] == "ready"
        assert source["media_type"] == "document"

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["probe"]["status"] == "ok"
        assert job["stages"]["document"]["status"] == "ok"

    _cleanup(source_id)


@skip_unless_mongo
async def test_reupload_same_bytes_is_idempotent(live_server_url):
    pdf_bytes = _make_pdf_bytes(pages=1)
    async with httpx.AsyncClient(base_url=live_server_url, timeout=60.0) as client:
        first = await client.post("/api/v1/sources", files={"file": ("dup.pdf", pdf_bytes, "application/pdf")})
        second = await client.post(
            "/api/v1/sources", files={"file": ("dup_renamed.pdf", pdf_bytes, "application/pdf")}
        )
        assert first.status_code == 201
        assert second.status_code == 201
        source_id = first.json()["source_id"]
        assert second.json()["source_id"] == source_id, "identical bytes must reuse the existing source"
        assert second.json()["checksum"] == first.json()["checksum"]

    count = _db()["sources"].count_documents({"sha256": first.json()["checksum"]})
    assert count == 1, "re-upload must not create a duplicate source"

    _cleanup(source_id)


@skip_unless_mongo
async def test_corrupt_file_fails_probe_but_keeps_raw_source(live_server_url):
    garbage = b"this is not a real video file, just garbage bytes" * 100
    async with httpx.AsyncClient(base_url=live_server_url, timeout=60.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("corrupt.mp4", garbage, "video/mp4")})
        assert resp.status_code == 201, "upload itself must succeed — only probe should fail"
        body = resp.json()
        source_id = body["source_id"]
        assert body["status"] == "failed"

        source = (await client.get(f"/api/v1/sources/{source_id}")).json()
        assert source["status"] == "failed"

        # Raw source must still be on disk — probe failure never deletes ground truth.
        store = get_asset_store()
        assert store.resolve(source["storage_path"]).exists()

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["probe"]["status"] == "failed"
        assert job["stages"]["probe"]["error"]

    _cleanup(source_id)


@skip_unless_mongo
async def test_video_upload_probes_duration(tmp_path, live_server_url):
    # Needs a real audio track: uploading a "video" source now auto-triggers
    # the P2 audio stage (§07: video's audio channel goes through the same
    # audio processor), which fails outright on a silent/no-audio-stream
    # file. This test's own concern is probe correctness, not the full
    # pipeline — but it exercises the real upload path, so the fixture must
    # be a file the rest of the pipeline can actually process.
    video_path = tmp_path / "clip.mp4"
    try:
        make_test_video("Short probe test clip.", "Probe test", video_path)
    except (subprocess.CalledProcessError, FileNotFoundError):
        pytest.skip("ffmpeg/espeak unavailable in this environment")
    video_bytes = video_path.read_bytes()

    async with httpx.AsyncClient(base_url=live_server_url, timeout=120.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("clip.mp4", video_bytes, "video/mp4")})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        source_id = body["source_id"]
        assert body["status"] != "failed", f"pipeline failed: {body}"

        source = (await client.get(f"/api/v1/sources/{source_id}")).json()
        assert source["duration_ms"] is not None
        assert source["duration_ms"] > 0

    _cleanup(source_id)


@skip_unless_mongo
async def test_unsupported_extension_rejected_before_storage(live_server_url):
    async with httpx.AsyncClient(base_url=live_server_url, timeout=30.0) as client:
        resp = await client.post(
            "/api/v1/sources", files={"file": ("payload.exe", b"MZ\x90\x00", "application/octet-stream")}
        )
        assert resp.status_code == 400
