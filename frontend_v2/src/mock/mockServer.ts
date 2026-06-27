import type {
  DatapackAnalysisResponse,
  GroupedResponse,
  HealthResponse,
  RecordingPayload,
  RecordingStatus,
  TraceRecord,
} from "../api/types";
import type { VisibleFunctionClient } from "../api/visibleFunctionClient";

// ---------------------------------------------------------------------------
// Mock server. Differs from the previous frontend's mock in three important ways:
//   1. Patches to window.fetch / window.EventSource are REVERSIBLE (stopMockServer restores them),
//      so leaving mock mode no longer leaks a fake fetch into real-mode requests.
//   2. Records are faithful to the real backend: they write `event_action` (not `action`) and
//      `tick`/`sessionId`/`event_type`/`result`, so the mock exercises the same code paths the
//      real backend hits — including the recordNorm.ts workaround.
//   3. Only real action names are emitted (storage_modified, scoreboard_score_set, item_given,
//      entity_killed, effect_applied, tag_added, entity_teleported). The fictional
//      player_hit/damage_calc_start/result_event names are gone.
// ---------------------------------------------------------------------------

const MOCK_STORAGE_KEY = "visiblefunction.mock.records";

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function seed(): TraceRecord[] {
  const base = Date.now() - 60_000;
  const out: TraceRecord[] = [];
  const functions = [
    "wtw:fight_system/on_hit",
    "wtw:damage_core",
    "wtw:damage_modifier_notcritical",
    "wtw:display_damage",
    "wtw:result_writer",
  ];
  // Real backend event actions (see *ResultEventFormatter.java).
  const actions = ["storage_modified", "scoreboard_score_set", "item_given", "entity_killed", "effect_applied", "tag_added", "entity_teleported"];
  const cmds = [
    "execute as @a[nbt={...}] run ...",
    "data get entity @s Health",
    "scoreboard players set @s dmg 0",
    "data modify storage wtw:temp.source set value 1",
    "title @a actionbar {\"text\":\"...\"}",
    "particle minecraft:crit ...",
    "playsound minecraft:entity.player.attack.sweep master @a",
    "scoreboard players reset @s *",
    "execute store result score @s dmg run data get entity @s Health",
    "function wtw:damage/crit_check",
    "tag @s add wtw:damage_calc_done",
    "execute if score @s dmg matches ..0 run ...",
    "data modify storage wtw:temp display.value set value 1",
    "tellraw @a {\"text\":\"...\"}",
    "function wtw:cleanup/temp",
  ];
  let id = 1;
  for (let tick = 24080; tick < 24095; tick++) {
    const t = base + (tick - 24080) * 50; // 50ms per tick (TICK_MILLIS), faithful time scale
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
    const order: { type: "COMMAND" | "EVENT"; idx: number; fcid: string; fn: string }[] = [];
    calls.forEach((c, ci) => {
      const count = 9 + ((ci * 7) % 9);
      for (let i = 0; i < count; i++) {
        order.push({ type: "COMMAND", idx: i, fcid: c.id, fn: c.fn });
      }
      if (ci < 3) order.push({ type: "EVENT", idx: 0, fcid: c.id, fn: c.fn });
    });
    let evCounter = 0;
    order.forEach((o, i) => {
      const ts = t + i * 5;
      if (o.type === "COMMAND") {
        const cmd = cmds[(o.idx + tick + i) % cmds.length];
        const action = "execute_run";
        out.push({
          id: id++,
          type: "COMMAND",
          commandType: cmd.startsWith("execute") ? "execute" : cmd.startsWith("data") ? "data" : cmd.startsWith("scoreboard") ? "scoreboard" : "none",
          eventAction: action,
          groups: ["commands"],
          subject: cmd.split(" ")[0] ?? "command",
          summary: cmd,
          timestampMillis: ts,
          sessionId: 1,
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
            action,
            command_type: cmd.startsWith("execute") ? "execute" : cmd.startsWith("data") ? "data" : cmd.startsWith("scoreboard") ? "scoreboard" : "none",
          },
          detailedFields: {
            tick: String(tick),
            sequence: String(o.idx + 1),
          },
        });
      } else {
        const action = actions[(tick + evCounter++) % actions.length];
        const storage = "wtw:temp";
        out.push({
          id: id++,
          type: "EVENT",
          commandType: "none",
          eventAction: action, // backend-populated (would be summary due to M1 bug); mock keeps it correct AND writes event_action below
          groups: ["events", "functions"],
          subject: action,
          summary: `${storage} ${action}`,
          timestampMillis: ts + 2,
          sessionId: 1,
          commandContext: {
            command: "",
            commandId: `c-${tick}-0-${o.fcid}`,
            source: "function",
            function: o.fn,
            functionCallId: o.fcid,
          },
          basicFields: {
            tick: String(tick),
            event_type: action.split("_")[0],
            event_action: action, // the key the real backend writes (and recordNorm.ts reads)
            action, // present too, mirroring CommandTraceFormatter; harmless
            function: o.fn,
            storage,
            path: "display.value",
            result: "1",
          },
          detailedFields: {
            tick: String(tick),
            event_action: action,
          },
        });
      }
    });
  }
  return out;
}

