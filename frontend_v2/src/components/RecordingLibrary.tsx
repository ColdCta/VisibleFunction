import { useEffect, useState } from "react";
import { useTraceStore } from "../store/traceStore";
import type { RecordingMetadata } from "../api/types";

const RENDER_BATCH = 60; // render recordings in growing batches to bound DOM size (docs :791)

export function RecordingLibrary() {
  const recordings = useTraceStore((s) => s.recordings);
  const loadRecording = useTraceStore((s) => s.loadRecording);
  const openRecordings = useTraceStore((s) => s.openRecordings);
  const recordingStatus = useTraceStore((s) => s.recordingStatus);
  const [visibleCount, setVisibleCount] = useState(RENDER_BATCH);

  // Load the list once on mount. The TopBar mode switch already calls openRecordings; this guards
  // the case where the component mounts independently.
  useEffect(() => {
    void openRecordings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the visible window when the list identity changes.
  useEffect(() => { setVisibleCount(RENDER_BATCH); }, [recordings]);

  const active = recordingStatus?.active === "true";
  const sorted = recordings.slice().reverse();
  const visible = sorted.slice(0, visibleCount);
  const remaining = sorted.length - visible.length;

  return (
    <main className="recordings">
      <div className="recordings__header">
        <div>
          <div className="recordings__title">Recording Library</div>
          <div className="recordings__subtitle">
            Static trace files captured by VisibleFunction. Select one to open it as a replay.
          </div>
        </div>
        <span className="spacer" />
        <button onClick={() => void openRecordings()}>Refresh</button>
      </div>

      {active && (
        <div className="recordings__banner">
          Recording is active in-game. Current segment: {recordingStatus?.activeRecords ?? "0"} records.
        </div>
      )}

      {recordings.length === 0 ? (
        <div className="recordings__empty">
          <div>No completed recordings.</div>
          <div className="muted">Press ] in-game to record a trace segment.</div>
        </div>
      ) : (
        <div className="recordings__grid">
          {visible.map((recording) => (
            <RecordingCard
              key={recording.id}
              recording={recording}
              onOpen={() => void loadRecording(recording)}
            />
          ))}
          {remaining > 0 && (
            <button className="recording-card" onClick={() => setVisibleCount((c) => c + RENDER_BATCH)}>
              <div className="recording-card__top">
                <span className="recording-card__id mono">+{remaining} more</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>Click to load {Math.min(RENDER_BATCH, remaining)} more recordings</div>
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function RecordingCard({
  recording,
  onOpen,
}: {
  recording: RecordingMetadata;
  onOpen: () => void;
}) {
  return (
    <button className="recording-card" onClick={onOpen}>
      <div className="recording-card__top">
        <span className="recording-card__id mono">{recording.id}</span>
        <span className="pill">{recording.records.toLocaleString()} records</span>
      </div>
      <div className="recording-card__meta">
        <span>Started</span>
        <span className="mono">{formatDate(recording.startedAtMillis)}</span>
        <span>Duration</span>
        <span className="mono">{formatDuration(recording.durationMillis)}</span>
        <span>File</span>
        <span className="mono recording-card__file">{recording.file}</span>
      </div>
    </button>
  );
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString([], { hour12: false });
}

function formatDuration(value: number): string {
  const seconds = Math.floor(value / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
