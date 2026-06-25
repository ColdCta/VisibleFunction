import { useMemo } from "react";
import { useTraceStore } from "../store/traceStore";
import { selectSelectedRecord } from "../store/selectors";
import type { TraceRecord } from "../api/types";
import { recordTick } from "../store/traceTime";

export function DetailPanel() {
  const selection = useTraceStore((s) => s.selection);
  const setSelection = useTraceStore((s) => s.setSelection);
  const indexes = useTraceStore((s) => s.indexes);
  const records = useTraceStore((s) => s.records);
  const setRange = useTraceStore((s) => s.setRange);
  const viewRange = useTraceStore((s) => s.viewRange);
  const range = useTraceStore((s) => s.range);

  const { record, related } = useMemo(
    () => selectSelectedRecord(selection, indexes),
    [selection, indexes]
  );

  const orderedIds = records.map((r) => r.id);
  const currentIndex = record ? orderedIds.indexOf(record.id) : -1;
  const prev = currentIndex > 0 ? records[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < records.length - 1 ? records[currentIndex + 1] : null;

  function navigate(r: TraceRecord | null) {
    if (!r) return;
    setSelection({ kind: "record", id: r.id });
    const span = (viewRange.max - viewRange.min) || bucketSpan();
    const half = span / 2;
    const tick = recordTick(r);
    const lo = Math.max(range.min, tick - half);
    const hi = lo + span;
    setRange(lo, hi);
  }

  function bucketSpan() {
    return 100;
  }

  return (
    <aside className="detail">
      <div className="detail__header">
        <span style={{ fontWeight: 600 }}>SELECTED ITEM</span>
        <span className="spacer" />
        <button onClick={() => setSelection(null)} title="Close (Esc)" aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      {!record ? (
        <div className="detail__empty">
          <div style={{ fontSize: 14, marginBottom: 6 }}>Nothing selected</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Click an event, function card, or command to inspect.
          </div>
        </div>
      ) : (
        <div className="detail__body">
          <div className="detail__title">
            <span className="detail__diamond">◇</span>
            {selection?.kind === "functionCall" ? "Function Call" : prettyType(record)}
          </div>

          <KV k="Type" v={record.type} />
          {record.basicFields.tick && <KV k="Tick" v={record.basicFields.tick} mono />}
          {record.basicFields.sequence && <KV k="Sequence" v={record.basicFields.sequence} mono />}
          <KV k="Function" v={record.commandContext.function} mono copyable />
          <KV k="Executor" v={record.commandContext.source || "—"} mono />
          {record.basicFields.position && <KV k="Position" v={record.basicFields.position} mono />}
          {record.basicFields["storage path"] && <KV k="Storage Path" v={record.basicFields["storage path"]} mono copyable />}
          {record.commandType && <KV k="Operation" v={record.commandType} mono />}
          {record.eventAction && <KV k="Action" v={record.eventAction} mono />}
          <KV k="Target" v={record.subject} mono />
          {record.commandContext.command && (
            <KV k="Arguments" v={record.commandContext.command} mono copyable block />
          )}
          <KV k="Result" v={<span style={{ color: "var(--success)" }}>✓ Success</span>} />
          <KV k="Duration" v="—" />
          <KV k="Notes" v="—" />

          {selection?.kind === "functionCall" && related.length > 0 && (
            <div className="detail__section">
              <div className="detail__section-title">Function Call Records ({related.length})</div>
              <div className="detail__list">
                {related.slice(0, 50).map((r) => (
                  <button
                    key={r.id}
                    className="detail__list-item mono"
                    onClick={() => setSelection({ kind: "record", id: r.id })}
                  >
                    <span className="muted">#{r.id}</span> {r.subject}
                  </button>
                ))}
                {related.length > 50 && (
                  <div className="muted detail__list-more">+{related.length - 50} more</div>
                )}
              </div>
            </div>
          )}

          <div className="detail__section">
            <div className="detail__section-title">Command Context</div>
            <pre className="detail__json mono">{JSON.stringify(record.commandContext, null, 2)}</pre>
          </div>

          <div className="detail__section">
            <div className="detail__section-title">Basic Fields</div>
            <pre className="detail__json mono">{JSON.stringify(record.basicFields, null, 2)}</pre>
          </div>

          {Object.keys(record.detailedFields).length > 0 && (
            <div className="detail__section">
              <div className="detail__section-title">Detailed Fields</div>
              <pre className="detail__json mono">{JSON.stringify(record.detailedFields, null, 2)}</pre>
            </div>
          )}

          <div className="detail__nav">
            <button onClick={() => navigate(prev)} disabled={!prev}>
              ‹ Prev ({prev?.id ?? "—"})
            </button>
            <button onClick={() => navigate(next)} disabled={!next}>
              Next ({next?.id ?? "—"}) ›
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function KV({ k, v, mono, copyable, block }: { k: string; v: React.ReactNode; mono?: boolean; copyable?: boolean; block?: boolean }) {
  return (
    <div className={"kv__row" + (block ? " kv__row--block" : "")}>
      <div className="kv__k muted">{k}</div>
      <div className={"kv__v" + (mono ? " mono" : "")}>
        {v}
        {copyable && <button className="kv__copy" onClick={() => navigator.clipboard?.writeText(String(v))} title="Copy">⧉</button>}
      </div>
    </div>
  );
}

function prettyType(r: TraceRecord): string {
  if (r.type === "COMMAND") return "Command";
  if (r.type === "EVENT") return "Event";
  return r.type || "Record";
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
