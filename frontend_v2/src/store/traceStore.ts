import { create } from "zustand";
import type {
  ConnectionState,
  FilterState,
  Mode,
  RecordingMetadata,
  RecordingStatus,
  Selection,
  TraceRecord,
} from "../api/types";
import { DEFAULT_BASE_URL, VisibleFunctionClient, type StreamMessage } from "../api/visibleFunctionClient";
import { buildIndexes, addToIndexes, type TraceIndexes } from "./traceIndexes";
import { recordTick } from "./traceTime";

const DEFAULT_VIEW_WINDOW_TICKS = 12 * 20; // ~12s at 20 TPS
// Live retention is tick-based (not record-count-based) so the window stays a stable time span
// regardless of record density. Both the visible retention and the hidden buffer are user-
// adjustable in the sidebar; defaults are 10s each. The buffer is retained in the background
// (records exist, just outside the visible range) for future features.
const DEFAULT_LIVE_RETENTION_TICKS = 10 * 20; // 10s visible
const DEFAULT_LIVE_BUFFER_TICKS = 10 * 20;    // 10s buffer (not shown)
// Flush throttle: under high throughput, coalesce pending records and flush at most ~12fps instead
// of every animation frame. This keeps the timeline smooth instead of stuttering when hundreds of
// records arrive per second.
const FLUSH_THROTTLE_MS = 80;
// Initial backfill on connect: only the most recent window is fetched as a seed + anchor for the
// polling `after` cursor. Full history is the Recordings/Replay flow's job. Previously this was
// 5000 records with a synchronous buildIndexes over all of them, which froze the UI on connect
// (issue #2 of the second round). 200 is cheap to index and enough to prime the live view.
const BACKFILL_LIMIT = 200;

export type SettingsState = {
  baseUrl: string;
  displayDensity: "comfortable" | "compact";
  liveRetentionTicks: number;
  liveBufferTicks: number;
};

type TraceNodeState = {
  records: TraceRecord[];
  indexes: TraceIndexes;
  range: { min: number; max: number };
  viewRange: { min: number; max: number };
  selection: Selection;
  highlightIds: Set<number>;
};

