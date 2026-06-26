import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTraceStore } from "../../store/traceStore";
import { selectViewModel } from "../../store/selectors";
import { BUCKET_SIZES, formatBucketHeader } from "../../store/timelineBuckets";
import type { TickFilterBand, TimelineBucket, TraceRecord } from "../../api/types";
import { recordTick } from "../../store/traceTime";
import { effectiveAction } from "../../store/recordNorm";
import { FunctionCard } from "./FunctionCard";

const COLUMN_WIDTH = 220;

export function Timeline() {
  const records = useTraceStore((s) => s.records);
  const indexes = useTraceStore((s) => s.indexes);
  const filters = useTraceStore((s) => s.filters);
  const bucketTicks = useTraceStore((s) => s.bucketTicks);
  const setBucket = useTraceStore((s) => s.setBucket);
  const autoScroll = useTraceStore((s) => s.autoScroll);
  const setAutoScroll = useTraceStore((s) => s.setAutoScroll);
  const viewRange = useTraceStore((s) => s.viewRange);
  const setRange = useTraceStore((s) => s.setRange);
  const range = useTraceStore((s) => s.range);
  const selection = useTraceStore((s) => s.selection);
  const setSelection = useTraceStore((s) => s.setSelection);
  const openRelationshipGraphForEvents = useTraceStore((s) => s.openRelationshipGraphForEvents);
  const highlightIds = useTraceStore((s) => s.highlightIds);
  const connection = useTraceStore((s) => s.connection);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Mirrors the scroller's horizontal scroll position via rAF-throttled listener so the minimap's
  // viewport rectangle tracks the native scrollbar (the minimap is read-only — no drag/paging).
  const [scrollState, setScrollState] = useState({ scrollLeft: 0, scrollWidth: 1, clientWidth: 1 });

  const vm = useMemo(
    () => selectViewModel(records, indexes, filters, bucketTicks),
    [records, indexes, filters, bucketTicks]
  );

  const visibleBuckets = useMemo(() => {
    if (!viewRange.min && !viewRange.max) return vm.buckets;
    // Use <= on the max boundary so the bucket containing the latest tick (startTick ===
    // viewRange.max in live mode) is included. With < it was excluded, hiding the newest frame.
    return vm.buckets.filter((b) => b.endTick > viewRange.min && b.startTick <= viewRange.max);
  }, [vm.buckets, viewRange]);

  // The "current" frame is the latest tick in the dataset, NOT the last filtered bucket. When
  // hideHighFreq removes every record from the newest tick, that bucket drops out of vm.buckets,
  // but the TICK lane must still mark the live edge. Derive the key from range.max so the marker
  // keeps updating regardless of filtering.
  const currentBucketKey = useMemo(() => {
    const latestTick = range.max;
    if (!latestTick) return visibleBuckets[visibleBuckets.length - 1]?.key;
    return String(Math.floor(latestTick / bucketTicks));
  }, [range.max, bucketTicks, visibleBuckets]);

  // Horizontal virtualization (docs :791). Only render the columns actually in (or near) the
  // scroll viewport, not every bucket in the view range. All four lanes share the same column
  // geometry, so a single virtualizer drives the slice for every lane.
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: visibleBuckets.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => COLUMN_WIDTH,
    overscan: 6,
  });
  const colStart = colVirtualizer.getVirtualItems()[0]?.start ?? 0;
  const visibleSlice = colVirtualizer.getVirtualItems().map((vi) => visibleBuckets[vi.index]);

  useEffect(() => {
    if (!autoScroll) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  }, [autoScroll, visibleBuckets.length, viewRange.max]);

  // Sync scrollState with the native scrollbar so the read-only minimap viewport follows it.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setScrollState({ scrollLeft: scroller.scrollLeft, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth });
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // A ResizeObserver keeps the rectangle correct when the grid's content size changes (new
    // buckets / window resizes) even without an explicit scroll event.
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    });
    ro.observe(scroller);
    update();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  function zoom(factor: number) {
    const idx = BUCKET_SIZES.findIndex((b) => b.ticks === bucketTicks);
    const next = BUCKET_SIZES[Math.max(0, Math.min(BUCKET_SIZES.length - 1, idx + factor))];
    setBucket(next.ticks);
  }

  // Double-click zoom (docs :746): center the timeline on the record's tick with a tight window.
  function zoomToTick(tick: number) {
    const half = Math.min(DEFAULT_ZOOM_TICKS, Math.max(1, (viewRange.max - viewRange.min) / 2));
    const lo = Math.max(range.min, tick - half);
    const hi = Math.min(range.max, tick + half);
    setRange(lo, hi);
  }

  function selectEventGroup(record: TraceRecord, events: TraceRecord[], label: string) {
    setSelection({ kind: "record", id: record.id });
    if (record.type === "EVENT") {
      openRelationshipGraphForEvents(record.id, events.map((event) => event.id), label);
    }
  }

  const empty = visibleBuckets.length === 0;
  const totalWidth = visibleBuckets.length * COLUMN_WIDTH;

  return (
    <main className="timeline">
      <div className="timeline__header">
        <div className="legend row gap-12">
          <Legend color="var(--tick)" label="Tick" />
          <Legend color="var(--event)" label="Event" />
          <Legend color="var(--function)" label="Function" />
          <Legend color="var(--command)" label="Commands" />
        </div>
        <span className="spacer" />
        <div className="row gap-6">
          <button onClick={() => zoom(-1)} title="Zoom in (smaller buckets)">−</button>
          <button onClick={() => zoom(1)} title="Zoom out (larger buckets)">+</button>
          <select value={bucketTicks} onChange={(e) => setBucket(Number(e.target.value))} title="Bucket size">
            {BUCKET_SIZES.map((b) => (
              <option key={b.label} value={b.ticks}>{b.label}</option>
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
        {empty ? (
          <EmptyState connection={connection} />
        ) : (
          <div className="buckets" style={{ width: totalWidth, minWidth: totalWidth }}>
            {/* Offset spacer so virtualized columns align with their true scroll position. */}
            <div style={{ position: "absolute", left: 0, top: 0, height: 0, width: colStart }} aria-hidden />
            <BucketHeaderRow
              buckets={visibleSlice}
              bucketTicks={bucketTicks}
              currentBucketKey={currentBucketKey}
              offset={colStart}
            />
            <TickLane buckets={visibleSlice} hideIdle={filters.hideIdleTicks} enabled={filters.tick} currentBucketKey={currentBucketKey} offset={colStart} />
            <EventLane
              buckets={visibleSlice}
              onSelect={selectEventGroup}
              onZoom={(r) => zoomToTick(recordTick(r))}
              highlightIds={highlightIds}
              currentBucketKey={currentBucketKey}
              offset={colStart}
            />
            <FunctionLane
              buckets={visibleSlice}
              enabled={filters.function}
              onSelectRecord={(r) => setSelection({ kind: "record", id: r.id })}
              onSelectCall={(fcid) => setSelection({ kind: "functionCall", functionCallId: fcid })}
              onZoom={(r) => zoomToTick(recordTick(r))}
              selection={selection}
              highlightIds={highlightIds}
              currentBucketKey={currentBucketKey}
              offset={colStart}
            />
            <CommandLane
              buckets={visibleSlice}
              onSelect={(r) => setSelection({ kind: "record", id: r.id })}
              onZoom={(r) => zoomToTick(recordTick(r))}
              selection={selection}
              highlightIds={highlightIds}
              currentBucketKey={currentBucketKey}
              offset={colStart}
            />
            {filters.showTickCommands && (
              <TickCommandsLane
                bands={vm.tickFilterBands}
                viewMinTick={visibleBuckets[0]?.startTick ?? 0}
                viewMaxTick={visibleBuckets[visibleBuckets.length - 1]?.endTick ?? 0}
                offset={colStart}
                totalWidth={totalWidth}
                onSelectRecord={(id) => setSelection({ kind: "record", id })}
              />
            )}
          </div>
        )}
      </div>

      <Minimap
        buckets={vm.buckets}
        scrollState={scrollState}
      />
    </main>
  );
}

const DEFAULT_ZOOM_TICKS = 40; // ~2s

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
  bucketTicks,
  currentBucketKey,
  offset,
}: {
  buckets: TimelineBucket[];
  bucketTicks: number;
  currentBucketKey: string | undefined;
  offset: number;
}) {
  return (
    <div className="buckets__row buckets__row--header" style={{ paddingLeft: offset }}>
      <div className="bucket__label-spacer" />
      {buckets.map((b) => {
        const tick = b.records[0]?.basicFields.tick ?? b.records[0]?.detailedFields.tick;
        const label = tick ? `Tick ${tick}` : formatBucketHeader(b, bucketTicks);
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
  offset,
}: {
  buckets: TimelineBucket[];
  hideIdle: boolean;
  enabled: boolean;
  currentBucketKey: string | undefined;
  offset: number;
}) {
  return (
    <div className="lane lane--tick">
      <LaneLabel icon="⏱" title="TICK" subtitle="Main Game Loop" />
      <div className="lane__grid" style={{ paddingLeft: offset }}>
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

function EventLane({
  buckets,
  onSelect,
  onZoom,
  highlightIds,
  currentBucketKey,
  offset,
}: {
  buckets: TimelineBucket[];
  onSelect: (r: TraceRecord, events: TraceRecord[], label: string) => void;
  onZoom: (r: TraceRecord) => void;
  highlightIds: Set<number>;
  currentBucketKey: string | undefined;
  offset: number;
}) {
  return (
    <div className="lane lane--event">
      <LaneLabel icon="◆" title="EVENT" subtitle="Triggered Events" />
      <div className="lane__grid" style={{ paddingLeft: offset }}>
        {buckets.map((b) => {
          const evs = b.events;
          const currentClass = b.key === currentBucketKey ? " lane__cell--current" : "";
          if (evs.length === 0) return <div key={b.key} className={"lane__cell" + currentClass} />;
          const lead = pickLead(evs);
          const extras = evs.length - 1;
          const label = effectiveAction(lead) || lead.subject;
          return (
            <div key={b.key} className={"lane__cell lane__cell--event" + currentClass}>
              <button
                className={"event-pill" + (highlightIds.has(lead.id) ? " is-highlight" : "")}
                onClick={() => onSelect(lead, evs, label)}
                onDoubleClick={() => { onSelect(lead, evs, label); onZoom(lead); }}
                title={`${label}${extras > 0 ? ` +${extras}` : ""} (dbl-click to zoom)`}
              >
                <span className="event-pill__icon">◆</span>
                <span className="event-pill__label">{label}</span>
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
  onZoom,
  selection,
  highlightIds,
  currentBucketKey,
  offset,
}: {
  buckets: TimelineBucket[];
  enabled: boolean;
  onSelectRecord: (r: TraceRecord) => void;
  onSelectCall: (fcid: string) => void;
  onZoom: (r: TraceRecord) => void;
  selection: ReturnType<typeof useTraceStore.getState>["selection"];
  highlightIds: Set<number>;
  currentBucketKey: string | undefined;
  offset: number;
}) {
  // Per-bucket expansion of the +N function-calls cap (B1). Keyed by bucket key so each cell
  // expands independently.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <div className="lane lane--function">
      <LaneLabel icon="📦" title="FUNCTION" subtitle="Function Calls" />
      <div className="lane__grid" style={{ paddingLeft: offset }}>
        {buckets.map((b) => {
          const currentClass = b.key === currentBucketKey ? " lane__cell--current" : "";
          if (!enabled) return <div key={b.key} className={"lane__cell" + currentClass} />;
          const calls = Array.from(b.byFunctionCallId.entries());
          if (calls.length === 0) return <div key={b.key} className={"lane__cell" + currentClass} />;
          const isExpanded = expanded.has(b.key);
          const CAP = 8;
          const visibleCalls = isExpanded ? calls : calls.slice(0, CAP);
          const hiddenCalls = calls.length - (isExpanded ? 0 : visibleCalls.length);
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
                    cmds={cmds}
                    events={evs}
                    selected={selected}
                    dim={Boolean(dim)}
                    onClick={() => onSelectCall(fcid)}
                    onDoubleClick={() => { onSelectRecord(recs[0]); onZoom(recs[0]); }}
                  />
                );
              })}
              {hiddenCalls > 0 && (
                <button className="bucket-more" onClick={() => toggle(b.key)}>
                  +{hiddenCalls} function calls {isExpanded ? "▲" : "▼"}
                </button>
              )}
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
  onZoom,
  selection,
  highlightIds,
  currentBucketKey,
  offset,
}: {
  buckets: TimelineBucket[];
  onSelect: (r: TraceRecord) => void;
  onZoom: (r: TraceRecord) => void;
  selection: ReturnType<typeof useTraceStore.getState>["selection"];
  highlightIds: Set<number>;
  currentBucketKey: string | undefined;
  offset: number;
}) {
  // Per-bucket expansion of the +N command-groups and +N-more-per-group caps (B1).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const toggleGroups = (k: string) => setExpandedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const toggleStack = (k: string) => setExpandedStacks((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <div className="lane lane--command">
      <LaneLabel icon="⌘" title="COMMANDS" subtitle="Executed Commands" />
      <div className="lane__grid" style={{ paddingLeft: offset }}>
        {buckets.map((b) => {
          const currentClass = b.key === currentBucketKey ? " lane__cell--current" : "";
          // Group commands by function call (docs :535).
          const groups = new Map<string, TraceRecord[]>();
          for (const c of b.commands) {
            const key = (c.commandContext.functionCallId && c.commandContext.functionCallId !== "none")
              ? c.commandContext.functionCallId
              : c.commandContext.function || "_";
            const arr = groups.get(key) ?? [];
            arr.push(c);
            groups.set(key, arr);
          }
          if (groups.size === 0) return <div key={b.key} className={"lane__cell" + currentClass} />;
          const groupEntries = Array.from(groups.entries());
          const groupsExpanded = expandedGroups.has(b.key);
          const GROUP_CAP = 8;
          const visibleGroups = groupsExpanded ? groupEntries : groupEntries.slice(0, GROUP_CAP);
          const hiddenGroups = groupEntries.length - (groupsExpanded ? 0 : visibleGroups.length);
          return (
            <div key={b.key} className={"lane__cell lane__cell--command" + currentClass}>
              {visibleGroups.map(([key, cmds]) => {
                const stackKey = `${b.key}:${key}`;
                const stackExpanded = expandedStacks.has(stackKey);
                const CMD_CAP = 12;
                const visible = stackExpanded ? cmds : cmds.slice(0, CMD_CAP);
                const rest = cmds.length - (stackExpanded ? 0 : visible.length);
                return (
                  <div key={key} className="cmdstack">
                    {visible.map((c, i) => {
                      const seq = c.basicFields.sequence ?? String(i + 1);
                      const selected = selection?.kind === "record" && selection.id === c.id;
                      const dim = !selected && highlightIds.size > 0 && !highlightIds.has(c.id);
                      return (
                        <div
                          key={c.id}
                          className={"cmdrow" + (selected ? " is-selected" : "") + (dim ? " is-dim" : "")}
                          onClick={() => onSelect(c)}
                          onDoubleClick={() => { onSelect(c); onZoom(c); }}
                          tabIndex={0}
                          role="button"
                          onKeyDown={(e) => {
                            if (e.key === " " || e.key === "Enter") { e.preventDefault(); onSelect(c); }
                          }}
                        >
                          <span className="cmdrow__seq mono">{seq}</span>
                          <span className="cmdrow__text mono">{c.commandContext.command || c.subject}</span>
                        </div>
                      );
                    })}
                    {rest > 0 && (
                      <button className="cmdrow cmdrow--more" onClick={() => toggleStack(stackKey)}>
                        +{rest} more {stackExpanded ? "▲" : "▼"}
                      </button>
                    )}
                  </div>
                );
              })}
              {hiddenGroups > 0 && (
                <button className="bucket-more" onClick={() => toggleGroups(b.key)}>
                  +{hiddenGroups} command groups {groupsExpanded ? "▲" : "▼"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// TICK COMMANDS lane — audio-track style. Each high-frequency command group is a red horizontal
// bar spanning its active tick range, stacked vertically like clips in a video editor's track.
// Unlike the other lanes this is NOT bucket-cell based: it uses absolute positioning over a
// continuous track so bars can span multiple buckets. Bands are never hidden from other lanes;
// this lane is a dedicated overview of spammy commands.
function TickCommandsLane({
  bands,
  viewMinTick,
  viewMaxTick,
  offset,
  totalWidth,
  onSelectRecord,
}: {
  bands: TickFilterBand[];
  viewMinTick: number;
  viewMaxTick: number;
  offset: number;
  totalWidth: number;
  onSelectRecord: (id: number) => void;
}) {
  // Map band tick coordinates to percentages of the visible span. The container is offset by
  // `offset` (the virtualized scroll position) so bars align with the other lanes' columns.
  const span = viewMaxTick - viewMinTick || 1;
  const ROW_HEIGHT = 14;
  const MAX_ROWS = 8;
  const visibleBands = bands.filter((b) => b.endMillis >= viewMinTick && b.startMillis <= viewMaxTick).slice(0, MAX_ROWS);
  const hiddenCount = bands.length - visibleBands.length;

  return (
    <div className="lane lane--tick-commands">
      <LaneLabel icon="!" title="TICK COMMANDS" subtitle="High-Frequency Spam" />
      <div
        className="lane__grid lane__grid--continuous"
        style={{ paddingLeft: offset, width: totalWidth, minWidth: totalWidth, minHeight: visibleBands.length * ROW_HEIGHT + 8 }}
      >
        {visibleBands.map((band, i) => {
          const leftPct = ((band.startMillis - viewMinTick) / span) * 100;
          const widthPct = Math.max(1.5, ((band.endMillis - band.startMillis) / span) * 100);
          const firstId = band.recordIds.values().next().value;
          return (
            <div
              key={band.key}
              className="tick-cmd-bar"
              style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: i * ROW_HEIGHT + 4 }}
              title={`${band.displayName} | ${band.countPerSecond}/s, total ${band.totalCount}`}
              onClick={() => { if (firstId !== undefined) onSelectRecord(firstId); }}
            >
              <span className="tick-cmd-bar__label">{band.displayName}</span>
              <span className="tick-cmd-bar__rate">{band.countPerSecond}/s</span>
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <div className="tick-cmd-more" style={{ top: visibleBands.length * ROW_HEIGHT + 4 }}>
            +{hiddenCount} more spam groups
          </div>
        )}
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
  scrollState,
}: {
  buckets: TimelineBucket[];
  scrollState: { scrollLeft: number; scrollWidth: number; clientWidth: number };
}) {
  if (buckets.length === 0) return <div className="minimap minimap--empty" />;
  const min = buckets[0].startTick;
  const max = buckets[buckets.length - 1].endTick;
  const span = max - min || 1;

  const ticks = buckets.map((b) => ({
    h: b.records.length,
    e: b.events.length,
    fn: b.byFunctionCallId.size,
    c: b.commands.length,
    s: b.startTick,
    e2: b.endTick,
  }));
  const maxH = Math.max(1, ...ticks.map((t) => t.h));

  // Viewport rectangle follows the native horizontal scrollbar of the timeline grid. The minimap
  // is read-only (no drag/paging) — issue #1 of the second round asked to remove those controls
  // and rely on the browser's native scrollbar instead. left/width are clamped to [0,100]%.
  const sw = scrollState.scrollWidth || 1;
  const leftPct = Math.max(0, Math.min(100, (scrollState.scrollLeft / sw) * 100));
  const widthPct = Math.max(2, Math.min(100 - leftPct, (scrollState.clientWidth / sw) * 100));

  return (
    <div className="minimap">
      <div className="minimap__body">
        <div className="minimap__rows">
          {(["t", "e", "f", "c"] as const).map((k) => (
            <div key={k} className="minimap__row">
              {ticks.map((b, i) => {
                const v = k === "t" ? b.h : k === "e" ? b.e : k === "f" ? b.fn : b.c;
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
        <div className="minimap__track">
          <div
            className="minimap__viewport"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ connection }: { connection: string }) {
  if (connection === "disconnected") {
    return (
      <div className="timeline__empty">
        <div style={{ fontSize: 14, marginBottom: 6 }}>Cannot connect to VisibleFunction export server.</div>
        <div className="muted" style={{ fontSize: 12 }}>
          Run <code>/visiblefunction export start</code> in Minecraft.
        </div>
      </div>
    );
  }
  return (
    <div className="timeline__empty">
      <div style={{ fontSize: 14, marginBottom: 6 }}>No trace records yet.</div>
      <div className="muted" style={{ fontSize: 12 }}>Start a recording or run datapack commands in-game.</div>
    </div>
  );
}

// Priority order uses REAL backend action names only (docs :488-496 listed some fictional names
// like result_event that do not exist in the Java formatters). Comparison is against
// effectiveAction() — which reads basicFields.event_action — not the buggy r.eventAction.
const EVENT_PRIORITY = [
  "storage_modified",
  "scoreboard_score_set",
  "item_given",
  "entity_killed",
  "effect_applied",
  "entity_teleported",
  "tag_added",
];

function pickLead(events: TraceRecord[]): TraceRecord {
  for (const p of EVENT_PRIORITY) {
    const hit = events.find((e) => effectiveAction(e) === p);
    if (hit) return hit;
  }
  return events[0];
}
