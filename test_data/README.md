# Test data

Four files, one coherent story, one file per mandatory modality — so the
demo shows real cross-modal retrieval, not four unrelated samples.

**The story:** a team proposes a Redis cache-aside layer between the API
and PostgreSQL to cut database load, discussed in a design review meeting
and written up afterward.

| File | Modality | What it contributes |
|---|---|---|
| `design_review.mp4` | video | Narrated explanation of the proposal + an on-screen architecture diagram (`API → Redis Cache → PostgreSQL`). Exercises ASR, visual-state/OCR, and the shared timeline together. |
| `cache_risk_note.wav` | audio | Follow-up remark about the cache-invalidation/TTL risk. Exercises standalone audio ingestion. |
| `architecture_diagram.png` | image | Standalone version of the same architecture diagram. Exercises image ingestion + OCR + vision. |
| `design_doc.pdf` | document | Written design doc with an explicit numbered "Trade-offs" section. Exercises document block/section retrieval. |

## Loading it

```bash
uvicorn api.main:app &

for f in test_data/*; do
  [ -f "$f" ] || continue
  case "$f" in *.md) continue ;; esac
  curl -s -X POST http://127.0.0.1:8000/api/v1/sources -F "file=@$f"
  echo
done

# Optional but recommended before asking cross-modal questions — builds the
# EXPLAINS/TEMPORALLY_OVERLAPS/SHOWS relationship graph (P6):
uv run python scripts/link.py
```

## Questions to ask (`POST /api/v1/query`)

1. **Hero query** — spans speech, visual, and document evidence together:
   > What architecture was proposed to reduce database load, who explained it, and where was it shown?

2. **Trade-off** — pulls from the PDF's Trade-offs section and the audio clip:
   > What trade-off was noted about the caching approach?

3. **Insufficient evidence** — deliberately absent from the corpus; should
   return `missing_information` instead of a fabricated number, not fail:
   > What was the exact p99 latency measured after the cache was deployed to production?

4. **Where shown** — proves the visual-state/OCR retrieval path specifically:
   > Where was the architecture diagram shown?

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What architecture was proposed to reduce database load, who explained it, and where was it shown?"}'
```

Or run all four (plus a baseline comparison) in one go, in the same fixed
order the demo script uses:

```bash
uv run python scripts/demo.py --base-url http://127.0.0.1:8000
```
