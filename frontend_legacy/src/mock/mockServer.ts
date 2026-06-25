import type { TraceRecord } from '../api/types';
import { useTraceStore } from '../store/traceStore';

const TICK_MS = 50;

interface MockCtx {
  recordId: number;
  commandId: number;
  functionCallId: number;
  startTime: number;
}

function makeCommand(
  ctx: MockCtx,
  raw: string,
  source: string,
  fn: string,
  callId: number,
  commandType: string,
  action: string,
  summary: string,
  extraBasic: Record<string, string>,
  extraDetailed: Record<string, string>,
): TraceRecord {
  const ts = ctx.startTime + (ctx.recordId - 1) * 8;
  const commandId = String(ctx.commandId);
  const functionCallId = callId >= 0 ? String(callId) : 'none';
  const basic: Record<string, string> = {
    command_id: commandId,
    source,
    function: fn,
    function_call_id: functionCallId,
    position: 'x=0.00, y=64.00, z=0.00',
    command_type: commandType,
    action,
    ...extraBasic,
  };
  const detailed: Record<string, string> = {
    ...basic,
    dimension: 'minecraft:overworld',
    rotation: 'yaw=0.00, pitch=0.00',
    executor: source === 'player' ? 'Steve' : 'server',
    executor_entity: source === 'player' ? 'minecraft:player 00000000-0000-0000-0000-000000000001' : 'none',
    ...extraDetailed,
  };
  return {
    id: ctx.recordId++,
    type: 'COMMAND',
    commandType,
    eventAction: action,
    groups: ['commands', ...(fn !== 'none' ? ['functions'] : [])],
    subject: raw,
    summary,
    timestampMillis: ts,
    commandContext: { command: raw, commandId, source, function: fn, functionCallId },
    basicFields: basic,
    detailedFields: detailed,
  };
}

function makeEvent(
  ctx: MockCtx,
  subject: string,
  summary: string,
  eventType: string,
  eventAction: string,
  parentCommandId: number,
  source: string,
  fn: string,
  callId: number,
  extraBasic: Record<string, string>,
  extraDetailed: Record<string, string>,
): TraceRecord {
  const ts = ctx.startTime + (ctx.recordId - 1) * 8 + 3;
  const commandId = String(parentCommandId);
  const functionCallId = callId >= 0 ? String(callId) : 'none';
  const basic: Record<string, string> = {
    command_id: commandId,
    source,
    function: fn,
    function_call_id: functionCallId,
    position: 'x=0.00, y=64.00, z=0.00',
    event_type: eventType,
    event_action: eventAction,
    ...extraBasic,
  };
  const detailed: Record<string, string> = {
    ...basic,
    dimension: 'minecraft:overworld',
    rotation: 'yaw=0.00, pitch=0.00',
    ...extraDetailed,
  };
  return {
    id: ctx.recordId++,
    type: 'EVENT',
    commandType: 'none',
    eventAction,
    groups: ['events', ...(fn !== 'none' ? ['functions'] : [])],
    subject,
    summary,
    timestampMillis: ts,
    commandContext: { command: `/execute ... run ...`, commandId, source, function: fn, functionCallId },
    basicFields: basic,
    detailedFields: detailed,
  };
}

