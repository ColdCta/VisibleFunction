import { create } from "zustand";
import type {
  ConnectionState,
  FilterState,
  Mode,
  RecordingMetadata,
  RecordingStatus,
  Selection,
  TickFilterBand,
  TraceRecord,
} from "../api/types";
import { DEFAULT_BASE_URL, VisibleFunctionClient, type StreamMessage } from "../api/visibleFunctionClient";
import { buildIndexes } from "./traceIndexes";
import { normalizeServerTickFilterBands } from "./tickFilter";
import { recordTick } from "./traceTime";
import { applyMockServer } from "../mock/mockServer";

const DEFAULT_VIEW_WINDOW_TICKS = 12 * 20;
const DEFAULT_LIVE_BUFFER_TICKS = 200;
const LIVE_RETENTION_TICKS = DEFAULT_VIEW_WINDOW_TICKS + DEFAULT_LIVE_BUFFER_TICKS;

export type SettingsState = {
  baseUrl: string;
  displayDensity: "comfortable" | "compact";
};

type Store = {
  baseUrl: string;
  client: VisibleFunctionClient;
  connection: ConnectionState;
  mockMode: boolean;
  mode: Mode;
  paused: boolean;
  pendingRecords: TraceRecord[];
  records: TraceRecord[];
  indexes: ReturnType<typeof buildIndexes>;
  serverTickFilterBands: TickFilterBand[];
  liveNode: TraceNodeState;
  recordNode: TraceNodeState;
  selection: Selection;
  filters: FilterState;
  range: { min: number; max: number };
  viewRange: { min: number; max: number };
  bucketMillis: number;
  autoScroll: boolean;
  recordingStatus: RecordingStatus | null;
  recordings: RecordingMetadata[];
  activeRecording: RecordingMetadata | null;
  liveSessionId: number | null;
  highlightIds: Set<number>;
  settings: SettingsState;
  setBaseUrl: (url: string) => void;
  setDensity: (d: SettingsState["displayDensity"]) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  togglePause: () => void;
  clear: () => void;
  setAutoScroll: (v: boolean) => void;
  setBucket: (millis: number) => void;
  setFilters: (patch: Partial<FilterState>) => void;
  setSelection: (s: Selection) => void;
  setRange: (min: number, max: number) => void;
  openLive: () => Promise<void>;
  openRecordings: () => Promise<void>;
  loadRecording: (rec: RecordingMetadata) => Promise<void>;
  loadLatestRecording: () => Promise<void>;
  pollRecordingStatus: () => Promise<void>;
  setMode: (m: Mode) => void;
  ingestRecord: (r: TraceRecord) => void;
};

type TraceNodeState = {
  records: TraceRecord[];
  indexes: ReturnType<typeof buildIndexes>;
  serverTickFilterBands: TickFilterBand[];
  range: { min: number; max: number };
  viewRange: { min: number; max: number };
  selection: Selection;
  highlightIds: Set<number>;
};

let streamClose: (() => void) | null = null;
let pollTimer: number | null = null;
let statusTimer: number | null = null;
let rafHandle: number | null = null;

