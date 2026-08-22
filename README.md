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
| P2 | Audio route (ASR, diarization) | not started |
| P3 | Visual route (states, OCR, diagram facts) | not started |
| P4 | Document route (blocks, tables, scanned pages) | not started |
| P5 | Enrichment (entities, embeddings, search indexing) | not started |
| P6 | Linker, events, threshold calibration | not started |
| P7 | Retrieval (RRF, expansion, bundle rerank) | not started |
| P8 | Grounded generation + validators | not started |
| P9 | Baseline + evaluation | not started |
| P10 | Freeze + demo | not started |

## Setup

Requires Python 3.11+, `ffmpeg`/`ffprobe` on `PATH`, and a MongoDB Atlas
cluster (free M0 tier is enough at this scale).

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install fastapi 'uvicorn[standard]' pydantic pydantic-settings \
    motor pymongo pymupdf python-multipart httpx python-ulid pytest pytest-asyncio

cp .env.example .env
# edit .env: set MONGODB_URI to your Atlas connection string
```

## Bootstrap (once, before first ingestion)

```bash
# Create the Atlas Search + vector search indexes against the (empty)
# evidence_items collection. Index builds are asynchronous — do this first,
# not right before a demo.
python3 scripts/create_search_indexes.py
python3 scripts/create_search_indexes.py --status   # poll until READY
```

## Run

```bash
uvicorn api.main:app --reload
```

- `GET /health`
- `POST /api/v1/sources` — multipart upload (`file`). Accepts video, audio,
  image, and PDF/document extensions. Returns `{source_id, job_id, checksum,
  status}`. Re-uploading identical bytes reuses the existing source.
- `GET /api/v1/sources/{id}` — full source record, including probed
  `duration_ms` / `page_count`.
- `GET /api/v1/jobs/{id}` — per-stage status (currently just `probe`; more
  stages land in P2–P6). `job_id` is the same value as `source_id` — see the
  docstring in `api/routes/sources.py` for why there's no separate jobs
  collection.

## Test

```bash
pytest tests/ -v
```

Tests talk to the real Atlas cluster configured in `.env` and clean up after
themselves (deleted documents, deleted asset files). They skip cleanly if
`MONGODB_URI` isn't configured yet.

## Layout

```
omnitrace/       config, Pydantic models, DB access, IDs, asset store
pipeline/        stage runner + per-stage logic (probe now; extract et al. later)
api/              FastAPI app and routes
scripts/         one-off ops scripts (search index bootstrap, later: calibration, demo)
data/assets/     local content-addressed storage for raw + derived files (gitignored)
tests/           acceptance tests, one file per phase
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
- **Vector backend is swappable.** `VECTOR_BACKEND=atlas` uses Atlas
  `$vectorSearch`; `VECTOR_BACKEND=numpy` is a structural hedge for if the
  Atlas index isn't `READY` yet at demo time (see `.env.example`). Not wired
  up until P5/P7.
- **Every ID is prefixed** (`src_`, `ev_`, `run_`, ...) — see
  `omnitrace/ids.py`. Prefixes make it obvious what you're looking at in the
  Mongo shell without a schema lookup.