function buildFunctionCall(ctx: MockCtx, fn: string, callId: number): TraceRecord[] {
  const out: TraceRecord[] = [];

  const cmd1 = ctx.commandId++;
  out.push(
    makeCommand(
      ctx,
      '/data modify storage wtw:dice set value {rolls:1,sides:6}',
      'function',
      fn,
      callId,
      'data',
      'data_modify',
      'changed data.',
      { action: 'storage_modified', target_kind: 'storage', storage: 'wtw:dice', path: 'root', arguments: 'set value {rolls:1,sides:6}' },
      {},
    ),
  );
  out.push(
    makeEvent(
      ctx,
      'wtw:dice',
      'changed data',
      'storage',
      'storage_modified',
      cmd1,
      'function',
      fn,
      callId,
      { operation: 'storage_modified', storage: 'wtw:dice', path: 'root', result: '1', query: 'false', after: '{rolls:1,sides:6}' },
      {},
    ),
  );

  const cmd2 = ctx.commandId++;
  out.push(
    makeCommand(
      ctx,
      '/scoreboard players set #roll wtw:math 3',
      'function',
      fn,
      callId,
      'scoreboard',
      'scoreboard_score_set',
      'changed scoreboard.',
      { category: 'players', operation: 'set', targets: '#roll', objective: 'wtw:math', value: '3' },
      {},
    ),
  );
  out.push(
    makeEvent(
      ctx,
      '#roll',
      'scoreboard score set',
      'scoreboard',
      'scoreboard_score_set',
      cmd2,
      'function',
      fn,
      callId,
      { operation: 'set', subject: '#roll', objective: 'wtw:math', value: '3' },
      {},
    ),
  );

  const cmd3 = ctx.commandId++;
  out.push(
    makeCommand(
      ctx,
      '/summon minecraft:item ~ ~ ~ {Item:{id:"minecraft:diamond",count:1}}',
      'function',
      fn,
      callId,
      'summon',
      'summon',
      'summoned entity.',
      { action: 'summon', entity: 'minecraft:item' },
      {},
    ),
  );
  out.push(
    makeEvent(
      ctx,
      'minecraft:item',
      'summoned by commands',
      'entity',
      'summoned',
      cmd3,
      'function',
      fn,
      callId,
      { spawn_reason: 'COMMAND', entity_position: 'x=0.00, y=64.00, z=0.00' },
      { uuid: '00000000-0000-0000-0000-0000000000a1', name: 'Item' },
    ),
  );

  const cmd4 = ctx.commandId++;
  out.push(
    makeCommand(
      ctx,
      '/give @s minecraft:bread 2',
      'function',
      fn,
      callId,
      'give',
      'give_item',
      'gave item.',
      { action: 'give_item', targets: '@s', item: 'minecraft:bread', count: '2' },
      {},
    ),
  );
  out.push(
    makeEvent(
      ctx,
      'minecraft:bread',
      'minecraft:bread x2 given to 1/1 players',
      'item',
      'item_given',
      cmd4,
      'function',
      fn,
      callId,
      { item: 'minecraft:bread', requested_count: '2', affected_players: '1', total_items: '2' },
      { target_preview: '[minecraft:player 00000000-0000-0000-0000-000000000001]' },
    ),
  );

  const cmd5 = ctx.commandId++;
  out.push(
    makeCommand(
      ctx,
      '/effect give @s minecraft:speed 30 1 true',
      'function',
      fn,
      callId,
      'effect',
      'give_effect',
      'gave effect.',
      { action: 'give_effect', mode: 'give', targets: '@s', effect: 'minecraft:speed', seconds: '30', amplifier: '1', hide_particles: 'true' },
      {},
    ),
  );
  out.push(
    makeEvent(
      ctx,
      'minecraft:speed',
      'minecraft:speed applied to 1/1 targets',
      'effect',
      'effect_applied',
      cmd5,
      'function',
      fn,
      callId,
      { mode: 'give', effect: 'minecraft:speed', duration_ticks: '600', duration_seconds: '30', amplifier: '1', hide_particles: 'true' },
      {},
    ),
  );

  const cmd6 = ctx.commandId++;
  out.push(
    makeCommand(
      ctx,
      '/tag @e[type=minecraft:item,limit=1] add rolled',
      'function',
      fn,
      callId,
      'tag',
      'tag_added',
      'tag added.',
      { action: 'tag_added', operation: 'add', tag: 'rolled', matched_targets: '1', affected_targets: '1' },
      {},
    ),
  );
  out.push(
    makeEvent(
      ctx,
      'rolled',
      'tag rolled added to 1/1 targets',
      'tag',
      'tag_added',
      cmd6,
      'function',
      fn,
      callId,
      { operation: 'add', tag: 'rolled', matched_targets: '1', affected_targets: '1' },
      {},
    ),
  );

  const cmd7 = ctx.commandId++;
  out.push(
    makeCommand(
      ctx,
      '/tp @e[type=minecraft:item,limit=1] ~ ~1 ~',
      'function',
      fn,
      callId,
      'tp',
      'teleport',
      'teleported target.',
      { action: 'teleport', targets: '@e[type=minecraft:item,limit=1]', destination: '~ ~1 ~' },
      {},
    ),
  );
  out.push(
    makeEvent(
      ctx,
      'minecraft:item',
      'minecraft:item teleported',
      'entity',
      'entity_teleported',
      cmd7,
      'function',
      fn,
      callId,
      { target: 'minecraft:item', from: 'x=0.00, y=64.00, z=0.00', to: 'x=0.00, y=65.00, z=0.00', dimension: 'minecraft:overworld', rotation: 'yaw=0.00, pitch=0.00' },
      {},
    ),
  );

  return out;
}

