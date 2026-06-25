import { useEffect, useMemo, useRef } from "react";
import { useTraceStore } from "../store/traceStore";
import { selectViewModel } from "../store/selectors";
import { BUCKET_SIZES } from "../store/timelineBuckets";
import type { TickFilterBand, TimelineBucket, TraceRecord } from "../api/types";
import { FunctionCard } from "./FunctionCard";

export function Timeline() {
  const records = useTraceStore((s) => s.records);
  const indexes = useTraceStore((s) => s.indexes);
  const serverTickFilterBands = useTraceStore((s) => s.serverTickFilterBands);
  const filters = useTraceStore((s) => s.filters);
  const bucketMillis = useTraceStore((s) => s.bucketMillis);
  const setBucket = useTraceStore((s) => s.setBucket);
  const autoScroll = useTraceStore((s) => s.autoScroll);
  const setAutoScroll = useTraceStore((s) => s.setAutoScroll);
  const viewRange = useTraceStore((s) => s.viewRange);
  const setRange = useTraceStore((s) => s.setRange);
  const range = useTraceStore((s) => s.range);
  const selection = useTraceStore((s) => s.selection);
  const setSelection = useTraceStore((s) => s.setSelection);
  const highlightIds = useTraceStore((s) => s.highlightIds);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const vm = useMemo(
    () => selectViewModel(records, indexes, filters, bucketMillis, serverTickFilterBands),
    [records, indexes, filters, bucketMillis, serverTickFilterBands]
  );

  const visibleBuckets = useMemo(() => {
    if (!viewRange.min && !viewRange.max) return vm.buckets;
    return vm.buckets.filter((b) => b.endMillis > viewRange.min && b.startMillis < viewRange.max);
  }, [vm.buckets, viewRange]);

  const visibleTickFilterBands = useMemo(() => {
    if (!viewRange.min && !viewRange.max) return vm.tickFilterBands;
    return vm.tickFilterBands.filter((band) => band.endMillis >= viewRange.min && band.startMillis <= viewRange.max);
  }, [vm.tickFilterBands, viewRange]);
  const currentBucketKey = visibleBuckets[visibleBuckets.length - 1]?.key;

  useEffect(() => {
    if (!autoScroll) {
      return;
    }

    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    scroller.scrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  }, [autoScroll, visibleBuckets.length, viewRange.max]);

  function zoom(factor: number) {
    const idx = BUCKET_SIZES.findIndex((b) => b.millis === bucketMillis);
    const next = BUCKET_SIZES[Math.max(0, Math.min(BUCKET_SIZES.length - 1, idx + factor))];
    setBucket(next.millis);
  }

  function jump(delta: number) {
    const span = (viewRange.max - viewRange.min) || (range.max - range.min) || bucketMillis * 20;
    const step = span * delta;
    const currentMin = viewRange.min || range.min;
    const currentMax = viewRange.max || range.max;
    const boundsMin = range.min;
    const boundsMax = range.max;
    let lo = currentMin + step;
    let hi = currentMax + step;
    if (lo < boundsMin) {
      hi += boundsMin - lo;
      lo = boundsMin;
    }
    if (hi > boundsMax) {
      lo -= hi - boundsMax;
      hi = boundsMax;
    }
    setRange(Math.max(boundsMin, lo), Math.min(boundsMax, hi));
  }

  return (
    <main className="timeline">
      <div className="timeline__header">
        <div className="legend row gap-12">
          <Legend color="var(--tick)" label="Tick" />
          <Legend color="var(--tick-filter)" label="Tick Filter" />
          <Legend color="var(--event)" label="Event" />
          <Legend color="var(--function)" label="Function" />
          <Legend color="var(--command)" label="Commands" />
        </div>

        <div className="spacer" />

        <div className="row gap-6">
          <button onClick={() => zoom(-1)} title="Zoom in (smaller buckets)">−</button>
          <button onClick={() => zoom(1)} title="Zoom out (larger buckets)">+</button>
          <select
            value={bucketMillis}
            onChange={(e) => setBucket(Number(e.target.value))}
            title="Bucket size"
          >
            {BUCKET_SIZES.map((b) => (
              <option key={b.label} value={b.millis}>{b.label}</option>
            ))}
          </select>
        </div>

        <div className="row gap-6" style={{ marginLeft: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>Auto Scroll</span>
          <span
            className={"switch" + (autoScroll ? " switch--on" : "")}
            role="switch"
            aria-checked={autoScroll}
            tabIndex={0}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            <span className="switch__knob" />
          </span>
        </div>
      </div>

      <div className="timeline__grid" ref={scrollerRef}>
        {visibleBuckets.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="buckets" style={{ minWidth: 200 + visibleBuckets.length * 220 }}>
            <BucketHeaderRow buckets={visibleBuckets} bucketMillis={bucketMillis} currentBucketKey={currentBucketKey} />
            <TickLane buckets={visibleBuckets} hideIdle={filters.hideIdleTicks} enabled={filters.tick} currentBucketKey={currentBucketKey} />
            <TickFilterLane buckets={visibleBuckets} bands={visibleTickFilterBands} enabled={filters.tick} currentBucketKey={currentBucketKey} />
            <EventLane
              buckets={visibleBuckets}
              onSelect={(r) => setSelection({ kind: "record", id: r.id })}
              highlightIds={highlightIds}
              currentBucketKey={currentBucketKey}
            />
            <FunctionLane
              buckets={visibleBuckets}
              enabled={filters.function}
              onSelectRecord={(r) => setSelection({ kind: "record", id: r.id })}
              onSelectCall={(fcid) => setSelection({ kind: "functionCall", functionCallId: fcid })}
              selection={selection}
              highlightIds={highlightIds}
              currentBucketKey={currentBucketKey}
            />
            <CommandLane
              buckets={visibleBuckets}
              onSelect={(r) => setSelection({ kind: "record", id: r.id })}
              selection={selection}
              highlightIds={highlightIds}
              currentBucketKey={currentBucketKey}
            />
          </div>
        )}
      </div>

      <Minimap
        buckets={vm.buckets}
        viewMin={viewRange.min || range.min}
        viewMax={viewRange.max || range.max}
        onChange={setRange}
        onPage={jump}
      />
    </main>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="legend__item">
      <span className="dot" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

function BucketHeaderRow({
  buckets,
  bucketMillis,
  currentBucketKey,
}: {
  buckets: TimelineBucket[];
  bucketMillis: number;
  currentBucketKey: string | undefined;
}) {
  return (
    <div className="buckets__row buckets__row--header">
      <div className="bucket__label-spacer" />
      {buckets.map((b) => {
        const tick = b.records[0]?.basicFields.tick ?? b.records[0]?.detailedFields.tick;
        const label = tick ? `Tick ${tick}` : formatTick(b, bucketMillis);
        const isCurrent = b.key === currentBucketKey;
        return (
          <div key={b.key} className={"bucket__header" + (isCurrent ? " bucket__header--current" : "")}>
            {label}
          </div>
        );
      })}
    </div>
  );
}

function TickLane({
  buckets,
  hideIdle,
  enabled,
  currentBucketKey,
}: {
  buckets: TimelineBucket[];
  hideIdle: boolean;
  enabled: boolean;
  currentBucketKey: string | undefined;
}) {
  return (
    <div className="lane lane--tick">
      <LaneLabel icon="⏱" title="TICK" subtitle="Main Game Loop" />
      <div className="lane__grid">
        {buckets.map((b) => {
          const currentClass = b.key === currentBucketKey ? " lane__cell--current" : "";
          if (!enabled) return <div key={b.key} className={"lane__cell" + currentClass} />;
          const has = b.records.length > 0;
          if (!has && hideIdle) return <div key={b.key} className={"lane__cell" + currentClass} />;
          return (
            <div key={b.key} className={"lane__cell lane__cell--tick" + currentClass}>
              <div className="tickbar">
                {Array.from({ length: 20 }).map((_, i) => (
                  <span key={i} className="tickbar__bar" style={{ opacity: has ? 1 : 0.15 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TickFilterLane({
  buckets,
  bands,
  enabled,
  currentBucketKey,
}: {
  buckets: TimelineBucket[];
  bands: TickFilterBand[];
  enabled: boolean;
  currentBucketKey: string | undefined;
}) {
  const visibleBands = bands.slice(0, 8);
  const hiddenBands = bands.length - visibleBands.length;

  return (
    <div className="lane lane--tick-filter">
      <LaneLabel icon="!" title="TICK FILTER" subtitle="High Frequency Commands" />
      <div className="lane__grid">
        {buckets.map((bucket, bucketIndex) => (
          <div
            key={bucket.key}
            className={"lane__cell lane__cell--tick-filter" + (bucket.key === currentBucketKey ? " lane__cell--current" : "")}
          >
            {!enabled ? null : visibleBands.map((band, bandIndex) => {
              const active = band.endMillis >= bucket.startMillis && band.startMillis <= bucket.endMillis;
              const startsHere = active && (bucketIndex === 0 || band.startMillis >= bucket.startMillis);
              return (
                <div
                  key={band.key}
                  className={"tick-filter-bar" + (active ? " is-active" : "")}
                  title={`${band.displayName} | ${band.countPerSecond}/s, total ${band.totalCount}`}
                  style={{ top: 8 + bandIndex * 14 }}
                >
                  {startsHere && <span>{band.displayName}</span>}
                </div>
              );
            })}
            {enabled && hiddenBands > 0 && bucketIndex === 0 && (
              <div className="tick-filter-more">+{hiddenBands} filtered groups</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventLane({
  buckets,
  onSelect,
  highlightIds,
  currentBucketKey,
}: {
  buckets: TimelineBucket[];
  onSelect: (r: TraceRecord) => void;
  highlightIds: Set<number>;
  currentBucketKey: string | undefined;
}) {
  return (
    <div className="lane lane--event">
      <LaneLabel icon="◆" title="EVENT" subtitle="Triggered Events" />
      <div className="lane__grid">
        {buckets.map((b) => {
          const evs = b.events;
          const currentClass = b.key === currentBucketKey ? " lane__cell--current" : "";
          if (evs.length === 0) return <div key={b.key} className={"lane__cell" + currentClass} />;
          const lead = pickLead(evs);
          const extras = evs.length - 1;
          return (
            <div key={b.key} className={"lane__cell lane__cell--event" + currentClass}>
              <button
                className={"event-pill" + (highlightIds.has(lead.id) ? " is-highlight" : "")}
                onClick={() => onSelect(lead)}
                onDoubleClick={() => onSelect(lead)}
                title={lead.eventAction}
              >
                <span className="event-pill__icon">◆</span>
                <span className="event-pill__label">{lead.eventAction || lead.subject}</span>
                {extras > 0 && <span className="event-pill__count">+{extras}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FunctionLane({
  buckets,
  enabled,
  onSelectRecord,
  onSelectCall,
  selection,
  highlightIds,
  currentBucketKey,
}: {
  buckets: TimelineBucket[];
  enabled: boolean;
  onSelectRecord: (r: TraceRecord) => void;
  onSelectCall: (fcid: string) => void;
  selection: ReturnType<typeof useTraceStore.getState>["selection"];
  highlightIds: Set<number>;
  currentBucketKey: string | undefined;
}) {
  return (
    <div className="lane lane--function">
      <LaneLabel icon="📦" title="FUNCTION" subtitle="Function Calls" />
      <div className="lane__grid">
        {buckets.map((b) => {
          const currentClass = b.key === currentBucketKey ? " lane__cell--current" : "";
          if (!enabled) return <div key={b.key} className={"lane__cell" + currentClass} />;
          const calls = Array.from(b.byFunctionCallId.entries());
          if (calls.length === 0) return <div key={b.key} className={"lane__cell" + currentClass} />;
          const visibleCalls = calls.slice(0, 8);
          const hiddenCalls = calls.length - visibleCalls.length;
          return (
            <div key={b.key} className={"lane__cell lane__cell--function" + currentClass}>
              {visibleCalls.map(([fcid, recs]) => {
                const fn = recs[0]?.commandContext.function ?? "unknown";
                const cmds = recs.filter((r) => r.type === "COMMAND").length;
                const evs = recs.filter((r) => r.type === "EVENT").length;
                const selected = selection?.kind === "functionCall" && selection.functionCallId === fcid;
                const dim = !selected && highlightIds.size > 0 && !recs.some((r) => highlightIds.has(r.id));
                return (
                  <FunctionCard
                    key={fcid}
                    name={fn}
                    fcid={fcid}
                    cmds={cmds}
                    events={evs}
                    selected={selected}
                    dim={Boolean(dim)}
                    onClick={() => onSelectCall(fcid)}
                    onDoubleClick={() => onSelectRecord(recs[0])}
                  />
                );
              })}
              {hiddenCalls > 0 && <div className="bucket-more">+{hiddenCalls} function calls</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CommandLane({
  buckets,
  onSelect,
  selection,
  highlightIds,
  currentBucketKey,
}: {
  buckets: TimelineBucket[];
  onSelect: (r: TraceRecord) => void;
  selection: ReturnType<typeof useTraceStore.getState>["selection"];
  highlightIds: Set<number>;
  currentBucketKey: string | undefined;
}) {
  return (
    <div className="lane lane--command">
      <LaneLabel icon="⌘" title="COMMANDS" subtitle="Executed Commands" />
      <div className="lane__grid">
        {buckets.map((b) => {
          const currentClass = b.key === currentBucketKey ? " lane__cell--current" : "";
          // group commands by function call
          const groups = new Map<string, TraceRecord[]>();
          for (const c of b.commands) {
            const key = c.commandContext.functionCallId || c.commandContext.function || "_";
            const arr = groups.get(key) ?? [];
            arr.push(c);
            groups.set(key, arr);
          }
          if (groups.size === 0) return <div key={b.key} className={"lane__cell" + currentClass} />;
          const visibleGroups = Array.from(groups.entries()).slice(0, 8);
          const hiddenGroups = groups.size - visibleGroups.length;
          return (
            <div key={b.key} className={"lane__cell lane__cell--command" + currentClass}>
              {visibleGroups.map(([key, cmds]) => {
                const visible = cmds.slice(0, 12);
                const rest = cmds.length - visible.length;
                return (
                  <div key={key} className="cmdstack">
                    {visible.map((c, i) => {
                      const seq = c.basicFields.sequence ?? String(i + 1);
                      const selected = selection?.kind === "record" && selection.id === c.id;
                      const dim = !selected && highlightIds.size > 0 && !highlightIds.has(c.id);
                      return (
                        <div
                          key={c.id}
                          className={
                            "cmdrow" +
                            (selected ? " is-selected" : "") +
                            (dim ? " is-dim" : "")
                          }
                          onClick={() => onSelect(c)}
                          onDoubleClick={() => onSelect(c)}
                        >
                          <span className="cmdrow__seq mono">{seq}</span>
                          <span className="cmdrow__text mono">{c.commandContext.command || c.subject}</span>
                        </div>
                      );
                    })}
                    {rest > 0 && <div className="cmdrow cmdrow--more">+{rest} more</div>}
                  </div>
                );
              })}
              {hiddenGroups > 0 && <div className="bucket-more">+{hiddenGroups} command groups</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LaneLabel({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="lane__label">
      <div className="lane__icon">{icon}</div>
      <div>
        <div className="lane__title">{title}</div>
        <div className="lane__subtitle">{subtitle}</div>
      </div>
    </div>
  );
}

function Minimap({
  buckets,
  viewMin,
  viewMax,
  onChange,
  onPage,
}: {
  buckets: TimelineBucket[];
  viewMin: number;
  viewMax: number;
  onChange: (min: number, max: number) => void;
  onPage: (delta: number) => void;
}) {
  if (buckets.length === 0) return <div className="minimap minimap--empty" />;
  const min = buckets[0].startMillis;
  const max = buckets[buckets.length - 1].endMillis;
  const span = max - min || 1;

  const ticks = buckets.map((b) => ({
    h: b.records.length,
    e: b.events.length,
    f: b.functions.length,
    c: b.commands.length,
    s: b.startMillis,
    e2: b.endMillis,
  }));
  const maxH = Math.max(1, ...ticks.map((t) => t.h));

  function pickFromX(clientX: number) {
    const el = document.getElementById("minimap-track");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const center = min + (x / rect.width) * span;
    const half = (viewMax - viewMin) / 2;
    onChange(Math.max(min, center - half), Math.min(max, center + half));
  }

  return (
    <div className="minimap">
      <button className="minimap__nav" onClick={() => onPage(-0.4)} aria-label="Page left">‹</button>
      <div className="minimap__body">
        <div className="minimap__rows">
          {(["t", "e", "f", "c"] as const).map((k) => (
            <div key={k} className="minimap__row">
              {ticks.map((b, i) => {
                const v = k === "t" ? b.h : k === "e" ? b.e : k === "f" ? buckets[i].byFunctionCallId.size : b.c;
                const w = (b.e2 - b.s) / span * 100;
                const left = (b.s - min) / span * 100;
                return (
                  <span
                    key={i}
                    className={`minimap__bar minimap__bar--${k}`}
                    style={{ left: `${left}%`, width: `${Math.max(0.5, w)}%`, opacity: 0.25 + (v / maxH) * 0.75 }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div
          id="minimap-track"
          className="minimap__track"
          onMouseDown={(e) => {
            pickFromX(e.clientX);
            const move = (ev: MouseEvent) => pickFromX(ev.clientX);
            const up = () => {
              window.removeEventListener("mousemove", move);
              window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
        >
          <div
            className="minimap__viewport"
            style={{
              left: `${((viewMin - min) / span) * 100}%`,
              width: `${Math.max(2, ((viewMax - viewMin) / span) * 100)}%`,
            }}
          />
        </div>
      </div>
      <button className="minimap__nav" onClick={() => onPage(0.4)} aria-label="Page right">›</button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="timeline__empty">
      <div style={{ fontSize: 14, marginBottom: 6 }}>No trace records yet.</div>
      <div className="muted" style={{ fontSize: 12 }}>
        Start a recording or run datapack commands in-game.
      </div>
    </div>
  );
}

function pickLead(events: TraceRecord[]): TraceRecord {
  // Prefer storage_modified > scoreboard_score_set > item_given > others
  const pri = ["storage_modified", "scoreboard_score_set", "item_given", "entity_killed", "result_event"];
  for (const p of pri) {
    const hit = events.find((e) => e.eventAction === p);
    if (hit) return hit;
  }
  return events[0];
}

function formatTick(b: TimelineBucket, bucketMillis: number): string {
  if (bucketMillis <= 1) {
    return `Tick ${Math.floor(b.startMillis)}`;
  }
  return `Tick ${Math.floor(b.startMillis)}-${Math.max(Math.floor(b.endMillis - 1), Math.floor(b.startMillis))}`;
}
