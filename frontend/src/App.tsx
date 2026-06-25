import { useEffect } from "react";
import { useTraceStore } from "./store/traceStore";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";
import { DetailPanel } from "./components/DetailPanel";
import { StatusBar } from "./components/StatusBar";
import { RecordingLibrary } from "./components/RecordingLibrary";

export default function App() {
  const setSelection = useTraceStore((s) => s.setSelection);
  const selection = useTraceStore((s) => s.selection);
  const setFilters = useTraceStore((s) => s.setFilters);
  const mode = useTraceStore((s) => s.mode);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        if (e.key === "Escape") {
          (target as HTMLInputElement).blur();
        }
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