function buildPlayerCommands(ctx: MockCtx): TraceRecord[] {
  const out: TraceRecord[] = [];
  const cmd = ctx.commandId++;
  out.push(
    makeCommand(
      ctx,
      '/kill @e[type=minecraft:zombie,distance=..10]',
      'player',
      'none',
      -1,
      'kill',
      'kill_entities',
      'killed target.',
      { action: 'kill_entities', targets: '@e[type=minecraft:zombie,distance=..10]' },
      {},
    ),
  );
  out.push(
    makeEvent(
      ctx,
      '2 targets',
      '2/2 targets killed',
      'entity',
      'entity_killed',
      cmd,
      'player',
      'none',
      -1,
      { matched_targets: '2', affected_targets: '2' },
      { target_preview: '[minecraft:zombie ..., minecraft:zombie ...]' },
    ),
  );
  return out;
}

function buildTickFunctionNoise(ctx: MockCtx): TraceRecord[] {
  const out: TraceRecord[] = [];
  const fn = 'wtw:test/tick';
  const callId = ctx.functionCallId++;
  const cmd = ctx.commandId++;
  out.push(
    makeCommand(
      ctx,
      '/execute if score #tick wtw:math matches ..10 run say tick',
      'function',
      fn,
      callId,
      'execute',
      'execute_run',
      'executed nested command.',
      { action: 'execute_run' },
      { nested_command: '/say tick' },
    ),
  );
  out.push(
    makeEvent(
      ctx,
      'say',
      'tick',
      'other',
      'tick_say',
      cmd,
      'function',
      fn,
      callId,
      {},
      {},
    ),
  );
  return out;
}

export function generateMockBatch(): TraceRecord[] {
  const ctx: MockCtx = {
    recordId: 1,
    commandId: 1,
    functionCallId: 1,
    startTime: Date.now(),
  };
  const all: TraceRecord[] = [];
  all.push(...buildFunctionCall(ctx, 'wtw:test/test_dice', ctx.functionCallId++));
  all.push(...buildPlayerCommands(ctx));
  all.push(...buildFunctionCall(ctx, 'wtw:test/test_dice', ctx.functionCallId++));
  all.push(...buildTickFunctionNoise(ctx));
  return all.sort((a, b) => a.id - b.id);
}

export function startMockServer(intervalMs = 2500): () => void {
  const store = useTraceStore.getState();
  store.setStatus('mock');
  store.setHealth({ running: true, port: 17654, records: 0 });

  const initial = generateMockBatch();
  store.backfill(initial);
  store.setHealth({ running: true, port: 17654, records: initial.length });

  let callCount = 1;
  const timer = setInterval(() => {
    if (useTraceStore.getState().paused) return;
    callCount++;
    const ctx: MockCtx = {
      recordId: useTraceStore.getState().lastRecordId + 1,
      commandId: 1000 + callCount * 10,
      functionCallId: 1000 + callCount,
      startTime: Date.now(),
    };
    const batch = buildFunctionCall(ctx, 'wtw:test/test_dice', ctx.functionCallId);
    store.appendRecordBatch(batch);
    if (callCount % 3 === 0) {
      const noiseCtx: MockCtx = {
        recordId: useTraceStore.getState().lastRecordId + 1,
        commandId: 2000 + callCount * 10,
        functionCallId: 2000 + callCount,
        startTime: Date.now(),
      };
      store.appendRecordBatch(buildTickFunctionNoise(noiseCtx));
    }
    store.setHealth({ running: true, port: 17654, records: useTraceStore.getState().records.length });
  }, intervalMs);

  return () => clearInterval(timer);
}

export const MOCK_TICK_MS = TICK_MS;
