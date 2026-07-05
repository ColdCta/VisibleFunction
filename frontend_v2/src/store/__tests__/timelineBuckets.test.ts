import { describe, expect, it } from "vitest";
import { buildBuckets, buildRangeBuckets, formatBucketHeader } from "../timelineBuckets";
import { commandAtTick, makeRecord } from "./fixtures";

describe("buildBuckets", () => {
  it("returns no buckets for an empty record list", () => {
    expect(buildBuckets([], 1)).toEqual([]);
  });

  it("groups records into per-tick buckets and partitions by kind", () => {
    const records = [
      commandAtTick(1, 0),
      makeRecord({ id: 2, type: "EVENT", basicFields: { tick: "0" }, subject: "spawned" }),
      commandAtTick(3, 1),
    ];
    const buckets = buildBuckets(records, 1);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].startTick).toBe(0);
    expect(buckets[0].commands).toHaveLength(1);
    expect(buckets[0].events).toHaveLength(1);
    expect(buckets[1].commands).toHaveLength(1);
  });

  it("indexes records by commandId and functionCallId within a bucket", () => {
    const records = [
      commandAtTick(1, 0, { commandContext: { commandId: "c1", functionCallId: "f1" } }),
      makeRecord({
        id: 2,
        type: "EVENT",
        basicFields: { tick: "0" },
        commandContext: { commandId: "c1", functionCallId: "f1" },
      }),
    ];
    const [bucket] = buildBuckets(records, 20);
    expect(bucket.byCommandId.get("c1")).toHaveLength(2);
    expect(bucket.byFunctionCallId.get("f1")).toHaveLength(2);
  });

  it("sorts buckets by start tick", () => {
    const records = [commandAtTick(1, 100), commandAtTick(2, 5)];
    const buckets = buildBuckets(records, 5);
    expect(buckets.map((b) => b.startTick)).toEqual([5, 100]);
  });
});

describe("buildRangeBuckets", () => {
  it("emits contiguous empty buckets across the range", () => {
    const buckets = buildRangeBuckets(0, 4, 2);
    expect(buckets.map((b) => b.startTick)).toEqual([0, 2, 4]);
    expect(buckets.every((b) => b.records.length === 0)).toBe(true);
  });

  it("returns nothing for an inverted range", () => {
    expect(buildRangeBuckets(10, 5, 2)).toEqual([]);
  });
});

describe("formatBucketHeader", () => {
  it("renders a single tick label at bucket size 1", () => {
    const [bucket] = buildBuckets([commandAtTick(1, 7)], 1);
    expect(formatBucketHeader(bucket, 1)).toBe("Tick 7");
  });
});
