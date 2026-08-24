"use client";

import { AlertTriangle, GitFork, Info, Loader2, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ClaimCard, DisclosureList } from "@/components/ui/ClaimCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusPill, supportLabel, supportTone } from "@/components/ui/StatusPill";
import { StreamingText } from "@/components/ui/StreamingText";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api";
import type { QueryResponse } from "@/lib/api/schemas";
import { formatMs } from "@/lib/format";
import { evidenceTruncatedCount, type Turn } from "@/lib/sessions";
import { useSourceCount } from "@/hooks/useSourceCount";
import { cn } from "@/lib/utils";

import { AnswerSources } from "./AnswerSources";
import { Composer } from "./Composer";
import { ProcessingTrace } from "./ProcessingTrace";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { useWorkspace } from "./WorkspaceProvider";

/** Examples shown only once this conversation actually has sources.
 *
 *  Two earlier problems: they were offered on a completely empty workspace,
 *  which invited the user to click a question about material that did not
 *  exist; and they named the demo corpus's own subject matter (Redis, Postgres,
 *  database load), which is wrong for anybody who uploads their own files.
 *  These are phrased against whatever the conversation happens to contain, and
 *  each still exercises a retrieval behaviour a plain text RAG cannot. */
const EXAMPLE_PROMPTS = [
  {
    kind: "Overview",
    detail: "spans every source in this chat",
    question: "What do these sources cover, and what are the main points?",
  },
  {
    kind: "Contrastive",
    detail: "what documents say that speech does not",
    question: "What is stated in the documents but never discussed out loud?",
  },
  {
    kind: "Temporal",
    detail: "visual state aligned to an utterance",
    question: "Show me every point where something on screen matched something being said.",
  },
  {
    kind: "Gap-aware",
    detail: "reports what is absent, not a guess",
    question: "What was decided, and what evidence is missing to confirm it?",
  },
];

