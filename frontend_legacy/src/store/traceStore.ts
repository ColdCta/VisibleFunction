import { create } from 'zustand';
import type { Health, TraceRecord } from '../api/types';
import { hasFunction, numericCommandId } from '../api/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'mock';

export interface DerivedIndexes {
  commandsByCommandId: Map<string, TraceRecord>;
  eventsByCommandId: Map<string, TraceRecord[]>;
  recordsByFunctionCallId: Map<string, TraceRecord[]>;
  functionCallsByFunctionId: Map<string, string[]>;
}

interface TraceState {
  recordsById: Map<number, TraceRecord>;
  records: TraceRecord[];
  indexes: DerivedIndexes;
  lastRecordId: number;
  health: Health | null;
  status: ConnectionStatus;
  baseUrl: string;
  selectedRecordId: number | null;
  paused: boolean;

  backfill: (records: TraceRecord[]) => void;
  appendRecord: (record: TraceRecord) => void;
  appendRecordBatch: (records: TraceRecord[]) => void;
  setHealth: (health: Health | null) => void;
  setStatus: (status: ConnectionStatus) => void;
  setBaseUrl: (url: string) => void;
  selectRecord: (id: number | null) => void;
  togglePaused: () => void;
  clear: () => void;

  recordById: (id: number) => TraceRecord | undefined;
  commandFor: (record: TraceRecord) => TraceRecord | undefined;
  eventsForCommand: (commandId: string) => TraceRecord[];
  recordsForFunctionCall: (functionCallId: string) => TraceRecord[];
}

function emptyIndexes(): DerivedIndexes {
  return {
    commandsByCommandId: new Map(),
    eventsByCommandId: new Map(),
    recordsByFunctionCallId: new Map(),
    functionCallsByFunctionId: new Map(),
  };
}

function indexRecord(indexes: DerivedIndexes, record: TraceRecord): void {
  const cid = numericCommandId(record);
  if (cid >= 0) {
    if (record.type === 'COMMAND') {
      indexes.commandsByCommandId.set(String(cid), record);
    } else {
      const key = String(cid);
      const list = indexes.eventsByCommandId.get(key);
      if (list) {
        if (!list.includes(record)) list.push(record);
      } else {
        indexes.eventsByCommandId.set(key, [record]);
      }
    }
  }

  if (hasFunction(record)) {
    const fid = record.commandContext.function;
    const callId = record.commandContext.functionCallId;
    if (callId && callId !== 'none') {
      const list = indexes.recordsByFunctionCallId.get(callId);
      if (list) {
        if (!list.includes(record)) list.push(record);
      } else {
        indexes.recordsByFunctionCallId.set(callId, [record]);
      }
      const calls = indexes.functionCallsByFunctionId.get(fid);
      if (calls) {
        if (calls[calls.length - 1] !== callId) calls.push(callId);
      } else {
        indexes.functionCallsByFunctionId.set(fid, [callId]);
      }
    }
  }
}

function reindexAll(records: TraceRecord[]): DerivedIndexes {
  const indexes = emptyIndexes();
  for (const record of records) indexRecord(indexes, record);
  return indexes;
}

export const useTraceStore = create<TraceState>((set, get) => ({
  recordsById: new Map(),
  records: [],
  indexes: emptyIndexes(),
  lastRecordId: 0,
  health: null,
  status: 'connecting',
  baseUrl: '',
  selectedRecordId: null,
  paused: false,

  backfill: (incoming) => {
    if (incoming.length === 0) return;
    set((state) => {
      const recordsById = new Map(state.recordsById);
      let lastRecordId = state.lastRecordId;
      for (const record of incoming) {
        if (!recordsById.has(record.id)) {
          recordsById.set(record.id, record);
          if (record.id > lastRecordId) lastRecordId = record.id;
        }
      }
      const records = Array.from(recordsById.values()).sort((a, b) => a.id - b.id);
      return { recordsById, records, indexes: reindexAll(records), lastRecordId };
    });
  },

  appendRecord: (record) => {
    set((state) => {
      if (state.recordsById.has(record.id)) return state;
      const recordsById = new Map(state.recordsById);
      recordsById.set(record.id, record);
      const records = state.records.concat(record);
      const indexes = state.indexes;
      indexRecord(indexes, record);
      return {
        recordsById,
        records,
        indexes: { ...indexes },
        lastRecordId: Math.max(state.lastRecordId, record.id),
      };
    });
  },

  appendRecordBatch: (batch) => {
    if (batch.length === 0) return;
    set((state) => {
      const recordsById = new Map(state.recordsById);
      let lastRecordId = state.lastRecordId;
      let appended = 0;
      for (const record of batch) {
        if (!recordsById.has(record.id)) {
          recordsById.set(record.id, record);
          if (record.id > lastRecordId) lastRecordId = record.id;
          appended++;
        }
      }
      if (appended === 0) return state;
      const records = state.records.concat(batch.filter((r) => !state.recordsById.has(r.id)));
      const indexes = state.indexes;
      for (const record of batch) {
        if (!state.recordsById.has(record.id)) indexRecord(indexes, record);
      }
      return { recordsById, records, indexes: { ...indexes }, lastRecordId };
    });
  },

  setHealth: (health) => set({ health }),
  setStatus: (status) => set({ status }),
  setBaseUrl: (url) => set({ baseUrl: url }),
  selectRecord: (id) => set({ selectedRecordId: id }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),

  clear: () =>
    set({
      recordsById: new Map(),
      records: [],
      indexes: emptyIndexes(),
      lastRecordId: 0,
      selectedRecordId: null,
    }),

  recordById: (id) => get().recordsById.get(id),

  commandFor: (record) => {
    const cid = record.commandContext.commandId;
    if (cid === 'none' || cid === '') return undefined;
    return get().indexes.commandsByCommandId.get(cid);
  },

  eventsForCommand: (commandId) => get().indexes.eventsByCommandId.get(commandId) ?? [],

  recordsForFunctionCall: (functionCallId) =>
    get().indexes.recordsByFunctionCallId.get(functionCallId) ?? [],
}));
