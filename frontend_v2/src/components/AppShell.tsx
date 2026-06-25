import { useEffect } from "react";
import { useTraceStore } from "../store/traceStore";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { Timeline } from "./Timeline/Timeline";
import { DetailPanel } from "./DetailPanel";
import { StatusBar } from "./StatusBar";
import { RecordingLibrary } from "./RecordingLibrary";

// Module-level guard: StrictMode invokes effects twice in dev; this ensures connect() runs once.
let didBootstrap = false;

export function AppShell() {
  const mode = useTraceStore((s) => s.mode);
  const setSelection = useTraceStore((s) => s.setSelection);
  const selection = useTraceStore((s) => s.selection);
  const setFilters = useTraceStore((s) => s.setFilters);

  // Bootstrap: auto-connect to the backend on first mount when in live mode. Previously the app
  // started disconnected and only connected after the user clicked the "Live Monitor" tab, which
  // read as "must switch to Recordings then back to Live to connect". A module-level guard
  // prevents StrictMode's double-invoked effects from opening two streams.
  useEffect(() => {
    if (didBootstrap) return;
    didBootstrap = true;
    const s = useTraceStore.getState();
    if (s.mode === "live" && s.connection === "disconnected") {
      void s.connect();
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (inField) {
        if (e.key === "Escape") (target as HTMLInputElement).blur();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(".search input");
        input?.focus();
        input?.select();
        return;
      }
      if (e.key === "Escape") {
        if (selection) setSelection(null);
        else setFilters({ search: "" });
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
        {mode === "recordings" ? <RecordingLibrary /> : <Timeline />}
        <DetailPanel />
      </div>
      <StatusBar />
    </div>
  );
}
