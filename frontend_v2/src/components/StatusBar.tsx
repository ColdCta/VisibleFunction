import { useMemo } from "react";
import { useTraceStore } from "../store/traceStore";

export function StatusBar() {
  const connection = useTraceStore((s) => s.connection);
  const records = useTraceStore((s) => s.records);
  const range = useTraceStore((s) => s.range);
  const viewRange = useTraceStore((s) => s.viewRange);
  const mockMode = useTraceStore((s) => s.mockMode);
  const baseUrl = useTraceStore((s) => s.baseUrl);

  // Single pass over records for all three counts (avoids 3× O(n) filters per render).
  const counts = useMemo(() => {
    let cmds = 0;
    let events = 0;
    const fcalls = new Set<string>();
    for (const r of records) {
      if (r.type === "COMMAND") cmds++;
      else if (r.type === "EVENT") events++;
      const fcid = r.commandContext.functionCallId;
      if (fcid && fcid !== "none") fcalls.add(fcid);
    }
    return { cmds, events, funcs: fcalls.size };
  }, [records]);

  const lo = viewRange.min || range.min;
  const hi = viewRange.max || range.max;
  const tickCount = Math.max(0, Math.floor(hi - lo));
  const seconds = tickCount > 0 ? Math.max(1, Math.ceil(tickCount / 20)) : 0;

  const connLabel =
    connection === "open" ? "Connected" :
    connection === "connecting" ? "Connecting…" :
    connection === "reconnecting" ? "Reconnecting…" :
    "Disconnected";

  return (
    <footer className="statusbar">
      <span className="statusbar__conn">
        <span className={"dot dot--" + connection} />
        <span>
          {connLabel}
          {mockMode && " · Mock"}
          {!mockMode && connection !== "disconnected" ? ` to ${baseUrl}` : ""}
        </span>
      </span>
      <span className="spacer" />
      <span className="mono muted">
        Ticks {Math.floor(lo)} to {Math.floor(hi)} <span style={{ opacity: 0.6 }}>({tickCount}t / {seconds}s window)</span>
      </span>
      <span className="spacer" />
      <span className="mono muted">
        <span style={{ color: "var(--event)" }}>{counts.events.toLocaleString()}</span> events ·{" "}
        <span style={{ color: "var(--function)" }}>{counts.funcs.toLocaleString()}</span> function calls ·{" "}
        <span style={{ color: "var(--command)" }}>{counts.cmds.toLocaleString()}</span> commands
      </span>
      <span className="spacer" />
      <span className="mono muted">{records.length.toLocaleString()} records</span>
    </footer>
  );
}