type Store = {
  baseUrl: string;
  client: VisibleFunctionClient;
  connection: ConnectionState;
  mockMode: boolean;
  streamError: boolean;
  mode: Mode;
  paused: boolean;
  pendingRecords: TraceRecord[];
  // Current-view mirror (live or replay).
  records: TraceRecord[];
  indexes: TraceIndexes;
  liveNode: TraceNodeState;
  recordNode: TraceNodeState;
  selection: Selection;
  filters: FilterState;
  range: { min: number; max: number };
  viewRange: { min: number; max: number };
  bucketTicks: number;
  autoScroll: boolean;
  recordingStatus: RecordingStatus | null;
  recordings: RecordingMetadata[];
  activeRecording: RecordingMetadata | null;
  liveSessionId: number | null;
  highlightIds: Set<number>;
  settings: SettingsState;
  setBaseUrl: (url: string) => void;
  setDensity: (d: SettingsState["displayDensity"]) => void;
  setLiveRetention: (ticks: number) => void;
  setLiveBuffer: (ticks: number) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  togglePause: () => void;
  clear: () => void;
  setAutoScroll: (v: boolean) => void;
  setBucket: (ticks: number) => void;
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

// Module-level handles so they survive re-renders but aren't part of reactive state.
let streamClose: (() => void) | null = null;
let pollTimer: number | null = null;
let statusTimer: number | null = null;
let flushTimer: number | null = null;
let lastFlushTime = 0;
const pendingIds = new Set<number>();

export const useTraceStore = create<Store>((set, get) => ({
  baseUrl: DEFAULT_BASE_URL,
  client: new VisibleFunctionClient(DEFAULT_BASE_URL),
  connection: "disconnected",
  mockMode: false,
  streamError: false,
  mode: "live",
  paused: false,
  pendingRecords: [],
  records: [],
  indexes: buildIndexes([]),
  liveNode: emptyTraceNode(),
  recordNode: emptyTraceNode(),
  selection: null,
  filters: {
    tick: true,
    event: true,
    function: true,
    command: true,
    hideIdleTicks: false,
    showTickCommands: true,
    hideHighFreq: false,
    search: "",
  },
  range: { min: 0, max: 0 },
  viewRange: { min: 0, max: 0 },
  bucketTicks: 1,
  autoScroll: true,
  recordingStatus: null,
  recordings: [],
  activeRecording: null,
  liveSessionId: null,
  highlightIds: new Set(),
  settings: { baseUrl: DEFAULT_BASE_URL, displayDensity: "comfortable", liveRetentionTicks: DEFAULT_LIVE_RETENTION_TICKS, liveBufferTicks: DEFAULT_LIVE_BUFFER_TICKS },

  setBaseUrl(url) {
    const cleaned = url.trim() || DEFAULT_BASE_URL;
    get().client.setBaseUrl(cleaned);
    set({ baseUrl: cleaned, settings: { ...get().settings, baseUrl: cleaned } });
  },

  setDensity(d) {
    set({ settings: { ...get().settings, displayDensity: d } });
  },

  setLiveRetention(ticks) {
    const clamped = Math.max(20, Math.min(10000, Math.floor(ticks)));
    set({ settings: { ...get().settings, liveRetentionTicks: clamped } });
  },

  setLiveBuffer(ticks) {
    const clamped = Math.max(0, Math.min(10000, Math.floor(ticks)));
    set({ settings: { ...get().settings, liveBufferTicks: clamped } });
  },

  async connect() {
    const { client } = get();
    get().disconnect();
    set({ connection: "connecting", mockMode: false, streamError: false });

    try {
      const health = await client.health();
      resetLiveSessionIfNeeded(health.sessionId);
    } catch {
      // Backend unreachable. Fall back to mock only if the user explicitly pointed at "mock".
      if (get().baseUrl !== "mock") {
        set({ connection: "disconnected" });
        return;
      }
      const { applyMockServer } = await import("../mock/mockServer");
      const ok = await applyMockServer(client);
      if (!ok) {
        set({ connection: "disconnected" });
        return;
      }
      set({ mockMode: true });
    }

    set({ connection: "open", streamError: false });

    // Initial backfill (docs :147). Capped at BACKFILL_LIMIT to avoid a synchronous indexing
    // storm on connect that froze the UI under high-throughput backends.
    try {
      const back = await client.records({ limit: BACKFILL_LIMIT, tail: true });
      const list = back.records ?? [];
      const range = computeRange(list);
      const node = traceNode(list, range, lastWindow(range));
      if (get().mode === "live") {
        set({ liveNode: node, ...node, pendingRecords: [] });
      } else {
        set({ liveNode: node, pendingRecords: [] });
      }
    } catch {
      /* keep last good data visible (docs :784) */
    }

    streamClose = client.openStream(
      (msg: StreamMessage) => {
        // Any inbound frame means the stream is healthy.
        if (get().connection !== "open") set({ connection: "open", streamError: false });
        if (msg.type === "record") {
          get().ingestRecord(msg.record);
        } else if (msg.type === "records") {
          for (const record of msg.records) get().ingestRecord(record);
        } else if (msg.type === "hello") {
          resetLiveSessionIfNeeded(msg.sessionId);
        }
      },
      () => {
        // SSE error: do NOT clear data (docs :784). Let EventSource retry; polling covers gaps.
        if (get().connection === "open") {
          set({ connection: "reconnecting", streamError: true });
        }
      }
    );

    // Polling fallback (docs :151). Runs in live mode while open or reconnecting.
    pollTimer = window.setInterval(async () => {
      const state = get();
      if (state.mode !== "live") return;
      if (state.connection !== "open" && state.connection !== "reconnecting") return;
      if (state.mockMode) return;
      const last = state.records.length ? state.records[state.records.length - 1].id : 0;
      try {
        const back = await state.client.records({ after: last, limit: 1000 });
        for (const r of back.records ?? []) state.ingestRecord(r);
      } catch {
        /* ignore; SSE + next tick will retry */
      }
    }, 1000);

    statusTimer = window.setInterval(() => {
      void get().pollRecordingStatus();
    }, 1000);
    void get().pollRecordingStatus();
  },

  disconnect() {
    stopLiveStream();
    if (statusTimer) {
      window.clearInterval(statusTimer);
      statusTimer = null;
    }
    set({ connection: "disconnected" });
  },

  togglePause() {
    const next = !get().paused;
    set({ paused: next });
    // Resume flushes buffered records (docs :638).
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
      pendingRecords: [],
    });
    pendingIds.clear();
  },

  setAutoScroll(v) {
    const range = get().range;
    const viewRange = v ? lastWindow(range) : get().viewRange;
    const nodeKey = activeNodeKey(get().mode);
    set({ autoScroll: v, viewRange, [nodeKey]: { ...get()[nodeKey], viewRange } });
  },

  setBucket(ticks) {
    set({ bucketTicks: ticks });
  },

  setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } });
  },

  setSelection(s) {
    const highlight = new Set<number>();
    const indexes = get().indexes;
    if (s?.kind === "record") {
      const r = indexes.recordsById.get(s.id);
      if (r) {
        const cid = r.commandContext.commandId;
        if (cid && cid !== "none") {
          const evs = indexes.eventsByCommandId.get(cid) ?? [];
          evs.forEach((e: TraceRecord) => highlight.add(e.id));
          const cmd = indexes.commandsByCommandId.get(cid);
          if (cmd) highlight.add(cmd.id);
        }
        const fcid = r.commandContext.functionCallId;
        if (fcid && fcid !== "none") {
          const peers = indexes.recordsByFunctionCallId.get(fcid) ?? [];
          peers.forEach((p: TraceRecord) => highlight.add(p.id));
        }
      }
    } else if (s?.kind === "functionCall") {
      const peers = indexes.recordsByFunctionCallId.get(s.functionCallId) ?? [];
      peers.forEach((p: TraceRecord) => highlight.add(p.id));
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
    pendingIds.clear();
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
    let payload;
    try {
      payload = await get().client.recording(rec.id);
    } catch {
      return;
    }
    if (!payload.recording) return;
    const list = dedupeById([
      ...payload.data.commands,
      ...payload.data.events,
      ...payload.data.functions,
      ...payload.data.other,
    ]).sort((a, b) => a.id - b.id);
    const range = computeRange(list);
    const node = traceNode(list, range, replayInitialWindow(list, range));
    set({
      mode: "replay",
      activeRecording: payload.recording,
      recordNode: node,
      ...node,
      autoScroll: false,
      paused: false,
      pendingRecords: [],
    });
    pendingIds.clear();
  },

  async loadLatestRecording() {
    try {
      const list = await get().client.recordings();
      set({ recordings: list.recordings });
      if (!list.recordings.length) return;
      const latest = list.recordings[list.recordings.length - 1];
      await get().loadRecording(latest);
    } catch {
      /* ignore */
    }
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
    if (liveNode.indexes.recordsById.has(r.id) || pendingIds.has(r.id)) return;
    // Immutable update (the previous frontend mutated the array in place).
    pendingIds.add(r.id);
    set({ pendingRecords: [...cur.pendingRecords, r] });
    scheduleFlush();
  },
}));

