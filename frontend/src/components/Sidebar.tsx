import { useEffect, useMemo, useState } from "react";
import { useTraceStore } from "../store/traceStore";
import { selectViewModel } from "../store/selectors";
import { QuickViewPresets, type QuickViewId } from "./quickViews";

export function Sidebar() {
  const records = useTraceStore((s) => s.records);
  const range = useTraceStore((s) => s.range);
  const viewRange = useTraceStore((s) => s.viewRange);
  const setRange = useTraceStore((s) => s.setRange);
  const filters = useTraceStore((s) => s.filters);
  const setFilters = useTraceStore((s) => s.setFilters);
  const indexes = useTraceStore((s) => s.indexes);
  const bucketMillis = useTraceStore((s) => s.bucketMillis);
  const serverTickFilterBands = useTraceStore((s) => s.serverTickFilterBands);

  const vm = useMemo(
    () => selectViewModel(records, indexes, filters, bucketMillis, serverTickFilterBands),
    [records, indexes, filters, bucketMillis, serverTickFilterBands]
  );

  const startedAt = records[0]?.timestampMillis;
  const lastAt = records[records.length - 1]?.timestampMillis;
  const durationMs = startedAt && lastAt ? lastAt - startedAt : 0;
  const minutes = Math.floor(durationMs / 60000).toString().padStart(2, "0");
  const seconds = Math.floor((durationMs % 60000) / 1000).toString().padStart(2, "0");

  return (
    <aside className="sidebar">
      <SessionPanel
        recordCount={records.length}
        startedAt={startedAt}
        duration={`${minutes}:${seconds}`}
        tickBuckets={vm.buckets.length}
      />
      <TickRangePanel
        min={range.min}
        max={range.max}
        viewMin={viewRange.min}
        viewMax={viewRange.max}
        onChange={setRange}
      />
      <FiltersPanel
        value={filters}
        onChange={setFilters}
      />
      <SearchPanel
        value={filters.search}
        onChange={(v) => setFilters({ search: v })}
      />
      <QuickViews
        onPick={(id: QuickViewId) => {
          const preset = QuickViewPresets.find((p) => p.id === id);
          if (!preset) return;
          setFilters({ search: preset.query });
        }}
      />
    </aside>
  );
}

function SessionPanel({
  recordCount,
  startedAt,
  duration,
  tickBuckets,
}: {
  recordCount: number;
  startedAt: number | undefined;
  duration: string;
  tickBuckets: number;
}) {
  return (
    <section className="panel">
      <h3 className="panel__title">
        <SectionIcon>📡</SectionIcon> SESSION
      </h3>
      <dl className="kv">
        <dt>World</dt>
        <dd className="mono">minecraft:overworld</dd>
        <dt>Records</dt>
        <dd className="mono">{recordCount.toLocaleString()}</dd>
        <dt>Started</dt>
        <dd className="mono">{startedAt ? formatTime(startedAt) : "—"}</dd>
        <dt>Duration</dt>
        <dd className="mono">{duration}</dd>
        <dt>Ticks Captured</dt>
        <dd className="mono">{tickBuckets > 0 ? tickBuckets.toLocaleString() : "not available"}</dd>
      </dl>
    </section>
  );
}

function TickRangePanel({
  min,
  max,
  viewMin,
  viewMax,
  onChange,
}: {
  min: number;
  max: number;
  viewMin: number;
  viewMax: number;
  onChange: (min: number, max: number) => void;
}) {
  const [minInput, setMinInput] = useState(String(viewMin || min));
  const [maxInput, setMaxInput] = useState(String(viewMax || max));
  const span = max - min || 1;

  useEffect(() => {
    if (min && viewMin !== Number(minInput)) setMinInput(String(viewMin || min));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMin]);
  useEffect(() => {
    if (max && viewMax !== Number(maxInput)) setMaxInput(String(viewMax || max));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMax]);

  return (
    <section className="panel">
      <h3 className="panel__title">
        <SectionIcon>⏱</SectionIcon> TIME RANGE
      </h3>
      <div className="row gap-6">
        <input
          className="mono"
          style={{ width: 88 }}
          value={minInput}
          onChange={(e) => setMinInput(e.target.value)}
          onBlur={() => {
            const v = Number(minInput);
            if (Number.isFinite(v)) onChange(v, viewMax || max);
          }}
        />
        <span className="muted">to</span>
        <input
          className="mono"
          style={{ width: 88 }}
          value={maxInput}
          onChange={(e) => setMaxInput(e.target.value)}
          onBlur={() => {
            const v = Number(maxInput);
            if (Number.isFinite(v)) onChange(viewMin || min, v);
          }}
        />
      </div>
      <div className="range">
        <div className="range__track" />
        <div
          className="range__fill"
          style={{
            left: `${((viewMin - min) / span) * 100}%`,
            right: `${100 - ((viewMax - min) / span) * 100}%`,
          }}
        />
        <div className="range__labels muted mono">
          <span>{min || 0}</span>
          <span>{max || 0}</span>
        </div>
      </div>
    </section>
  );
}

function FiltersPanel({
  value,
  onChange,
}: {
  value: ReturnType<typeof useTraceStore.getState>["filters"];
  onChange: (patch: Partial<typeof value>) => void;
}) {
  const rows: { key: keyof typeof value; label: string; color: string }[] = [
    { key: "tick", label: "Tick", color: "var(--tick)" },
    { key: "event", label: "Event", color: "var(--event)" },
    { key: "function", label: "Function", color: "var(--function)" },
    { key: "command", label: "Commands", color: "var(--command)" },
  ];
  return (
    <section className="panel">
      <h3 className="panel__title">
        <SectionIcon>🧪</SectionIcon> FILTERS
      </h3>
      <div className="filters">
        {rows.map((r) => (
          <label key={r.key} className="filter-row">
            <span className="dot" style={{ background: r.color }} />
            <span style={{ flex: 1 }}>{r.label}</span>
            <Switch
              checked={Boolean(value[r.key])}
              onChange={(v) => onChange({ [r.key]: v } as Partial<typeof value>)}
            />
          </label>
        ))}
        <label className="filter-row">
          <span className="muted">👁</span>
          <span style={{ flex: 1 }}>Hide Idle Ticks</span>
          <Switch
            checked={value.hideIdleTicks}
            onChange={(v) => onChange({ hideIdleTicks: v })}
          />
        </label>
      </div>
    </section>
  );
}

function SearchPanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <section className="panel">
      <h3 className="panel__title">
        <SectionIcon>🔍</SectionIcon> SEARCH
      </h3>
      <div className="search">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search functions, events, commands…"
          style={{ width: "100%" }}
        />
        <span className="search__hint mono">Ctrl K</span>
      </div>
    </section>
  );
}

function QuickViews({ onPick }: { onPick: (id: QuickViewId) => void }) {
  return (
    <section className="panel">
      <h3 className="panel__title">
        <SectionIcon>✨</SectionIcon> QUICK VIEWS
      </h3>
      <div className="quickviews">
        {QuickViewPresets.map((q) => (
          <button key={q.id} className="quickview" onClick={() => onPick(q.id)}>
            <span className="quickview__icon">{q.icon}</span>
            <span>{q.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SectionIcon({ children }: { children: React.ReactNode }) {
  return <span className="panel__icon">{children}</span>;
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span
      className={"switch" + (checked ? " switch--on" : "")}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") onChange(!checked);
      }}
    >
      <span className="switch__knob" />
    </span>
  );
}

function formatTime(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour12: false });
}
