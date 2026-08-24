# OmniTrace

Multimodal evidence pipeline for RAG-ready retrieval — video, audio, image, and
PDF sources ingested into a connected evidence fabric (MongoDB Atlas), linked
across modalities with typed, timestamped relationships, and retrieved as
evidence bundles rather than isolated chunks.

Full architecture and the phase-by-phase build plan this repo follows:
`OmniTrace_Master_Architecture_v2.pdf` (not checked in here — see the
project owner for the current copy). UI/UX is an intentionally separate pass,
built after the backend is complete, against the API contracts below.

## Status

| Phase | What it delivers | Status |
|---|---|---|
| P0 | Atlas connection, schemas, indexes | ✅ done |
| P1 | Ingestion API, stage runner, probe | ✅ done |
| P2 | Audio route (ASR, semantic segmentation) | ✅ done |
| P3 | Visual route (states, OCR, diagram facts) | ✅ done |
| P4 | Document route (blocks, tables, scanned pages) | ✅ done |
| P5 | Enrichment (entities, embeddings, search indexing) | ✅ done |
| P6 | Linker, events, threshold calibration | ✅ done (calibration reverts to the LINK_CONFIRM/LINK_TENTATIVE prior until `eval/gold.yaml` exists — no dataset yet) |
| P7 | Retrieval (RRF, expansion, bundle rerank) | ✅ done (model-based query planner cut per §09's own cut-line — deterministic planner only) |
| P8 | Grounded generation + validators | ✅ done — runs on Groq, not Anthropic (see **Model provider** below) |
| P9 | Baseline + evaluation | ✅ done — harness complete, `eval/gold.yaml` not supplied yet so results are honestly "not measured" (see **Evaluation** below) |
| P10 | Freeze + demo | ✅ done — tooling complete and round-trip-tested against a synthetic source; no real judge corpus to freeze yet (see **Limitations**) |

Every stage is built, unit-tested, and integration-tested end-to-end
against a real Atlas cluster and real Groq API — this is no longer
theoretical. `MONGODB_URI` and `GROQ_API_KEY` are configured and working.
`VOYAGE_API_KEY` is not configured, so embeddings and the two vector
retrieval channels degrade to "no results" with a logged warning — lexical
and structured retrieval still work, and the demo hero query still answers
correctly through them alone. See **Credentials needed** below.

## Setup

Requires Python 3.11+, `ffmpeg`/`ffprobe`/`tesseract` on `PATH`, and a
MongoDB Atlas cluster (free M0 tier is enough at this scale).

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv sync --extra dev   # installs every dependency in pyproject.toml, including pytest

cp .env.example .env
# edit .env — see "Credentials needed" below for the full list and what
# each one unlocks
```

## Credentials needed

Fill these into `.env` (copied from `.env.example`):

| Variable | Used by | What breaks without it |
|---|---|---|
| `MONGODB_URI` | everything | Nothing runs — every DB-backed test and endpoint skips/fails. Free M0 Atlas tier is enough. Currently configured and working. |
| `GROQ_API_KEY` | P2 (ASR), P3/P4 (vision), **P8 (grounded generation)** | Transcription/vision calls fail (visual/document stages still complete — OCR + structure only, vision fields fall back to `"unknown"`/empty); `POST /api/v1/query` returns retrieval results with `missing_information: ["generation failed: ..."]` instead of a generated answer. Currently configured and working — this one key covers all three. |
| `VOYAGE_API_KEY` | P5 (embeddings), P7 (vector channels), P9 (baseline) | `enrich/embed.py` skips embedding with a logged warning instead of failing the stage; the two vector-search retrieval channels and `baseline/text_rag.py` all contribute nothing, lexical + structured channels still work. Not currently configured. |

Every one of these degrades gracefully rather than crashing — a deliberate
design choice throughout (see each phase's module docstrings) specifically
so the system stays demoable while credentials are being sorted out.
**No Anthropic key is used anywhere in this build, by explicit direction —
not now, not in the future.** See **Model provider** below for what that
changed.

## Model provider

ASR (`whisper-large-v3-turbo`), vision (`qwen/qwen3.6-27b`), **and grounded
generation (`openai/gpt-oss-120b`)** all run through **Groq's
OpenAI-compatible API** — one key covers everything. The plan is to swap
to OpenAI directly once the project is built out further; that swap is
meant to be small: `omnitrace/llm.py` is written against the plain
OpenAI-shaped chat-completions / audio-transcriptions request and response
contract that Groq mirrors, so switching providers should only mean
changing `LLM_BASE_URL`, the API key, and the model IDs in
`omnitrace/config.py` / `.env` — not touching `pipeline/audio.py`,
`pipeline/visual.py`, or `generate/answer.py`.

Grounded generation (P8, `generate/answer.py`) was originally spec'd
against Claude Opus 5's Structured Outputs API and was rerouted to Groq
per explicit direction (no Anthropic key, not now, not in the future).
`omnitrace/llm.py`'s `chat_json()` — the text-only sibling of the
vision-calling `vision_json()` P3 already used — carries the same
`response_format: {"type": "json_object"}` contract. That mode guarantees
syntactically valid JSON but not schema conformance the way Anthropic's
`output_config` could, so the JSON Schema is spelled out directly in the
system prompt, and `generate/validate.py`'s five validators (already
written to repair a malformed response rather than trust the provider)
carry more of the correctness weight than they would have otherwise.
Functionally the contract is identical: evidence-only, JSON-schema-shaped,
citation-validated, degrades to `missing_information` rather than
fabricating — just a different underlying model.

Literal OCR (pytesseract, local, real per-line boxes + confidence) is kept
deliberately separate from the vision model's semantic read (visual type,
summary, diagram facts) — see the module docstring in `pipeline/visual.py`
for why mixing them would be a mistake.

**Voyage** (`voyage-3-large` text, `voyage-multimodal-3` multimodal) is the
one remaining separate provider, for embeddings only, via the `voyageai`
SDK directly (`enrich/embed.py`). Index-time calls use
`input_type="document"`, query-time calls (`retrieval/channels.py`,
`baseline/text_rag.py`) use `input_type="query"` — same model, asymmetric
embedding. Not currently configured — see **Credentials needed** above.

## Bootstrap (once, before first ingestion)

```bash
# Create the Atlas Search + vector search indexes against the (empty)
# evidence_items collection. Index builds are asynchronous — do this first,
# not right before a demo.
python3 scripts/create_search_indexes.py
python3 scripts/create_search_indexes.py --status   # poll until READY
```

If Atlas rejects connections with a TLS/SSL error, check **Network
Access** in the Atlas console — the allowlisted IP may have changed. This
project's cluster is currently open to `0.0.0.0/0` for exactly this reason
(a dynamic-IP dev environment); tighten it for anything beyond a
hackathon build.

After ingesting a corpus, run the linker once (P6 is a corpus-wide batch
pass, not a per-upload stage — see `scripts/link.py`'s module docstring):

```bash
python3 scripts/link.py                 # candidates -> score -> confirmed/tentative edges -> events
python3 scripts/calibrate.py            # dumps eval/candidates.csv; sweeps eval/gold.yaml if it exists,
                                         # else records the LINK_CONFIRM/LINK_TENTATIVE prior honestly
```

## Run

```bash
uvicorn api.main:app --reload
```

- `GET /health`
- `POST /api/v1/sources` — multipart upload (`file`). Accepts video, audio,
  image, and PDF/document extensions. Returns `{source_id, job_id, checksum,
  status}`. Re-uploading identical bytes reuses the existing source.
  Uploading a video or audio file auto-triggers the audio route (P2);
  video or image auto-triggers the visual route (P3); a document
  auto-triggers the document route (P4); enrichment (P5 — entities +
  embeddings) always runs last, regardless of modality — all synchronously
  inside the upload request, so the response's `status` reflects the
  fully-processed source, not just the probe result.
- `GET /api/v1/sources/{id}` — full source record: probed `duration_ms` /
  `page_count`, and `timeline_id` for video/audio sources (shared by every
  utterance and visual state derived from that source).
- `GET /api/v1/sources/{id}/evidence` — every evidence_item derived from
  this source (P5), vectors stripped from the listing.
- `GET /api/v1/jobs/{id}` — per-stage status (`probe`, `audio`, `visual`,
  `document`, `enrich`, ...). `job_id` is the same value as `source_id` —
  see the docstring in `api/routes/sources.py` for why there's no separate
  jobs collection.
- `GET /api/v1/events/{id}` — a semantic_event record (P6), built by
  `scripts/link.py`.
- `POST /api/v1/query` — the full retrieval + generation pipeline in one
  call (P7 + P8): deterministic plan → four seed channels → weighted RRF →
  bounded 2-hop expansion → coverage-aware bundle rerank → grounded
  generation → validators → response. Body: `{"question": str,
  "collection_id"?: str, "required_modalities"?: [str],
  "debug_trace"?: bool}`. See `api/routes/query.py` for the full response
  shape (`answer`, `claims`, `evidence`, `relationships`,
  `source_locators`, `support_label`, `stage_timings_ms`, `query_plan`,
  and — when `debug_trace: true` — per-channel ranks and which edge pulled
  in each expanded item).
- `GET /api/v1/evidence/{id}/source` — resolves one evidence item back to
  its originating Source record (P7).
- `POST /api/v1/evaluations/run` — runs `eval/run.py`'s harness in-request
  (P9): the full pipeline, its three ablations, and the naive baseline
  against every case in `eval/gold.yaml`. Body: `{"collection_id"?: str,
  "with_generation"?: bool}`. No `eval/gold.yaml` yet (no dataset) →
  returns `{"method": "not_measured", ...}` honestly rather than a
  fabricated result — see **Evaluation** below.

### Source status values

`uploaded` → `probing` → `probed` → `extracting` → `partial_ready` |
`ready` | `failed`. `ready` means every extraction stage *currently
implemented* for that media_type succeeded — see `REQUIRED_STAGES` in
`pipeline/runner.py`, which now includes `enrich` for every modality on
top of each modality's own extraction stage(s).

## Evaluation (P9)

```bash
uv run python eval/run.py [--collection-id demo_architecture] [--with-generation]
```

Runs every case in `eval/gold.yaml` against the full pipeline
(`retrieval/pipeline.py` — the exact same code path `POST /api/v1/query`
runs, factored out so an ablation can never drift from what the live
endpoint actually does), the same pipeline with each of three mechanisms
ablated (A1 no temporal edges, A2 no multimodal vector channel, A3 no
coverage-aware rerank), and `baseline/text_rag.py` (naive fixed-chunk,
single-vector, no states/edges/events/expansion — the fairness comparison
§09 P9 requires). Writes `eval/results.json` and `eval/results.md` with
measured Recall@5/@10, evidence-set F1, modality-completeness rate, link
precision/recall, provenance exact-match, and p50/p95 latency — see
`eval/run.py`'s module docstring for the exact definition of each metric.

**No `eval/gold.yaml` exists in this repo** — the judges haven't supplied
a dataset yet. Running the harness without it writes an honest
`"method": "not_measured"` result to both files instead of a fabricated
number, the same pattern `scripts/calibrate.py` already established for
P6's link-threshold calibration. Create `eval/gold.yaml` (schema in
`eval/run.py`'s docstring) once real cases exist, and the harness measures
for real — `tests/test_p9.py` proves the mechanism end-to-end against a
synthetic case today.

## Demo (P10)

```bash
uvicorn api.main:app &                          # server must already be running
uv run python scripts/demo.py --base-url http://127.0.0.1:8000
```

Runs four fixed-order queries (§09 P10) — hero query, change-over-time
query, insufficient-evidence query, then a baseline comparison on the hero
question — prints a readable transcript, and writes a backup copy to
`eval/demo_transcript.json` in case the live run fails during a
presentation. The change-over-time query runs as an ordinary grounded
query, not a claims/`SUPERSEDES`-aware timeline answer — that layer is
stretch-lane and wasn't built (see **Limitations**).

Retrieval (which evidence is found, for a fixed corpus) is exactly
reproducible run to run; the model's own generated text and support-label
are not — confirmed with two real runs against live Groq output that
found identical evidence but worded the answer differently, and once
returned zero claims where the other run returned one. That's real
provider-level non-determinism (this model routes through a
mixture-of-experts backend), not a bug — `tests/test_p10.py` asserts
determinism at the retrieval layer, where it's actually guaranteed, not on
generated text.

## Freeze / restore a corpus (P10)

```bash
uv run python scripts/freeze.py --collection-id demo_architecture --out data/snapshots/demo.json
# ships data/snapshots/demo.json + demo.assets.tar

uv run python scripts/restore.py --snapshot data/snapshots/demo.json
```

`freeze.py` exports every DB record for one `collection_id` (sources,
processing runs, evidence items, entities, relationships, semantic
events) plus a tar of the matching `data/assets/{raw,derived}` files.
`restore.py` is its exact inverse, idempotent (upserts by `_id`, safe to
run twice). A machine that restores a snapshot answers queries with **zero
re-processing** — no ASR, vision, OCR, or embedding calls happen during
restore, which is the entire point of freezing before a demo instead of
re-ingesting live. Round-trip tested against real Atlas (freeze → delete
every record and file → restore → confirm `status: "ready"` and content
intact) in both a manual smoke test and `tests/test_p10.py`. No real
judge-supplied corpus exists yet to freeze — this is the tooling, ready
the moment one does.

## Test

```bash
pytest tests/ -v
```

Tests talk to the real Atlas cluster configured in `.env` and the real
Groq/Voyage APIs, and clean up after themselves — deleted documents,
deleted asset files, and (via `tests/conftest.py`'s `cleanup_source()`)
any entities the auto-triggered enrich stage created that existed only
because of that test's own source, so repeated runs never pollute the
shared, globally-unique-indexed `entities` collection. Each test file
gates on exactly the credentials its own acceptance criteria need — e.g.
P6's timeline-guard and clustering tests are pure functions that need no
credentials at all, P8's live-generation tests need `GROQ_API_KEY` (and
pass against real output) — every gated test skips cleanly rather than
failing when a credential is missing.

Tests that call an async, DB-touching function directly rather than going
through an HTTP round trip (from P5 onward) run it on the live server's
own event loop via `tests/conftest.py`'s `server_loop` fixture +
`run_on_server_loop()` helper, not the test's own pytest-asyncio loop —
Motor's client is bound to whichever event loop first used it, and pytest
hands each test function a fresh one by default, so calling `coll()`
straight from a test coroutine crashes with "Future attached to a
different loop" the moment a `live_server_url`-using test has already run
earlier in the session. P2/P3/some P1 tests boot that real `uvicorn`
server in a background thread in the first place rather than using an
in-process ASGI transport — see `tests/conftest.py`'s docstring for the
same underlying reason: an in-process transport that routes through
anyio's task-group machinery reliably breaks once a request is slow enough
to matter (real network calls, not P1's near-instant local ffprobe/PyMuPDF
probes). Test-side DB verification uses plain synchronous PyMongo for the
same reason — no event-loop affinity to break.

## Layout

```
omnitrace/       config, Pydantic models, DB access, IDs, asset store, LLM client (chat/vision/ASR — all Groq)
pipeline/        stage runner + per-stage logic (probe, audio, visual, document)
enrich/          entity resolution (P5), embeddings (P5)
link/            candidate generation, scoring, event clustering (P6)
retrieval/       vector index, query planner, seed channels, fusion, expansion, rerank, shared
                 pipeline orchestration (retrieval/pipeline.py — P7, reused by eval/run.py for P9)
generate/        grounded-generation prompt, JSON-schema response contract, validators (P8, runs on Groq)
baseline/        naive fixed-chunk single-vector RAG — the P9 fairness comparison
eval/            eval/run.py (P9 harness) + generated eval/gold.yaml, results.json, results.md, demo_transcript.json
api/             FastAPI app and routes (sources, query, events, evaluations)
scripts/         ops scripts — search index bootstrap, linker, calibration, freeze/restore (P10), demo (P10)
data/assets/     local content-addressed storage for raw + derived files (gitignored)
data/snapshots/  frozen corpus snapshots (scripts/freeze.py output, gitignored)
tests/           acceptance tests, one file per phase, + shared live-server fixture
```

## Design notes worth knowing before touching this code

- **No queue.** The stage runner is synchronous and in-process. A stage runs
  to completion inside the request that triggered it. Idempotency keys (hash
  of source content + stage + processor version + config) make retries safe
  without a queue's bookkeeping.
- **Idempotent by content hash.** A source is identified by its SHA-256, not
  its filename. Re-uploading the same bytes returns the existing source.
- **Probe failures never delete the raw upload.** A corrupt or unreadable
  file gets `status: "failed"`, but the original bytes stay in
  `data/assets/raw/`. Ground truth is immutable regardless of what later
  stages can or can't do with it.
- **One timeline per video/audio source.** `Source.timeline_id` is
  generated once (first extraction stage to need it) and reused by every
  atomic observation derived from that source — utterances, visual states,
  OCR regions all carry the same `location.timeline_id` but distinct
  evidence IDs. This is what makes "was this said while that diagram was
  on screen" a valid question later (P6/P7) instead of a coincidence.
- **Speaker integrity.** No real diarization is implemented (documented
  cut-line, matches the architecture doc's own fallback). Every utterance
  gets the single stable anonymous `speaker_id: "spk_01"` — never a
  model-inferred name.
- **OCR and vision are two separate passes, on purpose.** pytesseract gives
  literal, boxed, confidence-scored text. The vision model gives a
  paraphrased semantic read. Mixing them would let the model's paraphrasing
  quietly stand in for the literal transcript that exact-text retrieval and
  provenance depend on.
- **Vector backend is swappable.** `VECTOR_BACKEND=atlas` uses Atlas
  `$vectorSearch`; `VECTOR_BACKEND=numpy` is a structural hedge for if the
  Atlas index isn't `READY` yet at demo time (see `.env.example`). Not wired
  up until P5/P7.
- **Every ID is prefixed** (`src_`, `ev_`, `run_`, ...) — see
  `omnitrace/ids.py`. Prefixes make it obvious what you're looking at in the
  Mongo shell without a schema lookup.
- **Documents never get a timeline_id.** Page/block/paragraph order is
  their native location, never a fabricated timestamp (P4). Embedded
  images and scanned pages are routed through the *same* visual processor
  P3 built (`pipeline/visual.py`'s `process_single_image`) — one
  processor, three entry points (video frame, standalone image, document
  page/embedded image).
- **Entity extraction is deterministic, not model-based** (P5). A generic
  capitalized-phrase/acronym/hyphenated-term heuristic finds candidates;
  resolution is exact-match plus a hand-seeded alias table
  (`enrich/entities.py`'s `SEED_ALIASES`, empty by default — extend it
  once the real corpus is seen, never guess ahead of the data). "Entity
  overlap is a linking signal; entity resolution is a research problem" —
  this build takes the signal, skips the problem.
- **Every graceful-degradation path is real, not aspirational.** No
  `GROQ_API_KEY` → vision fields fall back to `"unknown"`/empty, OCR still
  runs, and `POST /api/v1/query` still returns the retrieved evidence
  bundle with `missing_information` instead of a generated answer (this
  one key gates ASR, vision, *and* P8 generation now — see **Model
  provider**). No `VOYAGE_API_KEY` → embedding stage logs a warning and
  skips, the lexical and structured retrieval channels still work. Atlas
  Search/vector index not `READY` → the relevant channel returns nothing
  instead of raising; RRF fuses whatever did respond.
- **The linker is a corpus-wide batch pass, not a per-upload stage**
  (P6). `scripts/link.py` re-derives the whole relationship graph and
  event set for a collection from scratch each run — cross-file candidate
  generation needs the full evidence set to already exist, so it can't run
  per-source like probe/audio/visual/document/enrich do.
- **Calibration is honest about not having data yet.**
  `scripts/calibrate.py` always writes `eval/candidates.csv`. Without
  `eval/gold.yaml` (no dataset — the judges haven't supplied one) it writes
  `eval/threshold_sweep.json` with `"method": "prior"`, using the
  `LINK_CONFIRM`/`LINK_TENTATIVE` values already in `.env` — it never
  fabricates a measured-sounding F1 number it didn't actually compute.
- **The query planner is deterministic only** (P7). §09's own cut-line
  drops the optional model-based planner as the lowest-cost thing to cut;
  this build takes that cut rather than spending time on it before P8 was
  even wired up. Slot/entity extraction runs in well under a millisecond
  and cannot fail in a way that blocks retrieval.
- **Locator authenticity is enforced by construction, not just checked**
  (P8). `generate/prompt.py`'s response schema has no timestamp/page/box
  fields at all — the model can only ever cite an `evidence_id`.
  `api/routes/query.py` re-hydrates every returned locator from the stored
  record afterward, so there's no generated text for a validator to catch
  fabricating in the first place.
- **Ablations reuse the real pipeline, never a reimplementation** (P9).
  `retrieval/pipeline.py`'s `run_full_pipeline()` is the one orchestration
  both `POST /api/v1/query` and `eval/run.py` call; its three ablation
  flags (`exclude_edge_types`, `disabled_channels`, `coverage_aware`)
  thread straight into hooks added to `retrieval/expand.py`,
  `retrieval/channels.py`, and `retrieval/rerank.py`, each defaulting to a
  no-op so no pre-P9 caller's behavior changed. An ablation that lived in
  separate eval-only code could silently drift from what the live endpoint
  actually does; this can't.
- **Evaluation honesty is a running rule, not a one-off** (P6 and P9). Both
  `scripts/calibrate.py` and `eval/run.py` always write their output file —
  never skip it — and both write `"method": "prior"` / `"not_measured"`
  plus a plain-English note instead of a number when there's nothing real
  to report. Neither ever pre-fills an expected-looking value.

## Conversation scoping and the no-source answer

Two behaviours worth knowing, because they change what a "collection" means
and when an answer is grounded.

**Every conversation owns a collection.** `POST /api/v1/sources` takes an
optional `collection_id` form field and the web client mints a fresh one per
investigation, so a file uploaded in one conversation is not retrievable from
another. Omit the field and it still falls back to `COLLECTION_ID` from the
environment, which is what `scripts/demo.py` and the curl flow in
`test_data/README.md` rely on — those are unchanged.

Note that the stage idempotency key includes `source_id`, not only the content
hash. Uploading identical bytes into a second collection is genuinely
different work — it needs its own evidence rows — and a content-only key made
the runner skip every stage as already-done, yielding a source with zero
evidence. Duplicate protection *within* one collection still happens at upload
time, by checksum.

**A question asked with no sources is answered from general knowledge.** When
retrieval returns an empty bundle, `generate_general_answer()` answers
directly and the response carries `support_label: "ungrounded"` with empty
`claims` and `source_locators`. This does not weaken the grounding guarantee,
because it is a different guarantee: an answer built from a bundle still may
cite only IDs inside that bundle and still reports its gaps. The ungrounded
prompt explicitly forbids inventing citations, timestamps, page numbers or
speaker names, so the absence of provenance there is honest rather than merely
unstyled — and `support_label` makes the two cases distinguishable everywhere
downstream.

## Limitations

Honest accounting of every real gap and every cut-line actually invoked,
not just the ones a demo might surface:

- **No judge-supplied dataset yet.** `eval/gold.yaml` doesn't exist, so
  `eval/run.py` (P9) reports `"method": "not_measured"` rather than a
  fabricated number, and `scripts/calibrate.py` (P6) falls back to the
  configured `LINK_CONFIRM`/`LINK_TENTATIVE` prior rather than a measured
  threshold. Both harnesses are fully built and proven against synthetic
  cases (`tests/test_p9.py`) — once a real corpus + labels arrive, running
  them produces real numbers with no code changes.
- **No real corpus has been frozen.** `scripts/freeze.py`/`restore.py`
  (P10) are built and round-trip-tested against a synthetic source, not
  the actual judge-supplied corpus, which doesn't exist in this
  environment yet.
- **`VOYAGE_API_KEY` is not configured.** The two vector retrieval
  channels and `baseline/text_rag.py` all degrade to "no results" with a
  logged warning. Lexical and structured retrieval still work — the
  demo's hero query answers correctly through them alone (see **Demo**) —
  but recall on paraphrased or purely visual queries is lower than it
  would be with real embeddings.
- **No Anthropic key is used anywhere, by explicit direction.** P8's
  grounded generation runs on Groq (`openai/gpt-oss-120b`) instead of the
  architecture doc's originally-specified Claude Opus 5 — see **Model
  provider** for the full rationale. Functionally equivalent contract
  (evidence-only, JSON-schema-shaped, citation-validated), different
  underlying model. A real, measurable consequence of this swap: the model
  is not perfectly deterministic even at `temperature=0` (confirmed
  directly — two identical calls against the same evidence bundle
  produced different claim counts), which is why `tests/test_p10.py`
  checks demo-run determinism only at the retrieval layer.
- **Architected cut-lines** (chosen from the start, not late compromises
  under time pressure — each documented in its own module's docstring):
  P3 uses fixed-interval frame sampling instead of ffmpeg scene-cut
  detection; P4 flattens table cells to text instead of keeping structured
  coordinates; P7 uses the deterministic-only query planner and drops the
  optional model-based one; speaker diarization was never implemented —
  every utterance gets the single stable anonymous `speaker_id: "spk_01"`.
- **Stretch lane — deliberately not built.** §09 frames P8 as "the real
  finish line" and treats everything past P9/P10 as optional: the
  Claims + `SUPERSEDES` layer (temporal claim tracking — what the
  `change_over_time` demo query would ideally use), cross-file HDBSCAN
  candidate generation, ablations A4-A6, and expanding the eval set from
  12 to 20 cases were all correctly skipped in favor of finishing the two
  required remaining phases (P9, P10) first. None of the required-phase
  cut-lines (P9's "reduce to one ablation, reduce to 8 cases", P10's
  "none") were actually needed — both phases were built to their full
  spec.
