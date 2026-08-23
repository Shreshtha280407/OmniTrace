"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, DEFAULT_COLLECTION_ID, createSource, runQuery, type UploadProgress } from "@/lib/api";
import type { EvidenceItem, QueryResponse } from "@/lib/api/schemas";
import {
  compactTurn,
  createSession,
  deriveTitle,
  loadSessions,
  newId,
  saveSessions,
  sortSessions,
  type PersistenceState,
  type Session,
  type Turn,
} from "@/lib/sessions";

/**
 * Workspace state.
 *
 * One provider owns sessions, the in-flight query, uploads and the inspector
 * selection, because all four are coupled: submitting a query closes the
 * inspector's evidence selection, an upload attaches to the next turn, and
 * every one of them writes to the same persisted session.
 */

export interface PendingUpload {
  id: string;
  file: File;
  status: "validating" | "uploading" | "processing" | "done" | "failed";
  progress: UploadProgress | null;
  sourceId?: string;
  jobId?: string;
  error?: string;
  abort?: () => void;
}

/** Mirrors the backend's accepted extensions (api/routes/sources.py). */
const ACCEPTED_EXTENSIONS: Record<string, string> = {
  mp4: "video", mov: "video", mkv: "video", webm: "video", avi: "video", m4v: "video",
  mp3: "audio", wav: "audio", m4a: "audio", flac: "audio", ogg: "audio", aac: "audio",
  png: "image", jpg: "image", jpeg: "image", webp: "image", bmp: "image", gif: "image", tiff: "image",
  pdf: "document", docx: "document", txt: "document", md: "document", pptx: "document",
};

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // matches MAX_UPLOAD_BYTES server-side

export const ACCEPT_ATTRIBUTE = Object.keys(ACCEPTED_EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(",");

export function validateFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_EXTENSIONS[ext]) {
    return `.${ext || "unknown"} is not an accepted source type. Accepted: video, audio, image and document formats.`;
  }
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `This file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The maximum accepted size is 500 MB.`;
  }
  return null;
}

interface WorkspaceContextValue {
  // sessions
  sessions: Session[];
  activeSession: Session | null;
  activeSessionId: string | null;
  persistence: PersistenceState;
  hydrated: boolean;
  selectSession: (id: string) => void;
  startSession: () => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;

  // query
  submitQuery: (input: { question: string; requiredModalities: string[]; debugTrace: boolean }) => Promise<void>;
  cancelQuery: () => void;
  retryTurn: (turnId: string) => void;
  isQuerying: boolean;
  activeTurnId: string | null;

  // uploads
  uploads: PendingUpload[];
  addFiles: (files: FileList | File[]) => void;
  removeUpload: (id: string) => void;
  retryUpload: (id: string) => void;

  // inspector
  selectedEvidenceId: string | null;
  selectEvidence: (id: string | null) => void;
  sourceDrawerEvidenceId: string | null;
  openSourceDrawer: (evidenceId: string) => void;
  closeSourceDrawer: () => void;

  // lookups across the active session's most recent response
  latestResponse: QueryResponse | null;
  evidenceById: Record<string, EvidenceItem>;

  collectionId: string;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return context;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<PersistenceState>({ healthy: true, reason: null });
  const [hydrated, setHydrated] = useState(false);

  const [isQuerying, setIsQuerying] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [sourceDrawerEvidenceId, setSourceDrawerEvidenceId] = useState<string | null>(null);

  // ── hydration ──────────────────────────────────────────────────────
  useEffect(() => {
    const { sessions: stored, state } = loadSessions();
    const ordered = sortSessions(stored);
    setSessions(ordered);
    setPersistence(state);
    setActiveSessionId(ordered[0]?.id ?? null);
    setHydrated(true);
  }, []);

