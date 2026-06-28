import type { TraceRecord } from "../api/types";

export type RuntimeTriggerSource = {
  type: "advancement" | "enchantment" | string;
  id: string;
  functionId: string;
  actor: string;
  position: string;
  dimension: string;
};

// ---------------------------------------------------------------------------
// Backend contract workaround (M1). Do not delete without verifying the backend.
// ---------------------------------------------------------------------------
// VisibleFunctionExportJson.java:21, :71, :288 read the basic field "action" to populate
// `eventAction`, `eventsByAction`, and tick-filter event keys. But every EVENT formatter writes
// the field as "event_action" (e.g. DataStorageResultEventFormatter.java:82,
// ScoreboardResultEventFormatter.java:29, ItemResultEventFormatter.java:48,
// KillResultEventFormatter.java:34, EffectResultEventFormatter.java:53,
// TagResultEventFormatter.java:52, TeleportResultEventFormatter.java:50).
//
// Consequence: for real EVENT records the "action" key is absent, so the backend falls back to
// payload.summary() and `eventAction` ends up being prose like "wtw:temp display.value modified"
// instead of the action name "storage_modified". The in-game HUD reads the CORRECT key
// "event_action" (VisibleFunctionHud.java:855), confirming this is a backend bug.
//
// CommandTraceFormatter DOES write "action" for COMMAND records (CommandTraceFormatter.java:92
// etc.), so `eventAction` is correct for commands.
//
// Per project decision we do NOT modify the Fabric backend (docs/frontend-agent-brief.md:15).
// Workaround: prefer `basicFields.event_action`, then `basicFields.action`, then `eventAction`.
// This can be removed once the backend reads "event_action" at the three cited lines.
// ---------------------------------------------------------------------------

export function effectiveAction(r: TraceRecord): string {
  return r.basicFields.event_action ?? r.basicFields.action ?? r.eventAction ?? "";
}

export function recordDimension(r: TraceRecord): string {
  return r.basicFields.dimension ?? r.detailedFields.dimension ?? "minecraft:overworld";
}

// The backend writes a `result` field for many event/command formatters (e.g.
// DataStorageResultEventFormatter.java:86). Show it when present; otherwise the UI shows "—".
export function recordResult(r: TraceRecord): string {
  return r.basicFields.result ?? r.detailedFields.result ?? "";
}

export function recordDuration(r: TraceRecord): string {
  return r.basicFields.duration ?? r.detailedFields.duration ?? "";
}

export function recordTriggerSource(r: TraceRecord): RuntimeTriggerSource | null {
  const type = meaningful(
    r.commandContext.triggerType ??
    r.basicFields.trigger_type ??
    r.detailedFields.trigger_type
  );
  const id = meaningful(
    r.commandContext.triggerId ??
    r.basicFields.trigger_id ??
    r.detailedFields.trigger_id
  );
  const functionId = meaningful(
    r.commandContext.triggerFunction ??
    r.basicFields.trigger_function ??
    r.detailedFields.trigger_function
  );
  if (!type && !id && !functionId) return null;
  return {
    type: type || "unknown",
    id: id || "unknown",
    functionId: functionId || "unknown",
    actor: meaningful(r.detailedFields.trigger_actor ?? r.basicFields.trigger_actor),
    position: meaningful(r.detailedFields.trigger_position ?? r.basicFields.trigger_position),
    dimension: meaningful(r.detailedFields.trigger_dimension ?? r.basicFields.trigger_dimension),
  };
}

export function triggerSourceKey(source: RuntimeTriggerSource): string {
  return `${source.type}\u001f${source.id}\u001f${source.functionId}`;
}

export function triggerBadge(source: RuntimeTriggerSource): string {
  if (source.type === "advancement") return "ADV";
  if (source.type === "enchantment") return "ENCH";
  return source.type.slice(0, 5).toUpperCase() || "SRC";
}

function meaningful(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  return !normalized || normalized.toLowerCase() === "none" ? "" : normalized;
}