export const useTraceStore = create<Store>((set, get) => ({
  baseUrl: DEFAULT_BASE_URL,
  client: new VisibleFunctionClient(DEFAULT_BASE_URL),
  connection: "disconnected",
  mockMode: false,
  mode: "live",
  paused: false,
  pendingRecords: [],
  records: [],
  indexes: buildIndexes([]),
  serverTickFilterBands: [],
  liveNode: emptyTraceNode(),
  recordNode: emptyTraceNode(),
  selection: null,
  filters: {
    tick: true,
    event: true,
    function: true,
    command: true,
    hideIdleTicks: false,
    search: "",
  },
  range: { min: 0, max: 0 },
  viewRange: { min: 0, max: 0 },
  bucketMillis: 1,
  autoScroll: true,
  recordingStatus: null,
  recordings: [],
  activeRecording: null,
  liveSessionId: null,
  highlightIds: new Set(),
  settings: { baseUrl: DEFAULT_BASE_URL, displayDensity: "comfortable" },

  setBaseUrl(url) {
    const cleaned = url.trim() || DEFAULT_BASE_URL;
    get().client.setBaseUrl(cleaned);
    set({ baseUrl: cleaned, settings: { ...get().settings, baseUrl: cleaned } });
  },

  setDensity(d) {
    set({ settings: { ...get().settings, displayDensity: d } });
  },

  async connect() {
    const { client } = get();
    get().disconnect();
    set({ connection: "connecting", mockMode: false });

    try {
      const health = await client.health();
      resetLiveSessionIfNeeded(health.sessionId ?? null);
    } catch {
      if (get().baseUrl !== "mock") {
        set({ connection: "disconnected" });
        return;
      }

      const mocked = await applyMockServer(client);
      if (!mocked) {
        set({ connection: "disconnected" });
        return;
      }
      set({ mockMode: true });
    }

    set({ connection: "open" });

    try {
      const back = await client.records({ limit: 5000, tail: true });
      const list = pruneLiveRecords(back.records ?? []);
      const range = computeRange(list);
      const node = traceNode(list, [], range, lastWindow(range));
      if (get().mode === "live") {
        set({ liveNode: node, ...node, pendingRecords: [] });
      } else {
        set({ liveNode: node, pendingRecords: [] });
      }
    } catch {
      /* ignore */
    }

    streamClose = client.openStream(
      (msg: StreamMessage) => {
        if (msg.type === "record") {
          if (get().connection !== "open") set({ connection: "open" });
          get().ingestRecord(msg.record);
        } else if (msg.type === "records") {
          if (get().connection !== "open") set({ connection: "open" });
          for (const record of msg.records) {
            get().ingestRecord(record);
          }
        } else if (msg.type === "hello") {
          if (get().connection !== "open") set({ connection: "open" });
          resetLiveSessionIfNeeded(msg.sessionId ?? null);
        }
      },
      () => {
        if (get().connection === "open") {
          const empty = emptyTraceNode();
          set({ connection: "reconnecting", liveNode: empty, pendingRecords: [], ...(get().mode === "live" ? empty : {}) });
        }
      }
    );

    pollTimer = window.setInterval(async () => {
      if (get().connection !== "open" || get().mockMode) return;
      const state = get();
      const last = state.mode === "live" ? state.records : state.liveNode.records;
      const lastId = last.length ? last[last.length - 1].id : 0;
      try {
        const back = await state.client.records({ after: lastId, limit: 1000 });
        for (const r of back.records ?? []) state.ingestRecord(r);
      } catch {
        /* ignore */
      }
    }, 1000);

    statusTimer = window.setInterval(() => {
      void get().pollRecordingStatus();
    }, 1000);
    void get().pollRecordingStatus();
  },

  disconnect() {
    if (streamClose) {
      streamClose();
      streamClose = null;
    }
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (statusTimer) {
      window.clearInterval(statusTimer);
      statusTimer = null;
    }
    if (rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    set({ connection: "disconnected" });
  },

  togglePause() {
    const next = !get().paused;
    set({ paused: next });
    if (!next && get().pendingRecords.length > 0) {
      flushPending();
    }
  },

  clear() {
    const empty = emptyTraceNode();
    const nodeKey = activeNodeKey(get().mode);
    set({
      [nodeKey]: empty,
      ...empty,
      records: [],
      indexes: buildIndexes([]),
      serverTickFilterBands: [],
      range: { min: 0, max: 0 },
      viewRange: { min: 0, max: 0 },
      pendingRecords: [],
    });
  },

  setAutoScroll(v) {
    const range = get().range;
    const viewRange = v ? lastWindow(range) : get().viewRange;
    const nodeKey = activeNodeKey(get().mode);
    set({ autoScroll: v, viewRange, [nodeKey]: { ...get()[nodeKey], viewRange } });
  },

  setBucket(millis) {
    set({ bucketMillis: millis });
  },

  setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } });
  },

  setSelection(s) {
    const highlight = new Set<number>();
    if (s?.kind === "record") {
      const r = get().indexes.recordsById.get(s.id);
      if (r) {
        const cid = r.commandContext.commandId;
        if (cid && cid !== "none") {
          const evs = get().indexes.eventsByCommandId.get(cid) ?? [];
          evs.forEach((e) => highlight.add(e.id));
          const cmd = get().indexes.commandsByCommandId.get(cid);
          if (cmd) highlight.add(cmd.id);
        }
        const fcid = r.commandContext.functionCallId;
        if (fcid && fcid !== "none") {
          const peers = get().indexes.recordsByFunctionCallId.get(fcid) ?? [];
          peers.forEach((p) => highlight.add(p.id));
        }
      }
    } else if (s?.kind === "functionCall") {
      const peers = get().indexes.recordsByFunctionCallId.get(s.functionCallId) ?? [];
      peers.forEach((p) => highlight.add(p.id));
    }
    const nodeKey = activeNodeKey(get().mode);
    set({ selection: s, highlightIds: highlight, [nodeKey]: { ...get()[nodeKey], selection: s, highlightIds: highlight } });
  },

  setRange(min, max) {
    const viewRange = { min, max };
    const nodeKey = activeNodeKey(get().mode);
    set({ viewRange, [nodeKey]: { ...get()[nodeKey], viewRange } });
  },

  async openLive() {
    if (get().mode !== "live" || get().connection !== "open") {
      set({ mode: "live", activeRecording: null, ...get().liveNode });
      await get().connect();
      return;
    }
    set({ mode: "live", activeRecording: null, ...get().liveNode });
  },

  async openRecordings() {
    const current = get();
    const liveNode = current.mode === "live" ? currentTraceNode(current) : current.liveNode;
    stopLiveStream();
    const empty = emptyTraceNode();
    set({
      liveNode,
      mode: "recordings",
      connection: "disconnected",
      paused: false,
      activeRecording: null,
      ...empty,
      pendingRecords: [],
    });
    if (!statusTimer) {
      statusTimer = window.setInterval(() => {
        void get().pollRecordingStatus();
      }, 1000);
    }
    try {
      const list = await get().client.recordings();
      set({ recordings: list.recordings });
    } catch {
      set({ recordings: [] });
    }
    void get().pollRecordingStatus();
  },

  async loadRecording(rec) {
    stopLiveStream();
    const payload = await get().client.recording(rec.id);
    if (!payload.recording) {
      return;
    }
    const list = dedupeById([
      ...payload.data.commands,
      ...payload.data.events,
      ...payload.data.functions,
      ...payload.data.other,
    ]).sort((a, b) => a.id - b.id);
    const range = computeRange(list);
    const node = traceNode(
      list,
      normalizeServerTickFilterBands(payload.data.tickFilter),
      range,
      replayInitialWindow(list, range)
    );
    set({
      mode: "replay",
      activeRecording: payload.recording,
      recordNode: node,
      ...node,
      autoScroll: false,
      paused: false,
      pendingRecords: [],
    });
  },

  async loadLatestRecording() {
    const list = await get().client.recordings();
    set({ recordings: list.recordings });
    if (!list.recordings.length) return;
    const latest = list.recordings[list.recordings.length - 1];
    await get().loadRecording(latest);
  },

  async pollRecordingStatus() {
    if (get().mockMode) return;
    try {
      const status = await get().client.recordingStatus();
      set({ recordingStatus: status });
    } catch {
      /* ignore */
    }
  },

  setMode(m) {
    set({ mode: m });
  },

  ingestRecord(r) {
    const cur = get();
    const liveNode = cur.mode === "live" ? currentTraceNode(cur) : cur.liveNode;
    if (liveNode.indexes.recordsById.has(r.id) || cur.pendingRecords.some((x) => x.id === r.id)) return;
    cur.pendingRecords.push(r);
    if (rafHandle !== null) return;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      flushPending();
    });
  },
}));

