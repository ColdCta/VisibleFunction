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
    triggerType?: string;
    triggerId?: string;
    triggerFunction?: string;
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
  // These values are strings because the backend status helper serializes them as strings
  // (VisibleFunctionRecordingManager.statusJson). Normalize with normalizeRecordingStatus().
  active: string;
  activeId: string;
  activeRecords: string;
  directory?: string;
  activeFile?: string;
  completed: string;
  latest: string;
};

export function normalizeRecordingStatus(s: RecordingStatus): {
  active: boolean;
  activeId: string;
  activeRecords: number;
  directory: string;
  activeFile: string;
  completed: number;
  latest: string;
} {
  return {
    active: s.active === "true",
    activeId: s.activeId,
    activeRecords: Number(s.activeRecords || 0),
    directory: s.directory ?? "",
    activeFile: s.activeFile ?? "none",
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
  format?: string;
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

export type Mode = "live" | "recordings" | "replay" | "datapack";

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
