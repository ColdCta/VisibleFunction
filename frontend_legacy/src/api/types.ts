export type RecordType = 'COMMAND' | 'EVENT' | string;

export interface CommandContext {
  command: string;
  commandId: string;
  source: string;
  function: string;
  functionCallId: string;
}

export interface TraceRecord {
  id: number;
  type: RecordType;
  commandType: string;
  eventAction: string;
  groups: string[];
  subject: string;
  summary: string;
  timestampMillis: number;
  commandContext: CommandContext;
  basicFields: Record<string, string>;
  detailedFields: Record<string, string>;
}

export interface Health {
  running: boolean;
  port: number;
  records: number;
}

export interface GroupedResponse {
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
}

export interface RecordsResponse {
  records: TraceRecord[];
}

export const NONE = 'none';
export const UNKNOWN = 'unknown';

export function isCommand(record: TraceRecord): boolean {
  return record.type === 'COMMAND';
}

export function isEvent(record: TraceRecord): boolean {
  return record.type === 'EVENT';
}

export function hasCommandId(record: TraceRecord): boolean {
  const id = record.commandContext.commandId;
  return id !== NONE && id !== '' && !Number.isNaN(Number(id));
}

export function hasFunctionCallId(record: TraceRecord): boolean {
  const id = record.commandContext.functionCallId;
  return id !== NONE && id !== '' && !Number.isNaN(Number(id));
}

export function numericCommandId(record: TraceRecord): number {
  const n = Number(record.commandContext.commandId);
  return Number.isNaN(n) ? -1 : n;
}

export function numericFunctionCallId(record: TraceRecord): number {
  const n = Number(record.commandContext.functionCallId);
  return Number.isNaN(n) ? -1 : n;
}

export function hasFunction(record: TraceRecord): boolean {
  const fn = record.commandContext.function;
  return fn !== NONE && fn !== '' && fn.trim() !== '';
}

export function isTickFunction(fn: string): boolean {
  if (!fn || fn === NONE || fn.trim() === '') return false;
  const sep = fn.indexOf(':');
  const path = sep >= 0 ? fn.substring(sep + 1) : fn;
  return path === 'tick' || path.endsWith('/tick') || path.startsWith('tick/') || path.includes('/tick/');
}

export function sourceSummary(record: TraceRecord): string {
  const fn = record.commandContext.function;
  if (fn && fn !== NONE) {
    return (isTickFunction(fn) ? 'tick function ' : 'function ') + fn;
  }
  return record.commandContext.source || UNKNOWN;
}
