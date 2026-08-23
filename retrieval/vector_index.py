"""VectorIndex — architecture doc §02/§06/§11 P5.

Two implementations behind one interface, selected by VECTOR_BACKEND:
AtlasVectorIndex ($vectorSearch against the `ev_vec` index created in P0,
before any data exists — §11: index builds are asynchronous, so it's READY
long before the first real query) and NumpyVectorIndex, the structural
hedge for if that index isn't READY yet at query time. Brute-force cosine
over every embedded evidence_item is fine at this build's scale (§02:
"< 5,000 vectors at demo scale. Millisecond latency.") — no separate index
structure needed. Callers (P7's retrieval channels) query through this
interface and never know which backend answered.
"""

from __future__ import annotations

from typing import Any, Protocol

import numpy as np

from omnitrace.config import get_settings
from omnitrace.db import EVIDENCE_ITEMS, coll

VECTOR_INDEX_NAME = "ev_vec"

# Result-shaping fields both backends return alongside `score` — kept
# identical across backends so a caller can't tell which one answered.
_RESULT_FIELDS = {"content": 1, "modality": 1, "node_type": 1, "evidence_type": 1, "location": 1, "source_id": 1}


class VectorIndex(Protocol):
    async def query(
        self,
        vector: list[float],
        *,
        path: str,
        top_k: int = 10,
        modality: str | None = None,
        node_type: str | None = None,
        collection_id: str | None = None,
    ) -> list[dict[str, Any]]: ...


class AtlasVectorIndex:
    async def query(
        self,
        vector: list[float],
        *,
        path: str,
        top_k: int = 10,
        modality: str | None = None,
        node_type: str | None = None,
        collection_id: str | None = None,
    ) -> list[dict[str, Any]]:
        filter_query: dict[str, Any] = {}
        if modality:
            filter_query["modality"] = modality
        if node_type:
            filter_query["node_type"] = node_type
        if collection_id:
            filter_query["collection_id"] = collection_id

        vector_search_stage: dict[str, Any] = {
            "index": VECTOR_INDEX_NAME,
            "path": path,
            "queryVector": vector,
            "numCandidates": max(top_k * 10, 100),
            "limit": top_k,
        }
        if filter_query:
            vector_search_stage["filter"] = filter_query

        pipeline = [
            {"$vectorSearch": vector_search_stage},
            {"$project": {**_RESULT_FIELDS, "score": {"$meta": "vectorSearchScore"}}},
        ]
        cursor = coll(EVIDENCE_ITEMS).aggregate(pipeline)
        return await cursor.to_list(length=top_k)


class NumpyVectorIndex:
    @staticmethod
    def _dig(doc: dict[str, Any], dotted_path: str) -> Any:
        cur: Any = doc
        for part in dotted_path.split("."):
            if not isinstance(cur, dict):
                return None
            cur = cur.get(part)
        return cur

    async def query(
        self,
        vector: list[float],
        *,
        path: str,
        top_k: int = 10,
        modality: str | None = None,
        node_type: str | None = None,
        collection_id: str | None = None,
    ) -> list[dict[str, Any]]:
        mongo_filter: dict[str, Any] = {path: {"$ne": None}}
        if modality:
            mongo_filter["modality"] = modality
        if node_type:
            mongo_filter["node_type"] = node_type
        if collection_id:
            mongo_filter["collection_id"] = collection_id

        projection = {**_RESULT_FIELDS, path: 1}
        docs = await coll(EVIDENCE_ITEMS).find(mongo_filter, projection).to_list(length=None)

        vectors: list[list[float]] = []
        kept: list[dict[str, Any]] = []
        for d in docs:
            v = self._dig(d, path)
            if v:
                vectors.append(v)
                kept.append(d)
        if not vectors:
            return []

        mat = np.array(vectors, dtype=np.float32)
        q = np.array(vector, dtype=np.float32)
        mat_norm = mat / (np.linalg.norm(mat, axis=1, keepdims=True) + 1e-9)
        q_norm = q / (np.linalg.norm(q) + 1e-9)
        scores = mat_norm @ q_norm

        order = np.argsort(-scores)[:top_k]
        results = []
        for idx in order:
            d = dict(kept[int(idx)])
            d.pop("embeddings", None)
            d["score"] = float(scores[idx])
            results.append(d)
        return results


def get_vector_index() -> VectorIndex:
    """§11: VECTOR_BACKEND=numpy is the structural hedge — flip it if the
    Atlas vector index isn't READY yet at query time, no code changes
    required anywhere else (same records, same ranking trace shape)."""
    if get_settings().vector_backend == "numpy":
        return NumpyVectorIndex()
    return AtlasVectorIndex()
