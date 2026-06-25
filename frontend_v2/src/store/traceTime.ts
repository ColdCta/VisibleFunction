import type { TraceRecord } from "../api/types";

export const TICKS_PER_SECOND = 20;
export const TICK_MILLIS = 50;

export function recordTick(record: TraceRecord): number {
  const explicit = record.basicFields.tick ?? record.detailedFields.tick;
  if (explicit !== undefined) {
    const parsed = Number(explicit);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Math.floor(record.timestampMillis / TICK_MILLIS);
}

// Bucket key for a record at a given bucket size (in ticks).
export function recordTickKey(record: TraceRecord, bucketTicks: number): string {
  return String(Math.floor(recordTick(record) / bucketTicks));
}
