import { useState } from "react";
import { useTraceStore } from "../store/traceStore";
import { normalizeRecordingStatus } from "../api/types";
import type { TraceRecord } from "../api/types";

export function TopBar() {
  const paused = useTraceStore((s) => s.paused);
  const records = useTraceStore((s) => s.records);
  const togglePause = useTraceStore((s) => s.togglePause);
  const clear = useTraceStore((s) => s.clear);
  const mode = useTraceStore((s) => s.mode);
  const activeRecording = useTraceStore((s) => s.activeRecording);
  const recordingStatus = useTraceStore((s) => s.recordingStatus);
  const setBaseUrl = useTraceStore((s) => s.setBaseUrl);
  const baseUrl = useTraceStore((s) => s.baseUrl);
  const openLive = useTraceStore((s) => s.openLive);
  const openRecordings = useTraceStore((s) => s.openRecordings);
  const streamError = useTraceStore((s) => s.streamError);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState(baseUrl);

  const norm = recordingStatus ? normalizeRecordingStatus(recordingStatus) : null;
  const isRecording = norm?.active ?? false;

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <div className="topbar__logo" aria-hidden>
          <span className="grass grass--top" />
          <span className="grass grass--bottom" />
        </div>
        <div>
          <div className="topbar__title">VisibleFunction</div>
          <div className="topbar__subtitle">Minecraft Datapack Debugger</div>
        </div>
      </div>

      <div className="topbar__center">
        <div className="mode-tabs" aria-label="Data source">
          <button
            className={"mode-tab" + (mode === "live" ? " is-active" : "")}
            onClick={() => void openLive()}
          >
            Live Monitor
          </button>
          <button
            className={"mode-tab" + (mode === "recordings" || mode === "replay" ? " is-active" : "")}
            onClick={() => void openRecordings()}
          >
            Recordings
          </button>
        </div>
        {mode === "replay" && activeRecording ? (
          <span className="pill" style={{ color: "var(--function)" }}>
            REPLAY {activeRecording.id}
          </span>
        ) : isRecording ? (
          <span className="pill rec">
            <span className="dot rec" />
            RECORDING
            <span className="mono" style={{ marginLeft: 4 }}>{norm?.activeRecords ?? 0} recs</span>
          </span>
        ) : (
          <span className="pill idle">
            idle
            {norm && norm.latest && norm.latest !== "none" && (
              <span className="muted" style={{ marginLeft: 6 }}>last: {norm.latest}</span>
            )}
          </span>
        )}
      </div>

      {streamError && (
        <div className="topbar__warn" title="SSE stream error — showing last good data, retrying">
          stream error · retrying
        </div>
      )}

      <div className="topbar__actions">
        <button onClick={togglePause} title="Pause/resume live rendering (UI only)">
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={clear} title="Clear current view (does not delete backend recordings)">
          Clear
        </button>
        <button onClick={() => exportData(records, activeRecording?.id)} disabled={!records.length} title="Download current dataset as JSON">
          Export
        </button>
        <button onClick={() => setSettingsOpen((v) => !v)} title="Settings" aria-label="Settings">
          <SettingsIcon />
        </button>
      </div>

      {settingsOpen && (
        <div className="topbar__settings" onClick={() => setSettingsOpen(false)}>
          <div className="topbar__settings-panel" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Settings</div>
            <label className="muted" style={{ fontSize: 11 }}>Backend base URL</label>
            <div className="row" style={{ marginTop: 4 }}>
              <input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                style={{ flex: 1 }}
                placeholder="http://127.0.0.1:17654  (or 'mock')"
              />
              <button
                onClick={() => {
                  setBaseUrl(urlDraft);
                  setSettingsOpen(false);
                  if (mode === "live") {
                    void openLive();
                  } else {
                    void openRecordings();
                  }
                }}
              >
                Save & Reconnect
              </button>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              Default: http://127.0.0.1:17654 — type <code>mock</code> for the built-in mock server.
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function exportData(records: TraceRecord[], recordingId?: string) {
  if (!records.length) return;
  // In replay mode include the recording metadata alongside the records (docs :652 "download
  // current visible dataset or latest recording JSON").
  const payload = recordingId
    ? { recording: { id: recordingId }, records }
    : { records };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `visiblefunction-${recordingId ?? "live"}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
