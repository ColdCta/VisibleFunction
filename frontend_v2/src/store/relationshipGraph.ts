import type { TraceIndexes, TraceRecord } from "../api/types";
import { effectiveAction } from "./recordNorm";
import { recordTick } from "./traceTime";

const MAX_RENDER_NODES = 80;

export type RelationshipLane = "event" | "function" | "command";

export type RelationshipNode = {
  id: string;
  lane: RelationshipLane;
  kind: "event" | "command" | "functionCall" | "summary" | "missing";
  label: string;
  meta: string;
  recordId?: number;
  functionCallId?: string;
  count?: number;
  emphasized?: boolean;
  missing?: boolean;
};

export type RelationshipEdge = {
  id: string;
  from: string;
  to: string;
  label: "same commandId" | "same functionCallId" | "triggered by" | "emits";
  dashed?: boolean;
};

export type RelationshipGraphModel = {
  selectedEvent: TraceRecord;
  sourceCommand: TraceRecord | null;
  functionCallRecords: TraceRecord[];
  sameCommandEvents: TraceRecord[];
  commandRecords: TraceRecord[];
  eventRecords: TraceRecord[];
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  missingLinks: string[];
  collapsed: {
    events: number;
    commands: number;
  };
};

export function buildRelationshipGraph(eventId: number, indexes: TraceIndexes): RelationshipGraphModel | null {
  const selectedEvent = indexes.recordsById.get(eventId) ?? null;
  if (!selectedEvent || selectedEvent.type !== "EVENT") {
    return null;
  }

  const commandId = selectedEvent.commandContext.commandId;
  const functionCallId = selectedEvent.commandContext.functionCallId;
  const hasCommandId = present(commandId);
  const hasFunctionCallId = present(functionCallId);
  const sourceCommand = hasCommandId ? indexes.commandsByCommandId.get(commandId) ?? null : null;
  const functionCallRecords = hasFunctionCallId
    ? (indexes.recordsByFunctionCallId.get(functionCallId) ?? [])
    : [];
  const sameCommandEvents = hasCommandId
    ? (indexes.eventsByCommandId.get(commandId) ?? []).filter((record) => record.id !== selectedEvent.id)
    : [];

  const commandRecords = uniqueRecords([
    ...(sourceCommand ? [sourceCommand] : []),
    ...functionCallRecords.filter((record) => record.type === "COMMAND"),
  ]);
  const eventRecords = uniqueRecords([
    selectedEvent,
    ...sameCommandEvents,
    ...functionCallRecords.filter((record) => record.type === "EVENT" && record.id !== selectedEvent.id),
  ]);
  const missingLinks: string[] = [];
  const nodes: RelationshipNode[] = [];
  const edges: RelationshipEdge[] = [];

  nodes.push(eventNode(selectedEvent, true));

  if (hasFunctionCallId) {
    nodes.push({
      id: functionNodeId(functionCallId),
      lane: "function",
      kind: "functionCall",
      label: selectedEvent.commandContext.function || "unknown function",
      meta: `call ${functionCallId} | ${commandRecords.length} cmds | ${eventRecords.length} events`,
      functionCallId,
      emphasized: true,
    });
    edges.push({
      id: `function-${functionCallId}-selected`,
      from: functionNodeId(functionCallId),
      to: recordNodeId(selectedEvent),
      label: "same functionCallId",
    });
  } else {
    missingLinks.push("functionCallId is missing");
    nodes.push(missingNode("function", "Missing functionCallId", "No function-call grouping for this event"));
    edges.push({
      id: "missing-function-selected",
      from: "missing-function",
      to: recordNodeId(selectedEvent),
      label: "same functionCallId",
      dashed: true,
    });
  }

  if (hasCommandId && sourceCommand) {
    nodes.push(commandNode(sourceCommand, true));
    edges.push({
      id: `command-${commandId}-selected`,
      from: recordNodeId(sourceCommand),
      to: recordNodeId(selectedEvent),
      label: "triggered by",
    });
    if (hasFunctionCallId) {
      edges.push({
        id: `command-${commandId}-function-${functionCallId}`,
        from: recordNodeId(sourceCommand),
        to: functionNodeId(functionCallId),
        label: "same functionCallId",
      });
    }
  } else {
    missingLinks.push(hasCommandId ? `commandId ${commandId} is outside the current dataset` : "commandId is missing");
    nodes.push(missingNode("command", hasCommandId ? `Missing command ${commandId}` : "Missing commandId", "No causative command record in view"));
    edges.push({
      id: "missing-command-selected",
      from: "missing-command",
      to: recordNodeId(selectedEvent),
      label: "triggered by",
      dashed: true,
    });
  }

  const usedNodeIds = new Set(nodes.map((node) => node.id));
  let remaining = MAX_RENDER_NODES - nodes.length;
  let collapsedEvents = 0;
  let collapsedCommands = 0;

  const siblingEvents = sameCommandEvents.filter((record) => record.id !== selectedEvent.id);
  for (const record of siblingEvents) {
    if (remaining <= 0) {
      collapsedEvents++;
      continue;
    }
    const node = eventNode(record, false);
    if (usedNodeIds.has(node.id)) continue;
    nodes.push(node);
    usedNodeIds.add(node.id);
    remaining--;
    edges.push({
      id: `command-${commandId}-event-${record.id}`,
      from: sourceCommand ? recordNodeId(sourceCommand) : "missing-command",
      to: recordNodeId(record),
      label: "emits",
      dashed: !sourceCommand,
    });
  }

  const relatedCommands = commandRecords.filter((record) => !sourceCommand || record.id !== sourceCommand.id);
  for (const record of relatedCommands) {
    if (remaining <= 0) {
      collapsedCommands++;
      continue;
    }
    const node = commandNode(record, false);
    if (usedNodeIds.has(node.id)) continue;
    nodes.push(node);
    usedNodeIds.add(node.id);
    remaining--;
    if (hasFunctionCallId) {
      edges.push({
        id: `command-${record.id}-function-${functionCallId}`,
        from: recordNodeId(record),
        to: functionNodeId(functionCallId),
        label: "same functionCallId",
      });
    }
  }

  const relatedEvents = eventRecords.filter((record) => record.id !== selectedEvent.id && !sameCommandEvents.some((event) => event.id === record.id));
  for (const record of relatedEvents) {
    if (remaining <= 0) {
      collapsedEvents++;
      continue;
    }
    const node = eventNode(record, false);
    if (usedNodeIds.has(node.id)) continue;
    nodes.push(node);
    usedNodeIds.add(node.id);
    remaining--;
    if (hasFunctionCallId) {
      edges.push({
        id: `function-${functionCallId}-event-${record.id}`,
        from: functionNodeId(functionCallId),
        to: recordNodeId(record),
        label: "emits",
      });
    }
  }

  if (collapsedEvents > 0) {
    nodes.push(summaryNode("event", collapsedEvents, "more events"));
  }
  if (collapsedCommands > 0) {
    nodes.push(summaryNode("command", collapsedCommands, "more commands"));
  }

  return {
    selectedEvent,
    sourceCommand,
    functionCallRecords,
    sameCommandEvents,
    commandRecords,
    eventRecords,
    nodes,
    edges,
    missingLinks,
    collapsed: {
      events: collapsedEvents,
      commands: collapsedCommands,
    },
  };
}

