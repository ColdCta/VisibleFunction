import type { TraceRecord } from '../api/types';
import { isCommand, isEvent, hasFunction } from '../api/types';

export type TypeFilter = 'all' | 'commands' | 'events' | 'function' | 'hidePlayer';

export interface FilterState {
  typeFilter: TypeFilter;
  commandType: string;
  eventAction: string;
  source: string;
  search: string;
}

export const EMPTY_FILTER: FilterState = {
  typeFilter: 'all',
  commandType: '',
  eventAction: '',
  source: '',
  search: '',
};

const SEARCH_FIELDS = ['subject', 'summary', 'command', 'commandId', 'source', 'function', 'functionCallId'];

function matchesType(record: TraceRecord, filter: TypeFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'commands':
      return isCommand(record);
    case 'events':
      return isEvent(record);
    case 'function':
      return record.commandContext.source === 'function' || hasFunction(record);
    case 'hidePlayer':
      return record.commandContext.source !== 'player';
  }
}

function matchesSearch(record: TraceRecord, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (record.type.toLowerCase().includes(q)) return true;
  if (String(record.id).includes(q)) return true;
  for (const field of SEARCH_FIELDS) {
    const value = recordValueForField(record, field);
    if (value && value.toLowerCase().includes(q)) return true;
  }
  for (const [k, v] of Object.entries(record.basicFields)) {
    if (k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) return true;
  }
  for (const [k, v] of Object.entries(record.detailedFields)) {
    if (k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) return true;
  }
  return false;
}

function recordValueForField(record: TraceRecord, field: string): string {
  switch (field) {
    case 'command':
      return record.commandContext.command;
    case 'commandId':
      return record.commandContext.commandId;
    case 'source':
      return record.commandContext.source;
    case 'function':
      return record.commandContext.function;
    case 'functionCallId':
      return record.commandContext.functionCallId;
    case 'subject':
      return record.subject;
    case 'summary':
      return record.summary;
    default:
      return '';
  }
}

export function matchesFilters(record: TraceRecord, filter: FilterState): boolean {
  if (!matchesType(record, filter.typeFilter)) return false;
  if (filter.commandType && record.commandType !== filter.commandType) return false;
  if (filter.eventAction && record.eventAction !== filter.eventAction) return false;
  if (filter.source && record.commandContext.source !== filter.source) return false;
  if (!matchesSearch(record, filter.search)) return false;
  return true;
}

export function filterRecords(records: TraceRecord[], filter: FilterState): TraceRecord[] {
  if (filter === EMPTY_FILTER) return records;
  return records.filter((r) => matchesFilters(r, filter));
}

export interface DistinctOptions {
  commandTypes: string[];
  eventActions: string[];
  sources: string[];
}

export function distinctOptions(records: TraceRecord[]): DistinctOptions {
  const commandTypes = new Set<string>();
  const eventActions = new Set<string>();
  const sources = new Set<string>();
  for (const r of records) {
    if (r.commandType && r.commandType !== 'none') commandTypes.add(r.commandType);
    if (r.eventAction && r.eventAction !== 'none') eventActions.add(r.eventAction);
    if (r.commandContext.source) sources.add(r.commandContext.source);
  }
  return {
    commandTypes: Array.from(commandTypes).sort(),
    eventActions: Array.from(eventActions).sort(),
    sources: Array.from(sources).sort(),
  };
}

export type GroupKey = 'commands' | 'events' | 'functions' | 'other';

export interface GroupedRecords {
  counts: Record<GroupKey, number>;
  commands: TraceRecord[];
  events: TraceRecord[];
  functions: TraceRecord[];
  other: TraceRecord[];
  commandsByType: Map<string, TraceRecord[]>;
  eventsByAction: Map<string, TraceRecord[]>;
  functionsById: Map<string, TraceRecord[]>;
}

export function groupRecords(records: TraceRecord[]): GroupedRecords {
  const commands: TraceRecord[] = [];
  const events: TraceRecord[] = [];
  const functions: TraceRecord[] = [];
  const other: TraceRecord[] = [];
  const commandsByType = new Map<string, TraceRecord[]>();
  const eventsByAction = new Map<string, TraceRecord[]>();
  const functionsById = new Map<string, TraceRecord[]>();

  for (const record of records) {
    if (isCommand(record)) {
      commands.push(record);
      pushGroup(commandsByType, record.commandType || 'unknown', record);
    } else if (isEvent(record)) {
      events.push(record);
      pushGroup(eventsByAction, record.eventAction || 'unknown', record);
    } else {
      other.push(record);
    }
    if (hasFunction(record)) {
      functions.push(record);
      pushGroup(functionsById, record.commandContext.function, record);
    }
  }

  return {
    counts: { commands: commands.length, events: events.length, functions: functions.length, other: other.length },
    commands,
    events,
    functions,
    other,
    commandsByType,
    eventsByAction,
    functionsById,
  };
}

function pushGroup(map: Map<string, TraceRecord[]>, key: string, record: TraceRecord): void {
  const list = map.get(key);
  if (list) list.push(record);
  else map.set(key, [record]);
}

export interface FunctionTreeNode {
  functionId: string;
  functionCallId: string;
  records: TraceRecord[];
  children: CommandTreeNode[];
}

export interface CommandTreeNode {
  commandId: string;
  command: string;
  commandRecord: TraceRecord | null;
  events: TraceRecord[];
}

export function buildFunctionTree(
  recordsByFunctionCallId: Map<string, TraceRecord[]>,
  functionCallsByFunctionId: Map<string, string[]>,
): FunctionTreeNode[] {
  const nodes: FunctionTreeNode[] = [];
  for (const [functionId, callIds] of functionCallsByFunctionId) {
    for (const callId of callIds) {
      const callRecords = recordsByFunctionCallId.get(callId);
      if (!callRecords || callRecords.length === 0) continue;
      const children = buildCommandChildren(callRecords);
      if (children.length === 0) continue;
      nodes.push({ functionId, functionCallId: callId, records: callRecords, children });
    }
  }
  nodes.sort((a, b) => {
    const aLast = a.records[a.records.length - 1]?.timestampMillis ?? 0;
    const bLast = b.records[b.records.length - 1]?.timestampMillis ?? 0;
    return bLast - aLast;
  });
  return nodes;
}

function buildCommandChildren(records: TraceRecord[]): CommandTreeNode[] {
  const children: CommandTreeNode[] = [];
  const byKey = new Map<string, CommandTreeNode>();
  for (const record of records) {
    const key = record.commandContext.commandId !== 'none'
      ? `id:${record.commandContext.commandId}`
      : record.commandContext.command && record.commandContext.command !== 'none'
        ? `cmd:${record.commandContext.command}`
        : `rec:${record.id}`;
    let node = byKey.get(key);
    if (!node) {
      node = {
        commandId: record.commandContext.commandId,
        command: record.commandContext.command,
        commandRecord: null,
        events: [],
      };
      byKey.set(key, node);
      children.push(node);
    }
    if (isCommand(record)) node.commandRecord = record;
    else if (!node.events.includes(record)) node.events.push(record);
  }
  return children;
}
