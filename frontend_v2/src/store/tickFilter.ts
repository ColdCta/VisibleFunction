import type { TickFilterBand, TraceRecord } from "../api/types";
import { recordTick, TICKS_PER_SECOND } from "./traceTime";

// Tick-filter detects high-frequency command spam (e.g. a datapack running `execute` every tick)
// and lets the user hide it so the timeline stays readable. This is the documented high-throughput
// affordance (docs :788-792). It is OFF by default; the status bar reports how many records hide.
// Algorithm ported from the previous frontend but adapted to tick coordinates.

const MIN_TOTAL_COUNT = 12;
const MIN_COUNT_PER_SECOND = 5;
const MAX_DISPLAY_NAME = 96;

type MutableBand = {
  key: string;
  displayName: string;
  startTick: number;
  endTick: number;
  totalCount: number;
  source: string;
  functionId: string;
  commandIds: Set<string>;
  recordIds: Set<number>;
};

export function buildTickFilterBands(records: TraceRecord[]): TickFilterBand[] {
  const groups = new Map<string, MutableBand>();

  for (const record of records) {
    if (record.type !== "COMMAND") continue;
    const command = normalizeCommand(record.commandContext.command || record.subject);
    if (!command) continue;

    const source = record.commandContext.source || "unknown";
    const functionId = record.commandContext.function || "none";
    const key = [command, source, functionId].join("\u001f");
    const tick = recordTick(record);
    const group = groups.get(key) ?? {
      key,
      displayName: command,
      startTick: tick,
      endTick: tick,
      totalCount: 0,
      source,
      functionId,
      commandIds: new Set<string>(),
      recordIds: new Set<number>(),
    };
    group.startTick = Math.min(group.startTick, tick);
    group.endTick = Math.max(group.endTick, tick);
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

export function isTickFilteredRecord(record: TraceRecord, bands: TickFilterBand[]): boolean {
  if (bands.length === 0) return false;
  if (record.type === "EVENT") return false; // never hide events
  for (const band of bands) {
    if (band.recordIds.has(record.id)) return true;
    const commandId = record.commandContext.commandId;
    if (commandId && commandId !== "none" && band.commandIds.has(commandId)) return true;
  }
  return false;
}

// TickFilterBand reuses startTick/endTick for the (mis-named) startMillis/endMillis fields so it
// composes with tick-based buckets. See types.ts TickFilterBand for the legacy field names.
function toBand(group: MutableBand): TickFilterBand {
  const durationTicks = Math.max(TICKS_PER_SECOND, group.endTick - group.startTick + 1);
  const countPerSecond = Math.round((group.totalCount * TICKS_PER_SECOND) / durationTicks);
  return {
    key: group.key,
    displayName: trim(group.displayName),
    startMillis: group.startTick,
    endMillis: group.endTick + 1,
    totalCount: group.totalCount,
    countPerSecond,
    source: group.source,
    functionId: group.functionId,
    commandIds: group.commandIds,
    recordIds: group.recordIds,
  };
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function trim(value: string): string {
  if (value.length <= MAX_DISPLAY_NAME) return value;
  return value.slice(0, MAX_DISPLAY_NAME - 1) + "…";
}
