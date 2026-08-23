"""Embedding pipeline and the P5 "enrich" stage orchestrator — architecture
doc §04/§07/§09.

EmbeddingProvider is a thin, swappable interface (any text/multimodal
embedder can stand behind it — see README's model-provider swap note for
the same pattern applied to omnitrace/llm.py). The only implementation here
is Voyage (voyage-3-large text, voyage-multimodal-3 multimodal), batched.

Text vectors go on semantic segments and on visual_states as an
OCR-plus-description composite (the state's vision summary joined with its
child OCR regions' literal text) — never on an isolated ocr_region by
itself (§09 P5: "not on isolated OCR noise", since a single OCR line is too
fragmentary to be a meaningful retrieval unit on its own).

Multimodal vectors go on every visual_state's representative image —
video frames, standalone images, and (from P4) rendered document pages and
embedded images alike, since pipeline/visual.py's process_single_image
records the same evidence_type across all of them.

run_enrich_stage is the single "enrich" ProcessingRun (§06 model docstring:
stage is one of probe | extract | normalize | enrich | link | index) that
wraps both entity resolution (enrich/entities.py) and embedding. A missing
VOYAGE_API_KEY degrades to a warning rather than a stage failure — entity
resolution is free and still runs, and a source can still reach "ready"
without paid credentials configured.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Protocol

from PIL import Image

from enrich.entities import extract_entities_for_source
from omnitrace.assets import get_asset_store
from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS, coll
from omnitrace.models import EmbeddingRef
from pipeline.runner import ProcessorResult, run_stage

PROCESSOR_VERSION = "v1"
TEXT_BATCH_SIZE = 128
IMAGE_BATCH_SIZE = 8


class EmbeddingProvider(Protocol):
    text_model: str
    multimodal_model: str

    def embed_text(self, texts: list[str]) -> list[list[float]]: ...
    def embed_images(self, images: list[Image.Image]) -> list[list[float]]: ...
    def embed_query_text(self, texts: list[str]) -> list[list[float]]: ...
    def embed_multimodal_query_text(self, texts: list[str]) -> list[list[float]]: ...


class VoyageEmbeddingProvider:
    """voyage-3-large for text, voyage-multimodal-3 for images — §04.

    Voyage embeddings are asymmetric: index-time content is embedded with
    input_type="document", query-time text with input_type="query" — same
    model, different instruction prefix under the hood. embed_text/
    embed_images (index-time, P5) and embed_query_text/
    embed_multimodal_query_text (query-time, P7) are kept as separate
    methods rather than a shared one with an input_type flag so a caller
    can't accidentally embed a query as a document (or vice versa) and
    silently degrade retrieval quality.
    """

    def __init__(self, *, api_key: str, text_model: str, multimodal_model: str) -> None:
        import voyageai

        self._client = voyageai.Client(api_key=api_key)
        self.text_model = text_model
        self.multimodal_model = multimodal_model

    def embed_text(self, texts: list[str]) -> list[list[float]]:
        result = self._client.embed(texts, model=self.text_model, input_type="document")
        return result.embeddings

    def embed_images(self, images: list[Image.Image]) -> list[list[float]]:
        result = self._client.multimodal_embed(
            inputs=[[img] for img in images], model=self.multimodal_model, input_type="document"
        )
        return result.embeddings

    def embed_query_text(self, texts: list[str]) -> list[list[float]]:
        result = self._client.embed(texts, model=self.text_model, input_type="query")
        return result.embeddings

    def embed_multimodal_query_text(self, texts: list[str]) -> list[list[float]]:
        result = self._client.multimodal_embed(
            inputs=[[t] for t in texts], model=self.multimodal_model, input_type="query"
        )
        return result.embeddings


_provider: EmbeddingProvider | None = None


def get_embedding_provider() -> EmbeddingProvider:
    global _provider
    if _provider is None:
        settings = get_settings()
        _provider = VoyageEmbeddingProvider(
            api_key=settings.voyage_api_key, text_model=settings.embed_text, multimodal_model=settings.embed_mm
        )
    return _provider


def _chunks(seq: list[Any], size: int) -> list[list[Any]]:
    return [seq[i : i + size] for i in range(0, len(seq), size)]


async def _text_targets(source_id: str) -> list[dict[str, str]]:
    segments = await coll(EVIDENCE_ITEMS).find(
        {"source_id": source_id, "node_type": "semantic_segment", "embeddings.text": None},
        {"_id": 1, "content": 1},
    ).to_list(length=None)
    targets = [{"id": s["_id"], "text": s["content"]} for s in segments if s.get("content")]

    states = await coll(EVIDENCE_ITEMS).find(
        {"source_id": source_id, "evidence_type": "visual_state", "embeddings.text": None},
        {"_id": 1, "content": 1},
    ).to_list(length=None)
    if states:
        state_ids = [s["_id"] for s in states]
        ocr_regions = await coll(EVIDENCE_ITEMS).find(
            {"source_id": source_id, "evidence_type": "ocr_region", "parent_evidence_id": {"$in": state_ids}},
            {"parent_evidence_id": 1, "content": 1},
        ).to_list(length=None)
        ocr_by_parent: dict[str, list[str]] = {}
        for r in ocr_regions:
            ocr_by_parent.setdefault(r["parent_evidence_id"], []).append(r["content"])
        for s in states:
            composite = " ".join([s["content"], *ocr_by_parent.get(s["_id"], [])]).strip()
            if composite:
                targets.append({"id": s["_id"], "text": composite})

    return targets


async def _multimodal_targets(source_id: str) -> list[dict[str, str]]:
    states = await coll(EVIDENCE_ITEMS).find(
        {"source_id": source_id, "evidence_type": "visual_state", "embeddings.multimodal": None},
        {"_id": 1, "provenance.derived_from": 1},
    ).to_list(length=None)
    targets = []
    for s in states:
        derived = (s.get("provenance") or {}).get("derived_from") or []
        if derived:
            targets.append({"id": s["_id"], "storage_path": derived[0]})
    return targets


async def embed_evidence_for_source(source_id: str) -> tuple[dict[str, Any], list[str]]:
    settings = get_settings()
    warnings: list[str] = []
    if not settings.voyage_api_key:
        return {"text_embedded": 0, "multimodal_embedded": 0}, ["VOYAGE_API_KEY not set — embeddings skipped this run"]

    provider = get_embedding_provider()
    store = get_asset_store()

    text_targets = await _text_targets(source_id)
    text_embedded = 0
    for batch in _chunks(text_targets, TEXT_BATCH_SIZE):
        texts = [t["text"] for t in batch]
        try:
            vectors = await asyncio.to_thread(provider.embed_text, texts)
        except Exception as e:  # noqa: BLE001 — one batch failing must not lose the rest of the source
            warnings.append(f"text embedding batch failed ({len(batch)} items): {e}")
            continue
        for target, vector in zip(batch, vectors):
            ref = EmbeddingRef(model=provider.text_model, dim=len(vector), vector=vector)
            await coll(EVIDENCE_ITEMS).update_one({"_id": target["id"]}, {"$set": {"embeddings.text": ref.model_dump()}})
            text_embedded += 1

    mm_targets = await _multimodal_targets(source_id)
    mm_embedded = 0
    for batch in _chunks(mm_targets, IMAGE_BATCH_SIZE):
        images: list[Image.Image] = []
        valid_targets: list[dict[str, str]] = []
        for t in batch:
            try:
                images.append(Image.open(store.resolve(t["storage_path"])))
                valid_targets.append(t)
            except Exception as e:  # noqa: BLE001 — a missing/corrupt frame shouldn't sink the batch
                warnings.append(f"could not open image for {t['id']}: {e}")
        if not images:
            continue
        try:
            vectors = await asyncio.to_thread(provider.embed_images, images)
        except Exception as e:  # noqa: BLE001
            warnings.append(f"multimodal embedding batch failed ({len(valid_targets)} items): {e}")
            continue
        for target, vector in zip(valid_targets, vectors):
            ref = EmbeddingRef(model=provider.multimodal_model, dim=len(vector), vector=vector)
            await coll(EVIDENCE_ITEMS).update_one(
                {"_id": target["id"]}, {"$set": {"embeddings.multimodal": ref.model_dump()}}
            )
            mm_embedded += 1

    return {"text_embedded": text_embedded, "multimodal_embedded": mm_embedded}, warnings


async def run_enrich_stage(source_id: str) -> None:
    async def body(source_doc: dict, run_id: str) -> ProcessorResult:
        entity_metrics = await extract_entities_for_source(source_id)
        embed_metrics, warnings = await embed_evidence_for_source(source_id)
        return ProcessorResult(metrics={**entity_metrics, **embed_metrics}, warnings=warnings)

    settings = get_settings()
    await run_stage(
        source_id,
        stage="enrich",
        producer="enrichment_pipeline",
        processor_version=PROCESSOR_VERSION,
        config={
            "processor_version": PROCESSOR_VERSION,
            "embed_text_model": settings.embed_text,
            "embed_mm_model": settings.embed_mm,
        },
        body=body,
    )
