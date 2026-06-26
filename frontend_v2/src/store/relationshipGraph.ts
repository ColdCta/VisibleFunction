import type { TraceIndexes, TraceRecord } from "../api/types";
import { effectiveAction } from "./recordNorm";

export type RelationshipGraphRequest = {
  anchorEventId: number;
  eventIds: number[];
  label: string;
};

export type RelationshipLane = "function" | "command" | "event" | "eventRecord";

export type RelationshipNode = {
  id: string;
  lane: RelationshipLane;
  kind: "eventGroup" | "eventRecord" | "command" | "functionCall" | "summary" | "missing";
  label: string;
  meta: string;
  recordId?: number;
  functionCallId?: string;
  eventIds?: number[];
  count?: number;
  emphasized?: boolean;
  missing?: boolean;
};

export type RelationshipEdge = {
  id: string;
  from: string;
  to: string;
  dashed?: boolean;
};

export type EventActionGroup = {
  id: string;
  commandNodeId: string;
  action: string;
  eventIds: number[];
  count: number;
};

export type RelationshipGraphModel = {
  request: RelationshipGraphRequest;
  anchorEvent: TraceRecord;
  events: TraceRecord[];
  functionRecords: TraceRecord[];
  commandRecords: TraceRecord[];
  eventGroups: EventActionGroup[];
  relatedRecords: TraceRecord[];
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  missingLinks: string[];
  collapsed: {
    events: number;
    commands: number;
    functions: number;
  };
};

