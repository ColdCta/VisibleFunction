import type { TickFilterBucketPayload, TraceRecord } from "../api/types";

export type TickFilterGroup = {
  groupId: string;
  bucket: TickFilterBucketPayload;
  children: TickFilterBucketPayload[];
  allGroupIds: string[];
};

export function tickFilterBucketId(bucket: TickFilterBucketPayload): string {
  return bucket.groupId || bucket.key;
}

export function capturedGroupIdsFromBuckets(buckets: TickFilterBucketPayload[]): Set<string> {
  return new Set(buckets.filter(isStaticTickFilterBucket).map(tickFilterBucketId));
}

export function mergeTickFilterBuckets(
  current: TickFilterBucketPayload[],
  incoming: TickFilterBucketPayload[]
): TickFilterBucketPayload[] {
  if (incoming.length === 0) return current;
  const merged = new Map<string, TickFilterBucketPayload>();
  for (const bucket of current) merged.set(tickFilterBucketId(bucket), bucket);
  for (const bucket of incoming) merged.set(tickFilterBucketId(bucket), bucket);
  return Array.from(merged.values()).sort(compareBuckets);
}

export function tickFilterGroupsFromPayload(buckets: TickFilterBucketPayload[]): TickFilterGroup[] {
  const sorted = buckets.filter(isStaticTickFilterBucket).sort(compareBuckets);
  const functionParents = new Map<string, TickFilterBucketPayload>();
  const bucketsById = new Map(sorted.map((bucket) => [tickFilterBucketId(bucket), bucket]));

  for (const bucket of sorted) {
    const functionId = bucketFunctionId(bucket);
    if (bucket.type === "FUNCTION" && functionId !== "none") {
      functionParents.set(functionId, bucket);
    }
  }

  const children = new Map<string, TickFilterBucketPayload[]>();
  const standalone: TickFilterBucketPayload[] = [];
  for (const bucket of sorted) {
    if (bucket.type === "FUNCTION") continue;
    const functionId = bucketFunctionId(bucket);
    const parent = bucket.parentGroupId
      ? bucketsById.get(bucket.parentGroupId)
      : functionParents.get(functionId);
    if (parent?.type === "FUNCTION") {
      const parentId = tickFilterBucketId(parent);
      const list = children.get(parentId) ?? [];
      list.push(bucket);
      children.set(parentId, list);
    } else {
      standalone.push(bucket);
    }
  }

  const groups: TickFilterGroup[] = [];
  for (const parent of functionParents.values()) {
    const groupId = tickFilterBucketId(parent);
    const childBuckets = (children.get(groupId) ?? []).sort(compareBuckets);
    groups.push({
      groupId,
      bucket: parent,
      children: childBuckets,
      allGroupIds: [groupId, ...childBuckets.map(tickFilterBucketId)],
    });
  }
  for (const bucket of standalone) {
    const groupId = tickFilterBucketId(bucket);
    groups.push({ groupId, bucket, children: [], allGroupIds: [groupId] });
  }
  return groups.sort((left, right) => compareBuckets(left.bucket, right.bucket));
}

export function isTickFilteredRecord(
  record: TraceRecord,
  buckets: TickFilterBucketPayload[],
  capturedGroupIds: Set<string> = capturedGroupIdsFromBuckets(buckets),
  revealedGroupIds: Set<string> = new Set()
): boolean {
  const staticBuckets = buckets.filter(isStaticTickFilterBucket);
  const staticBucketIds = new Set(staticBuckets.map(tickFilterBucketId));
  for (const groupId of record.tickFilterGroupIds ?? []) {
    const staticallyIdentified = staticBucketIds.has(groupId) || record.commandContext.source === "tick function";
    if (staticallyIdentified && capturedGroupIds.has(groupId) && !revealedGroupIds.has(groupId)) return true;
  }

  // Protocol-v2 and legacy-recording fallback. A v3 record can also reach this path while a
  // transition and its periodic snapshot are crossing in flight.
  for (const bucket of staticBuckets) {
    const groupId = tickFilterBucketId(bucket);
    if (revealedGroupIds.has(groupId)) continue;
    if (recordMatchesTickFilterBucket(record, bucket)) return true;
  }
  // Old protocol/recording records may not carry memberships, but their source was persisted from
  // the static datapack classification performed at capture time.
  return record.commandContext.source === "tick function"
    && !(record.tickFilterGroupIds ?? []).some((groupId) => revealedGroupIds.has(groupId));
}

export function isStaticTickRecord(record: TraceRecord, buckets: TickFilterBucketPayload[]): boolean {
  if (record.commandContext.source === "tick function") return true;
  return buckets.some((bucket) => isStaticTickFilterBucket(bucket) && recordMatchesTickFilterBucket(record, bucket));
}

export function isStaticTickFilterBucket(bucket: TickFilterBucketPayload): boolean {
  const reason = bucket.reason.toLowerCase();
  const source = bucket.sourceSummary.toLowerCase();
  return reason.includes("tick function") || source.startsWith("tick function");
}

export function recordMatchesTickFilterBucket(record: TraceRecord, bucket: TickFilterBucketPayload): boolean {
  const groupId = tickFilterBucketId(bucket);
  if (record.tickFilterGroupIds?.includes(groupId)) return true;
  if (bucket.recordIds.includes(record.id)) return true;
  const commandId = record.commandContext.commandId;
  return Boolean(commandId && commandId !== "none" && bucket.commandIds.includes(commandId));
}

export function bucketFunctionId(bucket: TickFilterBucketPayload): string {
  if (bucket.functionId && bucket.functionId !== "none") return bucket.functionId;
  if (bucket.type === "FUNCTION" && bucket.key.startsWith("FUNCTION:")) {
    return bucket.key.slice("FUNCTION:".length);
  }
  const match = bucket.sourceSummary.match(/(?:tick function|function)\s+(.+)$/);
  return match?.[1] ?? "none";
}

function compareBuckets(left: TickFilterBucketPayload, right: TickFilterBucketPayload): number {
  if (left.active !== right.active) return left.active ? -1 : 1;
  return right.countLastSecond - left.countLastSecond
    || right.lastSeenTick - left.lastSeenTick
    || left.displayName.localeCompare(right.displayName);
}
