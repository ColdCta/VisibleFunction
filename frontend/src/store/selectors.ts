import type { FilterState, TickFilterBand, TraceRecord, TraceIndexes, TimelineBucket } from "../api/types";
import { buildBuckets, buildRangeBuckets } from "./timelineBuckets";
import { buildTickFilterBands, isTickFilteredRecord } from "./tickFilter";

export type ViewModel = {
  filtered: TraceRecord[];
  buckets: TimelineBucket[];
  tickFilterBands: TickFilterBand[];
  totalCommands: number;
  totalEvents: number;
  totalFunctions: number;
  searchActive: boolean;
};

export function selectViewModel(
  records: TraceRecord[],
  indexes: TraceIndexes,
  filters: FilterState,
  bucketMillis: number,
  serverTickFilterBands: TickFilterBand[] = []
): ViewModel {
  const includeCommand = filters.command;
  const includeEvent = filters.event;
  const includeTick = filters.tick;
  const search = filters.search.trim().toLowerCase();
  const searchActive = search.length > 0;

  const filtered: TraceRecord[] = [];
  const candidates: TraceRecord[] = [];
  let totalCommands = 0;
  let totalEvents = 0;
  const functionCalls = new Set<string>();

  for (const r of records) {
    if (r.type === "COMMAND") {
      if (!includeCommand) continue;
      totalCommands++;
    } else if (r.type === "EVENT") {
      if (!includeEvent) continue;
      totalEvents++;
    }

    const hasFunction = r.commandContext.function !== "none" || r.groups.includes("functions");
    if (hasFunction) {
      const functionKey = r.commandContext.functionCallId !== "none"
        ? r.commandContext.functionCallId
        : r.commandContext.function;
      if (functionKey && functionKey !== "none") {
        functionCalls.add(functionKey);
      }
    }

    if (searchActive && !matchesSearch(r, search)) continue;

    candidates.push(r);
  }

  const tickFilterBands = serverTickFilterBands.length > 0 ? serverTickFilterBands : buildTickFilterBands(candidates);
  for (const record of candidates) {
    if (!isTickFilteredRecord(record, tickFilterBands)) {
      filtered.push(record);
    }
  }

  if (!includeTick) {
    // We do not strip records, but Hide Idle Ticks will be handled in the lane render.
  }

  let buckets = buildBuckets(filtered, bucketMillis);
  if (buckets.length === 0 && tickFilterBands.length > 0) {
    const startMillis = Math.min(...tickFilterBands.map((band) => band.startMillis));
    const endMillis = Math.max(...tickFilterBands.map((band) => band.endMillis));
    buckets = buildRangeBuckets(startMillis, endMillis, bucketMillis);
  }
  void indexes;
  return { filtered, buckets, tickFilterBands, totalCommands, totalEvents, totalFunctions: functionCalls.size, searchActive };
}

function matchesSearch(r: TraceRecord, q: string): boolean {
  if (String(r.id).includes(q)) return true;
  if (r.type.toLowerCase().includes(q)) return true;
  if (r.subject.toLowerCase().includes(q)) return true;
  if (r.summary.toLowerCase().includes(q)) return true;
  if (r.commandContext.command.toLowerCase().includes(q)) return true;
  if (r.commandContext.function.toLowerCase().includes(q)) return true;
  if (r.commandType.toLowerCase().includes(q)) return true;
  if (r.eventAction.toLowerCase().includes(q)) return true;
  for (const v of Object.values(r.basicFields)) {
    if (v.toLowerCase().includes(q)) return true;
  }
  for (const v of Object.values(r.detailedFields)) {
    if (v.toLowerCase().includes(q)) return true;
  }
  return false;
}

export function selectSelectedRecord(
  selection: { kind: "record"; id: number } | { kind: "functionCall"; functionCallId: string } | null,
  indexes: TraceIndexes
): { record: TraceRecord | null; related: TraceRecord[] } {
  if (!selection) return { record: null, related: [] };
  if (selection.kind === "record") {
    const r = indexes.recordsById.get(selection.id) ?? null;
    return { record: r, related: [] };
  }
  const peers = indexes.recordsByFunctionCallId.get(selection.functionCallId) ?? [];
  return { record: peers[0] ?? null, related: peers };
}
