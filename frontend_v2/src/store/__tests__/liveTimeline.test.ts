import { describe, expect, it } from "vitest";
import {
  idleRegionWidth,
  isIdleTimelineActive,
  latestNonTickRecordTick,
  liveWindowForTick,
  shouldDisableAutoScroll,
  skippedTicks,
} from "../liveTimeline";
import { commandAtTick } from "./fixtures";

describe("live timeline activity", () => {
  it("ignores static TICK records but treats ordinary high-frequency commands as activity", () => {
    const records = [
      commandAtTick(1, 100, { commandContext: { source: "tick function" } }),
      commandAtTick(2, 105, { commandContext: { source: "function", command: "say spam" } }),
      commandAtTick(3, 110, { commandContext: { source: "tick function" } }),
    ];
    expect(latestNonTickRecordTick(records, [])).toBe(105);
  });

  it("keeps the live window anchored while heartbeats only increase skipped ticks", () => {
    expect(liveWindowForTick(1_000, { min: 800, max: 1_000 }, 240)).toEqual({ min: 800, max: 1_000 });
    expect(skippedTicks(1_025, 1_000)).toBe(25);
    expect(skippedTicks(995, 1_000)).toBe(0);
  });

  it("reserves exactly forty percent of the usable track", () => {
    expect(idleRegionWidth(1_000, 200, 32)).toBe(307);
    expect(idleRegionWidth(1_000, 200, 32, 0)).toBe(0);
  });

  it("shows skipped only for an active live auto-scroll connection", () => {
    expect(isIdleTimelineActive("live", true, false, "open", 5)).toBe(true);
    expect(isIdleTimelineActive("live", true, false, "reconnecting", 5)).toBe(true);
    expect(isIdleTimelineActive("live", false, false, "open", 5)).toBe(false);
    expect(isIdleTimelineActive("live", true, true, "open", 5)).toBe(false);
    expect(isIdleTimelineActive("live", true, false, "disconnected", 5)).toBe(false);
    expect(isIdleTimelineActive("recordings", true, false, "open", 5)).toBe(false);
    expect(isIdleTimelineActive("live", true, false, "open", 0)).toBe(false);
  });

  it("disables auto-scroll only for a user horizontal move", () => {
    expect(shouldDisableAutoScroll(200, 150, null)).toBe(true);
    expect(shouldDisableAutoScroll(200, 260, 260)).toBe(false);
    expect(shouldDisableAutoScroll(200, 200, null)).toBe(false);
    expect(shouldDisableAutoScroll(200, 198.5, 200, 2)).toBe(false);
  });
});
