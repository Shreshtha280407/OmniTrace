/**
 * Formatting for evidence telemetry.
 *
 * Every function here is total: given null/undefined it returns a dash, never
 * a fabricated zero. A missing timestamp is a real state in this system
 * (documents and images have no timeline) and must not be rendered as 00:00.
 */

/** `142300` -> `02:22.3`. Hours only appear when the source is that long. */
export function formatTimecode(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const total = Math.max(0, ms);
  const tenths = Math.floor((total % 1000) / 100);
  const seconds = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60_000) % 60;
  const hours = Math.floor(total / 3_600_000);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}.${tenths}` : `${mm}:${ss}.${tenths}`;
}

/** Duration without sub-second precision — for source lengths, not locators. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Milliseconds of wall-clock work. Stage timings are reported, not hidden. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** `0.913` -> `0.91`. Confidence is never rounded up to a flattering 1.00. */
export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (Math.floor(value * 100) / 100).toFixed(2);
}

/** Long IDs are elided in the middle so both the prefix and suffix stay
 *  recognisable — `evidence_01J…8FQ2`. Full value belongs in a title/copy. */
export function truncateId(id: string | null | undefined, head = 10, tail = 4): string {
  if (!id) return "—";
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function formatChecksum(sha: string | null | undefined): string {
  if (!sha) return "—";
  return `${sha.slice(0, 12)}…${sha.slice(-6)}`;
}

/** Relative time for session lists. Falls back to a date past a week. */
export function formatRelativeTime(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const delta = Date.now() - then;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human label for a stage id emitted by the backend runner. */
const STAGE_LABELS: Record<string, string> = {
  probe: "Source fingerprint",
  audio: "Audio route",
  visual: "Visual route",
  document: "Document route",
  enrich: "Enrichment",
  link: "Relationship linking",
  index: "Search indexing",
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

/** Elapsed time between two ISO stamps from a ProcessingRun. */
export function stageElapsedMs(startedAt?: string | null, endedAt?: string | null): number | null {
  if (!startedAt || !endedAt) return null;
  const a = new Date(startedAt).getTime();
  const b = new Date(endedAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}
