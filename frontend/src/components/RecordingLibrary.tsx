import { useEffect } from "react";
import { useTraceStore } from "../store/traceStore";
import type { RecordingMetadata } from "../api/types";

export function RecordingLibrary() {
  const recordings = useTraceStore((s) => s.recordings);
  const loadRecording = useTraceStore((s) => s.loadRecording);
  const openRecordings = useTraceStore((s) => s.openRecordings);
  const recordingStatus = useTraceStore((s) => s.recordingStatus);

  useEffect(() => {
    void openRecordings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {recordingStatus?.active === "true" && (
        <div className="recordings__banner">
          Recording is active in-game. Current segment: {recordingStatus.activeRecords} records.
        </div>
      )}

      {recordings.length === 0 ? (
        <div className="recordings__empty">
          <div>No completed recordings.</div>
          <div className="muted">
            Press ] in-game to start recording, press it again to stop, then refresh this page.
          </div>
        </div>
      ) : (
        <div className="recordings__grid">
          {recordings.slice().reverse().map((recording) => (
            <RecordingCard
              key={recording.id}
              recording={recording}
              onOpen={() => void loadRecording(recording)}
            />
          ))}
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
