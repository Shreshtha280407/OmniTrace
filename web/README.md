# OmniTrace — frontend

The interface layer for the OmniTrace multimodal evidence pipeline. Built as a
separate pass against the frozen API contracts in `§12` of the architecture
document, per the decision ledger's `UI · DEFERRED — separate pass after P10`.

Three surfaces:

| Route | What it is |
|---|---|
| `/` | Marketing landing page with a WebGL evidence-constellation hero and a six-step product walkthrough |
| `/workspace` | Three-panel investigation workspace: sessions, conversation, evidence inspector |
| `/workspace/graph` | Interactive relationship explorer with query-path and lineage modes |
| `/workspace/sources/[id]` | Focused inspection of one source and every evidence item derived from it |

## Setup

Requires Node 20+ and a running OmniTrace backend (see the repository root
README for the Python service).

```bash
cd web
npm install
cp .env.example .env.local     # edit NEXT_PUBLIC_API_BASE_URL if not localhost:8000
npm run dev                    # http://localhost:3000
```

To evaluate the interface without a backend, Atlas cluster or provider keys:

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run dev
```

## Environment variables

Every variable is `NEXT_PUBLIC_*` and therefore **shipped to the browser**.
Nothing secret belongs in this app: the service-role keys, model provider keys
and `MONGODB_URI` live in the backend's own `.env` and are never referenced
from `web/src`.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Backend origin; the client appends `/api/v1` |
| `NEXT_PUBLIC_COLLECTION_ID` | `demo_architecture` | Must match `COLLECTION_ID` on the backend |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Absolute URLs in page metadata |
| `NEXT_PUBLIC_DEMO_MODE` | `false` | `true` serves labelled synthetic fixtures instead of calling the backend |
| `NEXT_PUBLIC_API_TOKEN` | — | Optional bearer token if the backend sits behind a gateway |
| `NEXT_PUBLIC_API_AUTH_HEADER` | `Authorization` | Header name for that token |
| `NEXT_PUBLIC_API_AUTH_SCHEME` | `Bearer` | Scheme prefix; set empty to send the raw token |
| `NEXT_PUBLIC_API_TIMEOUT_MS` | `120000` | Request timeout — generous because ingestion is synchronous |

## Backend contracts consumed

The client in `src/lib/api/` is typed and Zod-validated against exactly these
endpoints. Response shapes mirror `omnitrace/models.py` field for field.

```text
POST /api/v1/sources                  multipart upload → { source_id, job_id, checksum, status }
GET  /api/v1/jobs/{id}                stage-level ingestion status
GET  /api/v1/sources/{id}             Source record
GET  /api/v1/sources/{id}/evidence    every evidence item derived from a source
GET  /api/v1/events/{id}              SemanticEvent record
POST /api/v1/query                    the full retrieval + generation pipeline
GET  /api/v1/evidence/{id}/source     provenance reachability: evidence → its Source
GET  /health                          liveness, surfaced in the footer
```

`POST /api/v1/evaluations/run` is modelled in the client but belongs to backend
phase **P9, which is not built**. Calls to it return an `unavailable` error and
the UI reports it as "not deployed on this backend" — never as a failure of a
feature that exists.

### Notes on the contracts that shaped the UI

- **`job_id` is the same value as `source_id`.** There is no separate jobs
  collection; the backend says so explicitly. The client does not invent one.
- **Ingestion is synchronous.** `POST /api/v1/sources` runs probe and extraction
  inside the request, so upload progress reflects real bytes on the socket and
  the job is usually already terminal on the first poll. Polling still exists,
  with exponential backoff to a 15s ceiling, for deployments where that changes.
- **Stages the backend has not started have no run document at all.** The
  processing trace renders those as `queued` from the media type's required
  stage list rather than omitting them, which would make the pipeline look
  shorter than it is.
- **Locators are hydrated server-side.** The model never states a timestamp or
  page; `generate/validate.py` attaches them from the stored record. The
  interface treats a locator as authoritative and never estimates one.
- **A record is time-located or page-located, never both.** Documents and
  images have no timeline position. `formatTimecode(null)` returns `—`, and the
  graph's timeline scrubber has an explicit switch for untimed evidence rather
  than filtering it out by pretending it happened at some moment.

## Design system

Tokens live in `tailwind.config.ts` and `src/app/globals.css`.

- **Ground** — graphite `#090B0F` / `#0E1117`, charcoal surfaces, hairline
  borders, restrained depth. No glass everywhere, no glowing cards.
- **Primary signal** — electric teal `#19D6C4`: evidence, provenance, active
  state, confirmed relationships.
- **Secondary signal** — muted ultraviolet `#7A6DC9`, used sparingly for
  cross-modal and tentative relationships.
- **States** — muted green (validated), amber (missing evidence / partial),
  disciplined red (errors only).
- **Modality encoding** — a fixed four-way scale defined once in
  `src/lib/modality.ts` and consumed by the DOM, the WebGL graph and the canvas
  diagrams, so a teal node and a teal badge always mean the same thing.
