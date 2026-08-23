"use client";

import { useMemo } from "react";

import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

/**
 * How many distinct sources this workspace has actually observed.
 *
 * There is no "list sources in a collection" endpoint on the frozen API
 * surface, so this counts the sources referenced by evidence in the loaded
 * investigations plus anything uploaded this session. It is a floor, not a
 * total — and the rail labels it as a count of what is known rather than
 * claiming to be the collection's size.
 */
export function useSourceCount(): number | null {
  const { sessions, uploads } = useWorkspace();

  return useMemo(() => {
    const ids = new Set<string>();
    sessions.forEach((session) =>
      session.turns.forEach((turn) =>
        turn.response?.evidence.forEach((item) => ids.add(item.source_id)),
      ),
    );
    uploads.forEach((upload) => upload.sourceId && ids.add(upload.sourceId));
    return ids.size;
  }, [sessions, uploads]);
}
