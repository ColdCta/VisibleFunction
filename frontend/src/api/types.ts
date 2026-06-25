export type TraceRecord = {
  id: number;
  type: string;
  commandType: string;
  eventAction: string;
  groups: string[];
  subject: string;
  summary: string;
  timestampMillis: number;
  sessionId?: number;
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

export type HealthResponse = {
  running: boolean;
  port: number;
  records: number;
  sessionId?: number;
};

export type RecordingStatus = {
  active: string;
  activeId: string;
  activeRecords: string;
  completed: string;
  latest: string;
};

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

export type Mode = "live" | "recordings" | "replay";

export type LaneKey = "tick" | "event" | "function" | "command";

export type FilterState = {
  tick: boolean;
  event: boolean;
  function: boolean;
  command: boolean;
  hideIdleTicks: boolean;
  search: string;
};

export type Selection =
  | { kind: "record"; id: number }
  | { kind: "functionCall"; functionCallId: string }
  | null;

export type TimelineBucket = {
  key: string;
  startMillis: number;
  endMillis: number;
  records: TraceRecord[];
  commands: TraceRecord[];
  events: TraceRecord[];
  functions: TraceRecord[];
  byFunctionCallId: Map<string, TraceRecord[]>;
  byCommandId: Map<string, TraceRecord[]>;
};

export type TickFilterBand = {
  key: string;
  type?: string;
  displayName: string;
  startMillis: number;
  endMillis: number;
  totalCount: number;
  countPerSecond: number;
  source: string;
  functionId: string;
  reason?: string;
  commandIds: Set<string>;
  recordIds: Set<number>;
};

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

export type TraceIndexes = {
  recordsById: Map<number, TraceRecord>;
  commandsByCommandId: Map<string, TraceRecord>;
  eventsByCommandId: Map<string, TraceRecord[]>;
  recordsByFunctionCallId: Map<string, TraceRecord[]>;
  functionCallsByFunctionId: Map<string, Set<string>>;
  recordsByFunctionId: Map<string, TraceRecord[]>;
};

export type ConnectionState = "connecting" | "open" | "reconnecting" | "disconnected";
