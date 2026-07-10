import type { TimelineBucket, TraceRecord } from "../api/types";
import { isCommand, isEvent } from "./traceIndexes";
import { recordTick, recordTickKey } from "./traceTime";

export type BucketSize = {
  label: string;
  ticks: number;
};

// NOTE: the field is named `ticks` (not `millis`) because backend records carry a real `tick`
// field (VisibleFunction.java:307) and bucketing is by tick. The doc's example type names the
// field `millis`/`startMillis` but that predates the tick field; this clearer naming is the
// approved deviation. 40 ticks = 2s, 100 ticks = 5s.
export const BUCKET_SIZES: BucketSize[] = [
  { label: "1 Tick", ticks: 1 },
  { label: "5 Ticks", ticks: 5 },
  { label: "20 Ticks", ticks: 20 },
  { label: "2s", ticks: 40 },
  { label: "5s", ticks: 100 },
];

export function autoBucketTicks(viewSpanTicks: number, targetBuckets = 10): number {
  const span = Math.max(1, Math.ceil(viewSpanTicks));
  const target = Math.max(1, Math.floor(targetBuckets));
  const raw = Math.max(1, Math.ceil(span / target));
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const multiplier of [1, 2, 5, 10]) {
    const candidate = multiplier * magnitude;
    if (candidate >= raw) return candidate;
  }
  return raw;
}

export function buildBuckets(records: TraceRecord[], bucketTicks: number): TimelineBucket[] {
  if (records.length === 0) return [];
  return buildExplicitTickBuckets(records, bucketTicks);
}

// Empty buckets spanning [startTick, endTick] — used when there are tick-filter bands but no
// visible records, so the lanes still render a grid.
export function buildRangeBuckets(startTick: number, endTick: number, bucketTicks: number): TimelineBucket[] {
  if (!Number.isFinite(startTick) || !Number.isFinite(endTick) || endTick < startTick) {
    return [];
  }
  const start = Math.floor(startTick / bucketTicks) * bucketTicks;
  const end = Math.ceil((endTick + 1) / bucketTicks) * bucketTicks;
  const buckets: TimelineBucket[] = [];
  for (let t = start; t < end; t += bucketTicks) {
    buckets.push({
      key: String(Math.floor(t / bucketTicks)),
      startTick: t,
      endTick: t + bucketTicks,
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

export function buildBucketsForRange(
  records: TraceRecord[],
  startTick: number,
  endTick: number,
  bucketTicks: number
): TimelineBucket[] {
  const buckets = buildRangeBuckets(startTick, endTick, bucketTicks);
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const record of records) {
    const tick = recordTick(record);
    if (tick < startTick || tick > endTick) continue;
    const bucket = byKey.get(recordTickKey(record, bucketTicks));
    if (bucket) addRecordToBucket(bucket, record);
  }
  return buckets;
}

function buildExplicitTickBuckets(records: TraceRecord[], bucketTicks: number): TimelineBucket[] {
  const map = new Map<string, TimelineBucket>();

  for (const r of records) {
    const key = recordTickKey(r, bucketTicks);
    const tick = recordTick(r);
    const start = Math.floor(tick / bucketTicks) * bucketTicks;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        startTick: start,
        endTick: start + bucketTicks,
        records: [],
        commands: [],
        events: [],
        functions: [],
        byFunctionCallId: new Map(),
        byCommandId: new Map(),
      };
      map.set(key, bucket);
    }

    addRecordToBucket(bucket, r);
  }

  return Array.from(map.values()).sort((a, b) => a.startTick - b.startTick);
}

function addRecordToBucket(bucket: TimelineBucket, record: TraceRecord) {
  const tick = recordTick(record);
  bucket.startTick = Math.min(bucket.startTick, tick);
  bucket.endTick = Math.max(bucket.endTick, tick + 1);
  bucket.records.push(record);
  if (isCommand(record)) bucket.commands.push(record);
  else if (isEvent(record)) bucket.events.push(record);
  else bucket.functions.push(record);

  const functionCallId = record.commandContext.functionCallId;
  if (functionCallId && functionCallId !== "none") {
    const records = bucket.byFunctionCallId.get(functionCallId) ?? [];
    records.push(record);
    bucket.byFunctionCallId.set(functionCallId, records);
  }
  const commandId = record.commandContext.commandId;
  if (commandId && commandId !== "none") {
    const records = bucket.byCommandId.get(commandId) ?? [];
    records.push(record);
    bucket.byCommandId.set(commandId, records);
  }
}

export function formatBucketHeader(bucket: TimelineBucket, bucketTicks: number): string {
  if (bucketTicks <= 1) {
    return `Tick ${Math.floor(bucket.startTick)}`;
  }
  return `Tick ${Math.floor(bucket.startTick)}–${Math.max(Math.floor(bucket.endTick - 1), Math.floor(bucket.startTick))}`;
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
