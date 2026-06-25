import type { GroupedResponse, HealthResponse, RecordingPayload, RecordingStatus, TraceRecord } from "../api/types";
import type { VisibleFunctionClient } from "../api/visibleFunctionClient";

const MOCK_STORAGE_KEY = "visiblefunction.mock.records";

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function now(): number {
  return Date.now();
}

function seed(): TraceRecord[] {
  const base = now() - 60_000;
  const out: TraceRecord[] = [];
  const functions = [
    "wtw:fight_system/on_hit",
    "wtw:damage_core",
    "wtw:damage_modifier_notcritical",
    "wtw:display_damage",
    "wtw:result_writer",
  ];
  const actions = ["player_hit", "damage_calc_start", "result_event", "storage_modified", "scoreboard_score_set"];
  const cmds = [
    "execute as @a[nbt={...}] run ...",
    "data get entity @s Health",
    "scoreboard players set ...",
    "data modify storage wtw:temp.source",
    "title @a actionbar {\"text\":\"...\"}",
    "particle minecraft:crit ...",
    "playsound minecraft:entity...",
    "scoreboard players reset ...",
    "execute store result score @s dmg",
    "function wtw:damage/crit_check",
    "tag @s add wtw:damage_calc_done",
    "execute if score @s dmg ...",
    "data modify storage wtw:temp display.value",
    "tellraw @a {\"text\":\"...\"}",
    "function wtw:cleanup/temp",
  ];
  let id = 1;
  for (let tick = 24080; tick < 24095; tick++) {
    const t = base + (tick - 24080) * 1000;
    const fc1 = rid();
    const fc2 = rid();
    const fc3 = rid();
    const fc4 = rid();
    const fc5 = rid();
    const calls = [
      { id: fc1, fn: functions[0] },
      { id: fc2, fn: functions[1] },
      { id: fc3, fn: functions[2] },
      { id: fc4, fn: functions[3] },
      { id: fc5, fn: functions[4] },
    ];
    const order: { type: "COMMAND" | "EVENT" | "FUNCTION"; idx: number; fcid: string; fn: string }[] = [];
    calls.forEach((c, ci) => {
      const count = 9 + ((ci * 7) % 9);
      for (let i = 0; i < count; i++) {
        order.push({ type: "COMMAND", idx: i, fcid: c.id, fn: c.fn });
      }
      if (ci < 3) order.push({ type: "EVENT", idx: 0, fcid: c.id, fn: c.fn });
    });
    order.forEach((o, i) => {
      const ts = t + i * 5;
      if (o.type === "COMMAND") {
        const cmd = cmds[(o.idx + tick + i) % cmds.length];
        out.push({
          id: id++,
          type: "COMMAND",
          commandType: "execute",
          eventAction: "",
          groups: ["commands"],
          subject: cmd.split(" ")[0] ?? "command",
          summary: cmd,
          timestampMillis: ts,
          commandContext: {
            command: cmd,
            commandId: `c-${tick}-${o.idx}-${o.fcid}`,
            source: "function",
            function: o.fn,
            functionCallId: o.fcid,
          },
          basicFields: {
            command: cmd,
            source: "function",
            function: o.fn,
            tick: String(tick),
            sequence: String(o.idx + 1),
          },
          detailedFields: {
            tick: String(tick),
            sequence: String(o.idx + 1),
          },
        });
      } else if (o.type === "EVENT") {
        const action = actions[(tick + i) % actions.length];
        out.push({
          id: id++,
          type: "EVENT",
          commandType: "",
          eventAction: action,
          groups: ["events", "functions"],
          subject: action,
          summary: action.replace(/_/g, " "),
          timestampMillis: ts + 2,
          commandContext: {
            command: "",
            commandId: `c-${tick}-0-${o.fcid}`,
            source: "function",
            function: o.fn,
            functionCallId: o.fcid,
          },
          basicFields: {
            tick: String(tick),
            action,
            function: o.fn,
          },
          detailedFields: {
            tick: String(tick),
            action,
          },
        });
      }
    });
  }
  return out;
}

let mockStarted = false;
let mockInterval: number | null = null;
let mockEventSourceInstalled = false;

