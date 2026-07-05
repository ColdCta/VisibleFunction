import type { TraceRecord } from "../../api/types";

export type RecordInput = {
  id: number;
  type?: string;
  subject?: string;
  summary?: string;
  timestampMillis?: number;
  eventAction?: string;
  commandType?: string;
  commandContext?: Partial<TraceRecord["commandContext"]>;
  basicFields?: Record<string, string>;
  detailedFields?: Record<string, string>;
};

// Builds a TraceRecord with sensible "none"/empty defaults so tests only spell out the fields that
// matter. Mirrors the backend contract in api/types.ts (VisibleFunctionExportJson serialization).
export function makeRecord(input: RecordInput): TraceRecord {
  const ctx = input.commandContext ?? {};
  return {
    id: input.id,
    type: input.type ?? "COMMAND",
    commandType: input.commandType ?? "none",
    eventAction: input.eventAction ?? "none",
    groups: [],
    subject: input.subject ?? "",
    summary: input.summary ?? "",
    timestampMillis: input.timestampMillis ?? 0,
    sessionId: 1,
    commandContext: {
      command: ctx.command ?? "none",
      commandId: ctx.commandId ?? "none",
      source: ctx.source ?? "unknown",
      function: ctx.function ?? "none",
      functionCallId: ctx.functionCallId ?? "none",
      triggerType: ctx.triggerType,
      triggerId: ctx.triggerId,
      triggerFunction: ctx.triggerFunction,
    },
    basicFields: input.basicFields ?? {},
    detailedFields: input.detailedFields ?? {},
  };
}

// A COMMAND record pinned to a specific tick via basicFields.tick (how the backend tags records).
export function commandAtTick(id: number, tick: number, over: Partial<RecordInput> = {}): TraceRecord {
  return makeRecord({
    id,
    type: "COMMAND",
    basicFields: { tick: String(tick) },
    commandContext: { command: "say hi", ...over.commandContext },
    ...over,
    // keep the tick we set above even if `over` also passes basicFields
    ...(over.basicFields ? { basicFields: { tick: String(tick), ...over.basicFields } } : {}),
  });
}
