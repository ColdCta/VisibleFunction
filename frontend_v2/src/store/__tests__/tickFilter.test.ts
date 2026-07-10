import { describe, expect, it } from "vitest";
import type { TickFilterBucketPayload } from "../../api/types";
import {
  isTickFilteredRecord,
  tickFilterGroupsFromPayload,
} from "../tickFilter";
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
    reason: "tick function",
    active: true,
    recordIds: [1, 2],
    commandIds: ["c1"],
    sampleRecords: [],
    ...over,
  };
}

describe("isTickFilteredRecord", () => {
  const buckets = [bucket()];

  it("returns false when there are no bands", () => {
    expect(isTickFilteredRecord(makeRecord({ id: 1 }), [])).toBe(false);
  });

  it("matches canonical record ids", () => {
    expect(isTickFilteredRecord(makeRecord({ id: 1 }), buckets)).toBe(true);
  });

  it("matches related command ids", () => {
    const record = makeRecord({ id: 99, commandContext: { commandId: "c1" } });
    expect(isTickFilteredRecord(record, buckets)).toBe(true);
  });

  it("uses backend membership for events too", () => {
    const event = makeRecord({ id: 2, type: "EVENT", commandContext: { commandId: "none" } });
    expect(isTickFilteredRecord(event, buckets)).toBe(true);
  });

  it("uses protocol-v3 group membership before legacy ids", () => {
    const record = makeRecord({
      id: 99,
      tickFilterGroupIds: ["group-a"],
      commandContext: { source: "tick function" },
    });
    expect(isTickFilteredRecord(record, [], new Set(["group-a"]), new Set())).toBe(true);
    expect(isTickFilteredRecord(record, [], new Set(["group-a"]), new Set(["group-a"]))).toBe(false);
  });

  it("reveals only the selected parent and child group ids", () => {
    const selected = makeRecord({ id: 90, tickFilterGroupIds: ["child-a"], commandContext: { source: "tick function" } });
    const other = makeRecord({ id: 91, tickFilterGroupIds: ["group-b"], commandContext: { source: "tick function" } });
    const captured = new Set(["parent-a", "child-a", "group-b"]);
    const revealed = new Set(["parent-a", "child-a"]);
    expect(isTickFilteredRecord(selected, [], captured, revealed)).toBe(false);
    expect(isTickFilteredRecord(other, [], captured, revealed)).toBe(true);
  });

  it("ignores legacy buckets captured only because of high frequency", () => {
    const legacyHighFrequency = bucket({
      sourceSummary: "function demo:loop",
      reason: "high frequency",
    });
    const record = makeRecord({ id: 1, commandContext: { commandId: "c1", source: "function" } });
    expect(isTickFilteredRecord(record, [legacyHighFrequency])).toBe(false);
    expect(tickFilterGroupsFromPayload([legacyHighFrequency])).toEqual([]);
  });
});

describe("tickFilterGroupsFromPayload", () => {
  it("groups command and event buckets under their canonical function parent", () => {
    const parent = bucket({
      groupId: "function-group",
      key: "FUNCTION:demo:tick",
      type: "FUNCTION",
      displayName: "demo:tick",
      functionId: "demo:tick",
    });
    const command = bucket({
      groupId: "command-group",
      parentGroupId: "function-group",
      functionId: "demo:tick",
    });
    const event = bucket({
      groupId: "event-group",
      key: "EVENT:score changed",
      type: "EVENT",
      displayName: "score changed",
      parentGroupId: "function-group",
      functionId: "demo:tick",
    });

    const groups = tickFilterGroupsFromPayload([command, event, parent]);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toBe("function-group");
    expect(groups[0].children.map((child) => child.groupId)).toEqual(["command-group", "event-group"]);
    expect(groups[0].allGroupIds).toEqual(["function-group", "command-group", "event-group"]);
  });
});
