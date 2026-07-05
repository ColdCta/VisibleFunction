import { describe, expect, it } from "vitest";
import { buildIndexes } from "../traceIndexes";
import { buildRelationshipGraph } from "../relationshipGraph";
import { makeRecord } from "./fixtures";

function linkedDataset() {
  const command = makeRecord({
    id: 1,
    type: "COMMAND",
    subject: "summon pig",
    commandContext: { command: "summon pig", commandId: "c1", function: "foo:bar", functionCallId: "f1" },
  });
  const event = makeRecord({
    id: 2,
    type: "EVENT",
    eventAction: "summoned",
    commandContext: { commandId: "c1", function: "foo:bar", functionCallId: "f1" },
  });
  return { command, event, indexes: buildIndexes([command, event]) };
}

describe("buildRelationshipGraph", () => {
  it("returns null when no referenced record is an EVENT", () => {
    const { indexes } = linkedDataset();
    const model = buildRelationshipGraph({ anchorEventId: 1, eventIds: [1], label: "cmd" }, indexes);
    expect(model).toBeNull();
  });

  it("links an event to its command and function call", () => {
    const { indexes } = linkedDataset();
    const model = buildRelationshipGraph({ anchorEventId: 2, eventIds: [2], label: "evt" }, indexes);
    expect(model).not.toBeNull();
    expect(model!.anchorEvent.id).toBe(2);
    expect(model!.missingLinks).toHaveLength(0);

    const functionNode = model!.nodes.find((n) => n.id === "function-f1");
    const commandNode = model!.nodes.find((n) => n.id === "command-1");
    expect(functionNode?.kind).toBe("functionCall");
    expect(commandNode?.kind).toBe("command");

    const eventGroup = model!.nodes.find((n) => n.kind === "eventGroup");
    expect(eventGroup?.label).toBe("summoned x1");

    expect(model!.edges).toContainEqual(
      expect.objectContaining({ from: "function-f1", to: "command-1", dashed: false })
    );
  });

  it("reports a missing functionCallId as a broken link", () => {
    const command = makeRecord({
      id: 1,
      type: "COMMAND",
      commandContext: { command: "summon pig", commandId: "c1" },
    });
    const event = makeRecord({
      id: 3,
      type: "EVENT",
      eventAction: "summoned",
      commandContext: { commandId: "c1", functionCallId: "none" },
    });
    const indexes = buildIndexes([command, event]);
    const model = buildRelationshipGraph({ anchorEventId: 3, eventIds: [3], label: "evt" }, indexes);
    expect(model).not.toBeNull();
    expect(model!.missingLinks).toContain("event #3: functionCallId is missing");
    expect(model!.nodes.some((n) => n.kind === "missing")).toBe(true);
  });
});
