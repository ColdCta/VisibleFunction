import type { FilterState, TickFilterBand, TimelineBucket, TraceIndexes, TraceRecord } from "../api/types";
import { effectiveAction } from "./recordNorm";
import { buildBuckets, buildRangeBuckets } from "./timelineBuckets";
import { buildTickFilterBands, isTickFilteredRecord } from "./tickFilter";
import { recordTick } from "./traceTime";

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
  bucketTicks: number,
  viewRange?: { min: number; max: number }
): ViewModel {
  void indexes; // indexes are used by selection/highlight, not by bucketing; kept for API symmetry.

  // Type + search filtering (shared with DetailPanel via filterRecords).
  const searchActive = filters.search.trim().length > 0;
  const scopedRecords = searchActive ? records : recordsForView(records, viewRange, bucketTicks);
  const candidates = filterRecords(scopedRecords, filters);

  // Bands are always derived so the TICK COMMANDS lane can render. When hideHighFreq is on, matched
  // records are removed from the other lanes (TICK/EVENT/FUNCTION/COMMANDS) but the bands stay
  // visible in the TICK COMMANDS lane — the user sees what was filtered, not just an empty axis.
  const tickFilterBands = buildTickFilterBands(candidates);
  const filtered = filters.hideHighFreq && tickFilterBands.length > 0
    ? candidates.filter((r) => !isTickFilteredRecord(r, tickFilterBands))
    : candidates;

  let buckets = buildBuckets(filtered, bucketTicks);
  if (buckets.length === 0 && filtered.length > 0) {
    const minT = Math.min(...filtered.map((r) => Number(r.basicFields.tick ?? 0)));
    const maxT = Math.max(...filtered.map((r) => Number(r.basicFields.tick ?? 0)));
    buckets = buildRangeBuckets(minT, maxT, bucketTicks);
  }

  // Always extend the bucket grid to the latest tick from candidates (pre-hideHighFreq) so the
  // TICK lane keeps rendering the live edge even when every record in the newest tick was spam-
  // filtered out of `filtered`. Without this, the newest bucket vanishes and the TICK timeline
  // stops updating (#1).
  if (candidates.length > 0) {
    const latestTick = Math.max(...candidates.map((r) => recordTick(r)));
    const lastEnd = buckets.length > 0 ? buckets[buckets.length - 1].endTick : Math.floor(latestTick / bucketTicks) * bucketTicks;
    if (lastEnd <= latestTick) {
      const ext = buildRangeBuckets(lastEnd, latestTick, bucketTicks);
      if (ext.length > 0) buckets = buckets.concat(ext);
    }
  }

  let totalCommands = 0;
  let totalEvents = 0;
  const functionCalls = new Set<string>();
  for (const r of records) {
    if (r.type === "COMMAND") totalCommands++;
    else if (r.type === "EVENT") totalEvents++;
    const fcid = r.commandContext.functionCallId;
    if (fcid && fcid !== "none") functionCalls.add(fcid);
  }

  return {
    filtered,
    buckets,
    tickFilterBands,
    totalCommands,
    totalEvents,
    totalFunctions: functionCalls.size,
    searchActive,
  };
}

function recordsForView(
  records: TraceRecord[],
  viewRange: { min: number; max: number } | undefined,
  bucketTicks: number
): TraceRecord[] {
  if (!viewRange || (!viewRange.min && !viewRange.max) || records.length === 0) return records;
  const overscanTicks = Math.max(bucketTicks * 12, 40);
  const min = viewRange.min - overscanTicks;
  const max = viewRange.max + overscanTicks;
  const start = lowerBoundRecordTick(records, min);
  const end = upperBoundRecordTick(records, max);
  return records.slice(start, end);
}

function lowerBoundRecordTick(records: TraceRecord[], target: number): number {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (recordTick(records[mid]) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundRecordTick(records: TraceRecord[], target: number): number {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (recordTick(records[mid]) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Pure filtering (type + search only — no tick-filter, no bucketing). Shared by the timeline view
// model and the DetailPanel so Prev/Next navigation stays within the current filtered result set
// (docs §10 :598). Tick-filter is intentionally NOT applied here so Prev/Next still reaches
// spam records the user might want to inspect after toggling the filter off.
export function filterRecords(records: TraceRecord[], filters: FilterState): TraceRecord[] {
  const includeCommand = filters.command;
  const includeEvent = filters.event;
  const search = filters.search.trim().toLowerCase();
  const searchActive = search.length > 0;

  const out: TraceRecord[] = [];
  for (const r of records) {
    if (r.type === "COMMAND") {
      if (!includeCommand) continue;
    } else if (r.type === "EVENT") {
      if (!includeEvent) continue;
    }
    if (searchActive && !matchesSearch(r, search)) continue;
    out.push(r);
  }
  return out;
}

// Search across all fields listed in docs §7 :389-399. Matches field VALUES (not keys).
function matchesSearch(r: TraceRecord, q: string): boolean {
  if (String(r.id).includes(q)) return true;
  if (r.type.toLowerCase().includes(q)) return true;
  if (r.subject.toLowerCase().includes(q)) return true;
  if (r.summary.toLowerCase().includes(q)) return true;
  if (r.commandContext.command.toLowerCase().includes(q)) return true;
  if (r.commandContext.function.toLowerCase().includes(q)) return true;
  if (r.commandType.toLowerCase().includes(q)) return true;
  if (effectiveAction(r).toLowerCase().includes(q)) return true;
  for (const v of Object.values(r.basicFields)) {
    if (v.toLowerCase().includes(q)) return true;
  }
  for (const v of Object.values(r.detailedFields)) {
    if (v.toLowerCase().includes(q)) return true;
  }
  return false;
}

export function selectSelectedRecord(
  selection:
    | { kind: "record"; id: number }
    | { kind: "functionCall"; functionCallId: string }
    | null,
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
