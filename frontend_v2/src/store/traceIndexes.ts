import type { TraceIndexes, TraceRecord } from "../api/types";

export type { TraceIndexes };

// Full rebuild — used for initial load, replay, and after live soft-cap trimming.
export function buildIndexes(records: TraceRecord[]): TraceIndexes {
  const indexes = emptyIndexes();
  for (const r of records) addToIndexes(indexes, r);
  return indexes;
}

export function emptyIndexes(): TraceIndexes {
  return {
    recordsById: new Map(),
    commandsByCommandId: new Map(),
    eventsByCommandId: new Map(),
    recordsByFunctionCallId: new Map(),
    functionCallsByFunctionId: new Map(),
    recordsByFunctionId: new Map(),
  };
}

// Incremental O(1) update. Mutates `indexes` in place. Callers ensure the record id is new.
// Used by flushPending so a frame with N new records costs O(N), not O(total).
export function addToIndexes(indexes: TraceIndexes, r: TraceRecord): void {
  indexes.recordsById.set(r.id, r);

  const ctx = r.commandContext;
  if (ctx.commandId && ctx.commandId !== "none") {
    if (r.type === "COMMAND") {
      indexes.commandsByCommandId.set(ctx.commandId, r);
    } else if (r.type === "EVENT") {
      const arr = indexes.eventsByCommandId.get(ctx.commandId) ?? [];
      arr.push(r);
      indexes.eventsByCommandId.set(ctx.commandId, arr);
    }
  }

  if (ctx.functionCallId && ctx.functionCallId !== "none") {
    const arr = indexes.recordsByFunctionCallId.get(ctx.functionCallId) ?? [];
    arr.push(r);
    indexes.recordsByFunctionCallId.set(ctx.functionCallId, arr);
  }

  if (ctx.function && ctx.function !== "none") {
    if (ctx.functionCallId && ctx.functionCallId !== "none") {
      const set = indexes.functionCallsByFunctionId.get(ctx.function) ?? new Set<string>();
      set.add(ctx.functionCallId);
      indexes.functionCallsByFunctionId.set(ctx.function, set);
    }
    const arr = indexes.recordsByFunctionId.get(ctx.function) ?? [];
    arr.push(r);
    indexes.recordsByFunctionId.set(ctx.function, arr);
  }
}

export function isCommand(r: TraceRecord): boolean {
  return r.type === "COMMAND";
}

export function isEvent(r: TraceRecord): boolean {
  return r.type === "EVENT";
}
