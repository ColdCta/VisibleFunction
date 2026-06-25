import type { TraceRecord } from "../api/types";

export const TICKS_PER_SECOND = 20;
export const TICK_MILLIS = 50;

export function recordTick(record: TraceRecord): number {
  const explicit = record.basicFields.tick ?? record.detailedFields.tick;
  if (explicit) {
    const parsed = Number(explicit);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Math.floor(record.timestampMillis / TICK_MILLIS);
}

export function recordTickKey(record: TraceRecord, bucketTicks: number): string {
  return String(Math.floor(recordTick(record) / bucketTicks));
}
