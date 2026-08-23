"""P4 acceptance tests — architecture doc §09.

Acceptance: a native-text page's paragraph block is retrievable with
correct page + bounding box, grouped into a semantic section; a text-sparse
(scanned/image-only) page routes through the shared visual processor's OCR
fallback and its literal text is still findable. Documents never receive a
timeline_id regardless of which path produced the page.

Requires MONGODB_URI (real Atlas cluster) — skips cleanly if unset, same as
test_p1.py. The OCR-fallback path degrades gracefully without GROQ_API_KEY
(process_single_image catches LLMError internally — see pipeline/visual.py),
so this file doesn't gate on it the way test_p2/test_p3 do.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import httpx
import pytest
from pymongo import MongoClient

from omnitrace.assets import get_asset_store
from omnitrace.config import get_settings

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
    for kind in ("raw", "derived"):
        d = store.root / kind / source_id
        if d.exists():
            shutil.rmtree(d)
    db = _db()
    db["sources"].delete_one({"_id": source_id})
    db["processing_runs"].delete_many({"source_id": source_id})
    db["evidence_items"].delete_many({"source_id": source_id})


def _make_text_pdf_bytes(pages_text: list[str]) -> bytes:
    import fitz  # PyMuPDF

    doc = fitz.open()
    for text in pages_text:
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 500, 700), text, fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


def _draw_text_image(text: str, path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-f", "lavfi", "-i", "color=c=white:s=640x360:d=1",
            "-vf", f"drawtext=text='{text}':fontsize=28:fontcolor=black:x=(w-text_w)/2:y=(h-text_h)/2",
            "-frames:v", "1", "-update", "1", "-y", str(path),
        ],
        capture_output=True, timeout=30, check=True,
    )


def _make_scanned_pdf_bytes(image_path: Path) -> bytes:
    import fitz  # PyMuPDF

    doc = fitz.open()
    page = doc.new_page()
    page.insert_image(fitz.Rect(50, 50, 590, 350), filename=str(image_path))
    data = doc.tobytes()
    doc.close()
    return data


@skip_unless_mongo
async def test_native_text_page_produces_located_block_and_section(live_server_url):
    pages = [
        "Page one is filler content, not the page under test.",
        "The team evaluated a Redis cache-aside layer between the API and PostgreSQL "
        "to reduce database load. The main trade-off recorded was cache invalidation "
        "complexity when the underlying data changes frequently.",
        "Page three is more filler content, also not under test.",
    ]
    pdf_bytes = _make_text_pdf_bytes(pages)

    async with httpx.AsyncClient(base_url=live_server_url, timeout=60.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("design_doc.pdf", pdf_bytes, "application/pdf")})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        source_id = body["source_id"]
        assert body["status"] == "ready", f"expected ready, got {body['status']!r}"

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["probe"]["status"] == "ok"
        assert job["stages"]["document"]["status"] == "ok"

    db = _db()
    blocks = list(db["evidence_items"].find({"source_id": source_id, "evidence_type": "document_block"}))
    sections = list(db["evidence_items"].find({"source_id": source_id, "evidence_type": "document_section"}))

    assert blocks, "native-text pages must produce document_block evidence"
    target = next((b for b in blocks if "cache-aside" in b["content"]), None)
    assert target is not None, "the cache-aside paragraph must be retrievable as its own block"
    assert target["location"]["page"] == 2, "the paragraph is on the second page (1-indexed)"
    assert target["location"]["timeline_id"] is None, "documents never get a fake timeline"
    box = target["location"]["bbox_norm"]
    assert box is not None and 0.0 <= box["x1"] < box["x2"] <= 1.0
    assert 0.0 <= box["y1"] < box["y2"] <= 1.0

    assert sections, "blocks must be grouped into at least one semantic section"
    owning_section = next((s for s in sections if target["_id"] in s["member_evidence_ids"]), None)
    assert owning_section is not None, "the cache-aside block must belong to a section"
    assert owning_section["location"]["page"] == 2

    _cleanup(source_id)


@skip_unless_mongo
async def test_scanned_page_routes_through_ocr_fallback(tmp_path, live_server_url):
    img_path = tmp_path / "scanned_source.png"
    _draw_text_image("Invalidation TTL constraint noted", img_path)
    pdf_bytes = _make_scanned_pdf_bytes(img_path)

    async with httpx.AsyncClient(base_url=live_server_url, timeout=120.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("scanned.pdf", pdf_bytes, "application/pdf")})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        source_id = body["source_id"]
        assert body["status"] == "ready", f"expected ready, got {body['status']!r}"

        job = (await client.get(f"/api/v1/jobs/{source_id}")).json()
        assert job["stages"]["document"]["status"] == "ok"
        metrics = job["stages"]["document"].get("metrics", {})

    db = _db()
    states = list(db["evidence_items"].find({"source_id": source_id, "evidence_type": "visual_state"}))
    ocr_regions = list(db["evidence_items"].find({"source_id": source_id, "evidence_type": "ocr_region"}))

    assert len(states) == 1, "one page-image in, one visual_state out"
    assert states[0]["modality"] == "document"
    assert states[0]["location"]["timeline_id"] is None
    assert states[0]["location"]["page"] == 1
    assert states[0]["provenance"]["derived_from"], "the rendered page image must be locatable via lineage"

    assert ocr_regions, "OCR must find the literal text rendered into the scanned page"
    ocr_text = " ".join(r["content"] for r in ocr_regions).lower()
    assert "invalidation" in ocr_text or "ttl" in ocr_text
    for region in ocr_regions:
        assert region["parent_evidence_id"] == states[0]["_id"]

    _cleanup(source_id)


@skip_unless_mongo
async def test_reupload_document_is_idempotent(live_server_url):
    pdf_bytes = _make_text_pdf_bytes(["A short duplicate-test document for P4 idempotency."])

    async with httpx.AsyncClient(base_url=live_server_url, timeout=60.0) as client:
        first = await client.post("/api/v1/sources", files={"file": ("dup1.pdf", pdf_bytes, "application/pdf")})
        second = await client.post("/api/v1/sources", files={"file": ("dup2.pdf", pdf_bytes, "application/pdf")})
        assert first.status_code == 201 and second.status_code == 201
        source_id = first.json()["source_id"]
        assert second.json()["source_id"] == source_id, "identical bytes must reuse the existing source"

    run_count = _db()["processing_runs"].count_documents({"source_id": source_id, "stage": "document"})
    assert run_count == 1, "re-processing must not have duplicated the document stage's ProcessingRun"

    _cleanup(source_id)
