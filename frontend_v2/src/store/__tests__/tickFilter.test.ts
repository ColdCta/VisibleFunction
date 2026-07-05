import { describe, expect, it } from "vitest";
import { buildTickFilterBands, isTickFilteredRecord } from "../tickFilter";
import { commandAtTick, makeRecord } from "./fixtures";

// 12 records of the same command at ticks 0..11 clears MIN_TOTAL_COUNT (12) and
// MIN_COUNT_PER_SECOND (5), so the group is captured as a high-frequency band.
function spamBand() {
  return Array.from({ length: 12 }, (_, i) =>
    commandAtTick(i + 1, i, { commandContext: { command: "say hi", commandId: "c1" } })
  );
}

describe("buildTickFilterBands", () => {
  it("captures a high-frequency command as a band", () => {
    const bands = buildTickFilterBands(spamBand());
    expect(bands).toHaveLength(1);
    expect(bands[0].displayName).toBe("say hi");
    expect(bands[0].totalCount).toBe(12);
    expect(bands[0].countPerSecond).toBeGreaterThanOrEqual(5);
  });

  it("does not capture low-frequency commands below the total threshold", () => {
    const records = Array.from({ length: 5 }, (_, i) => commandAtTick(i + 1, i));
    expect(buildTickFilterBands(records)).toHaveLength(0);
  });

  it("ignores EVENT records entirely", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeRecord({ id: i + 1, type: "EVENT", basicFields: { tick: String(i) }, subject: "spawned" })
    );
    expect(buildTickFilterBands(events)).toHaveLength(0);
  });

  it("normalizes whitespace when grouping commands", () => {
    const records = [
      ...Array.from({ length: 6 }, (_, i) => commandAtTick(i + 1, i, { commandContext: { command: "say  hi" } })),
      ...Array.from({ length: 6 }, (_, i) => commandAtTick(i + 7, i + 6, { commandContext: { command: "say hi" } })),
    ];
    const bands = buildTickFilterBands(records);
    expect(bands).toHaveLength(1);
    expect(bands[0].totalCount).toBe(12);
  });
});

describe("isTickFilteredRecord", () => {
  const bands = buildTickFilterBands(spamBand());

  it("returns false when there are no bands", () => {
    expect(isTickFilteredRecord(spamBand()[0], [])).toBe(false);
  });

  it("hides a record whose id belongs to a band", () => {
    expect(isTickFilteredRecord(spamBand()[0], bands)).toBe(true);
  });

  it("hides a record that shares a banded commandId even if its id is new", () => {
    const later = makeRecord({ id: 999, type: "COMMAND", commandContext: { command: "say hi", commandId: "c1" } });
    expect(isTickFilteredRecord(later, bands)).toBe(true);
  });

  it("never hides EVENT records", () => {
    const event = makeRecord({ id: 998, type: "EVENT", commandContext: { commandId: "c1" } });
    expect(isTickFilteredRecord(event, bands)).toBe(false);
  });
});
