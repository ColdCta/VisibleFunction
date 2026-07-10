import { describe, expect, it } from "vitest";
import type { FilterState } from "../../api/types";
import { selectViewModel } from "../selectors";
import { buildIndexes } from "../traceIndexes";
import { commandAtTick } from "./fixtures";

const filters: FilterState = {
  tick: true,
  event: true,
  function: true,
  command: true,
  hideIdleTicks: false,
  showFilteredActivity: true,
  search: "",
};

describe("selectViewModel", () => {
  it("treats tick zero as a valid visible range", () => {
    const records = [commandAtTick(1, 0), commandAtTick(2, 50)];
    const model = selectViewModel(records, buildIndexes(records), filters, 1, { min: 0, max: 0 }, []);

    expect(model.filtered.map((record) => record.id)).toEqual([1]);
    expect(model.buckets[0].startTick).toBe(0);
  });

  it("retroactively hides records after a captured group transition without collapsing the grid", () => {
    const records = [commandAtTick(1, 120, { tickFilterGroupIds: ["group-a"] })];
    const before = selectViewModel(
      records,
      buildIndexes(records),
      filters,
      20,
      { min: 100, max: 299 },
      [],
      new Set(),
      new Set()
    );
    const after = selectViewModel(
      records,
      buildIndexes(records),
      filters,
      20,
      { min: 100, max: 299 },
      [],
      new Set(["group-a"]),
      new Set()
    );

    expect(before.filtered).toHaveLength(1);
    expect(after.filtered).toHaveLength(0);
    expect(after.buckets).toHaveLength(10);
    expect(after.buckets.map((bucket) => bucket.startTick)).toEqual([100, 120, 140, 160, 180, 200, 220, 240, 260, 280]);
  });
});