export async function applyMockServer(client: VisibleFunctionClient): Promise<boolean> {
  if (!mockEventSourceInstalled) {
    window.EventSource = MockEventSourceImpl as unknown as typeof EventSource;
    mockEventSourceInstalled = true;
  }

  let records: TraceRecord[] = [];
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TraceRecord[];
      if (Array.isArray(parsed) && parsed.length > 0) records = parsed;
    }
  } catch {
    /* ignore */
  }
  if (records.length === 0) {
    records = seed();
    try {
      localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(records));
    } catch {
      /* ignore */
    }
  }

  let lastId = records.length ? records[records.length - 1].id : 0;
  let lastTs = records.length ? records[records.length - 1].timestampMillis : Date.now();
  mockStarted = true;

  // Patch fetch
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith(client.getBaseUrl())) {
      return realFetch(input, init);
    }
    const path = url.slice(client.getBaseUrl().length);
    const u = new URL(url);
    const after = Number(u.searchParams.get("after") ?? "0");
    const limit = Number(u.searchParams.get("limit") ?? "5000");
    const tail = u.searchParams.get("tail") === "true" || u.searchParams.get("tail") === "1";
    if (path === "/health") {
      const body: HealthResponse = { running: true, port: 17654, records: records.length };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/v1/records") {
      const slice = selectMockRecords(records, after, limit, tail);
      return new Response(JSON.stringify({ records: slice }), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/v1/grouped") {
      const body = makeGrouped(selectMockRecords(records, after, limit, tail));
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/v1/tick-filter") {
      return new Response(JSON.stringify({ tickFilter: [] }), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/v1/recording/status") {
      const body: RecordingStatus = {
        active: "true",
        activeId: "mock",
        activeRecords: String(records.length),
        completed: "0",
        latest: "mock",
      };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/v1/recordings") {
      return new Response(JSON.stringify({ recordings: [] }), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/v1/recordings/latest") {
      return new Response(
        JSON.stringify({
          recording: { id: "mock", startedAtMillis: records[0]?.timestampMillis ?? 0, endedAtMillis: lastTs, durationMillis: lastTs - (records[0]?.timestampMillis ?? lastTs), file: "mock", records: records.length },
          data: makeGrouped(records),
        } satisfies RecordingPayload),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  };

  if (mockInterval === null) {
    mockInterval = window.setInterval(() => {
      if (!mockStarted) return;
      const r = generateOne(++lastId, lastTs + 50);
      lastTs = r.timestampMillis;
      records.push(r);
      try {
        localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(records.slice(-5000)));
      } catch {
        /* ignore */
      }
      // Notify any active EventSource polyfill below.
      mockListeners.forEach((cb) => cb({ type: "record", record: r }));
    }, 250);
  }

  return true;
}

function selectMockRecords(records: TraceRecord[], after: number, limit: number, tail: boolean): TraceRecord[] {
  if (tail && after <= 0) {
    return records.slice(-limit);
  }
  return records.filter((r) => r.id > after).slice(0, limit);
}

export function stopMockServer() {
  mockStarted = false;
  if (mockInterval !== null) {
    window.clearInterval(mockInterval);
    mockInterval = null;
  }
}

const mockListeners = new Set<(m: { type: "record"; record: TraceRecord } | { type: "hello"; running: boolean; port: number; records: number }) => void>();

// Polyfill EventSource for mock mode only. Do not install this globally unless
// applyMockServer() is actually used, or the real backend SSE stream is hidden.
class MockEventSourceImpl {
  url: string;
  onerror: ((ev: Event) => void) | null = null;
  private listeners: Record<string, (ev: MessageEvent) => void> = {};
  private poll: number | null = null;
  private closeFn: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    const handler = (m: { type: "record"; record: TraceRecord } | { type: "hello"; running: boolean; port: number; records: number }) => {
      const ev = new MessageEvent("message", {
        data: JSON.stringify(m.type === "record" ? m.record : { running: m.running, port: m.port, records: m.records }),
      });
      const cb = this.listeners[m.type];
      if (cb) cb(ev);
    };
    mockListeners.add(handler as (m: { type: "record" | "hello"; record?: TraceRecord; running?: boolean; port?: number; records?: number }) => void);
    setTimeout(() => handler({ type: "hello", running: true, port: 17654, records: 0 }), 50);
    this.closeFn = () => mockListeners.delete(handler as (m: { type: "record" | "hello"; record?: TraceRecord; running?: boolean; port?: number; records?: number }) => void);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    this.listeners[type] = cb;
  }
  close() {
    this.closeFn?.();
    if (this.poll !== null) window.clearInterval(this.poll);
  }
}

function generateOne(id: number, ts: number): TraceRecord {
  const fcid = rid();
  const fn = "wtw:fight_system/on_hit";
  if (id % 5 === 0) {
    return {
      id,
      type: "EVENT",
      commandType: "data",
      eventAction: id % 10 === 0 ? "storage_modified" : "scoreboard_score_set",
      groups: ["events", "functions"],
      subject: id % 10 === 0 ? "wtw:temp" : "#temp_timer:temp",
      summary: id % 10 === 0 ? "changed data" : "score changed",
      timestampMillis: ts,
      commandContext: {
        command: "data modify storage wtw:temp display.value set value 1",
        commandId: `c-${id - 1}`,
        source: "function",
        function: fn,
        functionCallId: fcid,
      },
      basicFields: {
        action: id % 10 === 0 ? "storage_modified" : "scoreboard_score_set",
        command: "data modify storage wtw:temp display.value set value 1",
        source: "function",
        function: fn,
        tick: String(24095 + Math.floor(id / 20)),
      },
      detailedFields: {
        tick: String(24095 + Math.floor(id / 20)),
      },
    };
  }

  return {
    id,
    type: "COMMAND",
    commandType: "execute",
    eventAction: "",
    groups: ["commands"],
    subject: "execute",
    summary: "execute as @a[nbt={...}]",
    timestampMillis: ts,
    commandContext: {
      command: "execute as @a[nbt={...}]",
      commandId: `c-${id}`,
      source: "function",
      function: fn,
      functionCallId: fcid,
    },
    basicFields: {
      command: "execute as @a[nbt={...}]",
      source: "function",
      function: fn,
      tick: String(24095 + Math.floor(id / 20)),
      sequence: "1",
    },
    detailedFields: {},
  };
}

function makeGrouped(records: TraceRecord[]): GroupedResponse {
  const commands = records.filter((r) => r.type === "COMMAND");
  const events = records.filter((r) => r.type === "EVENT");
  const functions = records.filter((r) => r.groups.includes("functions") && r.type !== "EVENT" && r.type !== "COMMAND");
  const other = records.filter((r) => !commands.includes(r) && !events.includes(r) && !functions.includes(r));
  const commandsByType: Record<string, TraceRecord[]> = {};
  for (const c of commands) {
    const key = c.commandType || "other";
    (commandsByType[key] ??= []).push(c);
  }
  const eventsByAction: Record<string, TraceRecord[]> = {};
  for (const e of events) {
    const key = e.eventAction || "other";
    (eventsByAction[key] ??= []).push(e);
  }
  const functionsById: Record<string, TraceRecord[]> = {};
  for (const f of functions) {
    const key = f.commandContext.function;
    (functionsById[key] ??= []).push(f);
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
    tickFilter: [],
  };
}
