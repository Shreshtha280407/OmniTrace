"""Entity extraction and resolution — architecture doc §07/§09 P5.

Normalised exact-match plus a hand-seeded alias table, no model-based
resolution — §02 decision ledger: "entity overlap is a linking signal;
entity resolution is a research problem. Take the signal, skip the
problem." Candidate mentions come from a generic capitalized-phrase /
acronym / hyphenated-term heuristic over evidence content, not an LLM call
— it has to work on whatever corpus the judges hand over, sight unseen, so
it can't lean on domain-specific keyword lists. SEED_ALIASES starts empty
on purpose for the same reason: folding "Postgres" and "PostgreSQL" into
one entity is only correct once you've actually seen the corpus use both
spellings for the same thing — hardcoding that guess for an unknown domain
risks merging two unrelated concepts. Populate it once real data arrives.
"""

from __future__ import annotations

import re
from typing import Any

from pymongo.errors import DuplicateKeyError

from omnitrace.db import ENTITIES, EVIDENCE_ITEMS, coll
from omnitrace.ids import new_id
from omnitrace.models import Entity

# canonical alias key (lowercase, whitespace-collapsed) -> the set of other
# lowercase spellings that resolve to it. Extend this once the real corpus
# is seen — e.g. SEED_ALIASES["postgresql"] = {"postgres", "psql"}.
SEED_ALIASES: dict[str, set[str]] = {}

_ALIAS_LOOKUP: dict[str, str] = {
    alias: canonical for canonical, aliases in SEED_ALIASES.items() for alias in ({canonical} | aliases)
}

# Candidate phrase patterns — generic, not tied to any one domain:
#   - runs of 1-4 Title-Case words ("Redis Cache", "API Gateway")
#   - ALLCAPS acronyms, 2-6 letters ("API", "TTL", "SQL")
#   - lowercase hyphenated technical terms ("cache-aside", "load-balancer")
_TITLE_RUN_RE = re.compile(r"\b[A-Z][a-zA-Z0-9]*(?:[\s-][A-Z][a-zA-Z0-9]*){0,3}\b")
_ACRONYM_RE = re.compile(r"\b[A-Z]{2,6}\b")
_HYPHEN_TERM_RE = re.compile(r"\b[a-z]+(?:-[a-z]+)+\b")

# Common sentence-initial capitalized words that are not entities on their
# own — filtered so single-word matches like "The" or "This" don't flood
# the entity collection. Multi-word phrases are never filtered here.
_STOPWORDS = {
    "the", "this", "that", "these", "those", "it", "we", "a", "an", "in", "on",
    "at", "is", "was", "were", "and", "or", "but", "so", "if", "as", "of", "to",
}


def candidate_phrases(text: str) -> set[str]:
    if not text:
        return set()
    found: set[str] = set()
    for m in _TITLE_RUN_RE.finditer(text):
        phrase = m.group(0).strip()
        if len(phrase) < 2 or (" " not in phrase and phrase.lower() in _STOPWORDS):
            continue
        found.add(phrase)
    for m in _ACRONYM_RE.finditer(text):
        found.add(m.group(0))
    for m in _HYPHEN_TERM_RE.finditer(text):
        found.add(m.group(0))
    return found


def normalize_key(phrase: str) -> str:
    """Lowercase, collapse whitespace, resolve through the alias table, then
    strip to bare alphanumerics — the entities.normalized_key value (§06,
    unique-indexed)."""
    lowered = re.sub(r"\s+", " ", phrase.strip().lower())
    canonical = _ALIAS_LOOKUP.get(lowered, lowered)
    return re.sub(r"[^a-z0-9]+", "", canonical)


async def _upsert_entity(*, collection_id: str, normalized_key: str, canonical_name: str, evidence_id: str) -> tuple[str, bool]:
    """Find-or-create the Entity for this normalized_key. Returns
    (entity_id, was_created). normalized_key is globally unique-indexed
    (§06/omnitrace/db.py), not scoped to collection_id."""
    existing = await coll(ENTITIES).find_one({"normalized_key": normalized_key})
    if existing is not None:
        await coll(ENTITIES).update_one(
            {"_id": existing["_id"]},
            {"$addToSet": {"evidence_mentions": evidence_id, "aliases": canonical_name}},
        )
        return existing["_id"], False

    entity_id = new_id("entity")
    entity = Entity(
        _id=entity_id,
        collection_id=collection_id,
        canonical_name=canonical_name,
        normalized_key=normalized_key,
        aliases=[canonical_name],
        evidence_mentions=[evidence_id],
    )
    try:
        await coll(ENTITIES).insert_one(entity.model_dump(by_alias=True))
        return entity_id, True
    except DuplicateKeyError:
        # Lost a race against a concurrent upsert for the same key. Not
        # expected under the synchronous, queue-free runner (§02 decision
        # ledger) — cheap to guard against regardless.
        existing = await coll(ENTITIES).find_one({"normalized_key": normalized_key})
        assert existing is not None
        await coll(ENTITIES).update_one(
            {"_id": existing["_id"]},
            {"$addToSet": {"evidence_mentions": evidence_id, "aliases": canonical_name}},
        )
        return existing["_id"], False


async def extract_entities_for_source(source_id: str) -> dict[str, Any]:
    """Scan every evidence_item belonging to source_id, extract candidate
    entity mentions from its content, resolve each to an Entity by
    normalized_key, and write the resolved entity_ids back onto the item.
    Idempotent in effect (re-running just re-adds the same mentions/aliases
    via $addToSet and overwrites entity_ids with the same set) even though
    it isn't gated by its own idempotency key — the caller (run_enrich_stage)
    provides that via the shared run_stage helper."""
    items = await coll(EVIDENCE_ITEMS).find(
        {"source_id": source_id}, {"_id": 1, "content": 1, "collection_id": 1}
    ).to_list(length=None)

    mention_count = 0
    created_count = 0
    for item in items:
        phrases = candidate_phrases(item.get("content") or "")
        if not phrases:
            continue
        entity_ids: set[str] = set()
        for phrase in phrases:
            key = normalize_key(phrase)
            if not key:
                continue
            entity_id, created = await _upsert_entity(
                collection_id=item["collection_id"], normalized_key=key,
                canonical_name=phrase, evidence_id=item["_id"],
            )
            entity_ids.add(entity_id)
            mention_count += 1
            created_count += int(created)
        if entity_ids:
            await coll(EVIDENCE_ITEMS).update_one(
                {"_id": item["_id"]}, {"$set": {"entity_ids": sorted(entity_ids)}}
            )

    return {
        "entity_evidence_scanned": len(items),
        "entity_mentions_found": mention_count,
        "entities_created": created_count,
    }
