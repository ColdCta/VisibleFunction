import { useTraceStore } from "../store/traceStore";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { Timeline } from "./Timeline";
import { DetailPanel } from "./DetailPanel";
import { useEffect } from "react";

export function AppShell() {
  const connection = useTraceStore((s) => s.connection);
  const setSelection = useTraceStore((s) => s.setSelection);
  const selection = useTraceStore((s) => s.selection);
  const setFilters = useTraceStore((s) => s.setFilters);
  const records = useTraceStore((s) => s.records);
  const filteredCount = records.length;
  const totalCommands = records.filter((r) => r.type === "COMMAND").length;
  const totalEvents = records.filter((r) => r.type === "EVENT").length;
  const totalFunctions = records.filter((r) => r.commandContext.function !== "none" && r.commandContext.functionCallId !== "none").length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(".search input");
        input?.focus();
        input?.select();
        return;
      }
      if (e.key === "Escape") {
        if (selection) {
          setSelection(null);
        } else {
          setFilters({ search: "" });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, setSelection, setFilters]);

  return (
    <div className="shell">
      <TopBar />
      <div className="shell__body">
        <Sidebar />
        <Timeline />
        <DetailPanel />
      </div>
      <StatusBar
        connection={connection}
        count={filteredCount}
        commands={totalCommands}
        events={totalEvents}
        functions={totalFunctions}
      />
    </div>
  );
}

function StatusBar({
  connection,
  count,
  commands,
  events,
  functions,
}: {
  connection: ReturnType<typeof useTraceStore.getState>["connection"];
  count: number;
  commands: number;
  events: number;
  functions: number;
}) {
  const range = useTraceStore((s) => s.range);
  const tickLabel = range.min && range.max
    ? `Ticks ${Math.floor(range.min)} – ${Math.floor(range.max)} · ${Math.max(1, Math.floor((range.max - range.min) / 1000))} s window`
    : "No range";
  return (
    <footer className="statusbar">
      <span className={"conn conn--" + connection}>
        <span className="dot" style={{ background: connectionColor(connection) }} />
        {connection === "open" ? "Connected" : connection === "connecting" ? "Connecting…" : connection === "reconnecting" ? "Reconnecting…" : "Disconnected"}
        {" "}to {useTraceStore.getState().baseUrl}
      </span>
      <span className="spacer" />
      <span className="muted mono">{tickLabel}</span>
      <span className="spacer" />
      <span className="muted mono">
        {events.toLocaleString()} events · {functions.toLocaleString()} function calls · {commands.toLocaleString()} commands
      </span>
      <span className="spacer" />
      <span className="muted mono">{count.toLocaleString()} records</span>
    </footer>
  );
}

function connectionColor(c: string): string {
  if (c === "open") return "var(--success)";
  if (c === "connecting" || c === "reconnecting") return "var(--warn)";
  return "var(--rec)";
}