  /** Single write path. Returns the persistence result so callers know whether
   *  the change actually made it to disk. */
  const commit = useCallback((updater: (current: Session[]) => Session[]) => {
    setSessions((current) => {
      const next = sortSessions(updater(current));
      const toPersist = next.map((session) => ({ ...session, turns: session.turns.map(compactTurn) }));
      setPersistence(saveSessions(toPersist));
      return next;
    });
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const latestResponse = useMemo(() => {
    if (!activeSession) return null;
    for (let i = activeSession.turns.length - 1; i >= 0; i -= 1) {
      const response = activeSession.turns[i].response;
      if (response) return response;
    }
    return null;
  }, [activeSession]);

  // Evidence lookup spans every turn in the session, so a citation from an
  // earlier answer still resolves after a newer query has run.
  const evidenceById = useMemo(() => {
    const map: Record<string, EvidenceItem> = {};
    activeSession?.turns.forEach((turn) => {
      turn.response?.evidence.forEach((item) => {
        map[item._id] = item;
      });
    });
    return map;
  }, [activeSession]);

  // ── session actions ────────────────────────────────────────────────
  const startSession = useCallback(() => {
    const session = createSession(DEFAULT_COLLECTION_ID);
    commit((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setSelectedEvidenceId(null);
  }, [commit]);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setSelectedEvidenceId(null);
    setSourceDrawerEvidenceId(null);
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      commit((current) => current.filter((session) => session.id !== id));
      setActiveSessionId((current) => {
        if (current !== id) return current;
        const remaining = sessions.filter((session) => session.id !== id);
        return remaining[0]?.id ?? null;
      });
    },
    [commit, sessions],
  );

  const renameSession = useCallback(
    (id: string, title: string) => {
      commit((current) =>
        current.map((session) =>
          session.id === id ? { ...session, title: title.trim() || session.title, updatedAt: Date.now() } : session,
        ),
      );
    },
    [commit],
  );

  // ── uploads ────────────────────────────────────────────────────────
  const startUpload = useCallback((upload: PendingUpload) => {
    const controller = new AbortController();

    setUploads((current) =>
      current.map((u) =>
        u.id === upload.id
          ? { ...u, status: "uploading", error: undefined, progress: null, abort: () => controller.abort() }
          : u,
      ),
    );

    createSource(upload.file, {
      signal: controller.signal,
      onProgress: (progress) =>
        setUploads((current) => current.map((u) => (u.id === upload.id ? { ...u, progress } : u))),
    })
      .then((result) => {
        setUploads((current) =>
          current.map((u) =>
            u.id === upload.id
              ? {
                  ...u,
                  // The backend runs extraction inside this request, so a
                  // resolved promise means ingestion finished — but the source
                  // status is what decides, not the fact that we got a 201.
                  status: result.status === "failed" ? "failed" : result.status === "ready" ? "done" : "processing",
                  sourceId: result.source_id,
                  jobId: result.job_id,
                  progress: { loaded: u.file.size, total: u.file.size, fraction: 1 },
                  error: result.status === "failed" ? "Ingestion failed on the backend." : undefined,
                }
              : u,
          ),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          setUploads((current) => current.filter((u) => u.id !== upload.id));
          return;
        }
        const message = error instanceof ApiError ? error.userMessage : String(error);
        setUploads((current) =>
          current.map((u) => (u.id === upload.id ? { ...u, status: "failed", error: message } : u)),
        );
      });
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const created: PendingUpload[] = list.map((file) => {
        const problem = validateFile(file);
        return {
          id: newId("upl"),
          file,
          // Validation happens before a single byte leaves the browser.
          status: problem ? "failed" : "validating",
          progress: null,
          error: problem ?? undefined,
        };
      });

      setUploads((current) => [...current, ...created]);
      created.filter((upload) => upload.status === "validating").forEach(startUpload);
    },
    [startUpload],
  );

  const removeUpload = useCallback((id: string) => {
    setUploads((current) => {
      current.find((u) => u.id === id)?.abort?.();
      return current.filter((u) => u.id !== id);
    });
  }, []);

  const retryUpload = useCallback(
    (id: string) => {
      const upload = uploads.find((u) => u.id === id);
      if (!upload) return;
      const problem = validateFile(upload.file);
      if (problem) {
        setUploads((current) => current.map((u) => (u.id === id ? { ...u, status: "failed", error: problem } : u)));
        return;
      }
      startUpload(upload);
    },
    [uploads, startUpload],
  );

  // ── query ──────────────────────────────────────────────────────────
  const runTurn = useCallback(
    async (sessionId: string, turn: Turn) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsQuerying(true);
      setActiveTurnId(turn.id);

      try {
        const response = await runQuery(
          {
            collection_id: DEFAULT_COLLECTION_ID,
            question: turn.question,
            required_modalities: turn.requiredModalities,
            debug_trace: turn.debugTrace,
          },
          { signal: controller.signal },
        );

        commit((current) =>
          current.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  updatedAt: Date.now(),
                  turns: session.turns.map((t) =>
                    t.id === turn.id ? { ...t, response, error: undefined } : t,
                  ),
                }
              : session,
          ),
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // A cancelled turn is removed rather than left as a permanent
          // failure — the user withdrew the question.
          commit((current) =>
            current.map((session) =>
              session.id === sessionId
                ? { ...session, turns: session.turns.filter((t) => t.id !== turn.id) }
                : session,
            ),
          );
          return;
        }
        const apiError = error instanceof ApiError ? error : null;
        commit((current) =>
          current.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  updatedAt: Date.now(),
                  turns: session.turns.map((t) =>
                    t.id === turn.id
                      ? {
                          ...t,
                          error: {
                            message: apiError ? apiError.userMessage : String(error),
                            kind: apiError?.kind ?? "unknown",
                            retryable: apiError?.retryable ?? true,
                          },
                        }
                      : t,
                  ),
                }
              : session,
          ),
        );
      } finally {
        abortRef.current = null;
        setIsQuerying(false);
        setActiveTurnId(null);
      }
    },
    [commit],
  );

  const submitQuery = useCallback(
    async ({
      question,
      requiredModalities,
      debugTrace,
    }: {
      question: string;
      requiredModalities: string[];
      debugTrace: boolean;
    }) => {
      const trimmed = question.trim();
      if (!trimmed || isQuerying) return;

      // A query with no session yet creates one; the title comes from the
      // first question, which is what makes the rail readable.
      let sessionId = activeSessionId;
      const isNew = !sessionId;
      if (!sessionId) {
        const session = createSession(DEFAULT_COLLECTION_ID);
        sessionId = session.id;
        setActiveSessionId(session.id);
        commit((current) => [session, ...current]);
      }

      const turn: Turn = {
        id: newId("turn"),
        question: trimmed,
        requiredModalities,
        debugTrace,
        askedAt: Date.now(),
        jobIds: uploads.filter((u) => u.jobId).map((u) => u.jobId!),
      };

      commit((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                title: isNew || session.turns.length === 0 ? deriveTitle(trimmed) : session.title,
                updatedAt: Date.now(),
                turns: [...session.turns, turn],
              }
            : session,
        ),
      );

      setSelectedEvidenceId(null);
      await runTurn(sessionId!, turn);
    },
    [activeSessionId, commit, isQuerying, runTurn, uploads],
  );

  const cancelQuery = useCallback(() => abortRef.current?.abort(), []);

  const retryTurn = useCallback(
    (turnId: string) => {
      if (!activeSession) return;
      const turn = activeSession.turns.find((t) => t.id === turnId);
      if (!turn) return;
      commit((current) =>
        current.map((session) =>
          session.id === activeSession.id
            ? { ...session, turns: session.turns.map((t) => (t.id === turnId ? { ...t, error: undefined } : t)) }
            : session,
        ),
      );
      void runTurn(activeSession.id, turn);
    },
    [activeSession, commit, runTurn],
  );

  // ── inspector ──────────────────────────────────────────────────────
  const selectEvidence = useCallback((id: string | null) => setSelectedEvidenceId(id), []);
  const openSourceDrawer = useCallback((evidenceId: string) => setSourceDrawerEvidenceId(evidenceId), []);
  const closeSourceDrawer = useCallback(() => setSourceDrawerEvidenceId(null), []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      sessions,
      activeSession,
      activeSessionId,
      persistence,
      hydrated,
      selectSession,
      startSession,
      deleteSession,
      renameSession,
      submitQuery,
      cancelQuery,
      retryTurn,
      isQuerying,
      activeTurnId,
      uploads,
      addFiles,
      removeUpload,
      retryUpload,
      selectedEvidenceId,
      selectEvidence,
      sourceDrawerEvidenceId,
      openSourceDrawer,
      closeSourceDrawer,
      latestResponse,
      evidenceById,
      collectionId: DEFAULT_COLLECTION_ID,
    }),
    [
      sessions, activeSession, activeSessionId, persistence, hydrated, selectSession, startSession,
      deleteSession, renameSession, submitQuery, cancelQuery, retryTurn, isQuerying, activeTurnId,
      uploads, addFiles, removeUpload, retryUpload, selectedEvidenceId, selectEvidence,
      sourceDrawerEvidenceId, openSourceDrawer, closeSourceDrawer, latestResponse, evidenceById,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