export function relationshipGraphJson(model: RelationshipGraphModel): string {
  return JSON.stringify(
    {
      selectedEventId: model.selectedEvent.id,
      sourceCommandId: model.sourceCommand?.id ?? null,
      nodes: model.nodes,
      edges: model.edges,
      missingLinks: model.missingLinks,
      relatedRecordIds: {
        sameCommandEvents: model.sameCommandEvents.map((record) => record.id),
        functionCallRecords: model.functionCallRecords.map((record) => record.id),
      },
    },
    null,
    2
  );
}

function present(value: string | undefined): value is string {
  return Boolean(value && value !== "none");
}

function uniqueRecords(records: TraceRecord[]): TraceRecord[] {
  const seen = new Set<number>();
  const out: TraceRecord[] = [];
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
  }
  return out.sort((a, b) => a.id - b.id);
}

function eventNode(record: TraceRecord, emphasized: boolean): RelationshipNode {
  return {
    id: recordNodeId(record),
    lane: "event",
    kind: "event",
    label: effectiveAction(record) || record.subject || "event",
    meta: `#${record.id} | tick ${recordTick(record)}`,
    recordId: record.id,
    emphasized,
  };
}

function commandNode(record: TraceRecord, emphasized: boolean): RelationshipNode {
  return {
    id: recordNodeId(record),
    lane: "command",
    kind: "command",
    label: record.commandContext.command || record.subject || "command",
    meta: `#${record.id} | command ${record.commandContext.commandId}`,
    recordId: record.id,
    emphasized,
  };
}

function missingNode(lane: RelationshipLane, label: string, meta: string): RelationshipNode {
  return {
    id: `missing-${lane}`,
    lane,
    kind: "missing",
    label,
    meta,
    missing: true,
  };
}

function summaryNode(lane: RelationshipLane, count: number, label: string): RelationshipNode {
  return {
    id: `summary-${lane}-${label}`,
    lane,
    kind: "summary",
    label: `+${count} ${label}`,
    meta: "Collapsed to keep graph readable",
    count,
  };
}

function recordNodeId(record: TraceRecord): string {
  return `${record.type.toLowerCase()}-${record.id}`;
}

function functionNodeId(functionCallId: string): string {
  return `function-${functionCallId}`;
}
