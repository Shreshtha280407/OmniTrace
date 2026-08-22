"""Prefixed IDs, content hashing, and idempotency keys.

Every entity type in the evidence fabric gets a short, human-legible prefix
(``src_``, ``ev_``, ``rel_``, ...) followed by a ULID. ULIDs are lexicographically
sortable by creation time, which is convenient for debugging in the Mongo shell
without adding a separate ``created_at`` index just to browse records in order.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from ulid import ULID

# node_type / record kind -> ID prefix. Keep in sync with docs/appendix §12.
_PREFIXES = {
    "source": "src",
    "asset": "asset",
    "processing_run": "run",
    "evidence_item": "ev",
    "entity": "ent",
    "relationship": "rel",
    "semantic_event": "evt",
    "job": "job",
    "timeline": "tl",
}


def new_id(kind: str) -> str:
    """Generate a new prefixed ID for the given record kind.

    Raises ``KeyError`` on an unknown kind rather than silently minting an
    unprefixed ID — a typo'd kind should fail loudly at the call site, not
    produce an ID that looks valid but breaks prefix-based debugging later.
    """
    prefix = _PREFIXES[kind]
    return f"{prefix}_{ULID()}"


def sha256_file(path: str, chunk_size: int = 1 << 20) -> str:
    """Stream-hash a file on disk. Never loads the whole file into memory —
    source uploads can be multi-hundred-MB videos."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(chunk_size):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def idempotency_key(
    *, source_sha256: str, stage_name: str, processor_version: str, config_hash: str, schema_version: int
) -> str:
    """Deterministic key for a (source, stage, config) triple.

    Re-running the same stage on the same source with the same processor
    version and config reuses the prior run instead of duplicating evidence —
    this is what makes the stage runner safely re-runnable after a crash.
    """
    payload = f"{source_sha256}:{stage_name}:{processor_version}:{config_hash}:{schema_version}"
    return sha256_bytes(payload.encode())


def config_hash(config: dict[str, Any]) -> str:
    """Stable hash of a config dict — sorted keys so key ordering never
    changes the hash (and never silently breaks the prompt cache upstream,
    see shared/prompt-caching.md § Silent invalidators)."""
    canonical = json.dumps(config, sort_keys=True, separators=(",", ":"))
    return sha256_bytes(canonical.encode())
