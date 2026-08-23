"""Document route — architecture doc §07/§11/§09 P4.

PyMuPDF gives atomic paragraph-level blocks with page + normalized
bounding box; blocks are grouped into semantic segments under their
nearest preceding heading (by font size). Tables are flattened to text
per the §09 P4 cut-line — structured cell coordinates are not extracted.
Embedded images and text-sparse (scanned) pages are routed through the
*same* visual processor P3 built for video frames and standalone images —
one processor, multiple entry points, exactly as §07 specifies.

Documents never receive a timeline_id — §06: "Documents use page/block/
paragraph/line order. They are never assigned artificial timestamps."
Which extraction path produced a page (native text vs. rendered+OCR) is
recorded in provenance.producer rather than a new schema field.
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any

from omnitrace.assets import get_asset_store
from omnitrace.ids import new_id
from omnitrace.models import EvidenceItem, Location, Provenance
from pipeline.runner import ProcessorResult, run_stage
from pipeline.visual import process_single_image

PROCESSOR_VERSION = "v1"

HEADING_FONT_SIZE = 14.0          # spans at/above this size are treated as section headings
SPARSE_PAGE_CHAR_THRESHOLD = 30   # pages with less native text than this are treated as scanned
SEGMENT_MAX_WORDS = 400           # cap on a heading-section's combined semantic segment


class DocumentProcessingError(Exception):
    pass


def _page_blocks(page: Any) -> list[dict]:
    """One entry per PyMuPDF paragraph block: text, max span font size
    (used for heading detection), and a normalized bounding box."""
    w, h = page.rect.width, page.rect.height
    out = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:  # 0 = text block; skip images here, handled separately
            continue
        lines = block.get("lines", [])
        if not lines:
            continue
        text_parts: list[str] = []
        max_size = 0.0
        for line in lines:
            for span in line.get("spans", []):
                t = span.get("text", "")
                if t.strip():
                    text_parts.append(t)
                max_size = max(max_size, span.get("size", 0.0))
        text = " ".join(text_parts).strip()
        if not text:
            continue
        x0, y0, x1, y1 = block["bbox"]
        out.append({
            "text": text,
            "font_size": max_size,
            "bbox_norm": {
                "x1": round(max(0.0, x0) / w, 4), "y1": round(max(0.0, y0) / h, 4),
                "x2": round(min(w, x1) / w, 4), "y2": round(min(h, y1) / h, 4),
            },
        })
    return out


def _page_tables_as_text(page: Any) -> list[dict]:
    """Flat-text table extraction — §09 P4 cut-line: "drop table structure
    and keep the flat text rendering." Still keeps a page-level bbox so the
    table is locatable, just not per-cell."""
    out = []
    try:
        tables = page.find_tables()
    except Exception:
        return out
    w, h = page.rect.width, page.rect.height
    for tbl in tables.tables:
        try:
            rows = tbl.extract()
        except Exception:
            continue
        text = "\n".join(" | ".join(str(c) if c is not None else "" for c in row) for row in rows)
        if not text.strip():
            continue
        x0, y0, x1, y1 = tbl.bbox
        out.append({
            "text": text,
            "bbox_norm": {
                "x1": round(max(0.0, x0) / w, 4), "y1": round(max(0.0, y0) / h, 4),
                "x2": round(min(w, x1) / w, 4), "y2": round(min(h, y1) / h, 4),
            },
        })
    return out


def _group_into_sections(blocks: list[dict]) -> list[list[dict]]:
    """Merge adjacent blocks under the same heading into one semantic
    segment, capped by word count — §11: 'Merge adjacent blocks only under
    the same heading/topic and within a context cap.'"""
    if not blocks:
        return []
    sections: list[list[dict]] = [[blocks[0]]]
    section_words = len(blocks[0]["text"].split())
    for b in blocks[1:]:
        is_heading = b["font_size"] >= HEADING_FONT_SIZE
        words = len(b["text"].split())
        if is_heading or section_words + words > SEGMENT_MAX_WORDS:
            sections.append([b])
            section_words = words
        else:
            sections[-1].append(b)
            section_words += words
    return sections


