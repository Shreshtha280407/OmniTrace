import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ClaimCard } from "@/components/ui/ClaimCard";
import { EvidenceChip } from "@/components/ui/EvidenceChip";
import { buildStageRows } from "@/components/ui/RunTimeline";
import { SourceLocator, locatorKind, locatorText } from "@/components/ui/SourceLocator";
import { StreamingText } from "@/components/ui/StreamingText";
import {
  sourceStatusLabel,
  sourceStatusTone,
  stageTone,
  supportLabel,
  supportTone,
} from "@/components/ui/StatusPill";
import { validateFile } from "@/components/workspace/WorkspaceProvider";
import type { EvidenceItem, JobStatus } from "@/lib/api/schemas";

function ev(over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    _id: "ev_1",
    source_id: "src_1",
    node_type: "atomic_observation",
    evidence_type: "utterance",
    modality: "speech",
    content: "a claim's backing content",
    location: { start_ms: 104_200, end_ms: 121_900 },
    member_evidence_ids: [],
    entity_ids: [],
    confidence: { extraction: 0.94 },
    provenance: { processing_run_id: "run_1", producer: "pipeline.audio", derived_from: [] },
    ...over,
  } as EvidenceItem;
}

// ── processing trace state ────────────────────────────────────────────────

describe("buildStageRows", () => {
  const job: JobStatus = {
    job_id: "src_1",
    source_id: "src_1",
    source_status: "extracting",
    stages: {
      probe: { status: "ok", started_at: "2026-03-14T09:12:00Z", ended_at: "2026-03-14T09:12:01Z", warnings: [], error: null },
      audio: { status: "running", started_at: "2026-03-14T09:12:01Z", ended_at: null, warnings: [], error: null },
    },
  };

  it("shows a required stage with no run document as queued, not missing", () => {
    // The backend omits stages it has not started; rendering only what it
    // returned would make the pipeline look shorter than it is.
    const rows = buildStageRows(job, "video");
    expect(rows.map((r) => r.stage)).toEqual(["probe", "audio", "visual", "enrich"]);
    expect(rows.find((r) => r.stage === "visual")?.status).toBe("queued");
    expect(rows.find((r) => r.stage === "enrich")?.status).toBe("queued");
  });

  it("reports elapsed time only for a stage that has ended", () => {
    const rows = buildStageRows(job, "video");
    expect(rows.find((r) => r.stage === "probe")?.elapsedMs).toBe(1000);
    expect(rows.find((r) => r.stage === "audio")?.elapsedMs).toBeNull();
  });

  it("orders required stages first, then any extra stage the backend ran", () => {
    const withExtra: JobStatus = { ...job, stages: { ...job.stages, index: { status: "ok", warnings: [] } as never } };
    expect(buildStageRows(withExtra, "video").map((r) => r.stage)).toEqual([
      "probe", "audio", "visual", "enrich", "index",
    ]);
  });

  it("uses the media type's own pipeline", () => {
    expect(buildStageRows(job, "document").map((r) => r.stage)).toEqual(["probe", "document", "enrich", "audio"]);
  });

  it("returns nothing when there is no job", () => {
    expect(buildStageRows(undefined, "video")).toEqual([]);
  });
});

// ── status mapping ────────────────────────────────────────────────────────

describe("status mappings", () => {
  it("maps support levels to distinct tones and labels", () => {
    expect(supportTone("high")).toBe("validated");
    expect(supportTone("medium")).toBe("caution");
    expect(supportTone("none")).toBe("pending");
    expect(supportLabel("high")).toBe("High support");
    expect(supportLabel("none")).toBe("Insufficient evidence");
  });

  it("never labels anything 'verified'", () => {
    // No endpoint returns a verification verdict, so no tone may imply one.
    ["high", "medium", "low", "none"].forEach((level) => {
      expect(supportLabel(level).toLowerCase()).not.toContain("verified");
    });
  });

  it("distinguishes partial readiness from ready", () => {
    expect(sourceStatusTone("ready")).toBe("validated");
    expect(sourceStatusTone("partial_ready")).toBe("caution");
    expect(sourceStatusLabel("partial_ready")).toBe("Partially ready");
    expect(sourceStatusTone("failed")).toBe("fault");
  });

  it("gives queued stages a neutral tone, not a successful one", () => {
    expect(stageTone("queued")).toBe("pending");
    expect(stageTone("ok")).toBe("validated");
    expect(stageTone("failed")).toBe("fault");
  });
});

// ── locators ──────────────────────────────────────────────────────────────

describe("SourceLocator", () => {
  it("classifies a time-located record", () => {
    expect(locatorKind({ start_ms: 1000, end_ms: 2000 })).toBe("time");
    expect(locatorText({ start_ms: 104_200, end_ms: 121_900 })).toBe("01:44.2–02:01.9");
  });

  it("classifies a page-located record and shows a padded page number", () => {
    expect(locatorKind({ page: 7 })).toBe("page");
    expect(locatorText({ page: 7 })).toBe("p.07");
  });

  it("notes when a page also carries a region", () => {
    expect(locatorText({ page: 7, bbox_norm: { x1: 0, y1: 0, x2: 1, y2: 1 } })).toBe("p.07 · region");
  });

  it("says so plainly when nothing is stored", () => {
    expect(locatorKind({})).toBe("none");
    expect(locatorText(undefined)).toBe("no locator stored");
  });

  it("renders the stored bbox coordinates in block form", () => {
    render(<SourceLocator variant="block" location={{ page: 7, bbox_norm: { x1: 0.114, y1: 0.238, x2: 0.886, y2: 0.371 } }} />);
    expect(screen.getByText(/0\.114/)).toBeInTheDocument();
    expect(screen.getByText("p.07 · region")).toBeInTheDocument();
  });
});

