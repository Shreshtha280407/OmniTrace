"""P1 acceptance tests — architecture doc §09.

Acceptance: upload any file, source reaches durable state with correct
probe metadata; re-upload of same bytes is idempotent; a corrupt file
fails at probe with the raw source still stored.

Requires MONGODB_URI to point at a real Atlas cluster (same guard as
tests/test_p0.py) — skips cleanly if it isn't configured yet.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import httpx
import pytest

from omnitrace.assets import get_asset_store
from omnitrace.config import get_settings
from omnitrace.db import PROCESSING_RUNS, SOURCES, close_client, coll

pytestmark = pytest.mark.asyncio


def _mongo_configured() -> bool:
    uri = get_settings().mongodb_uri
    return bool(uri) and "localhost" not in uri


async def _cleanup(source_id: str) -> None:
    doc = await coll(SOURCES).find_one({"_id": source_id})
    if doc:
        store = get_asset_store()
        try:
            resolved = store.resolve(doc["storage_path"])
            resolved.unlink(missing_ok=True)
            # storage layout is {root}/raw/{source_id}/{filename} — remove the
            # now-empty per-source directory too, not just the file in it.
            if resolved.parent.exists() and not any(resolved.parent.iterdir()):
                resolved.parent.rmdir()
        except ValueError:
            pass
    await coll(SOURCES).delete_one({"_id": source_id})
    await coll(PROCESSING_RUNS).delete_many({"source_id": source_id})


def _make_pdf_bytes(pages: int) -> bytes:
    import fitz  # PyMuPDF

    doc = fitz.open()
    for _ in range(pages):
        doc.new_page()
    data = doc.tobytes()
    doc.close()
    return data


def _make_tiny_video_bytes() -> bytes:
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "test.mp4"
        subprocess.run(
            [
                "ffmpeg", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=5",
                "-pix_fmt", "yuv420p", "-y", str(out),
            ],
            capture_output=True, timeout=30, check=True,
        )
        return out.read_bytes()


@pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
async def test_pdf_upload_probes_correct_page_count():
    from api.main import app

    pdf_bytes = _make_pdf_bytes(pages=3)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/v1/sources", files={"file": ("test_doc.pdf", pdf_bytes, "application/pdf")})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        source_id = body["source_id"]
        assert body["job_id"] == source_id
        assert body["status"] == "probed"

        source = (await client.get(f"/api/v1/sources/{source_id}")).json()
        assert source["page_count"] == 3
        assert source["status"] == "probed"
        assert source["media_type"] == "document"

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["probe"]["status"] == "ok"

    await _cleanup(source_id)
    await close_client()


@pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
async def test_reupload_same_bytes_is_idempotent():
    from api.main import app

    pdf_bytes = _make_pdf_bytes(pages=1)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        first = await client.post("/api/v1/sources", files={"file": ("dup.pdf", pdf_bytes, "application/pdf")})
        second = await client.post(
            "/api/v1/sources", files={"file": ("dup_renamed.pdf", pdf_bytes, "application/pdf")}
        )
        assert first.status_code == 201
        assert second.status_code == 201
        source_id = first.json()["source_id"]
        assert second.json()["source_id"] == source_id, "identical bytes must reuse the existing source"
        assert second.json()["checksum"] == first.json()["checksum"]

        count = await coll(SOURCES).count_documents({"sha256": first.json()["checksum"]})
        assert count == 1, "re-upload must not create a duplicate source"

    await _cleanup(source_id)
    await close_client()


@pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
async def test_corrupt_file_fails_probe_but_keeps_raw_source():
    from api.main import app

    garbage = b"this is not a real video file, just garbage bytes" * 100
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
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

    await _cleanup(source_id)
    await close_client()


@pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
async def test_video_upload_probes_duration():
    from api.main import app

    try:
        video_bytes = _make_tiny_video_bytes()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pytest.skip("ffmpeg lavfi source unavailable in this environment")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/v1/sources", files={"file": ("clip.mp4", video_bytes, "video/mp4")})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        source_id = body["source_id"]
        assert body["status"] == "probed"

        source = (await client.get(f"/api/v1/sources/{source_id}")).json()
        assert source["duration_ms"] is not None
        assert 500 <= source["duration_ms"] <= 3000  # ~1s requested, allow encoder slack

    await _cleanup(source_id)
    await close_client()


@pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")
async def test_unsupported_extension_rejected_before_storage():
    from api.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/sources", files={"file": ("payload.exe", b"MZ\x90\x00", "application/octet-stream")}
        )
        assert resp.status_code == 400

    await close_client()
