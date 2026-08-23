import type { QueryResponse } from "@/lib/api/schemas";

/**
 * Investigation sessions.
 *
 * Persisted to localStorage under a versioned key, so a future change to the
 * stored shape can be migrated rather than silently misread.
 *
 * The honesty rule for this module: `save()` returns a result, and it returns
 * `false` when the write actually failed (quota exceeded, storage disabled,
 * private mode). Callers surface that. Nothing here reports a session as saved
 * that is not on disk — a silent catch would make the sidebar a lie the moment
 * the quota fills.
 */

export interface Turn {
  id: string;
  question: string;
  requiredModalities: string[];
  debugTrace: boolean;
  askedAt: number;
  /** Present once the query resolved. */
  response?: QueryResponse;
  /** Present when the query failed; the message shown to the user. */
  error?: { message: string; kind: string; retryable: boolean };
  /** Sources uploaded as part of this turn, for the processing trace. */
  jobIds?: string[];
}

export interface Session {
  id: string;
  title: string;
  collectionId: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
}

export interface PersistenceState {
  /** False once a write has failed; the UI shows an unsaved warning. */
  healthy: boolean;
  reason: string | null;
}

const STORAGE_VERSION = 1;

function storageKey(): string {
  return `omnitrace:v${STORAGE_VERSION}:sessions`;
}

export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/** First line of the question, trimmed to something that fits the rail. */
export function deriveTitle(question: string): string {
  const line = question.trim().split("\n")[0].trim();
  if (line.length === 0) return "Untitled investigation";
  return line.length > 64 ? `${line.slice(0, 61)}…` : line;
}

export function createSession(collectionId: string): Session {
  const now = Date.now();
  return {
    id: newId("inv"),
    title: "New investigation",
    collectionId,
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}

export function loadSessions(): { sessions: Session[]; state: PersistenceState } {
  if (typeof window === "undefined") return { sessions: [], state: { healthy: true, reason: null } };
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return { sessions: [], state: { healthy: true, reason: null } };
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { sessions: [], state: { healthy: true, reason: null } };
    // Shape is validated loosely: a stored session missing its id is dropped
    // rather than crashing the workspace on load.
    const sessions = (parsed as Session[]).filter(
      (s) => s && typeof s.id === "string" && typeof s.title === "string" && Array.isArray(s.turns),
    );
    return { sessions, state: { healthy: true, reason: null } };
  } catch (error) {
    return {
      sessions: [],
      state: {
        healthy: false,
        reason: `Saved investigations could not be read (${(error as Error).message}). This session will not persist.`,
      },
    };
  }
}

export function saveSessions(sessions: Session[]): PersistenceState {
  if (typeof window === "undefined") return { healthy: true, reason: null };
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(sessions));
    return { healthy: true, reason: null };
  } catch (error) {
    const isQuota =
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
    return {
      healthy: false,
      reason: isQuota
        ? "Local storage is full, so this investigation was not saved. Delete older investigations to free space."
        : `This investigation was not saved (${(error as Error).message}).`,
    };
  }
}

/**
 * Trims stored responses so a long investigation does not blow the ~5 MB
 * localStorage budget. Evidence content is the bulk of a response; we keep the
 * items that are actually cited plus the top of the bundle, and record how many
 * were dropped so the UI can say the stored copy is partial rather than
 * silently showing a shorter bundle than the backend returned.
 */
export const PERSISTED_EVIDENCE_LIMIT = 24;

export function compactTurn(turn: Turn): Turn {
  if (!turn.response) return turn;
  const response = turn.response;
  if (response.evidence.length <= PERSISTED_EVIDENCE_LIMIT) return turn;

  const citedIds = new Set(response.claims.flatMap((claim) => claim.evidence_ids));
  const cited = response.evidence.filter((e) => citedIds.has(e._id));
  const rest = response.evidence.filter((e) => !citedIds.has(e._id));
  const kept = [...cited, ...rest].slice(0, PERSISTED_EVIDENCE_LIMIT);

  return {
    ...turn,
    response: {
      ...response,
      evidence: kept,
      // Marker consumed by the conversation view.
      _truncatedEvidence: response.evidence.length - kept.length,
    } as QueryResponse,
  };
}

export function evidenceTruncatedCount(response: QueryResponse | undefined): number {
  if (!response) return 0;
  const value = (response as QueryResponse & { _truncatedEvidence?: number })._truncatedEvidence;
  return typeof value === "number" ? value : 0;
}

/** Most recently touched first — the order the rail renders. */
export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function searchSessions(sessions: Session[], query: string): Session[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter(
    (session) =>
      session.title.toLowerCase().includes(needle) ||
      session.turns.some((turn) => turn.question.toLowerCase().includes(needle)),
  );
}