// Throttled flush scheduler. Coalesces bursts of ingestRecord calls into a single state update at
// most every FLUSH_THROTTLE_MS. If enough time has already elapsed since the last flush, fire on
// the next animation frame; otherwise defer by the remaining throttle window.
function scheduleFlush() {
  if (flushTimer !== null) return;
  const elapsed = performance.now() - lastFlushTime;
  const delay = Math.max(0, FLUSH_THROTTLE_MS - elapsed);
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    lastFlushTime = performance.now();
    requestAnimationFrame(() => flushPending());
  }, delay);
}

function stopLiveStream() {
  if (streamClose) {
    streamClose();
    streamClose = null;
  }
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  if (flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function flushPending() {
  const cur = useTraceStore.getState();
  if (cur.paused) {
    // Keep incoming records buffered so the visible timeline truly freezes (docs :637).
    return;
  }
  const baseRecords = cur.mode === "live" ? cur.records : cur.liveNode.records;
  const baseViewRange = cur.mode === "live" ? cur.viewRange : cur.liveNode.viewRange;
  const pending = cur.pendingRecords;
  // Pending records already passed dedup at ingest time (against base + pending). Concatenate.
  let merged = pending.length ? [...baseRecords, ...pending] : baseRecords;

  // Incremental index update: reuse the existing indexes and add only the new pending records.
  // This makes a flush cost O(pending) instead of O(total). The indexes object is mutated in
  // place; a fresh node wraps it so subscribers still see a new reference.
  const indexes = cur.indexes;
  if (pending.length) {
    for (const r of pending) addToIndexes(indexes, r);
  }

  // Live retention: trim by tick age so the kept window is a stable time span (~40s) regardless
  // of record density. Trimming requires dropping from the indexes too, which is not supported
  // incrementally — so rebuild from the trimmed set. Replay mode is immutable, never trimmed.
  let trimmed = false;
  if (cur.mode === "live" && merged.length > 0) {
    const pruned = pruneLiveRecords(merged);
    if (pruned.length < merged.length) {
      merged = pruned;
      trimmed = true;
    }
  }

  const fullRange = computeRange(merged);
  // In live mode the buffer portion (liveBufferTicks) is retained in the background but NOT shown:
  // clamp the visible range to the retention window ending at the latest tick. Records in the
  // buffer are still queryable via indexes/selection, just outside the rendered timeline. Replay
  // mode shows the full recording range.
  const nr = cur.mode === "live"
    ? { min: Math.max(fullRange.min, fullRange.max - cur.settings.liveRetentionTicks), max: fullRange.max }
    : fullRange;
  const newView = cur.autoScroll ? lastWindow(nr) : clampViewRange(baseViewRange, nr);
  const finalIndexes = trimmed ? buildIndexes(merged) : indexes;
  const node: TraceNodeState = {
    records: merged,
    indexes: finalIndexes,
    range: nr,
    viewRange: newView,
    selection: cur.selection,
    highlightIds: cur.highlightIds,
  };

  if (cur.mode === "live") {
    useTraceStore.setState({ liveNode: node, ...node, pendingRecords: [] });
  } else {
    useTraceStore.setState({ liveNode: node, pendingRecords: [] });
  }
  pendingIds.clear();
}

function emptyTraceNode(): TraceNodeState {
  return traceNode([], { min: 0, max: 0 }, { min: 0, max: 0 });
}

function traceNode(
  records: TraceRecord[],
  range: { min: number; max: number },
  viewRange: { min: number; max: number },
  selection: Selection = null,
  highlightIds: Set<number> = new Set()
): TraceNodeState {
  return {
    records,
    indexes: buildIndexes(records),
    range,
    viewRange,
    selection,
    highlightIds,
  };
}

function currentTraceNode(state: Store): TraceNodeState {
  return traceNode(state.records, state.range, state.viewRange, state.selection, state.highlightIds);
}

function activeNodeKey(mode: Mode): "liveNode" | "recordNode" {
  return mode === "live" ? "liveNode" : "recordNode";
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

// Keep only records whose tick is within (retention + buffer) of the latest tick. Both are user-
// adjustable; the buffer portion is retained in the background but not shown (see flushPending
// which clamps the visible range to the retention window).
function pruneLiveRecords(records: TraceRecord[]): TraceRecord[] {
  if (records.length === 0) return records;
  const { liveRetentionTicks, liveBufferTicks } = useTraceStore.getState().settings;
  const keepTicks = liveRetentionTicks + liveBufferTicks;
  let latest = -Infinity;
  for (const r of records) {
    const t = recordTick(r);
    if (t > latest) latest = t;
  }
  const cutoff = latest - keepTicks;
  return records.filter((r) => recordTick(r) >= cutoff);
}

function computeRange(records: TraceRecord[]): { min: number; max: number } {
  if (records.length === 0) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const r of records) {
    const tick = recordTick(r);
    if (tick < min) min = tick;
    if (tick > max) max = tick;
  }
  return { min, max };
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

function resetLiveSessionIfNeeded(sessionId: number) {
  if (sessionId == null) return;
  const state = useTraceStore.getState();
  if (state.liveSessionId === sessionId) return;
  const empty = emptyTraceNode();
  useTraceStore.setState({
    liveSessionId: sessionId,
    liveNode: empty,
    pendingRecords: [],
    ...(state.mode === "live" ? empty : {}),
  });
  pendingIds.clear();
}
