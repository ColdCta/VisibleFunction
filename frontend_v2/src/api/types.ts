// Types aligned to docs/frontend-agent-brief.md (§14) AND the real backend contract.
// See VisibleFunctionExportJson.java for the authoritative serialization.

export type TraceRecord = {
  id: number;
  type: "COMMAND" | "EVENT" | string;
  commandType: string;
  eventAction: string;
  groups: string[];
  subject: string;
  summary: string;
  timestampMillis: number;
  // The backend always serializes sessionId (VisibleFunctionExportJson.java:35), so it is
  // required here even though docs/frontend-agent-brief.md §14 omits it.
  sessionId: number;
  commandContext: {
    command: string;
    commandId: string;
    source: string;
    function: string;
    functionCallId: string;
  };
  basicFields: Record<string, string>;
  detailedFields: Record<string, string>;
};

export type HealthResponse = {
  running: boolean;
  port: number;
  records: number;
  sessionId: number;
};

export type GroupedResponse = {
  counts: {
    commands: number;
    events: number;
    functions: number;
    other: number;
  };
  commands: TraceRecord[];
  events: TraceRecord[];
  functions: TraceRecord[];
  other: TraceRecord[];
  commandsByType: Record<string, TraceRecord[]>;
  eventsByAction: Record<string, TraceRecord[]>;
  functionsById: Record<string, TraceRecord[]>;
  tickFilter?: TickFilterBucketPayload[];
};

export type RecordingStatus = {
  // All five values are strings because the backend status helper serializes them as strings
  // (VisibleFunctionRecordingManager.statusJson). Normalize with normalizeRecordingStatus().
  active: string;
  activeId: string;
  activeRecords: string;
  completed: string;
  latest: string;
};

export function normalizeRecordingStatus(s: RecordingStatus): {
  active: boolean;
  activeId: string;
  activeRecords: number;
  completed: number;
  latest: string;
} {
  return {
    active: s.active === "true",
    activeId: s.activeId,
    activeRecords: Number(s.activeRecords || 0),
    completed: Number(s.completed || 0),
    latest: s.latest,
  };
}

export type RecordingMetadata = {
  id: string;
  startedAtMillis: number;
  endedAtMillis: number;
  durationMillis: number;
  file: string;
  records: number;
};

export type RecordingPayload = {
  recording: RecordingMetadata | null;
  data: GroupedResponse;
};

export type RecordingsList = {
  recordings: RecordingMetadata[];
};

// Undocumented by the doc but implemented by the backend (VisibleFunctionExportJson.tickFilter).
// Kept here for forward compatibility; Batch B wires it into the UI as an opt-in feature.
export type TickFilterBucketPayload = {
  key: string;
  type: string;
  displayName: string;
  firstSeenTick: number;
  lastSeenTick: number;
  startMillis: number;
  endMillis: number;
  totalCount: number;
  countLastSecond: number;
  sourceSummary: string;
  reason: string;
  active: boolean;
  recordIds: number[];
  commandIds: string[];
  sampleRecords: TraceRecord[];
};

export type Mode = "live" | "recordings" | "replay";

// Built client-side by buildTickFilterBands. Field names keep the `millis` suffix for legacy
// compatibility but actually hold TICK values (see store/tickFilter.ts toBand), so they compose
// with tick-based buckets.
export type TickFilterBand = {
  key: string;
  displayName: string;
  startMillis: number; // actually startTick
  endMillis: number;   // actually endTick + 1
  totalCount: number;
  countPerSecond: number;
  source: string;
  functionId: string;
  commandIds: Set<string>;
  recordIds: Set<number>;
};

export type FilterState = {
  tick: boolean;
  event: boolean;
  function: boolean;
  command: boolean;
  hideIdleTicks: boolean;
  // Toggle the dedicated TICK COMMANDS lane (high-frequency command spam shown as red horizontal
  // bars, audio-track style). On by default; the lane is purely informational.
  showTickCommands: boolean;
  // When on, records matched by tick-filter bands are removed from the other lanes (TICK/EVENT/
  // FUNCTION/COMMANDS) but remain visible in the TICK COMMANDS lane. Off by default so nothing is
  // hidden unless the user opts in.
  hideHighFreq: boolean;
  search: string;
};

export type Selection =
  | { kind: "record"; id: number }
  | { kind: "functionCall"; functionCallId: string }
  | null;

export type TimelineBucket = {
  key: string;
  startTick: number;
  endTick: number;
  records: TraceRecord[];
  commands: TraceRecord[];
  events: TraceRecord[];
  functions: TraceRecord[];
  byFunctionCallId: Map<string, TraceRecord[]>;
  byCommandId: Map<string, TraceRecord[]>;
};

export type TraceIndexes = {
  recordsById: Map<number, TraceRecord>;
  commandsByCommandId: Map<string, TraceRecord>;
  eventsByCommandId: Map<string, TraceRecord[]>;
  recordsByFunctionCallId: Map<string, TraceRecord[]>;
  functionCallsByFunctionId: Map<string, Set<string>>;
  recordsByFunctionId: Map<string, TraceRecord[]>;
};

export type ConnectionState = "connecting" | "open" | "reconnecting" | "disconnected";
