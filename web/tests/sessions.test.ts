import { describe, expect, it, vi } from "vitest";

import type { QueryResponse } from "@/lib/api/schemas";
import {
  PERSISTED_EVIDENCE_LIMIT,
  compactTurn,
  createSession,
  deriveTitle,
  evidenceTruncatedCount,
  loadSessions,
  saveSessions,
  searchSessions,
  sortSessions,
  type Session,
  type Turn,
} from "@/lib/sessions";

function evidence(id: string) {
  return {
    _id: id,
    source_id: "src_1",
    node_type: "atomic_observation" as const,
    evidence_type: "utterance",
    modality: "speech",
    content: "x".repeat(200),
    location: {},
    member_evidence_ids: [],
    entity_ids: [],
    confidence: {},
  };
}

function responseWith(count: number, citedIds: string[]): QueryResponse {
  return {
    answer: "a",
    claims: [{ text: "c", evidence_ids: citedIds, support: "high" }],
    conflicts: [],
    missing_information: [],
    primary_event_id: null,
    evidence: Array.from({ length: count }, (_, i) => evidence(`ev_${i}`)),
    relationships: [],
    source_locators: [],
    support_label: "high",
    stage_timings_ms: {},
    query_plan: { answer_slots: [], required_modalities: [], entity_ids: [], channel_weights: {} },
  } as unknown as QueryResponse;
}

describe("deriveTitle", () => {
  it("uses the first line of the question", () => {
    expect(deriveTitle("Where was Redis proposed?\nmore context")).toBe("Where was Redis proposed?");
  });

  it("truncates a very long question", () => {
    const title = deriveTitle("x".repeat(200));
    expect(title).toHaveLength(62);
    expect(title.endsWith("…")).toBe(true);
  });

  it("does not produce an empty title", () => {
    expect(deriveTitle("   ")).toBe("Untitled investigation");
  });
});

describe("compactTurn", () => {
  it("leaves a small bundle untouched", () => {
    const turn: Turn = {
      id: "t", question: "q", requiredModalities: [], debugTrace: false, askedAt: 0,
      response: responseWith(5, ["ev_0"]),
    };
    expect(compactTurn(turn).response?.evidence).toHaveLength(5);
    expect(evidenceTruncatedCount(compactTurn(turn).response)).toBe(0);
  });

  it("keeps every cited item when trimming an oversized bundle", () => {
    // The cited items are the ones a reader can click, so they must survive
    // compaction even when they sit at the bottom of the bundle.
    const cited = ["ev_38", "ev_39"];
    const turn: Turn = {
      id: "t", question: "q", requiredModalities: [], debugTrace: false, askedAt: 0,
      response: responseWith(40, cited),
    };
    const compacted = compactTurn(turn);
    const keptIds = compacted.response!.evidence.map((e) => e._id);
    expect(keptIds).toHaveLength(PERSISTED_EVIDENCE_LIMIT);
    cited.forEach((id) => expect(keptIds).toContain(id));
  });

  it("records how many items were dropped so the UI can say the copy is partial", () => {
    const turn: Turn = {
      id: "t", question: "q", requiredModalities: [], debugTrace: false, askedAt: 0,
      response: responseWith(40, ["ev_0"]),
    };
    expect(evidenceTruncatedCount(compactTurn(turn).response)).toBe(40 - PERSISTED_EVIDENCE_LIMIT);
  });

  it("passes through a turn that has no response yet", () => {
    const turn: Turn = { id: "t", question: "q", requiredModalities: [], debugTrace: false, askedAt: 0 };
    expect(compactTurn(turn)).toEqual(turn);
  });
});

describe("persistence", () => {
  it("round-trips sessions through localStorage", () => {
    const session = createSession("demo_architecture");
    expect(saveSessions([session]).healthy).toBe(true);
    const { sessions, state } = loadSessions();
    expect(state.healthy).toBe(true);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(session.id);
  });

  it("reports a write failure instead of silently swallowing it", () => {
    // A sidebar that shows sessions it failed to save is a lie; the provider
    // depends on this returning healthy:false so it can warn.
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const state = saveSessions([createSession("c")]);
    expect(state.healthy).toBe(false);
    expect(state.reason).toMatch(/full/i);
    spy.mockRestore();
  });

  it("recovers from corrupt stored data rather than throwing", () => {
    localStorage.setItem("omnitrace:v1:sessions", "{not json");
    const { sessions, state } = loadSessions();
    expect(sessions).toEqual([]);
    expect(state.healthy).toBe(false);
  });

  it("drops malformed session records but keeps valid ones", () => {
    const valid = createSession("c");
    localStorage.setItem("omnitrace:v1:sessions", JSON.stringify([valid, { nope: true }, null]));
    expect(loadSessions().sessions).toHaveLength(1);
  });
});

describe("sortSessions / searchSessions", () => {
  const sessions: Session[] = [
    { id: "a", title: "Where was Redis proposed?", collectionId: "c", createdAt: 1, updatedAt: 10, turns: [] },
    { id: "b", title: "Compare cache recommendations", collectionId: "c", createdAt: 2, updatedAt: 30, turns: [] },
    {
      id: "c", title: "Architecture meeting evidence", collectionId: "c", createdAt: 3, updatedAt: 20,
      turns: [{ id: "t", question: "who mentioned Postgres", requiredModalities: [], debugTrace: false, askedAt: 0 }],
    },
  ];

  it("orders by most recently touched", () => {
    expect(sortSessions(sessions).map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("matches on title", () => {
    expect(searchSessions(sessions, "redis").map((s) => s.id)).toEqual(["a"]);
  });

  it("also matches on question text inside a session", () => {
    expect(searchSessions(sessions, "postgres").map((s) => s.id)).toEqual(["c"]);
  });

  it("returns everything for an empty query", () => {
    expect(searchSessions(sessions, "  ")).toHaveLength(3);
  });
});
