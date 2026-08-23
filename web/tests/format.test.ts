import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatChecksum,
  formatConfidence,
  formatDuration,
  formatMs,
  formatTimecode,
  stageElapsedMs,
  stageLabel,
  truncateId,
} from "@/lib/format";

describe("formatTimecode", () => {
  it("renders minutes, seconds and tenths", () => {
    expect(formatTimecode(104_200)).toBe("01:44.2");
    expect(formatTimecode(0)).toBe("00:00.0");
  });

  it("adds an hours field only when the source is that long", () => {
    expect(formatTimecode(3_723_400)).toBe("1:02:03.4");
    expect(formatTimecode(59_000)).toBe("00:59.0");
  });

  it("returns a dash rather than 00:00.0 when there is no timestamp", () => {
    // This is the property the whole locator story rests on: a document has
    // no time, and must never be rendered as if it were at the start.
    expect(formatTimecode(null)).toBe("—");
    expect(formatTimecode(undefined)).toBe("—");
    expect(formatTimecode(Number.NaN)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(431_000)).toBe("7m 11s");
    expect(formatDuration(7_320_000)).toBe("2h 02m");
  });

  it("returns a dash for a missing duration", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatBytes", () => {
  it("scales through the unit ladder", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(418_332_160)).toBe("399 MB");
  });

  it("returns a dash for a missing size", () => {
    expect(formatBytes(undefined)).toBe("—");
  });
});

describe("formatMs", () => {
  it("switches to seconds past a thousand milliseconds", () => {
    expect(formatMs(412)).toBe("412 ms");
    expect(formatMs(4286)).toBe("4.29 s");
    expect(formatMs(64_000)).toBe("64.0 s");
  });
});

describe("formatConfidence", () => {
  it("truncates rather than rounds, so a score never flatters itself", () => {
    expect(formatConfidence(0.919)).toBe("0.91");
    expect(formatConfidence(0.999)).toBe("0.99");
    expect(formatConfidence(1)).toBe("1.00");
  });

  it("returns a dash when nothing was scored", () => {
    expect(formatConfidence(null)).toBe("—");
  });
});

describe("truncateId / formatChecksum", () => {
  it("elides the middle so both ends stay recognisable", () => {
    expect(truncateId("ev_01JQZKB1C2D3E4F5G6H7J8K9M0")).toBe("ev_01JQZKB…K9M0");
  });

  it("leaves a short id untouched", () => {
    expect(truncateId("ev_1")).toBe("ev_1");
  });

  it("returns a dash for a missing id", () => {
    expect(truncateId(null)).toBe("—");
    expect(formatChecksum(undefined)).toBe("—");
  });
});

describe("stageLabel", () => {
  it("maps backend stage ids to readable names", () => {
    expect(stageLabel("probe")).toBe("Source fingerprint");
    expect(stageLabel("enrich")).toBe("Enrichment");
  });

  it("passes an unknown stage through rather than hiding it", () => {
    expect(stageLabel("new_stage")).toBe("new stage");
  });
});

describe("stageElapsedMs", () => {
  it("measures a completed stage", () => {
    expect(stageElapsedMs("2026-03-14T09:12:00.000Z", "2026-03-14T09:12:01.500Z")).toBe(1500);
  });

  it("returns null while a stage is still open", () => {
    expect(stageElapsedMs("2026-03-14T09:12:00.000Z", null)).toBeNull();
    expect(stageElapsedMs(null, null)).toBeNull();
  });
});
