import { useTraceStore } from "../store/traceStore";

export function StatusBar() {
  const connection = useTraceStore((s) => s.connection);
  const records = useTraceStore((s) => s.records);
  const range = useTraceStore((s) => s.range);
  const viewRange = useTraceStore((s) => s.viewRange);
  const mockMode = useTraceStore((s) => s.mockMode);

  const cmds = records.filter((r) => r.type === "COMMAND").length;
  const events = records.filter((r) => r.type === "EVENT").length;
  const funcs = new Set(records.map((r) => r.commandContext.functionCallId).filter((x) => x && x !== "none")).size;

  const lo = viewRange.min || range.min;
  const hi = viewRange.max || range.max;
  const tickCount = Math.max(0, Math.floor(hi - lo));
  const seconds = tickCount > 0 ? Math.max(1, Math.ceil(tickCount / 20)) : 0;

  return (
    <footer className="statusbar">
      <span className="statusbar__conn">
        <span className={"dot dot--" + connection} />
        <span>
          {connection === "open" ? "Connected" : connection === "connecting" ? "Connecting..." : connection === "reconnecting" ? "Reconnecting..." : "Disconnected"}
          {mockMode && " - Mock"}
        </span>
      </span>
      <span className="spacer" />
      <span className="mono muted">
        Ticks {Math.floor(lo)} to {Math.floor(hi)} <span style={{ opacity: 0.6 }}>({tickCount}t / {seconds}s window)</span>
      </span>
      <span className="spacer" />
      <span className="mono muted">
        <span style={{ color: "var(--event)" }}>{events.toLocaleString()}</span> events -{" "}
        <span style={{ color: "var(--function)" }}>{funcs.toLocaleString()}</span> function calls -{" "}
        <span style={{ color: "var(--command)" }}>{cmds.toLocaleString()}</span> commands
      </span>
      <span className="spacer" />
      <span className="mono muted">v1.0.4</span>
    </footer>
  );
}
