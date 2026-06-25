import type { TraceRecord } from "../api/types";

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
