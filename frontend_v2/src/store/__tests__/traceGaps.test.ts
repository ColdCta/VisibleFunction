import { describe, expect, it } from "vitest";
import {
  addTraceGap,
  markTraceGapsUnavailableBefore,
  nextRecoveringTraceGap,
  observeTraceRecord,
  traceGapCount,
} from "../traceGaps";

describe("trace gap tracking", () => {
  it("detects a skipped id and closes the gap when backfill arrives", () => {
    const skipped = observeTraceRecord([], 10, 13);
    expect(skipped.gaps).toEqual([{ fromId: 11, toId: 12, state: "recovering" }]);

    const first = observeTraceRecord(skipped.gaps, skipped.highestObservedId, 11);
    const second = observeTraceRecord(first.gaps, first.highestObservedId, 12);
    expect(second.gaps).toEqual([]);
    expect(second.highestObservedId).toBe(13);
  });

  it("splits a range when a recovered record arrives out of order", () => {
    const result = observeTraceRecord(addTraceGap([], 5, 9), 10, 7);
    expect(result.gaps).toEqual([
      { fromId: 5, toId: 6, state: "recovering" },
      { fromId: 8, toId: 9, state: "recovering" },
    ]);
  });

  it("marks only the evicted portion as permanently lost", () => {
    const result = markTraceGapsUnavailableBefore(addTraceGap([], 5, 12), 9);
    expect(result).toEqual([
      { fromId: 5, toId: 8, state: "lost" },
      { fromId: 9, toId: 12, state: "recovering" },
    ]);
    expect(traceGapCount(result, "lost")).toBe(4);
    expect(nextRecoveringTraceGap(result)?.fromId).toBe(9);
  });
});
