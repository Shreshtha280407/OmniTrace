"use client";

import { AlertTriangle, Check, ChevronRight, CircleDashed, Loader2, X } from "lucide-react";
import { useState } from "react";

import type { JobStage, JobStatus } from "@/lib/api/schemas";
import { REQUIRED_STAGES } from "@/lib/api/schemas";
import { formatMs, stageElapsedMs, stageLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button } from "./Button";
import { StatusPill, stageTone } from "./StatusPill";

/**
 * RunTimeline — the processing trace.
 *
 * Every row here is a ProcessingRun document from `GET /api/v1/jobs/{id}`,
 * or a stage the runner is *required* to execute for this media type that has
 * not produced a run document yet. The second case renders as `queued`, which
 * is the truth: the backend omits stages it has not started.
 *
 * There is no synthetic progress. A running stage shows a spinner and no
 * percentage, because the backend does not report one. Durations come from
 * started_at/ended_at and are absent while a stage is still open.
 */

type DisplayStatus = "ok" | "failed" | "running" | "queued";

interface StageRow {
  stage: string;
  status: DisplayStatus;
  run: JobStage | null;
  elapsedMs: number | null;
}

export function buildStageRows(job: JobStatus | undefined, mediaType: string | undefined): StageRow[] {
  if (!job) return [];
  const required = REQUIRED_STAGES[mediaType ?? ""] ?? [];
  // Union of required order and whatever actually ran, required order first so
  // the list reads as a pipeline rather than a hash iteration.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const stage of required) {
    ordered.push(stage);
    seen.add(stage);
  }
  for (const stage of Object.keys(job.stages)) {
    if (!seen.has(stage)) ordered.push(stage);
  }

  return ordered.map((stage) => {
    const run = job.stages[stage] ?? null;
    const status: DisplayStatus = run ? run.status : "queued";
    return { stage, status, run, elapsedMs: run ? stageElapsedMs(run.started_at, run.ended_at) : null };
  });
}

const ICONS: Record<DisplayStatus, React.ComponentType<{ className?: string }>> = {
  ok: Check,
  failed: X,
  running: Loader2,
  queued: CircleDashed,
};

export interface RunTimelineProps {
  job: JobStatus | undefined;
  mediaType: string | undefined;
  /** Offered only when a stage has actually failed. */
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  /** Compact form for the inline conversation trace. */
  dense?: boolean;
}

export function RunTimeline({ job, mediaType, onRetry, retrying, className, dense }: RunTimelineProps) {
  const rows = buildStageRows(job, mediaType);
  const failed = rows.some((r) => r.status === "failed");
  const running = rows.some((r) => r.status === "running");
  const queued = rows.filter((r) => r.status === "queued").length;

  if (rows.length === 0) return null;

  return (
    <div className={cn("rounded-lg border border-ink-600/70 bg-ink-850/70", className)}>
      <div className="flex items-center gap-2 border-b border-ink-600/60 px-3 py-2">
        <h4 className="eyebrow">Processing trace</h4>
        <StatusPill
          tone={failed ? "fault" : running ? "active" : queued ? "pending" : "validated"}
          size="xs"
          dot
          pulse={running}
        >
          {failed ? "Stage failed" : running ? "Running" : queued ? `${queued} queued` : "Complete"}
        </StatusPill>
        <span className="telemetry ml-auto truncate" title={job?.job_id}>
          {job?.job_id}
        </span>
      </div>

      <ol className="divide-y divide-ink-600/40">
        {rows.map((row) => (
          <StageRowItem key={row.stage} row={row} dense={dense} />
        ))}
      </ol>

      {failed && onRetry && (
        <div className="flex items-center gap-2 border-t border-ink-600/60 px-3 py-2">
          <AlertTriangle className="size-3.5 shrink-0 text-fault-400" aria-hidden />
          <p className="flex-1 text-ui-2xs text-ink-300">
            A stage failed. Re-uploading the source re-runs the pipeline; completed stages are reused via their
            idempotency key.
          </p>
          <Button size="xs" variant="danger" onClick={onRetry} loading={retrying}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

function StageRowItem({ row, dense }: { row: StageRow; dense?: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[row.status];
  const hasDetail = Boolean(row.run && (row.run.warnings.length > 0 || row.run.error || row.run.started_at));

  const tone =
    row.status === "ok"
      ? "text-validated-500"
      : row.status === "failed"
        ? "text-fault-500"
        : row.status === "running"
          ? "text-signal-400"
          : "text-ink-400";

  return (
    <li>
      <div className={cn("flex items-center gap-2.5 px-3", dense ? "py-1.5" : "py-2")}>
        <Icon className={cn("size-3.5 shrink-0", tone, row.status === "running" && "animate-spin")} aria-hidden />
        <span
          className={cn(
            "flex-1 truncate text-ui-xs",
            row.status === "queued" ? "text-ink-400" : "text-ink-100",
          )}
        >
          {stageLabel(row.stage)}
        </span>

        {row.run?.warnings.length ? (
          <span className="flex items-center gap-1 text-ui-2xs text-caution-400" title={row.run.warnings.join("\n")}>
            <AlertTriangle className="size-3" aria-hidden />
            {row.run.warnings.length}
          </span>
        ) : null}

        <span className="w-16 shrink-0 text-right font-mono text-ui-2xs tabular text-ink-400">
          {row.status === "queued" ? "queued" : row.status === "running" ? "—" : formatMs(row.elapsedMs)}
        </span>

        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} technical detail for ${stageLabel(row.stage)}`}
            className="shrink-0 rounded-xs p-0.5 text-ink-400 transition-colors hover:text-ink-100"
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
          </button>
        )}
      </div>

      {open && row.run && (
        <dl className="space-y-0.5 border-t border-ink-600/30 bg-ink-900/50 px-3 py-2 pl-[34px]">
          <DetailRow label="stage">{row.stage}</DetailRow>
          <DetailRow label="status">{row.run.status}</DetailRow>
          {row.run.started_at && <DetailRow label="started">{row.run.started_at}</DetailRow>}
          {row.run.ended_at && <DetailRow label="ended">{row.run.ended_at}</DetailRow>}
          {row.run.warnings.map((warning, i) => (
            <DetailRow key={i} label={i === 0 ? "warnings" : ""} tone="caution">
              {warning}
            </DetailRow>
          ))}
          {row.run.error && (
            <DetailRow label="error" tone="fault">
              {row.run.error}
            </DetailRow>
          )}
        </dl>
      )}
    </li>
  );
}

function DetailRow({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "caution" | "fault";
}) {
  return (
    <div className="flex gap-2 font-mono text-[11px] leading-relaxed">
      <dt className="w-14 shrink-0 text-ink-500">{label}</dt>
      <dd
        className={cn(
          "min-w-0 flex-1 break-all",
          tone === "fault" ? "text-fault-400" : tone === "caution" ? "text-caution-400" : "text-ink-300",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
