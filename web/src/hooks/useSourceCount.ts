"use client";

import { useMemo } from "react";

import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

/**
 * How many distinct sources *this conversation* has.
 *
 * Scoped to the active investigation on purpose. It previously counted across
 * every stored session, which made a brand-new conversation report the source
 * count of unrelated ones — and, because the empty state keys off this number,
 * made a chat with nothing in it look like a chat with evidence in it.
 *
 * There is no "list sources in a collection" endpoint on the frozen API
 * surface, so this counts the sources referenced by evidence in this session's
 * answers plus anything uploaded into it. It is a floor, not a total.
 */
export function useSourceCount(): number {
  const { activeSession, uploads } = useWorkspace();

  return useMemo(() => {
    const ids = new Set<string>();
    activeSession?.turns.forEach((turn) =>
      turn.response?.evidence.forEach((item) => ids.add(item.source_id)),
    );
    // `uploads` from the context is already filtered to this session.
    uploads.forEach((upload) => upload.sourceId && ids.add(upload.sourceId));
    return ids.size;
  }, [activeSession, uploads]);
}
