import { describe, expect, it } from "vitest";
import { recordTick, recordTickKey } from "../traceTime";
import { makeRecord } from "./fixtures";

describe("recordTick", () => {
  it("uses the explicit tick from basicFields", () => {
    const record = makeRecord({ id: 1, basicFields: { tick: "42" }, timestampMillis: 999_999 });
    expect(recordTick(record)).toBe(42);
  });

  it("falls back to detailedFields.tick when basicFields lacks one", () => {
    const record = makeRecord({ id: 1, detailedFields: { tick: "7" }, timestampMillis: 999_999 });
    expect(recordTick(record)).toBe(7);
  });

  it("derives the tick from timestampMillis when no tick field is present", () => {
    const record = makeRecord({ id: 1, timestampMillis: 1000 });
    expect(recordTick(record)).toBe(20); // 1000ms / 50ms per tick
  });

  it("ignores a non-numeric tick field and falls back to the timestamp", () => {
    const record = makeRecord({ id: 1, basicFields: { tick: "abc" }, timestampMillis: 500 });
    expect(recordTick(record)).toBe(10);
  });
});

describe("recordTickKey", () => {
  it("groups ticks into bucket-sized keys", () => {
    const record = makeRecord({ id: 1, basicFields: { tick: "45" } });
    expect(recordTickKey(record, 20)).toBe("2"); // floor(45 / 20)
    expect(recordTickKey(record, 1)).toBe("45");
  });
});
