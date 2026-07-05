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
  showTickCommands: true,
  hideHighFreq: false,
  search: "",
};

describe("selectViewModel", () => {
  it("treats tick zero as a valid visible range", () => {
    const records = [commandAtTick(1, 0), commandAtTick(2, 50)];
    const model = selectViewModel(records, buildIndexes(records), filters, 1, { min: 0, max: 0 }, []);

    expect(model.filtered.map((record) => record.id)).toEqual([1]);
    expect(model.buckets[0].startTick).toBe(0);
  });
});
