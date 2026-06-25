import { useMemo, useState, useRef, useEffect } from 'react';
import type { TraceRecord } from '../api/types';
import { hasFunction, isTickFunction } from '../api/types';
import { useTraceStore } from '../store/traceStore';
import styles from './Timeline.module.css';

const TICK_MS = 50;
const BUFFER_TICKS_DEFAULT = 200;

type Lane = 'commands' | 'events' | 'functions' | 'tick';

const LANE_LABELS: Record<Lane, string> = {
  commands: 'CMD',
  events: 'EVT',
  functions: 'FN',
  tick: 'TICK',
};

const LANE_COLORS: Record<Lane, string> = {
  commands: 'var(--vf-command-fg)',
  events: 'var(--vf-event-fg)',
  functions: 'var(--vf-function-fg)',
  tick: 'var(--vf-tick-line)',
};

interface TimelineBucket {
  tick: number;
  records: TraceRecord[];
  byLane: Record<Lane, TraceRecord[]>;
}

interface TimelineTarget {
  lane: Lane;
  bucket: TimelineBucket;
  tickTrack: number;
}

export function Timeline() {
  const records = useTraceStore((s) => s.records);
  const selectRecord = useTraceStore((s) => s.selectRecord);
  const paused = useTraceStore((s) => s.paused);
  const togglePaused = useTraceStore((s) => s.togglePaused);
  const [bufferTicks, setBufferTicks] = useState(BUFFER_TICKS_DEFAULT);
  const [selection, setSelection] = useState<TimelineTarget | null>(null);
  const [now, setNow] = useState(Date.now());
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [paused]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(Date.now() - bufferTicks * TICK_MS, now - bufferTicks * TICK_MS);
  const effectiveStart = Math.min(start, now - bufferTicks * TICK_MS);

  const buckets = useMemo(() => {
    const map = new Map<number, TimelineBucket>();
    for (const record of records) {
      if (record.timestampMillis < effectiveStart || record.timestampMillis > now) continue;
      const tick = Math.floor(record.timestampMillis / TICK_MS);
      let bucket = map.get(tick);
      if (!bucket) {
        bucket = { tick, records: [], byLane: { commands: [], events: [], functions: [], tick: [] } };
        map.set(tick, bucket);
      }
      bucket.records.push(record);
      const tickFiltered = isTickFunction(record.commandContext.function);
      if (tickFiltered) {
        bucket.byLane.tick.push(record);
      } else {
        if (record.type === 'COMMAND') bucket.byLane.commands.push(record);
        if (record.type === 'EVENT') bucket.byLane.events.push(record);
        if (hasFunction(record)) bucket.byLane.functions.push(record);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.tick - b.tick);
  }, [records, effectiveStart, now]);

  const targets = useMemo(() => buildTargets(buckets), [buckets]);

  const axisWidth = Math.max(100, width - 90);
  const axisX = 80;
  const span = Math.max(1, now - effectiveStart);

  const handleBucketClick = (target: TimelineTarget) => {
    setSelection(target);
    const recs = target.bucket.byLane[target.lane];
    if (recs.length > 0) {
      selectRecord(recs[recs.length - 1].id);
    }
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.header}>
        <span className={styles.title}>TIMELINE</span>
        <span className={styles.bufferLabel}>buffer {bufferTicks}t{paused ? ' | paused' : ''}</span>
        <div className={styles.bufferControls}>
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => setBufferTicks((b) => Math.max(20, b - 40))}
          >
            -40t
          </button>
          <button
            type="button"
            className={styles.smallBtn}
            onClick={() => setBufferTicks((b) => Math.min(1200, b + 40))}
          >
            +40t
          </button>
        </div>
        <button type="button" className={styles.pauseBtn} onClick={togglePaused}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      <div className={styles.lanes} style={{ position: 'relative', height: '88px' }}>
        {(Object.keys(LANE_LABELS) as Lane[]).map((lane) => (
          <div key={lane} className={styles.lane}>
            <span className={styles.laneLabel} style={{ color: LANE_COLORS[lane] }}>{LANE_LABELS[lane]}</span>
            <div className={styles.laneLine} />
          </div>
        ))}
        {targets.map((target) => (
          <TimelineMarker
            key={`${target.lane}-${target.bucket.tick}-${target.tickTrack}`}
            target={target}
            axisX={axisX}
            axisWidth={axisWidth}
            effectiveStart={effectiveStart}
            span={span}
            laneIndex={laneOrder[target.lane]}
            selected={selection?.lane === target.lane && selection?.bucket.tick === target.bucket.tick}
            onClick={() => handleBucketClick(target)}
          />
        ))}
      </div>
      <div className={styles.footer}>
        {selection ? (
          <span className={styles.selectionInfo}>
            {selection.bucket.byLane[selection.lane].length} {summaryNoun(selection.lane, selection.bucket.byLane[selection.lane].length)} @ tick {selection.bucket.tick}
          </span>
        ) : (
          <span className={styles.hint}>click a marker to inspect; bucket = 1 tick (50ms)</span>
        )}
      </div>
    </div>
  );
}

