import { useTraceStore } from "../store/traceStore";

export function StatusBar() {
  const connection = useTraceStore((s) => s.connection);
  const stats = useTraceStore((s) => s.stats);
  const range = useTraceStore((s) => s.range);
  const viewRange = useTraceStore((s) => s.viewRange);
  const mockMode = useTraceStore((s) => s.mockMode);
  const baseUrl = useTraceStore((s) => s.baseUrl);

  const lo = viewRange.min || range.min;
  const hi = viewRange.max || range.max;
  const tickCount = Math.max(0, Math.floor(hi - lo));
  const seconds = tickCount > 0 ? Math.max(1, Math.ceil(tickCount / 20)) : 0;

  const connLabel =
    connection === "open" ? "Connected" :
    connection === "connecting" ? "Connecting..." :
    connection === "reconnecting" ? "Reconnecting..." :
    "Disconnected";

  return (
    <footer className="statusbar">
      <span className="statusbar__conn">
        <span className={"dot dot--" + connection} />
        <span>
          {connLabel}
          {mockMode && " - Mock"}
          {!mockMode && connection !== "disconnected" ? ` to ${baseUrl}` : ""}
        </span>
      </span>
      <span className="spacer" />
      <span className="mono muted">
        Ticks {Math.floor(lo)} to {Math.floor(hi)} <span style={{ opacity: 0.6 }}>({tickCount}t / {seconds}s window)</span>
      </span>
      <span className="spacer" />
      <span className="mono muted">
        <span style={{ color: "var(--event)" }}>{stats.eventCount.toLocaleString()}</span> events -{" "}
        <span style={{ color: "var(--function)" }}>{stats.functionCallCount.toLocaleString()}</span> function calls -{" "}
        <span style={{ color: "var(--command)" }}>{stats.commandCount.toLocaleString()}</span> commands
      </span>
      <span className="spacer" />
      <span className="mono muted">{stats.recordCount.toLocaleString()} records</span>
    </footer>
  );
}