let mockStarted = false;
let mockInterval: number | null = null;
let realFetch: typeof window.fetch | null = null;
let realEventSource: typeof EventSource | null = null;
let mockEventSourceInstalled = false;

export async function applyMockServer(client: VisibleFunctionClient): Promise<boolean> {
  if (!mockEventSourceInstalled) {
    realEventSource = window.EventSource;
    window.EventSource = MockEventSourceImpl as unknown as typeof EventSource;
    mockEventSourceInstalled = true;
  }

  let records: TraceRecord[] = [];
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TraceRecord[];
      const recent = Array.isArray(parsed) ? parsed.slice(-200) : [];
      if (Array.isArray(parsed) && parsed.length > 0 && recent.some((record) => record.type === "EVENT")) {
        records = parsed;
      }
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

  // Patch fetch reversibly.
  realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith(client.getBaseUrl())) {
      return realFetch!(input as RequestInfo, init);
    }
    const path = url.slice(client.getBaseUrl().length).split("?")[0];
    const u = new URL(url, window.location.origin);
    const after = Number(u.searchParams.get("after") ?? "0");
    const limit = Number(u.searchParams.get("limit") ?? "5000");
    const tail = u.searchParams.get("tail") === "true" || u.searchParams.get("tail") === "1";
    if (path === "/health") {
      const body: HealthResponse = { running: true, port: 17654, records: records.length, sessionId: 1 };
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
    if (path === "/api/v1/datapack-analysis") {
      return new Response(JSON.stringify(mockDatapackAnalysis()), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/v1/recording/status") {
      const body: RecordingStatus = {
        active: "false",
        activeId: "none",
        activeRecords: "0",
        completed: "1",
        latest: "mock",
      };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/v1/recordings") {
      return new Response(JSON.stringify({ recordings: [] }), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/v1/recordings/latest") {
      const startedAt = records[0]?.timestampMillis ?? 0;
      return new Response(
        JSON.stringify({
          recording: { id: "mock", startedAtMillis: startedAt, endedAtMillis: lastTs, durationMillis: lastTs - startedAt, file: "mock", records: records.length },
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
      mockListeners.forEach((cb) => cb({ type: "record", record: r }));
    }, 250);
  }

  return true;
}

// Fully reverses the patches. Call when switching back to a real backend.
export function stopMockServer() {
  mockStarted = false;
  if (mockInterval !== null) {
    window.clearInterval(mockInterval);
    mockInterval = null;
  }
  if (realFetch) {
    window.fetch = realFetch;
    realFetch = null;
  }
  if (realEventSource) {
    window.EventSource = realEventSource;
    realEventSource = null;
    mockEventSourceInstalled = false;
  }
  mockListeners.clear();
}

function selectMockRecords(records: TraceRecord[], after: number, limit: number, tail: boolean): TraceRecord[] {
  if (tail && after <= 0) {
    return records.slice(-limit);
  }
  return records.filter((r) => r.id > after).slice(0, limit);
}

const mockListeners = new Set<(m: { type: "record"; record: TraceRecord } | { type: "hello"; running: boolean; port: number; records: number; sessionId: number }) => void>();

// Polyfill EventSource for mock mode only. Installed by applyMockServer; removed by stopMockServer.
class MockEventSourceImpl {
  url: string;
  onerror: ((ev: Event) => void) | null = null;
  private listeners: Record<string, (ev: MessageEvent) => void> = {};
  private closeFn: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    const handler = (m: { type: "record"; record: TraceRecord } | { type: "hello"; running: boolean; port: number; records: number; sessionId: number }) => {
      const payload = m.type === "record" ? m.record : { running: m.running, port: m.port, records: m.records, sessionId: m.sessionId };
      const ev = new MessageEvent("message", { data: JSON.stringify(payload) });
      const cb = this.listeners[m.type];
      if (cb) cb(ev);
    };
    mockListeners.add(handler);
    setTimeout(() => handler({ type: "hello", running: true, port: 17654, records: 0, sessionId: 1 }), 50);
    this.closeFn = () => mockListeners.delete(handler);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    this.listeners[type] = cb;
  }
  close() {
    this.closeFn?.();
  }
}

function generateOne(id: number, ts: number): TraceRecord {
  const fcid = rid();
  const fn = "wtw:fight_system/on_hit";
  const tick = 24095 + Math.floor(id / 20);
  if (id % 5 === 0) {
    const action = id % 10 === 0 ? "storage_modified" : "scoreboard_score_set";
    return {
      id,
      type: "EVENT",
      commandType: "none",
      eventAction: action,
      groups: ["events", "functions"],
      subject: action,
      summary: `wtw:temp ${action}`,
      timestampMillis: ts,
      sessionId: 1,
      commandContext: {
        command: "data modify storage wtw:temp display.value set value 1",
        commandId: `c-${id - 1}`,
        source: "function",
        function: fn,
        functionCallId: fcid,
      },
      basicFields: {
        tick: String(tick),
        event_type: action.split("_")[0],
        event_action: action,
        action,
        function: fn,
        storage: "wtw:temp",
        path: "display.value",
        result: "1",
      },
      detailedFields: { tick: String(tick), event_action: action },
    };
  }

  return {
    id,
    type: "COMMAND",
    commandType: "execute",
    eventAction: "execute_run",
    groups: ["commands"],
    subject: "execute",
    summary: "execute as @a[nbt={...}]",
    timestampMillis: ts,
    sessionId: 1,
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
      tick: String(tick),
      sequence: "1",
      action: "execute_run",
      command_type: "execute",
    },
    detailedFields: { tick: String(tick) },
  };
}

function mockDatapackAnalysis(): DatapackAnalysisResponse {
  const functions = [
    {
      id: "wtw:tick",
      pack: "file/wtw",
      lineCount: 9,
      commandCount: 6,
      tickRoot: true,
      tickFunction: true,
      calls: ["wtw:fight_system/on_hit", "wtw:cleanup/temp"],
      calledBy: [],
      variables: ["scoreboard:damage", "storage:wtw:temp"],
    },
    {
      id: "wtw:fight_system/on_hit",
      pack: "file/wtw",
      lineCount: 24,
      commandCount: 18,
      tickRoot: false,
      tickFunction: true,
      calls: ["wtw:damage_core", "wtw:display_damage"],
      calledBy: ["wtw:tick"],
      variables: ["score:@s:damage", "tag:wtw:damage_calc_done"],
    },
    {
      id: "wtw:damage_core",
      pack: "file/wtw",
      lineCount: 18,
      commandCount: 14,
      tickRoot: false,
      tickFunction: true,
      calls: ["wtw:damage_modifier_notcritical", "wtw:result_writer"],
      calledBy: ["wtw:fight_system/on_hit"],
      variables: ["score:@s:damage", "storage:wtw:temp damage.current"],
    },
    {
      id: "wtw:damage_modifier_notcritical",
      pack: "file/wtw",
      lineCount: 12,
      commandCount: 9,
      tickRoot: false,
      tickFunction: true,
      calls: ["wtw:result_writer"],
      calledBy: ["wtw:damage_core"],
      variables: ["score:@s:damage"],
    },
    {
      id: "wtw:display_damage",
      pack: "file/wtw",
      lineCount: 14,
      commandCount: 10,
      tickRoot: false,
      tickFunction: true,
      calls: ["wtw:cleanup/temp"],
      calledBy: ["wtw:fight_system/on_hit"],
      variables: ["storage:wtw:temp display.value"],
    },
    {
      id: "wtw:result_writer",
      pack: "file/wtw",
      lineCount: 11,
      commandCount: 8,
      tickRoot: false,
      tickFunction: true,
      calls: ["wtw:display_damage"],
      calledBy: ["wtw:damage_core", "wtw:damage_modifier_notcritical"],
      variables: ["storage:wtw:temp damage.current"],
    },
    {
      id: "wtw:cleanup/temp",
      pack: "file/wtw",
      lineCount: 7,
      commandCount: 5,
      tickRoot: false,
      tickFunction: true,
      calls: [],
      calledBy: ["wtw:tick", "wtw:display_damage"],
      variables: ["storage:wtw:temp", "tag:wtw:damage_calc_done"],
    },
    {
      id: "demo:scheduled_wave",
      pack: "file/demo",
      lineCount: 8,
      commandCount: 6,
      tickRoot: false,
      tickFunction: false,
      calls: ["demo:spawn_wave"],
      calledBy: [],
      variables: ["scoreboard:wave"],
    },
    {
      id: "demo:spawn_wave",
      pack: "file/demo",
      lineCount: 16,
      commandCount: 13,
      tickRoot: false,
      tickFunction: false,
      calls: [],
      calledBy: ["demo:scheduled_wave"],
      variables: ["score:#wave:wave", "scoreboard:wave"],
    },
  ];
  const targetSelector = selector("@e[type=zombie,tag=target,scores={damage=1..}]", "@e", {
    type: "zombie",
    tag: "target",
    scores: "{damage=1..}",
  });
  const selfSelector = selector("@s[tag=wtw.damage]", "@s", { tag: "wtw.damage" });
  const waveSelector = selector("@e[type=minecraft:zombie,tag=wave,limit=8]", "@e", {
    type: "minecraft:zombie",
    tag: "wave",
    limit: "8",
  });
  const edges = [
    edge("wtw:tick", "wtw:fight_system/on_hit", "direct", 2, "/function wtw:fight_system/on_hit"),
    edge("wtw:tick", "wtw:fight_system/on_hit", "direct", 3, "/execute if score #damage damage matches 1.. run function wtw:fight_system/on_hit", "none", {
      conditionSummary: "if score #damage damage matches 1..",
      variablesRead: ["score:#damage:damage"],
      execute: executeContext({
        conditions: [clause("if", "score", "if score #damage damage matches 1..", "#damage damage", "if score #damage damage matches 1..", ["score:#damage:damage"])],
        runCommand: "function wtw:fight_system/on_hit",
      }),
    }),
    edge("wtw:tick", "wtw:cleanup/temp", "direct", 6, "/function wtw:cleanup/temp"),
    edge("wtw:fight_system/on_hit", "wtw:damage_core", "direct", 4, "/execute as @s if entity @e[type=zombie,tag=target,scores={damage=1..}] run function wtw:damage_core", "none", {
      conditionSummary: "as @s if entity @e[type=zombie,tag=target]",
      selectors: [selfSelector, targetSelector],
      variablesRead: ["score:@s:damage", "tag:target"],
      execute: executeContext({
        contextModifiers: [clause("context", "as", "as @s", "@s", "as @s", [], [selfSelector])],
        conditions: [clause("if", "entity", "if entity @e[type=zombie,tag=target,scores={damage=1..}]", targetSelector.raw, "if entity @e[type=zombie,tag=target]", ["score:@s:damage", "tag:target"], [targetSelector])],
        runCommand: "function wtw:damage_core",
      }),
    }),
    edge("wtw:fight_system/on_hit", "wtw:damage_core", "direct", 5, "/execute as @s if score @s damage matches 1.. run function wtw:damage_core", "none", {
      conditionSummary: "as @s if score @s damage matches 1..",
      selectors: [selfSelector],
      variablesRead: ["score:@s:damage"],
      execute: executeContext({
        contextModifiers: [clause("context", "as", "as @s", "@s", "as @s", [], [selfSelector])],
        conditions: [clause("if", "score", "if score @s damage matches 1..", "@s damage", "if score @s damage matches 1..", ["score:@s:damage"], [selfSelector])],
        runCommand: "function wtw:damage_core",
      }),
    }),
    edge("wtw:fight_system/on_hit", "wtw:display_damage", "tag", 9, "/function #wtw:damage_display", "wtw:damage_display"),
    edge("wtw:fight_system/on_hit", "wtw:display_damage", "tag", 12, "/execute if entity @s[tag=wtw.damage] run function #wtw:damage_display", "wtw:damage_display", {
      conditionSummary: "if entity @s[tag=wtw.damage]",
      selectors: [selfSelector],
      variablesRead: ["tag:wtw.damage"],
      execute: executeContext({
        conditions: [clause("if", "entity", "if entity @s[tag=wtw.damage]", selfSelector.raw, "if entity @s[tag=wtw.damage]", ["tag:wtw.damage"], [selfSelector])],
        runCommand: "function #wtw:damage_display",
      }),
    }),
    edge("wtw:damage_core", "wtw:damage_modifier_notcritical", "direct", 7, "/execute if function wtw:crit_check run function wtw:damage_modifier_notcritical", "none", {
      conditionSummary: "if function wtw:crit_check",
      execute: executeContext({
        conditions: [clause("if", "function", "if function wtw:crit_check", "wtw:crit_check", "if function wtw:crit_check")],
        runCommand: "function wtw:damage_modifier_notcritical",
      }),
    }),
    edge("wtw:damage_core", "wtw:result_writer", "direct", 11, "/execute store result storage wtw:temp damage.current int 1 run function wtw:result_writer", "none", {
      conditionSummary: "store result storage wtw:temp damage.current",
      variablesWritten: ["storage:wtw:temp damage.current"],
      execute: executeContext({
        stores: [clause("store", "storage", "store result storage wtw:temp damage.current int 1", "wtw:temp damage.current", "store result storage wtw:temp damage.current", ["storage:wtw:temp damage.current"])],
        runCommand: "function wtw:result_writer",
      }),
    }),
    edge("wtw:damage_modifier_notcritical", "wtw:result_writer", "direct", 8, "/function wtw:result_writer"),
    edge("wtw:result_writer", "wtw:display_damage", "direct", 6, "/function wtw:display_damage"),
    edge("wtw:display_damage", "wtw:cleanup/temp", "direct", 10, "/function wtw:cleanup/temp"),
    edge("demo:scheduled_wave", "demo:spawn_wave", "scheduled", 3, "/schedule function demo:spawn_wave 20t"),
    edge("demo:scheduled_wave", "demo:spawn_wave", "direct", 4, "/execute if entity @e[type=minecraft:zombie,tag=wave,limit=8] run function demo:spawn_wave", "none", {
      conditionSummary: "if entity @e[type=zombie,tag=wave]",
      selectors: [waveSelector],
      variablesRead: ["tag:wave"],
      execute: executeContext({
        conditions: [clause("if", "entity", "if entity @e[type=minecraft:zombie,tag=wave,limit=8]", waveSelector.raw, "if entity @e[type=zombie,tag=wave]", ["tag:wave"], [waveSelector])],
        runCommand: "function demo:spawn_wave",
      }),
    }),
    edge("demo:scheduled_wave", "#demo:missing_wave", "tag", 7, "/function #demo:missing_wave", "demo:missing_wave"),
  ];
  const variables = [
    variable("scoreboard:damage", "scoreboard", "damage", 3, 2, "wtw:tick"),
    variable("score:@s:damage", "score", "@s:damage", 4, 7, "wtw:damage_core"),
    variable("storage:wtw:temp", "storage", "wtw:temp", 2, 3, "wtw:cleanup/temp"),
    variable("storage:wtw:temp damage.current", "storage", "wtw:temp damage.current", 1, 4, "wtw:result_writer"),
    variable("storage:wtw:temp display.value", "storage", "wtw:temp display.value", 1, 2, "wtw:display_damage"),
    variable("tag:wtw:damage_calc_done", "tag", "wtw:damage_calc_done", 2, 2, "wtw:fight_system/on_hit"),
    variable("scoreboard:wave", "scoreboard", "wave", 1, 1, "demo:scheduled_wave"),
    variable("score:#wave:wave", "score", "#wave:wave", 1, 1, "demo:spawn_wave"),
  ];
  return {
    analysis: {
      generatedAtMillis: Date.now(),
      functionCount: functions.length,
      edgeCount: edges.length,
      variableCount: variables.length,
      warnings: ["Function demo:scheduled_wave references empty or missing tag #demo:missing_wave at line 7"],
    },
    functions,
    edges,
    commands: edges.map((e, index) => commandFromEdge(e, index + 1)),
    variables,
    graph: graphFromMock(functions, edges, {
      "minecraft:tick": ["wtw:tick"],
      "wtw:damage_display": ["wtw:display_damage"],
    }),
    tags: {
      "minecraft:tick": ["wtw:tick"],
      "wtw:damage_display": ["wtw:display_damage"],
    },
  };
}

function edge(
  from: string,
  to: string,
  kind: string,
  line: number,
  command: string,
  viaTag = "none",
  extra: Partial<{
    rawCommand: string;
    effectiveCommand: string;
    conditionSummary: string;
    execute: ReturnType<typeof executeContext>;
    selectors: ReturnType<typeof selector>[];
    variablesRead: string[];
    variablesWritten: string[];
  }> = {}
) {
  return {
    id: `${from}:${to}:${kind}:${line}`,
    from,
    to,
    kind,
    viaTag,
    line,
    command,
    rawCommand: extra.rawCommand ?? command,
    effectiveCommand: extra.effectiveCommand ?? command.replace(/^\/?execute .* run /, ""),
    conditionSummary: extra.conditionSummary ?? "none",
    execute: extra.execute ?? executeContext({ runCommand: command }),
    selectors: extra.selectors ?? [],
    variablesRead: extra.variablesRead ?? [],
    variablesWritten: extra.variablesWritten ?? [],
  };
}

function commandFromEdge(e: ReturnType<typeof edge>, index: number) {
  const tag = e.to.startsWith("#") || e.viaTag !== "none";
  return {
    id: `cmd-${index}`,
    function: e.from,
    line: e.line,
    rawCommand: e.rawCommand,
    effectiveCommand: e.effectiveCommand,
    rootCommand: e.command.trim().split(/\s+/)[0]?.replace("/", "") || "function",
    conditionSummary: e.conditionSummary,
    execute: e.execute,
    calls: [
      {
        id: tag ? e.viaTag.replace(/^#/, "") : e.to,
        tag,
        kind: e.kind,
      },
    ],
    variables: [
      ...e.variablesRead.map((key) => variableRef(key, "read")),
      ...e.variablesWritten.map((key) => variableRef(key, "write")),
    ],
    variablesRead: e.variablesRead,
    variablesWritten: e.variablesWritten,
    selectors: e.selectors,
  };
}

function graphFromMock(functions: Array<{ id: string; pack: string; tickRoot: boolean; tickFunction: boolean; calledBy: string[] }>, edges: ReturnType<typeof edge>[], tags: Record<string, string[]>) {
  const edgeGroups = new Map<string, ReturnType<typeof edge>[]>();
  for (const e of edges) {
    const key = `${e.from}|${e.to}|${e.kind}`;
    const group = edgeGroups.get(key);
    if (group) group.push(e);
    else edgeGroups.set(key, [e]);
  }
  const graphEdges = Array.from(edgeGroups.values()).map((group) => ({
    from: group[0].from,
    to: group[0].to,
    kind: group[0].kind,
    callCount: group.length,
    lines: group.map((e) => e.line),
    conditionSummaries: Array.from(new Set(group.map((e) => e.conditionSummary).filter((value) => value && value !== "none"))),
    sampleCommands: Array.from(new Set(group.map((e) => e.command))).slice(0, 4),
  }));
  const degree = new Map<string, { in: number; out: number }>();
  for (const fn of functions) degree.set(fn.id, { in: 0, out: 0 });
  for (const e of graphEdges) {
    (degree.get(e.from) ?? degree.set(e.from, { in: 0, out: 0 }).get(e.from)!).out += e.callCount;
    (degree.get(e.to) ?? degree.set(e.to, { in: 0, out: 0 }).get(e.to)!).in += e.callCount;
  }
  const modules = Array.from(new Set(functions.map((fn) => fn.pack))).sort().map((pack) => ({
    id: pack,
    namespace: pack.split("/").pop() ?? pack,
    functionCount: functions.filter((fn) => fn.pack === pack).length,
    functions: functions.filter((fn) => fn.pack === pack).map((fn) => fn.id),
  }));
  return {
    nodes: functions.map((fn) => {
      const d = degree.get(fn.id) ?? { in: 0, out: 0 };
      return {
        id: fn.id,
        module: fn.pack,
        namespace: fn.id.split(":")[0] ?? "",
        entrypoint: fn.tickRoot ? "tickRoot" : fn.calledBy.length === 0 ? "noCaller" : "none",
        tickRoot: fn.tickRoot,
        tickFunction: fn.tickFunction,
        degree: d.in + d.out,
        inDegree: d.in,
        outDegree: d.out,
      };
    }),
    edges: graphEdges,
    modules,
    entrypoints: {
      tickRoots: tags["minecraft:tick"] ?? [],
      loadRoots: [],
      noCaller: functions.filter((fn) => fn.calledBy.length === 0).map((fn) => fn.id),
      publicTags: Object.keys(tags).filter((tag) => !tag.startsWith("minecraft:")),
    },
    warnings: ["Function demo:scheduled_wave references empty or missing tag #demo:missing_wave at line 7"],
  };
}

function executeContext({
  clauses = [],
  conditions = [],
  stores = [],
  contextModifiers = [],
  runCommand = "",
}: Partial<{
  clauses: ReturnType<typeof clause>[];
  conditions: ReturnType<typeof clause>[];
  stores: ReturnType<typeof clause>[];
  contextModifiers: ReturnType<typeof clause>[];
  runCommand: string;
}>) {
  return {
    present: clauses.length + conditions.length + stores.length + contextModifiers.length > 0 || runCommand.startsWith("function"),
    clauses: [...clauses, ...contextModifiers, ...conditions, ...stores],
    conditions,
    stores,
    contextModifiers,
    runCommand,
  };
}

function clause(mode: string, keyword: string, raw: string, subject: string, summary: string, variables: string[] = [], selectors: ReturnType<typeof selector>[] = []) {
  return { mode, keyword, raw, subject, summary, variables, selectors };
}

function selector(raw: string, target: string, filters: Record<string, string>) {
  return { raw, target, filters };
}

function variableRef(key: string, access: string) {
  const first = key.indexOf(":");
  const kind = first > 0 ? key.slice(0, first) : "unknown";
  return { key, kind, name: key.slice(first + 1), access };
}

function variable(key: string, kind: string, name: string, reads: number, writes: number, fn: string) {
  return {
    key,
    kind,
    name,
    reads,
    writes,
    occurrences: [
      {
        function: fn,
        line: 1,
        access: reads > writes ? "read" : "update",
        command: `/execute if score @s ${name.split(":").pop() ?? name} matches 1.. run say sample`,
      },
    ],
  };
}

function makeGrouped(records: TraceRecord[]): GroupedResponse {
  const commands = records.filter((r) => r.type === "COMMAND");
  const events = records.filter((r) => r.type === "EVENT");
  const functions = records.filter((r) => r.groups.includes("functions") && r.type !== "EVENT" && r.type !== "COMMAND");
  const other = records.filter((r) => !commands.includes(r) && !events.includes(r) && !functions.includes(r));
  const commandsByType: Record<string, TraceRecord[]> = {};
  for (const c of commands) {
    const key = c.commandType || "none";
    (commandsByType[key] ??= []).push(c);
  }
  const eventsByAction: Record<string, TraceRecord[]> = {};
  for (const e of events) {
    const key = e.basicFields.event_action ?? (e.eventAction || "other");
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
