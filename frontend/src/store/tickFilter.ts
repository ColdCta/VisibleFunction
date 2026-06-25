import type { TickFilterBand, TickFilterBucketPayload, TraceRecord } from "../api/types";
import { recordTick, TICKS_PER_SECOND } from "./traceTime";

const MIN_TOTAL_COUNT = 12;
const MIN_COUNT_PER_SECOND = 5;
const MAX_DISPLAY_NAME = 96;

type MutableBand = {
  key: string;
  displayName: string;
  startMillis: number;
  endMillis: number;
  totalCount: number;
  source: string;
  functionId: string;
  commandIds: Set<string>;
  recordIds: Set<number>;
};

export function buildTickFilterBands(records: TraceRecord[]): TickFilterBand[] {
  const groups = new Map<string, MutableBand>();

  for (const record of records) {
    if (record.type !== "COMMAND") {
      continue;
    }

    const command = normalizeCommand(record.commandContext.command || record.subject);
    if (!command) {
      continue;
    }

    const source = record.commandContext.source || "unknown";
    const functionId = record.commandContext.function || "none";
    const key = [command, source, functionId].join("\u001f");
    const group = groups.get(key) ?? {
      key,
      displayName: command,
      startMillis: recordTick(record),
      endMillis: recordTick(record),
      totalCount: 0,
      source,
      functionId,
      commandIds: new Set<string>(),
      recordIds: new Set<number>(),
    };

    const tick = recordTick(record);
    group.startMillis = Math.min(group.startMillis, tick);
    group.endMillis = Math.max(group.endMillis, tick);
    group.totalCount += 1;
    group.recordIds.add(record.id);
    if (record.commandContext.commandId && record.commandContext.commandId !== "none") {
      group.commandIds.add(record.commandContext.commandId);
    }
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map(toBand)
    .filter((band) => band.totalCount >= MIN_TOTAL_COUNT && band.countPerSecond >= MIN_COUNT_PER_SECOND)
    .sort((a, b) => b.countPerSecond - a.countPerSecond || b.totalCount - a.totalCount);
}

export function normalizeServerTickFilterBands(buckets: TickFilterBucketPayload[] | undefined): TickFilterBand[] {
  if (!buckets || buckets.length === 0) {
    return [];
  }

  return buckets.map((bucket) => ({
    key: bucket.key,
    type: bucket.type,
    displayName: bucket.displayName,
    startMillis: bucket.firstSeenTick,
    endMillis: bucket.lastSeenTick + 1,
    totalCount: bucket.totalCount,
    countPerSecond: bucket.countLastSecond,
    source: bucket.sourceSummary,
    functionId: functionFromSource(bucket.sourceSummary),
    reason: bucket.reason,
    commandIds: new Set(bucket.commandIds),
    recordIds: new Set(bucket.recordIds),
  }));
}

export function isTickFilteredRecord(record: TraceRecord, bands: TickFilterBand[]): boolean {
  if (bands.length === 0) {
    return false;
  }
  if (record.type === "EVENT") {
    return false;
  }

  for (const band of bands) {
    if (band.recordIds.has(record.id)) {
      return true;
    }
    const commandId = record.commandContext.commandId;
    if (commandId && commandId !== "none" && band.commandIds.has(commandId)) {
      return true;
    }
  }
  return false;
}

function toBand(group: MutableBand): TickFilterBand {
  const durationTicks = Math.max(TICKS_PER_SECOND, group.endMillis - group.startMillis + 1);
  const countPerSecond = Math.round((group.totalCount * TICKS_PER_SECOND) / durationTicks);
  return {
    ...group,
    displayName: trim(group.displayName),
    countPerSecond,
  };
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function trim(value: string): string {
  if (value.length <= MAX_DISPLAY_NAME) {
    return value;
  }
  return value.slice(0, MAX_DISPLAY_NAME - 1) + "...";
}

function functionFromSource(source: string): string {
  const prefix = "function ";
  const tickPrefix = "tick function ";
  if (source.startsWith(tickPrefix)) {
    return source.slice(tickPrefix.length);
  }
  if (source.startsWith(prefix)) {
    return source.slice(prefix.length);
  }
  return "none";
}