function stopLiveStream() {
  if (streamClose) {
    streamClose();
    streamClose = null;
  }
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  if (rafHandle) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

function flushPending() {
  const cur = useTraceStore.getState();
  if (cur.paused) {
    // Keep incoming records buffered so the visible timeline truly freezes.
    return;
  }
  const baseRecords = cur.mode === "live" ? cur.records : cur.liveNode.records;
  const baseViewRange = cur.mode === "live" ? cur.viewRange : cur.liveNode.viewRange;
  const merged = [...baseRecords, ...cur.pendingRecords];
  const dedup = dedupeById(merged);
  const bounded = pruneLiveRecords(dedup);
  const nr = computeRange(bounded);
  const newView = cur.autoScroll ? lastWindow(nr) : clampViewRange(baseViewRange, nr);
  const node = traceNode(bounded, [], nr, newView);

  if (cur.mode === "live") {
    useTraceStore.setState({
      liveNode: node,
      ...node,
      pendingRecords: [],
    });
    return;
  }

  useTraceStore.setState({
    liveNode: node,
    pendingRecords: [],
  });
}

function emptyTraceNode(): TraceNodeState {
  return traceNode([], [], { min: 0, max: 0 }, { min: 0, max: 0 });
}

function traceNode(
  records: TraceRecord[],
  serverTickFilterBands: TickFilterBand[],
  range: { min: number; max: number },
  viewRange: { min: number; max: number },
  selection: Selection = null,
  highlightIds: Set<number> = new Set()
): TraceNodeState {
  return {
    records,
    indexes: buildIndexes(records),
    serverTickFilterBands,
    range,
    viewRange,
    selection,
    highlightIds,
  };
}

function currentTraceNode(state: Store): TraceNodeState {
  return traceNode(
    state.records,
    state.serverTickFilterBands,
    state.range,
    state.viewRange,
    state.selection,
    state.highlightIds
  );
}

function activeNodeKey(mode: Mode): "liveNode" | "recordNode" {
  return mode === "live" ? "liveNode" : "recordNode";
}

function pruneLiveRecords(records: TraceRecord[]): TraceRecord[] {
  if (records.length === 0) {
    return [];
  }

  let latest = -Infinity;
  for (const record of records) {
    const tick = recordTick(record);
    if (tick > latest) {
      latest = tick;
    }
  }

  const cutoff = latest - LIVE_RETENTION_TICKS;
  return records.filter((record) => recordTick(record) >= cutoff);
}

function dedupeById(records: TraceRecord[]): TraceRecord[] {
  const seen = new Set<number>();
  const out: TraceRecord[] = [];
  for (const r of records) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function computeRange(records: TraceRecord[]): { min: number; max: number; end: number } {
  if (records.length === 0) return { min: 0, max: 0, end: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const r of records) {
    const tick = recordTick(r);
    if (tick < min) min = tick;
    if (tick > max) max = tick;
  }
  return { min, max, end: max };
}

function lastWindow(range: { min: number; max: number }): { min: number; max: number } {
  if (!range.min || !range.max) return { min: range.min, max: range.max };
  const min = Math.max(range.min, range.max - DEFAULT_VIEW_WINDOW_TICKS);
  return { min, max: range.max };
}

function clampViewRange(
  viewRange: { min: number; max: number },
  range: { min: number; max: number }
): { min: number; max: number } {
  if (!range.min || !range.max || !viewRange.min || !viewRange.max) {
    return lastWindow(range);
  }

  const span = Math.min(DEFAULT_VIEW_WINDOW_TICKS, Math.max(1, viewRange.max - viewRange.min));
  let min = viewRange.min;
  let max = viewRange.max;

  if (max < range.min || min > range.max) {
    return lastWindow(range);
  }
  if (min < range.min) {
    min = range.min;
    max = Math.min(range.max, min + span);
  }
  if (max > range.max) {
    max = range.max;
    min = Math.max(range.min, max - span);
  }

  return { min, max };
}

function firstWindow(range: { min: number; max: number }): { min: number; max: number } {
  if (!range.min || !range.max) return { min: range.min, max: range.max };
  return { min: range.min, max: Math.min(range.max, range.min + DEFAULT_VIEW_WINDOW_TICKS) };
}

function replayInitialWindow(records: TraceRecord[], range: { min: number; max: number }): { min: number; max: number } {
  const firstEvent = records.find((record) => record.type === "EVENT");
  if (!firstEvent) {
    return firstWindow(range);
  }

  const min = Math.max(range.min, recordTick(firstEvent) - 20);
  return { min, max: Math.min(range.max, min + DEFAULT_VIEW_WINDOW_TICKS) };
}

function resetLiveSessionIfNeeded(sessionId: number | null) {
  if (sessionId == null) {
    return;
  }

  const state = useTraceStore.getState();
  if (state.liveSessionId === sessionId) {
    return;
  }

  const empty = emptyTraceNode();
  useTraceStore.setState({
    liveSessionId: sessionId,
    liveNode: empty,
    pendingRecords: [],
    ...(state.mode === "live" ? empty : {}),
  });
}
