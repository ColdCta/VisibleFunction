export type TraceGapState = "recovering" | "lost";

export type TraceGap = {
  fromId: number;
  toId: number;
  state: TraceGapState;
};

export function addTraceGap(
  gaps: TraceGap[],
  fromId: number,
  toId: number,
  state: TraceGapState = "recovering"
): TraceGap[] {
  if (!Number.isFinite(fromId) || !Number.isFinite(toId) || toId < fromId) return gaps;
  return normalize([...gaps, { fromId: Math.floor(fromId), toId: Math.floor(toId), state }]);
}

export function observeTraceRecord(
  gaps: TraceGap[],
  highestObservedId: number,
  recordId: number
): { gaps: TraceGap[]; highestObservedId: number } {
  if (!Number.isFinite(recordId) || recordId <= 0) return { gaps, highestObservedId };
  let next = gaps;
  if (highestObservedId > 0 && recordId > highestObservedId + 1) {
    next = addTraceGap(next, highestObservedId + 1, recordId - 1);
  }
  next = resolveTraceRecord(next, recordId);
  return { gaps: next, highestObservedId: Math.max(highestObservedId, recordId) };
}

export function markTraceGapsUnavailableBefore(gaps: TraceGap[], oldestRecordId: number): TraceGap[] {
  if (!Number.isFinite(oldestRecordId) || oldestRecordId <= 1) return gaps;
  const unavailableThrough = Math.floor(oldestRecordId) - 1;
  const next: TraceGap[] = [];
  for (const gap of gaps) {
    if (gap.state === "lost" || gap.fromId > unavailableThrough) {
      next.push(gap);
      continue;
    }
    next.push({ fromId: gap.fromId, toId: Math.min(gap.toId, unavailableThrough), state: "lost" });
    if (gap.toId > unavailableThrough) {
      next.push({ fromId: unavailableThrough + 1, toId: gap.toId, state: "recovering" });
    }
  }
  return normalize(next);
}

export function nextRecoveringTraceGap(gaps: TraceGap[]): TraceGap | undefined {
  return gaps.find((gap) => gap.state === "recovering");
}

export function traceGapCount(gaps: TraceGap[], state?: TraceGapState): number {
  return gaps.reduce(
    (total, gap) => total + (state === undefined || gap.state === state ? gap.toId - gap.fromId + 1 : 0),
    0
  );
}

function resolveTraceRecord(gaps: TraceGap[], recordId: number): TraceGap[] {
  const next: TraceGap[] = [];
  let changed = false;
  for (const gap of gaps) {
    if (recordId < gap.fromId || recordId > gap.toId) {
      next.push(gap);
      continue;
    }
    changed = true;
    if (recordId > gap.fromId) next.push({ ...gap, toId: recordId - 1 });
    if (recordId < gap.toId) next.push({ ...gap, fromId: recordId + 1 });
  }
  return changed ? next : gaps;
}

function normalize(gaps: TraceGap[]): TraceGap[] {
  const sorted = gaps
    .filter((gap) => gap.toId >= gap.fromId)
    .sort((a, b) => a.fromId - b.fromId || a.toId - b.toId);
  const merged: TraceGap[] = [];
  for (const gap of sorted) {
    const last = merged.at(-1);
    if (last && last.state === gap.state && gap.fromId <= last.toId + 1) {
      last.toId = Math.max(last.toId, gap.toId);
    } else {
      merged.push({ ...gap });
    }
  }
  return merged;
}
