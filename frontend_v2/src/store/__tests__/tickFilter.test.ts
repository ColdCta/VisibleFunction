import { describe, expect, it } from "vitest";
import type { TickFilterBucketPayload } from "../../api/types";
import { isTickFilteredRecord, tickFilterBandsFromPayload } from "../tickFilter";
import { makeRecord } from "./fixtures";

function bucket(over: Partial<TickFilterBucketPayload> = {}): TickFilterBucketPayload {
  return {
    key: "COMMAND:say hi|function|demo:tick",
    type: "COMMAND",
    displayName: "say hi",
    firstSeenTick: 0,
    lastSeenTick: 20,
    startMillis: 0,
    endMillis: 1000,
    totalCount: 21,
    countLastSecond: 20,
    sourceSummary: "tick function demo:tick",
    reason: "tick function + high frequency",
    active: true,
    recordIds: [1, 2],
    commandIds: ["c1"],
    sampleRecords: [],
    ...over,
  };
}

describe("tickFilterBandsFromPayload", () => {
  it("preserves the canonical backend tick range and counts, including tick zero", () => {
    const [band] = tickFilterBandsFromPayload([bucket()]);
    expect(band.startMillis).toBe(0);
    expect(band.endMillis).toBe(21);
    expect(band.countPerSecond).toBe(20);
    expect(band.totalCount).toBe(21);
  });

  it("extracts function ids from function buckets", () => {
    const [band] = tickFilterBandsFromPayload([
      bucket({ key: "FUNCTION:demo:tick", type: "FUNCTION", sourceSummary: "tick function demo:tick" }),
    ]);
    expect(band.functionId).toBe("demo:tick");
  });
});

describe("isTickFilteredRecord", () => {
  const bands = tickFilterBandsFromPayload([bucket()]);

  it("returns false when there are no bands", () => {
    expect(isTickFilteredRecord(makeRecord({ id: 1 }), [])).toBe(false);
  });

  it("matches canonical record ids", () => {
    expect(isTickFilteredRecord(makeRecord({ id: 1 }), bands)).toBe(true);
  });

  it("matches related command ids", () => {
    const record = makeRecord({ id: 99, commandContext: { commandId: "c1" } });
    expect(isTickFilteredRecord(record, bands)).toBe(true);
  });

  it("uses backend membership for events too", () => {
    const event = makeRecord({ id: 2, type: "EVENT", commandContext: { commandId: "none" } });
    expect(isTickFilteredRecord(event, bands)).toBe(true);
  });
});
