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
| P4 | Document route (blocks, tables, scanned pages) | not started |
| P5 | Enrichment (entities, embeddings, search indexing) | not started |
| P6 | Linker, events, threshold calibration | not started |
| P7 | Retrieval (RRF, expansion, bundle rerank) | not started |
| P8 | Grounded generation + validators | not started |
| P9 | Baseline + evaluation | not started |
| P10 | Freeze + demo | not started |

## Setup

Requires Python 3.11+, `ffmpeg`/`ffprobe`/`tesseract` on `PATH`, and a
MongoDB Atlas cluster (free M0 tier is enough at this scale).

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install fastapi 'uvicorn[standard]' pydantic pydantic-settings \
    motor pymongo pymupdf python-multipart httpx python-ulid \
    pytesseract pillow imagehash numpy pytest pytest-asyncio

cp .env.example .env
# edit .env: set MONGODB_URI to your Atlas connection string, and
# GROQ_API_KEY (used for both ASR and vision — see Model provider below)
```

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

## Run

```bash
uvicorn api.main:app --reload
```

- `GET /health`
- `POST /api/v1/sources` — multipart upload (`file`). Accepts video, audio,
  image, and PDF/document extensions. Returns `{source_id, job_id, checksum,
  status}`. Re-uploading identical bytes reuses the existing source.
  Uploading a video or audio file auto-triggers the audio route (P2);
  video or image auto-triggers the visual route (P3) — both run
  synchronously inside the upload request, so the response's `status`
  reflects the fully-processed source, not just the probe result.
- `GET /api/v1/sources/{id}` — full source record: probed `duration_ms` /
  `page_count`, and `timeline_id` for video/audio sources (shared by every
  utterance and visual state derived from that source).
- `GET /api/v1/jobs/{id}` — per-stage status (`probe`, `audio`, `visual`,
  ...). `job_id` is the same value as `source_id` — see the docstring in
  `api/routes/sources.py` for why there's no separate jobs collection.

### Source status values

`uploaded` → `probing` → `probed` → `extracting` → `partial_ready` |
`ready` | `failed`. `ready` means every extraction stage *currently
implemented* for that media_type succeeded — see `REQUIRED_STAGES` in
`pipeline/runner.py`. That list grows as P4+ land, so a document source is
legitimately `"ready"` right now after just probing (P4 doesn't exist
yet) — that's not a bug, it's the status machinery being honest about what
this build can actually do today.

## Test

```bash
pytest tests/ -v
```

Tests talk to the real Atlas cluster configured in `.env` and the real Groq
API, and clean up after themselves (deleted documents, deleted asset
files). They skip cleanly if `MONGODB_URI` or `GROQ_API_KEY` isn't
configured. P2/P3/some P1 tests boot a real `uvicorn` server in a
background thread (`tests/conftest.py`'s `live_server_url` fixture) rather
than using an in-process ASGI transport — see that file's docstring for
why: Motor's client is bound to whichever asyncio event loop first uses
it, and an in-process transport that routes through anyio's task-group
machinery reliably breaks that once a request is slow enough to matter
(real network calls to Groq, not P1's near-instant local ffprobe/PyMuPDF
probes). Test-side DB verification uses plain synchronous PyMongo for the
same reason — no event-loop affinity to break.

## Layout

```
omnitrace/       config, Pydantic models, DB access, IDs, asset store, LLM client
pipeline/        stage runner + per-stage logic (probe, audio, visual; document later)
api/              FastAPI app and routes
scripts/         one-off ops scripts (search index bootstrap, later: calibration, demo)
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