async def run_document_stage(source_id: str) -> None:
    async def body(source_doc: dict, run_id: str) -> ProcessorResult:
        import fitz  # PyMuPDF — imported lazily so P0-P3 don't pay for it at module load

        store = get_asset_store()
        raw_path = store.resolve(source_doc["storage_path"])
        collection_id = source_doc["collection_id"]

        evidence_items: list[EvidenceItem] = []
        warnings: list[str] = []
        scanned_pages: list[int] = []

        try:
            pdf = fitz.open(str(raw_path))
        except Exception as e:
            raise DocumentProcessingError(f"failed to open document: {e}") from e

        try:
            for page in pdf:
                page_num = page.number  # 0-indexed internally; store 1-indexed for humans
                blocks = _page_blocks(page)
                native_char_count = sum(len(b["text"]) for b in blocks)

                if native_char_count < SPARSE_PAGE_CHAR_THRESHOLD:
                    # Text-sparse / scanned page — render then route through
                    # the shared visual processor's OCR + vision pass.
                    scanned_pages.append(page_num + 1)
                    pix = page.get_pixmap(dpi=200)
                    with tempfile.TemporaryDirectory() as tmpdir:
                        img_path = Path(tmpdir) / f"page_{page_num:03d}.png"
                        pix.save(str(img_path))
                        persisted = store.put_file(
                            str(img_path), source_id=source_id, kind="derived",
                            filename=f"page_{page_num:03d}_scanned.png",
                        )
                        rendered_path = store.resolve(persisted)

                    try:
                        page_items = await asyncio.to_thread(
                            process_single_image,
                            rendered_path,
                            collection_id=collection_id,
                            source_id=source_id,
                            run_id=run_id,
                            modality="document",
                            image_storage_path=persisted,
                            location_extra={"page": page_num + 1, "timeline_id": None},
                            run_id_producer_suffix="ocr_fallback",
                        )
                        evidence_items.extend(page_items)
                    except Exception as e:  # noqa: BLE001 — one bad page shouldn't fail the whole document
                        warnings.append(f"OCR fallback failed for page {page_num + 1}: {e}")
                    continue

                # Native text path — atomic blocks, then merge into sections.
                block_ids: list[str] = []
                for i, b in enumerate(blocks):
                    block_id = new_id("evidence_item")
                    item = EvidenceItem(
                        _id=block_id,
                        collection_id=collection_id,
                        source_id=source_id,
                        node_type="atomic_observation",
                        evidence_type="document_block",
                        modality="document",
                        content=b["text"],
                        location=Location(
                            timeline_id=None, page=page_num + 1,
                            block_id=f"p{page_num}_b{i}", bbox_norm=b["bbox_norm"],
                        ),
                        provenance=Provenance(processing_run_id=run_id, producer="pymupdf_native"),
                    )
                    block_ids.append(block_id)
                    evidence_items.append(item)

                idx = 0
                for section in _group_into_sections(blocks):
                    member_ids = block_ids[idx: idx + len(section)]
                    idx += len(section)
                    if len(member_ids) < 1:
                        continue
                    content = " ".join(s["text"] for s in section)
                    x1 = min(s["bbox_norm"]["x1"] for s in section)
                    y1 = min(s["bbox_norm"]["y1"] for s in section)
                    x2 = max(s["bbox_norm"]["x2"] for s in section)
                    y2 = max(s["bbox_norm"]["y2"] for s in section)
                    evidence_items.append(
                        EvidenceItem(
                            _id=new_id("evidence_item"),
                            collection_id=collection_id,
                            source_id=source_id,
                            node_type="semantic_segment",
                            evidence_type="document_section",
                            modality="document",
                            content=content,
                            location=Location(
                                timeline_id=None, page=page_num + 1,
                                bbox_norm={"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                            ),
                            member_evidence_ids=member_ids,
                            provenance=Provenance(processing_run_id=run_id, producer="document_segmenter"),
                        )
                    )

                for tbl in _page_tables_as_text(page):
                    evidence_items.append(
                        EvidenceItem(
                            _id=new_id("evidence_item"),
                            collection_id=collection_id,
                            source_id=source_id,
                            node_type="atomic_observation",
                            evidence_type="table",
                            modality="document",
                            content=tbl["text"],
                            location=Location(timeline_id=None, page=page_num + 1, bbox_norm=tbl["bbox_norm"]),
                            provenance=Provenance(processing_run_id=run_id, producer="pymupdf_table"),
                        )
                    )

                # Embedded images — route through the shared visual processor.
                for img_index, img in enumerate(page.get_images(full=True)):
                    xref = img[0]
                    try:
                        rects = page.get_image_rects(xref)
                        if not rects:
                            continue
                        rect = rects[0]
                        base = pdf.extract_image(xref)
                        img_bytes, ext = base["image"], base["ext"]
                    except Exception as e:
                        warnings.append(f"failed to extract embedded image on page {page_num + 1}: {e}")
                        continue

                    with tempfile.TemporaryDirectory() as tmpdir:
                        img_path = Path(tmpdir) / f"embedded_{page_num:03d}_{img_index}.{ext}"
                        img_path.write_bytes(img_bytes)
                        persisted = store.put_file(
                            str(img_path), source_id=source_id, kind="derived",
                            filename=f"embedded_p{page_num:03d}_{img_index}.{ext}",
                        )
                        embedded_path = store.resolve(persisted)

                    w, h = page.rect.width, page.rect.height
                    bbox_norm = {
                        "x1": round(max(0.0, rect.x0) / w, 4), "y1": round(max(0.0, rect.y0) / h, 4),
                        "x2": round(min(w, rect.x1) / w, 4), "y2": round(min(h, rect.y1) / h, 4),
                    }
                    try:
                        img_items = await asyncio.to_thread(
                            process_single_image,
                            embedded_path,
                            collection_id=collection_id,
                            source_id=source_id,
                            run_id=run_id,
                            modality="document",
                            image_storage_path=persisted,
                            location_extra={"page": page_num + 1, "timeline_id": None, "bbox_norm": bbox_norm},
                            run_id_producer_suffix="embedded_image",
                        )
                        evidence_items.extend(img_items)
                    except Exception as e:  # noqa: BLE001
                        warnings.append(f"vision pass failed for embedded image on page {page_num + 1}: {e}")
        finally:
            pdf.close()

        return ProcessorResult(
            evidence_items=evidence_items,
            metrics={
                "block_count": sum(1 for e in evidence_items if e.evidence_type == "document_block"),
                "section_count": sum(1 for e in evidence_items if e.evidence_type == "document_section"),
                "table_count": sum(1 for e in evidence_items if e.evidence_type == "table"),
                "scanned_page_count": len(scanned_pages),
                "scanned_pages": scanned_pages,
            },
            warnings=warnings,
        )

    await run_stage(
        source_id,
        stage="document",
        producer="document_processor",
        processor_version=PROCESSOR_VERSION,
        config={"processor_version": PROCESSOR_VERSION, "sparse_threshold": SPARSE_PAGE_CHAR_THRESHOLD},
        body=body,
    )
