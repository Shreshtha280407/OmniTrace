"""P9 acceptance tests — architecture doc §09.

Acceptance: both systems (full pipeline + baseline) complete every gold
case without error; a results table exists with measured numbers; each
ablation config runs and produces its own metrics; missing eval/gold.yaml
degrades to an honest "not measured" result rather than a fabricated one.

This environment has no real judge-supplied dataset yet (that's expected —
see eval/run.py's own module docstring), so the DB-backed tests here build
a tiny synthetic gold set from a real ingested source rather than reading
the real eval/gold.yaml, the same "prove the mechanism, not the numbers"
approach test_p6.py and test_p7.py already take for their own DB-backed
cases. VOYAGE_API_KEY is also unset in this environment, so the ablations'
*directional* effect (A2 should depress visual-only recall, etc.) isn't
assertable here with any statistical meaning at n=2 — these tests instead
confirm every system/ablation runs to completion and reports structurally
correct, honestly-null-where-unmeasurable metrics, which is what's actually
verifiable without live embeddings.
"""

from __future__ import annotations

import pytest
from pymongo import MongoClient

from baseline.text_rag import chunk_words
from eval.run import _percentile, _recall_at_k, _set_f1, load_gold, run_eval
from omnitrace.config import get_settings
from tests.conftest import cleanup_source, run_on_server_loop


def _mongo_configured() -> bool:
    uri = get_settings().mongodb_uri
    return bool(uri) and "localhost" not in uri


skip_unless_mongo = pytest.mark.skipif(not _mongo_configured(), reason="MONGODB_URI not set to a real Atlas cluster yet")


def _db():
    s = get_settings()
    return MongoClient(s.mongodb_uri)[s.mongodb_db]


def _make_pdf_bytes(pages_text: list[str]) -> bytes:
    import fitz  # PyMuPDF

    doc = fitz.open()
    for text in pages_text:
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 500, 700), text, fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


# ── pure-function tests: no DB, no network ─────────────────────────────────


def test_chunk_words_respects_size_and_overlap():
    text = " ".join(f"word{i}" for i in range(1200))
    chunks = chunk_words(text, size=500, overlap=50)
    # step = 450, so chunk starts are 0, 450, 900 -> 3 chunks, last one short.
    assert len(chunks) == 3
    assert chunks[0].split()[0] == "word0"
    assert chunks[0].split()[-1] == "word499"
    # second chunk starts 450 words in — the last 50 words of chunk 0 repeat.
    assert chunks[1].split()[0] == "word450"


def test_chunk_words_empty_text_yields_no_chunks():
    assert chunk_words("") == []
    assert chunk_words("   ") == []


def test_chunk_words_short_text_yields_one_chunk():
    text = "just a few words here"
    chunks = chunk_words(text, size=500, overlap=50)
    assert chunks == [text]


def test_recall_at_k_measures_gold_overlap_in_top_k():
    gold = ["ev_a", "ev_b", "ev_c"]
    ranked = ["ev_x", "ev_a", "ev_y", "ev_b", "ev_z", "ev_c"]
    assert _recall_at_k(gold, ranked, k=5) == pytest.approx(2 / 3)  # ev_a, ev_b in top-5; ev_c is 6th
    assert _recall_at_k(gold, ranked, k=10) == pytest.approx(1.0)
    assert _recall_at_k([], ranked, k=5) is None, "no gold ids means recall is undefined, not zero"


def test_set_f1_perfect_and_partial_overlap():
    assert _set_f1(["a", "b"], ["a", "b"]) == pytest.approx(1.0)
    assert _set_f1(["a", "b"], []) == 0.0
    assert _set_f1([], ["a"]) is None, "no gold ids means F1 is undefined, not zero"
    # predicted {a,b,c}, gold {a,b} -> precision=2/3, recall=1.0, f1=0.8
    assert _set_f1(["a", "b"], ["a", "b", "c"]) == pytest.approx(0.8)


def test_percentile_picks_correct_rank():
    values = [10.0, 20.0, 30.0, 40.0, 50.0]
    assert _percentile(values, 50) == 30.0
    assert _percentile(values, 0) == 10.0
    assert _percentile(values, 100) == 50.0
    assert _percentile([], 50) is None


def test_load_gold_returns_none_when_file_absent(tmp_path):
    assert load_gold(tmp_path / "does_not_exist.yaml") is None


