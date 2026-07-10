import { useMemo } from "react";
import { useTraceStore } from "../store/traceStore";
import { selectSelectedRecord, filterRecords } from "../store/selectors";
import type { TraceRecord } from "../api/types";
import { recordTick } from "../store/traceTime";
import {
  effectiveAction,
  recordDuration,
  recordResult,
  recordTriggerSource,
  triggerBadge,
} from "../store/recordNorm";
import {
  recordMatchesTickFilterBucket,
  tickFilterGroupsFromPayload,
  type TickFilterGroup,
} from "../store/tickFilter";

export function DetailPanel() {
  const selection = useTraceStore((s) => s.selection);
  const setSelection = useTraceStore((s) => s.setSelection);
  const indexes = useTraceStore((s) => s.indexes);
  const records = useTraceStore((s) => s.records);
  const filters = useTraceStore((s) => s.filters);
  const setRange = useTraceStore((s) => s.setRange);
  const viewRange = useTraceStore((s) => s.viewRange);
  const range = useTraceStore((s) => s.range);
  const tickFilterBuckets = useTraceStore((s) => s.tickFilterBuckets);
  const revealedTickFilterGroupIds = useTraceStore((s) => s.revealedTickFilterGroupIds);
  const setTickFilterGroupReveal = useTraceStore((s) => s.setTickFilterGroupReveal);

  const { record, related } = useMemo(() => selectSelectedRecord(selection, indexes), [selection, indexes]);
  const selectedTickFilterGroup = useMemo(() => {
    if (selection?.kind !== "tickFilterGroup") return null;
    return tickFilterGroupsFromPayload(tickFilterBuckets)
      .find((group) => group.groupId === selection.groupId) ?? null;
  }, [selection, tickFilterBuckets]);
  const tickFilterGroupRecords = useMemo(() => {
    if (!selectedTickFilterGroup) return [];
    const buckets = [selectedTickFilterGroup.bucket, ...selectedTickFilterGroup.children];
    return records
      .filter((item) => buckets.some((bucket) => recordMatchesTickFilterBucket(item, bucket)))
      .slice(-50)
      .reverse();
  }, [records, selectedTickFilterGroup]);
  const tickFilterGroupRevealed = selectedTickFilterGroup?.allGroupIds.some(
    (groupId) => revealedTickFilterGroupIds.has(groupId)
  ) ?? false;
  const trigger = record ? recordTriggerSource(record) : null;

  // Prev/Next navigate within the current FILTERED result set (docs :598). Use a Map<id,index>
  // so navigation is O(1) instead of indexOf's O(n) on large datasets.
  const { filtered, idIndex } = useMemo(() => {
    const f = filterRecords(records, filters);
    const m = new Map<number, number>();
    for (let i = 0; i < f.length; i++) m.set(f[i].id, i);
    return { filtered: f, idIndex: m };
  }, [records, filters]);
  const currentIndex = record ? idIndex.get(record.id) ?? -1 : -1;
  const prev = currentIndex > 0 ? filtered[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < filtered.length - 1 ? filtered[currentIndex + 1] : null;

  function navigate(r: TraceRecord | null) {
    if (!r) return;
    setSelection({ kind: "record", id: r.id });
    const span = (viewRange.max - viewRange.min) || 100;
    const half = span / 2;
    const tick = recordTick(r);
    const lo = Math.max(range.min, tick - half);
    const hi = lo + span;
    setRange(lo, hi);
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

      {selectedTickFilterGroup ? (
        <TickFilterGroupDetail
          group={selectedTickFilterGroup}
          records={tickFilterGroupRecords}
          revealed={tickFilterGroupRevealed}
          onReveal={(reveal) => setTickFilterGroupReveal(selectedTickFilterGroup.allGroupIds, reveal)}
          onSelectRecord={(id) => setSelection({ kind: "record", id })}
        />
      ) : !record ? (
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

          {/* Always-show fields per docs :592 (id/type/subject/summary). */}
          <KV k="ID" v={String(record.id)} mono />
          <KV k="Type" v={record.type} mono />
          <KV k="Subject" v={record.subject} mono copyable />
          <KV k="Summary" v={record.summary} mono block />
          {record.basicFields.tick && <KV k="Tick" v={record.basicFields.tick} mono />}
          {record.basicFields.sequence && <KV k="Sequence" v={record.basicFields.sequence} mono />}
          <KV k="Function" v={record.commandContext.function} mono copyable />
          <KV k="Executor" v={record.commandContext.source || "—"} mono />
          {record.basicFields.position && <KV k="Position" v={record.basicFields.position} mono />}
          {record.basicFields["storage path"] && <KV k="Storage Path" v={record.basicFields["storage path"]} mono copyable />}
          {record.commandType && record.commandType !== "none" && <KV k="Operation" v={record.commandType} mono />}
          {effectiveAction(record) && <KV k="Action" v={effectiveAction(record)} mono />}
          {record.commandContext.command && (
            <KV k="Arguments" v={record.commandContext.command} mono copyable block />
          )}
          <KV k="Result" v={resultDisplay(record)} />
          <KV k="Duration" v={durationDisplay(record)} />

          {trigger && (
            <div className="detail__section detail__trigger">
              <div className="detail__section-title">
                Trigger Source
                <span className="trigger-badge">{triggerBadge(trigger)}</span>
              </div>
              <KV k="Type" v={trigger.type} mono />
              <KV k="Trigger ID" v={trigger.id} mono copyable />
              <KV k="Entry Function" v={trigger.functionId} mono copyable />
              {trigger.actor && <KV k="Actor" v={trigger.actor} mono />}
              {trigger.position && <KV k="Position" v={trigger.position} mono />}
              {trigger.dimension && <KV k="Dimension" v={trigger.dimension} mono />}
            </div>
          )}

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
            <div className="detail__section-title">
              Command Context
              <button className="kv__copy" onClick={() => copyText(JSON.stringify(record.commandContext, null, 2))} title="Copy JSON">⧉</button>
            </div>
            <pre className="detail__json mono">{JSON.stringify(record.commandContext, null, 2)}</pre>
          </div>

          <div className="detail__section">
            <div className="detail__section-title">
              Basic Fields
              <button className="kv__copy" onClick={() => copyText(JSON.stringify(record.basicFields, null, 2))} title="Copy JSON">⧉</button>
            </div>
            <pre className="detail__json mono">{JSON.stringify(record.basicFields, null, 2)}</pre>
          </div>

          {Object.keys(record.detailedFields).length > 0 && (
            <div className="detail__section">
              <div className="detail__section-title">
                Detailed Fields
                <button className="kv__copy" onClick={() => copyText(JSON.stringify(record.detailedFields, null, 2))} title="Copy JSON">⧉</button>
              </div>
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

function TickFilterGroupDetail({
  group,
  records,
  revealed,
  onReveal,
  onSelectRecord,
}: {
  group: TickFilterGroup;
  records: TraceRecord[];
  revealed: boolean;
  onReveal: (reveal: boolean) => void;
  onSelectRecord: (id: number) => void;
}) {
  const bucket = group.bucket;
  return (
    <div className="detail__body">
      <div className="detail__title">
        <span className="detail__diamond">≡</span>
        Filtered Activity
      </div>
      <KV k="Function" v={bucket.functionId || bucket.displayName} mono copyable />
      <KV k="Reason" v={bucket.reason} />
      <KV k="State" v={bucket.active ? "active" : "inactive"} mono />
      <KV k="Current Rate" v={`${bucket.countLastSecond.toLocaleString()}/s`} mono />
      <KV k="Total" v={bucket.totalCount.toLocaleString()} mono />
      <KV k="First Tick" v={String(bucket.firstSeenTick)} mono />
      <KV k="Last Tick" v={String(bucket.lastSeenTick)} mono />
      <KV k="Child Groups" v={String(group.children.length)} mono />

      <button
        className={revealed ? "detail__reveal detail__reveal--active" : "detail__reveal"}
        onClick={() => onReveal(!revealed)}
      >
        {revealed ? "Re-hide this group" : "Temporarily show this group's raw records"}
      </button>

      {group.children.length > 0 && (
        <div className="detail__section">
          <div className="detail__section-title">Child Commands / Events ({group.children.length})</div>
          <div className="detail__list">
            {group.children.map((child) => (
              <div key={child.groupId || child.key} className="detail__filter-child">
                <span className="muted">{child.type}</span>
                <span className="mono">{child.displayName}</span>
                <strong className="mono">{child.countLastSecond.toLocaleString()}/s</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="detail__section">
        <div className="detail__section-title">Recent Raw Records ({records.length})</div>
        <div className="detail__list">
          {records.map((item) => (
            <button
              key={item.id}
              className="detail__list-item mono"
              onClick={() => onSelectRecord(item.id)}
            >
              <span className="muted">#{item.id} · Tick {recordTick(item)}</span> {item.subject}
            </button>
          ))}
          {records.length === 0 && <div className="muted detail__list-more">No raw records loaded.</div>}
        </div>
      </div>
    </div>
  );
}

function resultDisplay(r: TraceRecord): React.ReactNode {
  const v = recordResult(r);
  if (!v) return "—";
  // The backend writes numeric results (e.g. "1") for many events; show success-ish styling when nonzero/truthy.
  const ok = v !== "0" && v.toLowerCase() !== "false" && v.toLowerCase() !== "none";
  return <span style={{ color: ok ? "var(--success)" : "var(--text-muted)" }}>{v}</span>;
}

function durationDisplay(r: TraceRecord): React.ReactNode {
  const v = recordDuration(r);
  return v || "—";
}

function KV({ k, v, mono, copyable, block }: { k: string; v: React.ReactNode; mono?: boolean; copyable?: boolean; block?: boolean }) {
  return (
    <div className={"kv__row" + (block ? " kv__row--block" : "")}>
      <div className="kv__k muted">{k}</div>
      <div className={"kv__v" + (mono ? " mono" : "")}>
        {v}
        {copyable && <button className="kv__copy" onClick={() => copyText(String(v))} title="Copy">⧉</button>}
      </div>
    </div>
  );
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => { /* ignore */ });
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