export function buildRelationshipGraph(
  request: RelationshipGraphRequest,
  indexes: TraceIndexes
): RelationshipGraphModel | null {
  const events = uniqueRecords(
    request.eventIds
      .map((id) => indexes.recordsById.get(id))
      .filter((record): record is TraceRecord => Boolean(record && record.type === "EVENT"))
  );
  if (events.length === 0) return null;

  const anchorEvent =
    events.find((record) => record.id === request.anchorEventId) ?? events[0];
  const nodes: RelationshipNode[] = [];
  const edges: RelationshipEdge[] = [];
  const missingLinks: string[] = [];
  const relatedRecords: TraceRecord[] = [...events];
  const commandRecords: TraceRecord[] = [];
  const functionRecords: TraceRecord[] = [];
  const usedNodeIds = new Set<string>();
  const usedEdgeIds = new Set<string>();
  const usedRecordIds = new Set(events.map((event) => event.id));
  const functionData = new Map<string, { node: RelationshipNode; recordIds: Set<number> }>();
  const commandData = new Map<string, { node: RelationshipNode; parentId: string; recordIds: Set<number> }>();
  const eventGroupData = new Map<string, { commandNodeId: string; action: string; events: TraceRecord[] }>();

  function addRecord(record: TraceRecord | null | undefined) {
    if (!record || usedRecordIds.has(record.id)) return;
    usedRecordIds.add(record.id);
    relatedRecords.push(record);
  }

  function addNode(node: RelationshipNode) {
    if (usedNodeIds.has(node.id)) return;
    usedNodeIds.add(node.id);
    nodes.push(node);
  }

  function addEdge(edge: RelationshipEdge) {
    if (usedEdgeIds.has(edge.id)) return;
    usedEdgeIds.add(edge.id);
    edges.push(edge);
  }

  for (const event of events) {
    const functionCallId = event.commandContext.functionCallId;
    const commandId = event.commandContext.commandId;
    const hasFunctionCallId = present(functionCallId);
    const hasCommandId = present(commandId);
    const functionNodeKey = hasFunctionCallId ? functionNodeId(functionCallId) : missingFunctionNodeId(event);
    const commandRecord = hasCommandId ? indexes.commandsByCommandId.get(commandId) ?? null : null;
    const commandNodeKey = commandRecord ? recordNodeId(commandRecord) : missingCommandNodeId(event);

    if (hasFunctionCallId) {
      const records = indexes.recordsByFunctionCallId.get(functionCallId) ?? [];
      for (const record of records) {
        addRecord(record);
        if (record.type === "COMMAND") commandRecords.push(record);
        functionRecords.push(record);
      }
      const existing = functionData.get(functionCallId);
      if (existing) {
        records.forEach((record) => existing.recordIds.add(record.id));
      } else {
        functionData.set(functionCallId, {
          node: {
            id: functionNodeKey,
            lane: "function",
            kind: "functionCall",
            label: event.commandContext.function || "unknown function",
            meta: `call ${functionCallId}`,
            functionCallId,
            emphasized: event.id === anchorEvent.id,
          },
          recordIds: new Set(records.map((record) => record.id)),
        });
      }
    } else {
      missingLinks.push(`event #${event.id}: functionCallId is missing`);
      addNode({
        id: functionNodeKey,
        lane: "function",
        kind: "missing",
        label: "Missing functionCallId",
        meta: `event #${event.id}`,
        missing: true,
        eventIds: [event.id],
      });
    }

    if (commandRecord) {
      addRecord(commandRecord);
      commandRecords.push(commandRecord);
      const existing = commandData.get(commandId);
      if (existing) {
        existing.recordIds.add(commandRecord.id);
      } else {
        commandData.set(commandId, {
          node: {
            id: commandNodeKey,
            lane: "command",
            kind: "command",
            label: commandRecord.commandContext.command || commandRecord.subject || "command",
            meta: `#${commandRecord.id} | command ${commandId}`,
            recordId: commandRecord.id,
            emphasized: event.id === anchorEvent.id,
          },
          parentId: functionNodeKey,
          recordIds: new Set([commandRecord.id]),
        });
      }
    } else {
      missingLinks.push(hasCommandId ? `event #${event.id}: commandId ${commandId} is outside the current dataset` : `event #${event.id}: commandId is missing`);
      addNode({
        id: commandNodeKey,
        lane: "command",
        kind: "missing",
        label: hasCommandId ? `Missing command ${commandId}` : "Missing commandId",
        meta: `event #${event.id}`,
        missing: true,
        eventIds: [event.id],
      });
    }

    addEdge({
      id: `function-${functionNodeKey}-command-${commandNodeKey}`,
      from: functionNodeKey,
      to: commandNodeKey,
      dashed: !hasFunctionCallId || !commandRecord,
    });

    const action = effectiveAction(event) || event.subject || "event";
    const eventGroupKey = `${commandNodeKey}:${action}`;
    const group = eventGroupData.get(eventGroupKey);
    if (group) {
      group.events.push(event);
    } else {
      eventGroupData.set(eventGroupKey, { commandNodeId: commandNodeKey, action, events: [event] });
    }
  }

  for (const data of functionData.values()) {
    const commandCount = uniqueRecords(
      Array.from(data.recordIds)
        .map((id) => indexes.recordsById.get(id))
        .filter((record): record is TraceRecord => Boolean(record && record.type === "COMMAND"))
    ).length;
    const eventCount = uniqueRecords(
      Array.from(data.recordIds)
        .map((id) => indexes.recordsById.get(id))
        .filter((record): record is TraceRecord => Boolean(record && record.type === "EVENT"))
    ).length;
    addNode({ ...data.node, meta: `${data.node.meta} | ${commandCount} cmds | ${eventCount} events` });
  }

  for (const data of commandData.values()) {
    addNode(data.node);
  }

  const eventGroups: EventActionGroup[] = [];
  const sortedEventGroups = Array.from(eventGroupData.entries()).sort(([, a], [, b]) => {
    const aMin = Math.min(...a.events.map((event) => event.id));
    const bMin = Math.min(...b.events.map((event) => event.id));
    return aMin - bMin;
  });

  for (const [key, group] of sortedEventGroups) {
    const eventIds = group.events.map((event) => event.id);
    const eventGroup: EventActionGroup = {
      id: eventGroupNodeId(key),
      commandNodeId: group.commandNodeId,
      action: group.action,
      eventIds,
      count: eventIds.length,
    };
    eventGroups.push(eventGroup);
    addNode({
      id: eventGroup.id,
      lane: "event",
      kind: "eventGroup",
      label: `${group.action} x${eventIds.length}`,
      meta: `${eventIds.length} event${eventIds.length === 1 ? "" : "s"} | click to expand`,
      eventIds,
      count: eventIds.length,
      emphasized: eventIds.includes(anchorEvent.id),
    });
    addEdge({
      id: `command-${group.commandNodeId}-event-${eventGroup.id}`,
      from: group.commandNodeId,
      to: eventGroup.id,
      dashed: group.commandNodeId.startsWith("missing-command"),
    });
  }

  return {
    request,
    anchorEvent,
    events,
    functionRecords: uniqueRecords(functionRecords),
    commandRecords: uniqueRecords(commandRecords),
    eventGroups,
    relatedRecords: uniqueRecords(relatedRecords),
    nodes,
    edges,
    missingLinks,
    collapsed: {
      events: 0,
      commands: 0,
      functions: 0,
    },
  };
}

export function relationshipGraphJson(model: RelationshipGraphModel): string {
  return JSON.stringify(
    {
      request: model.request,
      anchorEventId: model.anchorEvent.id,
      eventIds: model.events.map((record) => record.id),
      nodes: model.nodes,
      edges: model.edges,
      missingLinks: model.missingLinks,
      eventGroups: model.eventGroups,
      relatedRecordIds: model.relatedRecords.map((record) => record.id),
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

function recordNodeId(record: TraceRecord): string {
  return `${record.type.toLowerCase()}-${record.id}`;
}

function functionNodeId(functionCallId: string): string {
  return `function-${functionCallId}`;
}

function missingFunctionNodeId(event: TraceRecord): string {
  return `missing-function-${event.id}`;
}

function missingCommandNodeId(event: TraceRecord): string {
  const commandId = event.commandContext.commandId;
  return present(commandId) ? `missing-command-${commandId}` : `missing-command-${event.id}`;
}

function eventGroupNodeId(key: string): string {
  return `event-group-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
