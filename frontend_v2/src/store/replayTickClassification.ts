import type {
  DatapackAnalysisResponse,
  FunctionEdge,
  TickFilterBucketPayload,
  TraceRecord,
} from "../api/types";
import { bucketFunctionId, tickFilterBucketId } from "./tickFilter";

export type ReplayTickClassification = {
  records: TraceRecord[];
  buckets: TickFilterBucketPayload[];
};

export function directStaticTickFunctionIds(analysis: DatapackAnalysisResponse): Set<string> {
  const roots = analysis.graph?.entrypoints.tickRoots?.length
    ? analysis.graph.entrypoints.tickRoots
    : analysis.functions.filter((fn) => fn.tickRoot).map((fn) => fn.id);
  const eligible = new Set(roots);
  const outgoing = new Map<string, FunctionEdge[]>();
  for (const edge of analysis.edges) {
    if (!isDirectFunctionEdge(edge)) continue;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  const queue = [...roots];
  for (let index = 0; index < queue.length; index++) {
    for (const edge of outgoing.get(queue[index]) ?? []) {
      if (eligible.has(edge.to)) continue;
      eligible.add(edge.to);
      queue.push(edge.to);
    }
  }
  return eligible;
}

export function reclassifyReplayTickData(
  records: TraceRecord[],
  buckets: TickFilterBucketPayload[],
  eligibleFunctionIds: Set<string>
): ReplayTickClassification {
  const validBuckets = buckets.filter((bucket) => eligibleFunctionIds.has(bucketFunctionId(bucket)));
  const validGroupIds = new Set(validBuckets.map(tickFilterBucketId));
  const normalizedRecords = records.map((record) => normalizeRecord(record, eligibleFunctionIds, validGroupIds));
  return { records: normalizedRecords, buckets: validBuckets };
}

function isDirectFunctionEdge(edge: FunctionEdge): boolean {
  const raw = (edge.rawCommand ?? edge.command ?? "").trim().replace(/^\//, "");
  return /^function\s+/i.test(raw);
}

function normalizeRecord(
  record: TraceRecord,
  eligibleFunctionIds: Set<string>,
  validGroupIds: Set<string>
): TraceRecord {
  const eligible = eligibleFunctionIds.has(record.commandContext.function);
  const tickFilterGroupIds = record.tickFilterGroupIds?.filter((groupId) => validGroupIds.has(groupId));
  const capturedTickFilterGroupIds = record.capturedTickFilterGroupIds?.filter((groupId) => validGroupIds.has(groupId));
  const source = !eligible && record.commandContext.source === "tick function"
    ? "function"
    : record.commandContext.source;
  const membershipsChanged = tickFilterGroupIds?.length !== record.tickFilterGroupIds?.length
    || capturedTickFilterGroupIds?.length !== record.capturedTickFilterGroupIds?.length;
  if (!membershipsChanged && source === record.commandContext.source) return record;
  return {
    ...record,
    tickFilterGroupIds,
    capturedTickFilterGroupIds,
    commandContext: source === record.commandContext.source
      ? record.commandContext
      : { ...record.commandContext, source },
  };
}
