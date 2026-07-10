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
  // Protocol-v3 canonical Tick Filter membership. Optional for protocol-v2 servers and legacy
  // recordings; the frontend falls back to recordIds/commandIds when absent.
  tickFilterGroupIds?: string[];
  capturedTickFilterGroupIds?: string[];
  commandContext: {
    command: string;
    commandId: string;
    source: string;
    function: string;
    functionCallId: string;
    triggerType?: string;
    triggerId?: string;
    triggerFunction?: string;
  };
  basicFields: Record<string, string>;
  detailedFields: Record<string, string>;
};

export type HealthResponse = {
  protocolVersion: number;
  running: boolean;
  port: number;
  records: number;
  sessionId: number;
  // Live game tick (server.overworld().getGameTime()), pushed every five server ticks even when
  // no events fire — lets the UI show how many ticks passed with no records instead of freezing.
  currentTick: number;
  oldestRecordId: number;
  latestRecordId: number;
  droppedStreamRecords: number;
  slowClientDisconnects: number;
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
  // These values are strings because the backend status helper serializes them as strings
  // (VisibleFunctionRecordingManager.statusJson). Normalize with normalizeRecordingStatus().
  active: string;
  activeId: string;
  activeRecords: string;
  activeBytes?: string;
  directory?: string;
  activeFile?: string;
  completed: string;
  latest: string;
  lastStopReason?: string;
  maxBytes?: string;
  maxDurationMillis?: string;
  maxFiles?: string;
  maxTotalBytes?: string;
  minFreeBytes?: string;
};

export function normalizeRecordingStatus(s: RecordingStatus): {
  active: boolean;
  activeId: string;
  activeRecords: number;
  activeBytes: number;
  directory: string;
  activeFile: string;
  completed: number;
  latest: string;
  lastStopReason: string;
  maxBytes: number;
  maxDurationMillis: number;
  maxFiles: number;
  maxTotalBytes: number;
  minFreeBytes: number;
} {
  return {
    active: s.active === "true",
    activeId: s.activeId,
    activeRecords: Number(s.activeRecords || 0),
    activeBytes: Number(s.activeBytes || 0),
    directory: s.directory ?? "",
    activeFile: s.activeFile ?? "none",
    completed: Number(s.completed || 0),
    latest: s.latest,
    lastStopReason: s.lastStopReason ?? "none",
    maxBytes: Number(s.maxBytes || 0),
    maxDurationMillis: Number(s.maxDurationMillis || 0),
    maxFiles: Number(s.maxFiles || 0),
    maxTotalBytes: Number(s.maxTotalBytes || 0),
    minFreeBytes: Number(s.minFreeBytes || 0),
  };
}

export type RecordingMetadata = {
  id: string;
  startedAtMillis: number;
  endedAtMillis: number;
  durationMillis: number;
  file: string;
  records: number;
  sizeBytes?: number;
  format?: string;
  recovered?: boolean;
  stopReason?: string;
};

export type RecordingPayload = {
  recording: RecordingMetadata | null;
  records?: TraceRecord[];
  data: GroupedResponse;
};

export type RecordingsList = {
  recordings: RecordingMetadata[];
};

export type DatapackTriggerResponse = {
  analysis: {
    generatedAtMillis: number;
    advancementResourceCount: number;
    enchantmentResourceCount: number;
    advancementSourceCount: number;
    enchantmentSourceCount: number;
    advancementTriggerCount: number;
    enchantmentTriggerCount: number;
    triggerCount: number;
    functionCount: number;
    warnings: string[];
  };
  advancements: AdvancementTriggerSource[];
  enchantments: EnchantmentTriggerSource[];
  triggers: DatapackTriggerEdge[];
  functions: TriggeredFunction[];
};

export type AdvancementTriggerSource = {
  id: string;
  pack: string;
  parent: string;
  function: string;
  triggerId: string;
  criteria: Array<{ name: string; trigger: string }>;
};

export type EnchantmentTriggerSource = {
  id: string;
  pack: string;
  supportedItems: string;
  primaryItems: string;
  slots: string[];
  functions: string[];
  triggerIds: string[];
  triggerCount: number;
};

export type DatapackTriggerEdge = {
  id: string;
  sourceType: "advancement" | "enchantment";
  sourceId: string;
  kind: "reward" | "run_function";
  function: string;
  pack: string;
  effectComponent: string;
  jsonPath: string;
  conditionSummary: string;
  affected: string;
  enchanted: string;
  functionExists: boolean;
  tickFunction: boolean;
};