// ── citations ─────────────────────────────────────────────────────────────

describe("EvidenceChip", () => {
  it("names the modality and locator in its accessible name", () => {
    render(<EvidenceChip evidenceId="ev_1" evidence={ev()} />);
    expect(screen.getByRole("button", { name: /Speech evidence at 01:44\.2–02:01\.9/ })).toBeInTheDocument();
  });

  it("flags a citation that is not in the returned bundle", () => {
    // The validators strip these; seeing one means the bundle changed, and
    // hiding it would make the answer look better supported than it is.
    render(<EvidenceChip evidenceId="ev_missing" evidence={undefined} />);
    expect(screen.getByRole("button", { name: /not present in the returned bundle/ })).toBeInTheDocument();
  });

  it("invokes the selection handler on click", async () => {
    const onClick = vi.fn();
    render(<EvidenceChip evidenceId="ev_1" evidence={ev()} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("ClaimCard", () => {
  const claim = { text: "It is a Redis read-through cache.", evidence_ids: ["ev_1", "ev_gone"], support: "high" as const };

  it("renders one chip per cited id and selects on click", async () => {
    const onSelect = vi.fn();
    render(<ClaimCard claim={claim} index={0} evidenceById={{ ev_1: ev() }} onSelectEvidence={onSelect} />);

    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(2);

    await userEvent.click(chips[0]);
    expect(onSelect).toHaveBeenCalledWith("ev_1");
  });

  it("states how many cited ids cannot be opened", () => {
    render(<ClaimCard claim={claim} index={0} evidenceById={{ ev_1: ev() }} onSelectEvidence={vi.fn()} />);
    expect(screen.getByText(/1 cited id is not in the returned bundle/)).toBeInTheDocument();
  });

  it("shows the claim's own support level", () => {
    render(
      <ClaimCard
        claim={{ ...claim, support: "low", evidence_ids: ["ev_1"] }}
        index={0}
        evidenceById={{ ev_1: ev() }}
        onSelectEvidence={vi.fn()}
      />,
    );
    expect(screen.getByText("Low")).toBeInTheDocument();
  });
});

// ── streaming ─────────────────────────────────────────────────────────────

describe("StreamingText", () => {
  it("reveals the full text and reports completion once", async () => {
    const onComplete = vi.fn();
    const { container } = render(
      <StreamingText text="one two three" wordsPerSecond={1000} onComplete={onComplete} />,
    );
    // Rendered twice by design: once in the sr-only live region, once visibly.
    await waitFor(() => expect(screen.getAllByText("one two three")).toHaveLength(2));
    await waitFor(() => expect(container.querySelector('[data-complete="true"]')).toBeTruthy());
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("marks itself complete so downstream UI can un-dim", async () => {
    const { container } = render(<StreamingText text="short answer" wordsPerSecond={1000} />);
    await waitFor(() => expect(container.querySelector('[data-complete="true"]')).toBeTruthy());
  });

  it("in live mode renders exactly what has arrived and stays incomplete until told", () => {
    const { container } = render(<StreamingText text="partial tok" mode="live" done={false} />);
    expect(container.textContent).toContain("partial tok");
    expect(container.querySelector('[data-complete="true"]')).toBeNull();
  });

  it("in live mode completes only when the caller says the stream closed", () => {
    const { container } = render(<StreamingText text="all of it" mode="live" done />);
    expect(container.querySelector('[data-complete="true"]')).toBeTruthy();
  });
});

// ── upload validation ─────────────────────────────────────────────────────

describe("validateFile", () => {
  const file = (name: string, size: number) => {
    const f = new File(["x"], name, { type: "application/octet-stream" });
    Object.defineProperty(f, "size", { value: size });
    return f;
  };

  it("accepts each of the four source families", () => {
    expect(validateFile(file("a.mp4", 1000))).toBeNull();
    expect(validateFile(file("a.m4a", 1000))).toBeNull();
    expect(validateFile(file("a.png", 1000))).toBeNull();
    expect(validateFile(file("a.pdf", 1000))).toBeNull();
  });

  it("rejects an extension the backend would reject, before uploading a byte", () => {
    expect(validateFile(file("a.exe", 1000))).toMatch(/not an accepted source type/);
  });

  it("rejects an empty file", () => {
    expect(validateFile(file("a.mp4", 0))).toMatch(/empty/);
  });

  it("rejects a file over the server's 500 MB limit", () => {
    expect(validateFile(file("a.mp4", 600 * 1024 * 1024))).toMatch(/maximum accepted size is 500 MB/);
  });
});