const laneOrder: Record<Lane, number> = { commands: 0, events: 1, functions: 2, tick: 3 };

function buildTargets(buckets: TimelineBucket[]): TimelineTarget[] {
  const targets: TimelineTarget[] = [];
  const tickTracks = new Map<string, number>();
  for (const bucket of buckets) {
    (Object.keys(bucket.byLane) as Lane[]).forEach((lane) => {
      if (bucket.byLane[lane].length === 0) return;
      let track = 0;
      if (lane === 'tick') {
        const key = tickTrackKey(bucket);
        const existing = tickTracks.get(key);
        if (existing != null) {
          track = existing;
        } else {
          track = tickTracks.size % 6;
          tickTracks.set(key, track);
        }
      }
      targets.push({ lane, bucket, tickTrack: track });
    });
  }
  return targets;
}

function tickTrackKey(bucket: TimelineBucket): string {
  const rec = bucket.records[0];
  if (rec && isTickFunction(rec.commandContext.function)) {
    return 'FN:' + rec.commandContext.function;
  }
  return 'TICK:' + bucket.tick;
}

function summaryNoun(lane: Lane, count: number): string {
  const nouns: Record<Lane, [string, string]> = {
    commands: ['command', 'commands'],
    events: ['event', 'events'],
    functions: ['function', 'functions'],
    tick: ['filtered record', 'filtered records'],
  };
  return count === 1 ? nouns[lane][0] : nouns[lane][1];
}

interface TimelineMarkerProps {
  target: TimelineTarget;
  axisX: number;
  axisWidth: number;
  effectiveStart: number;
  span: number;
  laneIndex: number;
  selected: boolean;
  onClick: () => void;
}

function TimelineMarker({ target, axisX, axisWidth, effectiveStart, span, laneIndex, selected, onClick }: TimelineMarkerProps) {
  const ts = target.bucket.tick * TICK_MS;
  const clamped = Math.max(effectiveStart, Math.min(effectiveStart + span, ts));
  const x = axisX + ((clamped - effectiveStart) / span) * axisWidth;
  const laneTop = 8 + laneIndex * 20;
  const count = target.bucket.byLane[target.lane].length;
  const color = LANE_COLORS[target.lane];

  if (target.lane === 'tick') {
    const trackTop = laneTop + target.tickTrack * 3;
    return (
      <div
        className={`${styles.tickBar} ${selected ? styles.tickBarSelected : ''}`}
        style={{ left: `${x}px`, top: `${trackTop}px`, background: selected ? 'var(--vf-tick-selected)' : color }}
        onClick={onClick}
        title={`${count} filtered records @ tick ${target.bucket.tick}`}
      />
    );
  }

  if (count > 1) {
    const label = count > 99 ? '99+' : String(count);
    const labelWidth = Math.max(20, label.length * 7 + 8);
    return (
      <div
        className={`${styles.aggregate} ${selected ? styles.aggregateSelected : ''}`}
        style={{ left: `${x - labelWidth / 2}px`, top: `${laneTop - 4}px`, width: `${labelWidth}px`, borderColor: color, color }}
        onClick={onClick}
        title={`${count} ${summaryNoun(target.lane, count)} @ tick ${target.bucket.tick}`}
      >
        {label}
      </div>
    );
  }

  return (
    <div
      className={`${styles.marker} ${selected ? styles.markerSelected : ''}`}
      style={{ left: `${x - 2}px`, top: `${laneTop - 2}px`, background: selected ? 'var(--vf-accent-fg)' : color }}
      onClick={onClick}
      title={`${summaryNoun(target.lane, 1)} @ tick ${target.bucket.tick}`}
    />
  );
}