def test_load_gold_parses_cases(tmp_path):
    gold_path = tmp_path / "gold.yaml"
    gold_path.write_text("cases:\n  - id: q1\n    question: \"test?\"\n    gold_evidence_ids: [ev_x]\n")
    cases = load_gold(gold_path)
    assert cases == [{"id": "q1", "question": "test?", "gold_evidence_ids": ["ev_x"]}]


# ── DB-backed: honest fallback + synthetic end-to-end ───────────────────────


@pytest.mark.asyncio
@skip_unless_mongo
async def test_run_eval_writes_not_measured_when_gold_missing(tmp_path, server_loop):
    result = await run_on_server_loop(
        server_loop, run_eval(get_settings().collection_id, gold_path=tmp_path / "no_such_gold.yaml")
    )
    assert result["method"] == "not_measured"
    assert result["systems"] == {}
    assert "not" in result["note"].lower()  # never a fabricated number


@pytest.mark.asyncio
@skip_unless_mongo
async def test_run_eval_end_to_end_via_live_server(tmp_path, live_server_url, server_loop):
    """One ingested PDF, one gold case pointing at a real block from it —
    proves the harness runs every system/ablation config to completion and
    produces structurally correct output, not that any particular recall
    number is high (see module docstring for why that's not assertable
    here without live embeddings)."""
    import httpx

    pdf_bytes = _make_pdf_bytes(["OmniTrace links speech, visual and document evidence with typed edges."])
    async with httpx.AsyncClient(base_url=live_server_url, timeout=60.0) as client:
        resp = await client.post("/api/v1/sources", files={"file": ("p9_case.pdf", pdf_bytes, "application/pdf")})
        assert resp.status_code == 201, resp.text
        source_id = resp.json()["source_id"]

    db = _db()
    block = db["evidence_items"].find_one({"source_id": source_id, "evidence_type": "document_block"})
    assert block is not None, "ingestion must have produced at least one document_block to build a gold case from"

    settings = get_settings()
    collection_id = settings.collection_id
    gold_path = tmp_path / "gold.yaml"
    gold_path.write_text(
        "cases:\n"
        "  - id: p9_synthetic_1\n"
        "    category: architecture\n"
        "    question: \"What evidence does OmniTrace link together?\"\n"
        f"    gold_evidence_ids: [{block['_id']}]\n"
        "    required_modalities: [document]\n"
    )

    try:
        result = await run_on_server_loop(
            server_loop, run_eval(collection_id, gold_path=gold_path, with_generation=False)
        )
        assert result["method"] == "measured"
        assert result["n_cases"] == 1

        expected_systems = {"full", "A1_no_temporal_edges", "A2_no_multimodal_vector", "A3_no_coverage_rerank", "baseline"}
        assert set(result["systems"]) == expected_systems

        full = result["systems"]["full"]
        assert full["n_cases"] == 1
        assert full["latency_p50_ms"] is not None and full["latency_p50_ms"] >= 0
        # Lexical channel (Atlas Search) needs no API keys, so the gold block
        # should be findable via plain text search on its own content.
        assert full["recall_at_10"] is not None

        for ablation_name in ("A1_no_temporal_edges", "A2_no_multimodal_vector", "A3_no_coverage_rerank"):
            ablated = result["systems"][ablation_name]
            assert ablated["n_cases"] == 1
            assert ablated["latency_p50_ms"] is not None

        baseline = result["systems"]["baseline"]
        assert baseline["n_cases"] == 1
        assert baseline["evidence_f1"] is None, "baseline has no evidence-item granularity — must report null, not 0"

        # provenance_exact_match must be null throughout — with_generation=False
        # means no source_locators were ever produced to check.
        for agg in result["systems"].values():
            assert agg["provenance_exact_match"] is None
    finally:
        cleanup_source(source_id)


@pytest.mark.asyncio
@skip_unless_mongo
async def test_evaluations_endpoint_returns_not_measured_without_gold(live_server_url):
    """Confirms POST /api/v1/evaluations/run is actually wired up — the
    endpoint always reads the real eval/gold.yaml path, which this repo
    intentionally doesn't ship (no dataset yet — see eval/run.py), so the
    honest fallback is what a fresh checkout's endpoint call must return."""
    import httpx

    async with httpx.AsyncClient(base_url=live_server_url, timeout=30.0) as client:
        resp = await client.post("/api/v1/evaluations/run", json={})
        assert resp.status_code == 200, resp.text
        body = resp.json()

    assert body["method"] == "not_measured"
    assert body["systems"] == {}
