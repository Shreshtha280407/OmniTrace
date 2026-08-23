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
| P8 | Grounded generation + validators | ✅ done |
| P9 | Baseline + evaluation | not started |
| P10 | Freeze + demo | not started |

**Not yet run end-to-end against real data.** Every stage above is built,
unit-tested, and integration-tested (gated to skip cleanly without
credentials — see Test below), but nothing in this environment has actual
`MONGODB_URI` / `GROQ_API_KEY` / `ANTHROPIC_API_KEY` / `VOYAGE_API_KEY`
configured, and there's no browser-automation tool available to obtain
those here. See **Credentials needed** below.

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

Nothing in this build environment has real credentials configured. Fill
these into `.env` (copied from `.env.example`) to actually run it:

| Variable | Used by | What breaks without it |
|---|---|---|
| `MONGODB_URI` | everything | Nothing runs — every DB-backed test and endpoint skips/fails. Free M0 Atlas tier is enough. |
| `GROQ_API_KEY` | P2 (ASR), P3/P4 (vision) | Transcription and vision calls fail; visual/document stages still complete (OCR + structure only, vision fields fall back to `"unknown"`/empty — see `pipeline/visual.py`'s `LLMError` handling). |
| `VOYAGE_API_KEY` | P5 (embeddings), P7 (vector channels) | `enrich/embed.py` skips embedding with a logged warning instead of failing the stage; the two vector-search retrieval channels contribute nothing, lexical + structured channels still work. |
| `ANTHROPIC_API_KEY` | P8 (grounded generation) | `POST /api/v1/query` returns retrieval results with `missing_information: ["generation failed: ..."]` instead of a generated answer. |

Every one of these degrades gracefully rather than crashing — this was a
deliberate design choice throughout (see each phase's module docstrings)
specifically so the system stays demoable while credentials are being
sorted out. This session had no browser-automation tool available to
create the Atlas cluster or fetch API keys — that setup has to happen
outside this session.

## Model provider

ASR (`whisper-large-v3-turbo`) and vision (`qwen/qwen3.6-27b`, or whatever
current vision-capable model Groq is hosting) run through **Groq's
OpenAI-compatible API** — this is a deliberate stand-in until the project is
built out further, at which point the plan is to swap to OpenAI directly.
That swap is meant to be small: `omnitrace/llm.py` is written against the
plain OpenAI-shaped chat-completions / audio-transcriptions request and
response contract that Groq mirrors, so switching providers should only
mean changing `LLM_BASE_URL`, the API key, and the model IDs in
`omnitrace/config.py` / `.env` — not touching `pipeline/audio.py` or
`pipeline/visual.py`.

Literal OCR (pytesseract, local, real per-line boxes + confidence) is kept
deliberately separate from the vision model's semantic read (visual type,
summary, diagram facts) — see the module docstring in `pipeline/visual.py`
for why mixing them would be a mistake.

Two more providers land from P5 onward, both independent of the Groq
setup above:

- **Voyage** (`voyage-3-large` text, `voyage-multimodal-3` multimodal) —
  embeddings, via the `voyageai` SDK directly (`enrich/embed.py`). Index-time
  calls use `input_type="document"`, query-time calls (`retrieval/channels.py`)
  use `input_type="query"` — same model, asymmetric embedding.
- **Anthropic** (`claude-opus-5`) — grounded generation only
  (`generate/answer.py`), via `output_config: {format: {type: "json_schema",
  schema: ...}}` (Structured Outputs), never assistant-turn prefill, with
  prompt caching on the system prompt. The architecture doc's §04 model
  table also pins Claude Sonnet 5 for vision as the eventual target state;
  P3 was already built and tested against Groq's vision model before this
  build reached §04, so vision stays on Groq for now — swapping it is the
  same small change described above, just not done yet.

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

### Source status values

`uploaded` → `probing` → `probed` → `extracting` → `partial_ready` |
`ready` | `failed`. `ready` means every extraction stage *currently
implemented* for that media_type succeeded — see `REQUIRED_STAGES` in
`pipeline/runner.py`, which now includes `enrich` for every modality on
top of each modality's own extraction stage(s).

## Test

```bash
pytest tests/ -v
```

Tests talk to the real Atlas cluster configured in `.env` and the real
Groq/Anthropic/Voyage APIs, and clean up after themselves (deleted
documents, deleted asset files). Each test file gates on exactly the
credentials its own acceptance criteria need — e.g. P6's timeline-guard
and clustering tests are pure functions that need no credentials at all,
P8's validator tests only need `ANTHROPIC_API_KEY` for the two tests that
actually call the live model — and every gated test skips cleanly rather
than failing when a credential is missing. P2/P3/some P1 tests boot a real
`uvicorn` server in a background thread (`tests/conftest.py`'s
`live_server_url` fixture) rather than using an in-process ASGI transport
— see that file's docstring for why: Motor's client is bound to whichever
asyncio event loop first uses it, and an in-process transport that routes
through anyio's task-group machinery reliably breaks that once a request
is slow enough to matter (real network calls, not P1's near-instant local
ffprobe/PyMuPDF probes). Test-side DB verification uses plain synchronous
PyMongo for the same reason — no event-loop affinity to break.

## Layout

```
omnitrace/       config, Pydantic models, DB access, IDs, asset store, LLM client
pipeline/        stage runner + per-stage logic (probe, audio, visual, document)
enrich/          entity resolution (P5), embeddings (P5)
link/            candidate generation, scoring, event clustering (P6)
retrieval/       vector index, query planner, seed channels, fusion, expansion, rerank (P5/P7)
generate/        grounded-generation prompt + Structured Outputs schema, validators (P8)
api/             FastAPI app and routes
scripts/         one-off ops scripts (search index bootstrap, linker, calibration)
data/assets/     local content-addressed storage for raw + derived files (gitignored)
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
  runs. No `VOYAGE_API_KEY` → embedding stage logs a warning and skips, the
  lexical and structured retrieval channels still work. No
  `ANTHROPIC_API_KEY` → `POST /api/v1/query` still returns the retrieved
  evidence bundle, just with `missing_information` instead of a generated
  answer. Atlas Search/vector index not `READY` → the relevant channel
  returns nothing instead of raising; RRF fuses whatever did respond.
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
