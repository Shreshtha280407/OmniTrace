"""Response validators — architecture doc §08/§09 P8.

Five checks, run in order, before a response is ever returned:

  1. Bundle membership   — every cited ID exists in the selected bundle.
  2. Provenance reachability — every cited item resolves to a real source_id.
  3. Locator authenticity — enforced by construction: generate/prompt.py's
     schema has no location fields at all, so there's nothing for the model
     to fabricate. hydrate_locators() re-attaches the stored location for
     whatever the model actually cited.
  4. Claim coverage — every claim carries at least one surviving evidence_id.
  5. Speaker identity — a claim citing speech evidence only ever inherits
     the stable anonymous speaker_id already stored on it (§09 P2 speaker
     integrity); this validator confirms that field is present rather than
     attempting free-text name detection, which needs real NER to do safely
     and is out of scope here.

Each enforce_* function is a pure transform: (response, context) -> a new
response with violations fixed, never a hard failure — matching §08's "on
failure: <repair>" column rather than raising.
"""

from __future__ import annotations

from typing import Any


def validate_bundle_membership(response: dict[str, Any], allowed_ids: set[str]) -> list[str]:
    issues = []
    for claim in response.get("claims", []):
        bad = [eid for eid in claim.get("evidence_ids", []) if eid not in allowed_ids]
        if bad:
            issues.append(f"claim {claim.get('text', '')[:40]!r} cites unknown evidence_ids: {bad}")
    return issues


def enforce_bundle_membership(response: dict[str, Any], allowed_ids: set[str]) -> dict[str, Any]:
    kept_claims = []
    for claim in response.get("claims", []):
        valid_ids = [eid for eid in claim.get("evidence_ids", []) if eid in allowed_ids]
        if valid_ids:
            kept_claims.append({**claim, "evidence_ids": valid_ids})
    response["claims"] = kept_claims
    return response


def enforce_provenance_reachability(response: dict[str, Any], evidence_by_id: dict[str, Any]) -> dict[str, Any]:
    kept_claims = []
    for claim in response.get("claims", []):
        reachable = [eid for eid in claim["evidence_ids"] if evidence_by_id.get(eid, {}).get("source_id")]
        if not reachable:
            continue
        support = claim.get("support", "medium")
        if len(reachable) < len(claim["evidence_ids"]) and support == "high":
            support = "medium"
        kept_claims.append({**claim, "evidence_ids": reachable, "support": support})
    response["claims"] = kept_claims
    return response


def enforce_claim_coverage(response: dict[str, Any]) -> dict[str, Any]:
    kept_claims = []
    missing = list(response.get("missing_information", []))
    for claim in response.get("claims", []):
        if claim.get("evidence_ids"):
            kept_claims.append(claim)
        else:
            missing.append(claim.get("text", "unsupported claim"))
    response["claims"] = kept_claims
    response["missing_information"] = missing
    return response


def check_speaker_identity(response: dict[str, Any], evidence_by_id: dict[str, Any]) -> list[str]:
    warnings = []
    for claim in response.get("claims", []):
        for eid in claim.get("evidence_ids", []):
            item = evidence_by_id.get(eid)
            if item and item.get("modality") == "speech" and not item.get("speaker_id"):
                warnings.append(f"speech evidence {eid} cited with no stored speaker_id")
    return warnings


def hydrate_locators(response: dict[str, Any], evidence_by_id: dict[str, Any]) -> list[dict[str, Any]]:
    cited_ids: set[str] = set()
    for claim in response.get("claims", []):
        cited_ids.update(claim.get("evidence_ids", []))
    return [
        {"id": eid, **{k: v for k, v in evidence_by_id[eid].items() if k not in ("embeddings", "_id")}}
        for eid in cited_ids if eid in evidence_by_id
    ]


def run_validators(
    response: dict[str, Any], *, allowed_ids: set[str], evidence_by_id: dict[str, Any]
) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    response = enforce_bundle_membership(response, allowed_ids)
    response = enforce_provenance_reachability(response, evidence_by_id)
    response = enforce_claim_coverage(response)
    speaker_warnings = check_speaker_identity(response, evidence_by_id)
    source_locators = hydrate_locators(response, evidence_by_id)
    return response, source_locators, speaker_warnings