export function Conversation() {
  const { activeSession, isQuerying, activeTurnId, submitQuery, hydrated } = useWorkspace();
  const sourceCount = useSourceCount();
  const scrollRef = useRef<HTMLDivElement>(null);
  const turns = activeSession?.turns ?? [];

  // Follow the tail while a query is running, but never yank the view if the
  // user has scrolled up to read an earlier answer.
  const pinnedRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (pinnedRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [turns.length, activeTurnId]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-ink-900" aria-label="Investigation conversation">
      <WorkspaceHeader />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* The empty state centres in the column instead of stacking at the
            top of it — top-aligned, it left a third of the workspace as blank
            floor between the prompts and the composer, which reads as a
            screen that failed to load rather than one waiting for input. */}
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl flex-col px-4 py-6 sm:px-6",
            // `safe center` and not plain `justify-center`: on a short viewport
            // the prompt set is taller than the column, and ordinary centring
            // overflows equally in both directions — the top of the empty state
            // ends up above the scroll origin and is unreachable. `safe` falls
            // back to flex-start exactly when that would happen.
            turns.length === 0 && hydrated && "min-h-full [justify-content:safe_center] py-10",
          )}
        >
          {!hydrated ? (
            <div className="space-y-4" aria-hidden>
              <div className="skeleton h-6 w-2/3" />
              <div className="skeleton h-24 w-full" />
            </div>
          ) : turns.length === 0 ? (
            <EmptyPrompts
              hasSources={sourceCount > 0}
              onPick={(q) => void submitQuery({ question: q, requiredModalities: [], debugTrace: false })}
            />
          ) : (
            <ol className="space-y-10">
              {turns.map((turn) => (
                <li key={turn.id}>
                  <TurnView turn={turn} running={isQuerying && activeTurnId === turn.id} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-ink-600/70 bg-ink-900/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <Composer />
        </div>
      </div>
    </section>
  );
}

function EmptyPrompts({ hasSources, onPick }: { hasSources: boolean; onPick: (question: string) => void }) {
  return (
    <div>
      <div className="mb-7">
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-signal-600/30 bg-signal-900/40">
          <Sparkles className="size-4 text-signal-400" aria-hidden />
        </div>
        <h2 className="font-display text-[1.875rem] leading-tight text-ink-50">
          {hasSources ? "Ask about your sources" : "Start a conversation"}
        </h2>
        <p className="mt-2.5 max-w-lg text-pretty text-ui-sm leading-relaxed text-ink-200">
          {hasSources
            ? "Answers are grounded in the sources you added here, and every citation opens at the exact timestamp, page or region it came from."
            : "Ask anything to get started. Add a video, recording, image or document and answers will be grounded in it — cited back to the exact timestamp, page or region."}
        </p>
      </div>

      {/* No suggestions until this conversation actually has something to
          search. Offering "what do these sources cover?" against an empty
          collection invites a click that cannot be honoured. */}
      {!hasSources ? null : (
      <>
      <p className="eyebrow mb-3">Try one of these</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <li key={prompt.question}>
            <button
              type="button"
              onClick={() => onPick(prompt.question)}
              className="group flex h-full w-full flex-col rounded-lg border border-ink-600/70 bg-ink-850/50 p-3.5 text-left transition-all duration-150 hover:-translate-y-px hover:border-signal-600/50 hover:bg-ink-800 hover:shadow-panel"
            >
              <span className="mb-2 flex items-center gap-2">
                <Search
                  className="size-3 shrink-0 text-ink-400 transition-colors group-hover:text-signal-400"
                  aria-hidden
                />
                <span className="font-mono text-ui-2xs uppercase tracking-[0.14em] text-ink-300 transition-colors group-hover:text-signal-300">
                  {prompt.kind}
                </span>
              </span>
              <span className="text-pretty text-ui-sm leading-relaxed text-ink-100 transition-colors group-hover:text-ink-50">
                {prompt.question}
              </span>
              <span className="mt-2 text-ui-2xs leading-relaxed text-ink-400">{prompt.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      </>
      )}
    </div>
  );
}

function TurnView({ turn, running }: { turn: Turn; running: boolean }) {
  const { evidenceById, openSourceDrawer, selectedEvidenceId, retryTurn } = useWorkspace();
  const [answerRevealed, setAnswerRevealed] = useState(false);

  const jobIds = turn.jobIds ?? [];

  return (
    <article className="space-y-4">
      {/* ── question ──────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm border border-ink-600 bg-ink-800 px-3.5 py-2.5">
          <p className="whitespace-pre-wrap text-pretty text-ui-sm leading-relaxed text-ink-50">{turn.question}</p>
          {(turn.requiredModalities.length > 0 || turn.debugTrace) && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {turn.requiredModalities.map((m) => (
                <span key={m} className="rounded-sm border border-ink-550 px-1.5 py-px font-mono text-[10px] text-ink-300">
                  require {m}
                </span>
              ))}
              {turn.debugTrace && (
                <span className="rounded-sm border border-uv-500/40 bg-uv-800/40 px-1.5 py-px font-mono text-[10px] text-uv-300">
                  debug_trace
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── ingestion traces for sources attached to this turn ────── */}
      {jobIds.length > 0 && (
        <div className="space-y-2">
          {jobIds.map((jobId) => (
            <ProcessingTrace key={jobId} jobId={jobId} />
          ))}
        </div>
      )}

      {/* ── running ───────────────────────────────────────────────── */}
      {running && <RetrievalPending />}

      {/* ── error ─────────────────────────────────────────────────── */}
      {turn.error && !running && (
        <ErrorState
          error={
            new ApiError({
              kind: (turn.error.kind as never) ?? "server",
              message: turn.error.message,
              detail: turn.error.message,
              retryable: turn.error.retryable,
            })
          }
          title="This query did not complete"
          onRetry={() => retryTurn(turn.id)}
        />
      )}

      {/* ── response ──────────────────────────────────────────────── */}
      {turn.response && !running && (
        <ResponseView
          response={turn.response}
          evidenceById={evidenceById}
          selectedEvidenceId={selectedEvidenceId}
          onSelectEvidence={openSourceDrawer}
          revealed={answerRevealed}
          onRevealed={() => setAnswerRevealed(true)}
        />
      )}
    </article>
  );
}

/**
 * Shown while POST /query is open.
 *
 * The backend does one round trip and returns stage timings at the end, so
 * there is no per-stage progress to report mid-flight. Rather than animate
 * fake step completions, this states the pipeline that is running and marks
 * the whole thing as in progress. Real timings appear when the response lands.
 */
function RetrievalPending() {
  const stages = ["Planning query", "Four-channel retrieval", "Bounded expansion", "Bundle rerank", "Grounded generation"];
  return (
    <div className="rounded-lg border border-ink-600/70 bg-ink-850/70 p-3" role="status" aria-live="polite">
      <div className="mb-2.5 flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin text-signal-400" aria-hidden />
        <span className="eyebrow">Retrieval in progress</span>
      </div>
      <ol className="space-y-1">
        {stages.map((stage) => (
          <li key={stage} className="flex items-center gap-2 text-ui-2xs text-ink-400">
            <span aria-hidden className="size-1 rounded-full bg-ink-500" />
            {stage}
          </li>
        ))}
      </ol>
      <p className="mt-2.5 border-t border-ink-600/50 pt-2 text-[10.5px] leading-relaxed text-ink-500">
        The backend runs these as one request and reports per-stage timings on completion.
      </p>
    </div>
  );
}

function ResponseView({
  response,
  evidenceById,
  selectedEvidenceId,
  onSelectEvidence,
  revealed,
  onRevealed,
}: {
  response: QueryResponse;
  evidenceById: Record<string, import("@/lib/api/schemas").EvidenceItem>;
  selectedEvidenceId: string | null;
  onSelectEvidence: (id: string) => void;
  revealed: boolean;
  onRevealed: () => void;
}) {
  const totalMs = useMemo(
    () => Object.values(response.stage_timings_ms).reduce((sum, ms) => sum + ms, 0),
    [response.stage_timings_ms],
  );
  const truncated = evidenceTruncatedCount(response);

  const noAnswer = response.answer.trim().length === 0;

  return (
    <div className="space-y-4">
      {/* support + timings header */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={supportTone(response.support_label)} size="sm" dot>
          {supportLabel(response.support_label)}
        </StatusPill>
        <span className="font-mono text-ui-2xs tabular text-ink-400" title="Sum of reported stage timings">
          {formatMs(totalMs)}
        </span>
        <span className="font-mono text-ui-2xs tabular text-ink-500">
          {response.evidence.length} evidence · {response.relationships.length} relationships
        </span>
      </div>

      {/* the answer */}
      {noAnswer ? (
        <EmptyState
          compact
          tone="caution"
          icon={AlertTriangle}
          title="No grounded answer was produced"
          description="The backend returned an empty answer. When this happens it is because generation failed or no evidence was retrieved — see missing information below."
        />
      ) : (
        <StreamingText
          text={response.answer}
          mode="reveal"
          onComplete={onRevealed}
          className="text-ui-base leading-[1.75] text-ink-50"
        />
      )}

      {/* claims */}
      {response.claims.length > 0 && (
        <div className={cn("space-y-2 transition-opacity duration-300", revealed ? "opacity-100" : "opacity-45")}>
          <h3 className="eyebrow pt-1">Claims · {response.claims.length}</h3>
          {response.claims.map((claim, i) => (
            <ClaimCard
              key={i}
              claim={claim}
              index={i}
              evidenceById={evidenceById}
              onSelectEvidence={onSelectEvidence}
              activeEvidenceId={selectedEvidenceId}
            />
          ))}
        </div>
      )}

      {/* Provenance affordance. Rendered only for an answer that actually has a
          bundle behind it: an ungrounded answer (no sources in the
          conversation) has nothing to open, and offering the control anyway
          would imply provenance it does not have. */}
      {response.support_label !== "ungrounded" && response.evidence.length > 0 && (
        <div className="pt-0.5">
          <AnswerSources evidence={response.evidence} />
        </div>
      )}

      {/* gaps and conflicts — deliberately prominent */}
      <div className="space-y-2">
        <DisclosureList
          title="Missing information"
          items={response.missing_information}
          tone="caution"
          icon={Info}
        />
        <DisclosureList title="Conflicting evidence" items={response.conflicts} tone="contextual" icon={GitFork} />
      </div>

      {truncated > 0 && (
        <p className="text-ui-2xs text-ink-500">
          {truncated} further evidence items were returned by the backend but not kept in this browser&apos;s stored
          copy of the investigation. Re-run the query to see the full bundle.
        </p>
      )}

      {response.debug_trace && <DebugTrace trace={response.debug_trace} />}
    </div>
  );
}

function DebugTrace({ trace }: { trace: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-uv-500/25 bg-uv-800/15">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="font-mono text-ui-2xs uppercase tracking-[0.12em] text-uv-300">Debug trace</span>
        <span className="ml-auto font-mono text-ui-2xs text-ink-400">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-uv-500/20 p-3 font-mono text-[11px] leading-relaxed text-ink-300">
          {JSON.stringify(trace, null, 2)}
        </pre>
      )}
    </div>
  );
}
