import type { TimelineBucket, TraceRecord } from "../api/types";
import { isCommand, isEvent, recordTickKey } from "./traceIndexes";
import { recordTick } from "./traceTime";

export type BucketSize = {
  label: string;
  millis: number;
};

export const BUCKET_SIZES: BucketSize[] = [
  { label: "1 Tick", millis: 1 },
  { label: "5 Ticks", millis: 5 },
  { label: "20 Ticks", millis: 20 },
  { label: "2s", millis: 40 },
  { label: "5s", millis: 100 },
];

export function buildBuckets(records: TraceRecord[], bucketMillis: number): TimelineBucket[] {
  if (records.length === 0) return [];
  return buildExplicitTickBuckets(records, bucketMillis);
}

export function buildRangeBuckets(startMillis: number, endMillis: number, bucketMillis: number): TimelineBucket[] {
  if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis) || endMillis < startMillis) {
    return [];
  }

  const start = Math.floor(startMillis / bucketMillis) * bucketMillis;
  const end = Math.ceil((endMillis + 1) / bucketMillis) * bucketMillis;
  const buckets: TimelineBucket[] = [];

  for (let t = start; t < end; t += bucketMillis) {
    buckets.push({
      key: String(Math.floor(t / bucketMillis)),
      startMillis: t,
      endMillis: t + bucketMillis,
      records: [],
      commands: [],
      events: [],
      functions: [],
      byFunctionCallId: new Map(),
      byCommandId: new Map(),
    });
  }

  return buckets;
}

function buildExplicitTickBuckets(records: TraceRecord[], bucketMillis: number): TimelineBucket[] {
  const map = new Map<string, TimelineBucket>();

  for (const r of records) {
    const key = recordTickKey(r, bucketMillis);
    const tick = recordTick(r);
    const start = Math.floor(tick / bucketMillis) * bucketMillis;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        startMillis: start,
        endMillis: start + bucketMillis,
        records: [],
        commands: [],
        events: [],
        functions: [],
        byFunctionCallId: new Map(),
        byCommandId: new Map(),
      };
      map.set(key, bucket);
    }

    bucket.startMillis = Math.min(bucket.startMillis, tick);
    bucket.endMillis = Math.max(bucket.endMillis, tick + 1);
    bucket.records.push(r);
    if (isCommand(r)) bucket.commands.push(r);
    else if (isEvent(r)) bucket.events.push(r);
    else bucket.functions.push(r);

    const fcid = r.commandContext.functionCallId;
    if (fcid && fcid !== "none") {
      const arr = bucket.byFunctionCallId.get(fcid) ?? [];
      arr.push(r);
      bucket.byFunctionCallId.set(fcid, arr);
    }
    const cid = r.commandContext.commandId;
    if (cid && cid !== "none") {
      const arr = bucket.byCommandId.get(cid) ?? [];
      arr.push(r);
      bucket.byCommandId.set(cid, arr);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.startMillis - b.startMillis);
}

export function formatBucketHeader(bucket: TimelineBucket, _bucketMillis: number): string {
  return `Tick ${Math.floor(bucket.startMillis)}`;
}

export function summarizeBucket(bucket: TimelineBucket): {
  cmds: number;
  events: number;
  functions: number;
} {
  return {
    cmds: bucket.commands.length,
    events: bucket.events.length,
    functions: bucket.functions.length,
  };
}
