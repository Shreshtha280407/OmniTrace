"""Asset streaming — the read path for stored binaries.

The web client resolves a Source's `storage_path` to a URL through
`assetUrl()` and hands it straight to a `<video>`, `<audio>` or `<img>`
element. Nothing served that URL, so every viewer fell back to "the source
file could not be loaded from the asset store" — the provenance chain ran
all the way from a claim to a locator and then stopped one step short of
the bytes it pointed at.

Range requests matter here rather than being a nicety: a `<video>` element
seeks by issuing `Range`, so without 206 support a citation at 02:19 could
not actually open at 02:19. Starlette's FileResponse handles that.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from omnitrace.assets import get_asset_store
from omnitrace.db import SOURCES, coll

router = APIRouter()

# Only these two trees exist under the asset root (see LocalAssetStore's
# layout). Naming them explicitly keeps the endpoint from being a general
# file server rooted at whatever ASSET_ROOT happens to point at.
_ALLOWED_KINDS = {"raw", "derived"}


# Registered before the generic {kind} route below: FastAPI matches in
# declaration order, and /assets/page/... would otherwise be read as a
# `kind` of "page" and rejected.
# Rendered lazily on first request and cached next to the source's other
# derived assets, so the second view of a page is a plain file read.
_PAGE_DPI = 144


@router.get("/assets/page/{source_id}/{page}")
async def get_document_page(source_id: str, page: int) -> FileResponse:
    """One page of a paged document, rasterised.

    The web client needs to show *the cited page* of a PDF — not the file
    from the top, and not a whole-document scroll the reader has to hunt
    through. Serving the raw PDF and letting the browser's viewer jump to a
    page fragment gets close, but it cannot carry the stored bounding box,
    which is the part that says which region of the page the claim came from.
    Rasterising the single page turns a document into exactly the same case
    as an image: one bitmap with one normalised overlay on top.
    """
    if page < 1:
        raise HTTPException(404, "page numbers start at 1")

    source_doc = await coll(SOURCES).find_one({"_id": source_id}, {"storage_path": 1, "media_type": 1})
    if source_doc is None:
        raise HTTPException(404, "source not found")
    if source_doc.get("media_type") != "document":
        raise HTTPException(404, "source is not a paged document")

    store = get_asset_store()
    raw_path = store.resolve(source_doc["storage_path"])
    if not raw_path.is_file():
        raise HTTPException(404, "source file is missing from the asset store")

    cached = Path(store.root) / "derived" / source_id / f"page_{page:04d}.png"
    if not cached.is_file():
        import fitz  # PyMuPDF — same lazy import as pipeline/document.py

        with fitz.open(str(raw_path)) as pdf:
            if page > pdf.page_count:
                raise HTTPException(404, f"page {page} is past the end of a {pdf.page_count}-page document")
            pixmap = pdf.load_page(page - 1).get_pixmap(dpi=_PAGE_DPI)
            cached.parent.mkdir(parents=True, exist_ok=True)
            pixmap.save(str(cached))

    return FileResponse(cached, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/assets/{kind}/{source_id}/{filename}")
async def get_asset(kind: str, source_id: str, filename: str) -> FileResponse:
    if kind not in _ALLOWED_KINDS:
        raise HTTPException(404, "unknown asset kind")

    store = get_asset_store()
    root = Path(store.root).resolve()
    candidate = (root / kind / source_id / filename).resolve()

    # Path containment check, not a string prefix check: `source_id` and
    # `filename` arrive from the URL, and `..` segments resolve away before
    # this comparison rather than after it.
    if not candidate.is_relative_to(root):
        raise HTTPException(404, "asset not found")
    if not candidate.is_file():
        raise HTTPException(404, "asset not found")

    media_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
    return FileResponse(
        candidate,
        media_type=media_type,
        # Content-addressed by source: the bytes behind a storage_path never
        # change, so the browser may keep them.
        headers={"Cache-Control": "private, max-age=3600"},
    )