- **Type** — Manrope for the product, Instrument Serif for major editorial
  headings on the marketing surface only, JetBrains Mono for IDs, timecodes,
  checksums and telemetry. If it is monospace, it is a machine value.

### Honesty rules encoded in components

These are the constraints the component layer enforces, not conventions:

- `StatusPill` has no `verified` tone, because no endpoint returns a
  verification verdict. Confirmed relationships and validated bundles are
  narrower claims and say so.
- `EvidenceChip` renders a cited id that is absent from the returned bundle as
  a visible fault, rather than dropping it.
- `ConfidenceMeter` distinguishes "0.00" from "not scored".
- `StreamingText` has two modes: `live` renders real deltas, `reveal` animates
  an already-received payload and marks itself `data-mode="reveal"`. It never
  animates progress that has not happened.
- The processing trace shows no percentage for a running stage, because the
  backend does not report one.
- Demo fixtures are only reachable behind `NEXT_PUBLIC_DEMO_MODE=true`, are
  never a fallback for a failed live request, and always render a banner.

## Accessibility & performance

- Skip link, semantic landmarks, visible focus rings, `aria-current` on the
  walkthrough rail, live regions for streamed answers and loading states.
- Keyboard: `/` focuses the composer, `Cmd/Ctrl+K` opens the command palette,
  `Esc` closes the innermost open panel, arrows drive the palette and the
  timeline scrubber handles.
- `prefers-reduced-motion` collapses animation durations and switches both
  WebGL scenes to a single settled frame.
- Three.js is dynamically imported, suspended when offscreen or when the tab is
  hidden, and capped at 1.75× DPR. Both WebGL surfaces have full-fidelity SVG
  fallbacks — the graph fallback is interactive, not a placeholder image.
- The marketing route's First Load JS excludes Three.js entirely.

## Testing

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest — 95 unit tests
npm run test:e2e       # playwright (builds and serves in demo mode)
```

Unit coverage (`tests/`):

| File | Covers |
|---|---|
| `api-schemas.test.ts` | Contract parsing: defaults, unknown-enum fallback, passthrough of unmodelled fields, and that a document's absent timestamp stays absent |
| `format.test.ts` | Locator and telemetry formatting, including the dash-not-zero rule |
| `sessions.test.ts` | Persistence round-trip, quota-failure reporting, corrupt-data recovery, and that compaction keeps every cited item |
| `graph-model.test.ts` | Graph construction, dangling-edge rejection, stats derived from confirmed edges only, layout convergence |
| `ui-state.test.tsx` | Processing-trace stage rows (queued vs running vs ok), status mappings, citation chips, streaming completion, upload validation |

End-to-end coverage (`e2e/`) runs in demo mode and exercises the landing page
and walkthrough, the full query → claims → citation → source-drawer path,
upload progress and rejection, session persistence across reload, keyboard
shortcuts, and graph navigation including mode switching and the timeline.

Playwright needs browsers on first run: `npx playwright install chromium`.

## Project layout

```text
src/
  app/                     routes: landing, workspace, graph, source detail
  components/
    landing/               hero (WebGL + SVG fallback), walkthrough, proof sections
    workspace/             three-panel shell, composer, conversation, inspector, drawers
    graph/                 force model, WebGL canvas, SVG fallback, context rail, scrubber
    ui/                    StatusPill, EvidenceChip, ModalityBadge, ConfidenceMeter,
                           RunTimeline, SourceLocator, ClaimCard, EmptyState, PanelShell,
                           CommandInput, StreamingText, GraphLegend, EvidenceDetail
  lib/
    api/                   schemas (Zod), client, demo adapter, fixtures, react-query hooks
    modality.ts            the four-way modality encoding, single source of truth
    format.ts              locator and telemetry formatting
    sessions.ts            localStorage-backed investigations
```

## Known limitations

- **No authentication.** The workspace is open; there is no sign-in, no route
  protection, and no per-user separation. Investigations are stored in the
  browser's `localStorage` and are shared by anyone using that browser profile.
- **Investigations are local-only.** They do not sync across browsers or
  devices, and a failed write is reported in the rail rather than retried.
  Stored responses are compacted to 24 evidence items; the conversation says so
  when the stored copy is partial.
- **Source count is a floor, not a total.** There is no "list sources in a
  collection" endpoint on the frozen API surface, so the rail counts sources
  observed through loaded investigations and this session's uploads, and labels
  it accordingly.
- **No collection switching.** `COLLECTION_ID` is a backend setting, so the
  switcher shows what is connected rather than offering a control that cannot work.
- **The graph is built from the current query's bundle**, plus the event record
  when one is reached — there is no whole-collection graph endpoint. With no
  query run, the page says there is nothing to draw instead of inventing one.
- **`POST /api/v1/evaluations/run` is not implemented on any backend build** (P9).
- **Media bytes are not served in demo mode**, so the source viewer draws a
  labelled schematic that still honours the real stored bounding box.
