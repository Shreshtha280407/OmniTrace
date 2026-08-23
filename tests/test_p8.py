"""P8 acceptance tests — architecture doc §09.

Acceptance: across all eval queries, zero cited IDs outside the bundle,
zero locators not present in the database; an absent-metric query returns
missing_information rather than a fabricated number.

Most of this is testable without ANTHROPIC_API_KEY: the validators are
pure functions, and generate_grounded_answer's empty-evidence short-circuit
never calls the model at all. Only the full live-model round trip needs a
real key.
"""

from __future__ import annotations

import pytest

from generate.answer import generate_grounded_answer
from generate.prompt import RESPONSE_SCHEMA, render_locator
from generate.validate import (
    enforce_bundle_membership,
    enforce_claim_coverage,
    enforce_provenance_reachability,
    hydrate_locators,
    validate_bundle_membership,
)
from omnitrace.config import get_settings


def _has_anthropic_key() -> bool:
    return bool(get_settings().anthropic_api_key)


skip_unless_anthropic = pytest.mark.skipif(not _has_anthropic_key(), reason="ANTHROPIC_API_KEY not set")


# ── pure-function tests: no network ─────────────────────────────────────────


def test_response_schema_has_no_locator_fields():
    """Locator authenticity is enforced by construction (§08) — the model
    schema must not expose any way to state a timestamp, page, or box."""
    claim_props = RESPONSE_SCHEMA["properties"]["claims"]["items"]["properties"]
    for forbidden in ("location", "start_ms", "end_ms", "page", "bbox_norm", "timestamp"):
        assert forbidden not in claim_props
        assert forbidden not in RESPONSE_SCHEMA["properties"]


def test_render_locator_uses_stored_fields_only():
    assert render_locator({"location": {"start_ms": 1000, "end_ms": 2000}}) == "t=1000-2000ms"
    assert render_locator({"location": {"page": 7}}) == "page=7"
    assert render_locator({"location": {}}) == "unlocated"


def test_enforce_bundle_membership_strips_unknown_ids():
    response = {"claims": [
        {"text": "a", "evidence_ids": ["ev_real", "ev_fake"], "support": "high"},
        {"text": "b", "evidence_ids": ["ev_fake_only"], "support": "high"},
    ]}
    allowed = {"ev_real"}
    issues = validate_bundle_membership(response, allowed)
    assert len(issues) == 2

    fixed = enforce_bundle_membership(response, allowed)
    assert len(fixed["claims"]) == 1, "the claim with zero surviving IDs must be dropped entirely"
    assert fixed["claims"][0]["evidence_ids"] == ["ev_real"], "the fake ID must be stripped, the real one kept"


def test_enforce_provenance_reachability_downgrades_support():
    response = {"claims": [{"text": "a", "evidence_ids": ["ev_1", "ev_2"], "support": "high"}]}
    evidence_by_id = {
        "ev_1": {"source_id": "src_a"},
        "ev_2": {},  # no source_id — unreachable
    }
    fixed = enforce_provenance_reachability(response, evidence_by_id)
    assert fixed["claims"][0]["evidence_ids"] == ["ev_1"]
    assert fixed["claims"][0]["support"] == "medium", "a partially-unreachable high-support claim must downgrade"


def test_enforce_claim_coverage_moves_unsupported_claims_to_missing_information():
    response = {"claims": [{"text": "orphan claim", "evidence_ids": [], "support": "low"}], "missing_information": []}
    fixed = enforce_claim_coverage(response)
    assert fixed["claims"] == []
    assert "orphan claim" in fixed["missing_information"]


def test_hydrate_locators_never_trusts_model_text():
    response = {"claims": [{"text": "a", "evidence_ids": ["ev_1"], "support": "high"}]}
    evidence_by_id = {"ev_1": {"content": "real content", "location": {"page": 7}, "embeddings": {"text": "should be stripped"}}}
    locators = hydrate_locators(response, evidence_by_id)
    assert len(locators) == 1
    assert locators[0]["location"]["page"] == 7, "location must come from the stored record"
    assert "embeddings" not in locators[0], "raw vectors must never leak into a locator response"


def test_generate_grounded_answer_short_circuits_on_empty_evidence():
    """No model call at all when the bundle is empty — this must work
    without any credentials configured."""
    result = generate_grounded_answer("a question with no retrievable evidence", [])
    assert result["support_label"] == "none"
    assert result["claims"] == []
    assert result["missing_information"]


# ── live model round trip ───────────────────────────────────────────────────


@skip_unless_anthropic
def test_live_generation_never_cites_outside_the_bundle():
    evidence = [
        {
            "_id": "ev_test_1", "source_id": "src_test", "modality": "speech", "evidence_type": "speech_segment",
            "content": "We proposed a Redis cache-aside layer between the API and PostgreSQL.",
            "location": {"start_ms": 1000, "end_ms": 5000}, "confidence": {"extraction": 0.9},
            "provenance": {"processing_run_id": "run_test"},
        },
    ]
    result = generate_grounded_answer("What architecture was proposed?", evidence)
    allowed_ids = {e["_id"] for e in evidence}
    for claim in result["claims"]:
        assert set(claim["evidence_ids"]) <= allowed_ids, "zero cited IDs outside the bundle (§09 P8 acceptance)"
    for locator in result["source_locators"]:
        assert locator["id"] in allowed_ids


@skip_unless_anthropic
def test_live_generation_reports_missing_information_for_absent_metric():
    evidence = [
        {
            "_id": "ev_test_2", "source_id": "src_test", "modality": "speech", "evidence_type": "speech_segment",
            "content": "We proposed a Redis cache-aside layer between the API and PostgreSQL.",
            "location": {"start_ms": 1000, "end_ms": 5000}, "confidence": {"extraction": 0.9},
            "provenance": {"processing_run_id": "run_test"},
        },
    ]
    result = generate_grounded_answer("What was the p99 latency after the cache was added?", evidence)
    assert result["missing_information"], "a metric absent from the evidence must surface as missing_information, not a fabricated number"