export type TriggeredFunction = {
  id: string;
  functionExists: boolean;
  tickFunction: boolean;
  triggerCount: number;
  triggerIds: string[];
  advancements: string[];
  enchantments: string[];
};

export type DatapackAnalysisResponse = {
  analysis: {
    generatedAtMillis: number;
    functionCount: number;
    edgeCount: number;
    variableCount: number;
    warnings: string[];
  };
  functions: AnalyzedFunction[];
  edges: FunctionEdge[];
  commands?: DatapackCommand[];
  variables: DatapackVariable[];
  graph?: DatapackGraph;
  tags: Record<string, string[]>;
};

export type AnalyzedFunction = {
  id: string;
  pack: string;
  lineCount: number;
  commandCount: number;
  tickRoot: boolean;
  tickFunction: boolean;
  calls: string[];
  calledBy: string[];
  variables: string[];
};

export type FunctionEdge = {
  id?: string;
  from: string;
  to: string;
  kind: "direct" | "tag" | "scheduled" | string;
  viaTag: string;
  line: number;
  command: string;
  rawCommand?: string;
  effectiveCommand?: string;
  conditionSummary?: string;
  execute?: ExecuteContext;
  selectors?: SelectorRef[];
  variablesRead?: string[];
  variablesWritten?: string[];
};

export type DatapackCommand = {
  id: string;
  function: string;
  line: number;
  rawCommand: string;
  effectiveCommand: string;
  rootCommand: string;
  conditionSummary: string;
  execute: ExecuteContext;
  calls: DatapackFunctionCall[];
  variables: DatapackVariableRef[];
  variablesRead: string[];
  variablesWritten: string[];
  selectors: SelectorRef[];
};

export type ExecuteContext = {
  present: boolean;
  clauses: ExecuteClause[];
  conditions: ExecuteClause[];
  stores: ExecuteClause[];
  contextModifiers: ExecuteClause[];
  runCommand: string;
};

export type ExecuteClause = {
  mode: "if" | "unless" | "store" | "context" | string;
  keyword: string;
  raw: string;
  subject: string;
  summary: string;
  variables: string[];
  selectors: SelectorRef[];
};

export type SelectorRef = {
  raw: string;
  target: string;
  filters: Record<string, string>;
};

export type DatapackFunctionCall = {
  id: string;
  tag: boolean;
  kind: string;
};

export type DatapackVariableRef = {
  key: string;
  kind: string;
  name: string;
  access: string;
};

export type DatapackGraph = {
  nodes: DatapackGraphNode[];
  edges: DatapackGraphEdge[];
  modules: DatapackGraphModule[];
  entrypoints: {
    tickRoots: string[];
    loadRoots: string[];
    noCaller: string[];
    publicTags: string[];
  };
  warnings: string[];
};

export type DatapackGraphNode = {
  id: string;
  module: string;
  namespace: string;
  entrypoint: string;
  tickRoot: boolean;
  tickFunction: boolean;
  degree: number;
  inDegree: number;
  outDegree: number;
};

export type DatapackGraphModule = {
  id: string;
  namespace: string;
  functionCount: number;
  functions: string[];
};

export type DatapackGraphEdge = {
  from: string;
  to: string;
  kind: string;
  callCount: number;
  lines: number[];
  conditionSummaries: string[];
  sampleCommands: string[];
};

export type DatapackVariable = {
  key: string;
  kind: "scoreboard" | "score" | "storage" | "tag" | "bossbar" | string;
  name: string;
  reads: number;
  writes: number;
  occurrences: VariableOccurrence[];
};

export type VariableOccurrence = {
  function: string;
  line: number;
  access: "read" | "write" | "update" | "query" | "declare" | "remove" | string;
  command: string;
};

// Canonical protocol-v3 Tick Filter bucket. groupId/functionId/parentGroupId are optional so
// protocol-v2 servers and older recording footers can still be loaded through the legacy ids.
export type TickFilterBucketPayload = {
  groupId?: string;
  key: string;
  type: string;
  displayName: string;
  functionId?: string;
  parentGroupId?: string;
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

export type Mode = "live" | "recordings" | "replay" | "datapack";

export type FilterState = {
  tick: boolean;
  event: boolean;
  function: boolean;
  command: boolean;
  hideIdleTicks: boolean;
  // Tick noise is always filtered from the ordinary lanes. This flag only controls whether the
  // dedicated aggregate panel is visible.
  showFilteredActivity: boolean;
  search: string;
};

export type Selection =
  | { kind: "record"; id: number }
  | { kind: "functionCall"; functionCallId: string }
  | { kind: "tickFilterGroup"; groupId: string }
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
