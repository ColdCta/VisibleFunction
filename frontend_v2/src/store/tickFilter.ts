import type { TickFilterBand, TraceRecord } from "../api/types";
import type { TickFilterBucketPayload } from "../api/types";

export function tickFilterBandsFromPayload(buckets: TickFilterBucketPayload[]): TickFilterBand[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    displayName: bucket.displayName,
    startMillis: bucket.firstSeenTick,
    endMillis: bucket.lastSeenTick + 1,
    totalCount: bucket.totalCount,
    countPerSecond: bucket.countLastSecond,
    source: bucket.sourceSummary,
    functionId: functionId(bucket),
    commandIds: new Set(bucket.commandIds),
    recordIds: new Set(bucket.recordIds),
  }));
}

export function isTickFilteredRecord(record: TraceRecord, bands: TickFilterBand[]): boolean {
  if (bands.length === 0) return false;
  for (const band of bands) {
    if (band.recordIds.has(record.id)) return true;
    const commandId = record.commandContext.commandId;
    if (commandId && commandId !== "none" && band.commandIds.has(commandId)) return true;
  }
  return false;
}

function functionId(bucket: TickFilterBucketPayload): string {
  if (bucket.type === "FUNCTION" && bucket.key.startsWith("FUNCTION:")) {
    return bucket.key.slice("FUNCTION:".length);
  }
  const match = bucket.sourceSummary.match(/(?:tick function|function)\s+(.+)$/);
  return match?.[1] ?? "none";
}
