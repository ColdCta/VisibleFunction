import { describe, expect, it } from "vitest";
import type { DatapackAnalysisResponse, TickFilterBucketPayload } from "../../api/types";
import { directStaticTickFunctionIds, reclassifyReplayTickData } from "../replayTickClassification";
import { commandAtTick } from "./fixtures";

const analysis = {
  analysis: { generatedAtMillis: 1, functionCount: 4, edgeCount: 3, variableCount: 0, warnings: [] },
  functions: [
    { id: "demo:root", tickRoot: true },
    { id: "demo:main", tickRoot: false },
    { id: "demo:conditional", tickRoot: false },
    { id: "demo:descendant", tickRoot: false },
  ],
  edges: [
    { from: "demo:root", to: "demo:main", command: "/function demo:main", rawCommand: "/function demo:main" },
    { from: "demo:main", to: "demo:conditional", command: "/execute as @a run function demo:conditional", rawCommand: "/execute as @a run function demo:conditional" },
    { from: "demo:conditional", to: "demo:descendant", command: "/function demo:descendant", rawCommand: "/function demo:descendant" },
  ],
  variables: [],
  tags: { "minecraft:tick": ["demo:root"] },
  graph: { entrypoints: { tickRoots: ["demo:root"] } },
} as unknown as DatapackAnalysisResponse;

function bucket(groupId: string, functionId: string): TickFilterBucketPayload {
  return {
    groupId,
    key: `FUNCTION:${functionId}`,
    type: "FUNCTION",
    displayName: functionId,
    functionId,
    firstSeenTick: 100,
    lastSeenTick: 100,
    startMillis: 1,
    endMillis: 1,
    totalCount: 1,
    countLastSecond: 1,
    sourceSummary: `tick function ${functionId}`,
    reason: "tick function",
    active: true,
    recordIds: [1],
    commandIds: ["1"],
    sampleRecords: [],
  };
}

describe("replay TICK reclassification", () => {
  it("propagates only over top-level function edges", () => {
    expect([...directStaticTickFunctionIds(analysis)]).toEqual(["demo:root", "demo:main"]);
  });

  it("restores records from execute-wrapped functions", () => {
    const record = commandAtTick(1, 100, {
      tickFilterGroupIds: ["conditional"],
      capturedTickFilterGroupIds: ["conditional"],
      commandContext: {
        source: "tick function",
        function: "demo:conditional",
        functionCallId: "conditional/1",
      },
    });
    const result = reclassifyReplayTickData(
      [record],
      [bucket("conditional", "demo:conditional")],
      directStaticTickFunctionIds(analysis)
    );

    expect(result.buckets).toEqual([]);
    expect(result.records[0].commandContext.source).toBe("function");
    expect(result.records[0].tickFilterGroupIds).toEqual([]);
    expect(result.records[0].capturedTickFilterGroupIds).toEqual([]);
  });

  it("fails open when no datapack analysis is available", () => {
    const record = commandAtTick(1, 100, {
      tickFilterGroupIds: ["recorded"],
      commandContext: { source: "tick function", function: "demo:root" },
    });
    const result = reclassifyReplayTickData(
      [record],
      [bucket("recorded", "demo:root")],
      new Set()
    );

    expect(result.buckets).toEqual([]);
    expect(result.records[0].commandContext.source).toBe("function");
  });
});
