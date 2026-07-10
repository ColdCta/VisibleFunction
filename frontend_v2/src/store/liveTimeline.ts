import type { TickFilterBucketPayload, TraceRecord } from "../api/types";
import { isStaticTickRecord } from "./tickFilter";
import { recordTick } from "./traceTime";

export function latestNonTickRecordTick(
  records: TraceRecord[],
  buckets: TickFilterBucketPayload[]
): number | null {
  let latest: number | null = null;
  for (const record of records) {
    if (isStaticTickRecord(record, buckets)) continue;
    const tick = recordTick(record);
    latest = latest == null ? tick : Math.max(latest, tick);
  }
  return latest;
}

export function liveWindowForTick(
  tick: number,
  previous: { min: number; max: number } | undefined,
  defaultSpan: number
): { min: number; max: number } {
  const previousSpan = previous && Number.isFinite(previous.min) && Number.isFinite(previous.max)
    ? previous.max - previous.min
    : 0;
  const span = previousSpan > 0 ? Math.min(defaultSpan, previousSpan) : defaultSpan;
  return { min: Math.max(0, tick - span), max: tick };
}

export function skippedTicks(currentTick: number, activityTick: number): number {
  if (!Number.isFinite(currentTick) || !Number.isFinite(activityTick)) return 0;
  return Math.max(0, currentTick - activityTick);
}

export function isIdleTimelineActive(
  mode: string,
  autoScroll: boolean,
  paused: boolean,
  connection: string,
  skipped: number
): boolean {
  return mode === "live"
    && autoScroll
    && !paused
    && (connection === "open" || connection === "reconnecting")
    && skipped > 0;
}

export function shouldDisableAutoScroll(
  previousScrollLeft: number,
  currentScrollLeft: number,
  programmedTarget: number | null,
  tolerance = 1
): boolean {
  if (Math.abs(currentScrollLeft - previousScrollLeft) <= tolerance) return false;
  return programmedTarget == null || Math.abs(currentScrollLeft - programmedTarget) > tolerance;
}

export function idleRegionWidth(
  clientWidth: number,
  laneLabelWidth: number,
  horizontalPadding: number,
  fraction = 0.4
): number {
  const trackWidth = Math.max(0, clientWidth - laneLabelWidth - horizontalPadding);
  return Math.floor(trackWidth * fraction);
}
