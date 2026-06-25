import type { TraceIndexes, TraceRecord } from "../api/types";
import { recordTickKey as tickKey } from "./traceTime";

export function buildIndexes(records: TraceRecord[]): TraceIndexes {
  const recordsById = new Map<number, TraceRecord>();
  const commandsByCommandId = new Map<string, TraceRecord>();
  const eventsByCommandId = new Map<string, TraceRecord[]>();
  const recordsByFunctionCallId = new Map<string, TraceRecord[]>();
  const functionCallsByFunctionId = new Map<string, Set<string>>();
  const recordsByFunctionId = new Map<string, TraceRecord[]>();

  for (const r of records) {
    recordsById.set(r.id, r);

    const ctx = r.commandContext;
    if (ctx.commandId && ctx.commandId !== "none") {
      if (r.type === "COMMAND") {
        commandsByCommandId.set(ctx.commandId, r);
      } else if (r.type === "EVENT") {
        const arr = eventsByCommandId.get(ctx.commandId) ?? [];
        arr.push(r);
        eventsByCommandId.set(ctx.commandId, arr);
      }
    }

    if (ctx.functionCallId && ctx.functionCallId !== "none") {
      const arr = recordsByFunctionCallId.get(ctx.functionCallId) ?? [];
      arr.push(r);
      recordsByFunctionCallId.set(ctx.functionCallId, arr);
    }

    if (ctx.function && ctx.function !== "none") {
      if (ctx.functionCallId && ctx.functionCallId !== "none") {
        const set = functionCallsByFunctionId.get(ctx.function) ?? new Set();
        set.add(ctx.functionCallId);
        functionCallsByFunctionId.set(ctx.function, set);
      }
      const arr = recordsByFunctionId.get(ctx.function) ?? [];
      arr.push(r);
      recordsByFunctionId.set(ctx.function, arr);
    }
  }

  return {
    recordsById,
    commandsByCommandId,
    eventsByCommandId,
    recordsByFunctionCallId,
    functionCallsByFunctionId,
    recordsByFunctionId,
  };
}

export function isCommand(r: TraceRecord): boolean {
  return r.type === "COMMAND";
}

export function isEvent(r: TraceRecord): boolean {
  return r.type === "EVENT";
}

export function recordTickKey(r: TraceRecord, bucketMillis: number): string {
  return tickKey(r, bucketMillis);
}
