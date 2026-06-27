import { useEffect, useState } from "react";
import { useTraceStore } from "../store/traceStore";
import { recordDimension } from "../store/recordNorm";
import { QuickViewPresets, type QuickViewId } from "./quickViews";

export function Sidebar() {
  const records = useTraceStore((s) => s.records);
  const stats = useTraceStore((s) => s.stats);
  const range = useTraceStore((s) => s.range);
  const viewRange = useTraceStore((s) => s.viewRange);
  const setRange = useTraceStore((s) => s.setRange);
  const filters = useTraceStore((s) => s.filters);
  const setFilters = useTraceStore((s) => s.setFilters);
  const mode = useTraceStore((s) => s.mode);
  const settings = useTraceStore((s) => s.settings);
  const setLiveRetention = useTraceStore((s) => s.setLiveRetention);
  const setLiveBuffer = useTraceStore((s) => s.setLiveBuffer);

  const world = records[0] ? recordDimension(records[0]) : "minecraft:overworld";
  const startedAt = stats.startedAtMillis;
  const lastAt = stats.lastAtMillis;
  const durationMs = startedAt && lastAt ? lastAt - startedAt : 0;
  const minutes = Math.floor(durationMs / 60000).toString().padStart(2, "0");
  const seconds = Math.floor((durationMs % 60000) / 1000).toString().padStart(2, "0");
  // "Ticks captured" = tick span of the dataset (doc :360), not bucket count.
  const tickSpan = stats.recordCount ? Math.max(0, Math.floor(range.max - range.min)) : 0;

  return (
    <aside className="sidebar">
      <SessionPanel
        world={world}
        recordCount={stats.recordCount}
        startedAt={startedAt}
        duration={`${minutes}:${seconds}`}
        tickSpan={tickSpan}
      />
      <TickRangePanel
        min={range.min}
        max={range.max}
        viewMin={viewRange.min}
        viewMax={viewRange.max}
        onChange={setRange}
      />
      {mode === "live" && (
        <LiveRetentionPanel
          retentionTicks={settings.liveRetentionTicks}
          bufferTicks={settings.liveBufferTicks}
          onRetentionChange={setLiveRetention}
          onBufferChange={setLiveBuffer}
        />
      )}
      <FiltersPanel value={filters} onChange={setFilters} />
      <SearchPanel value={filters.search} onChange={(v) => setFilters({ search: v })} />
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
  world,
  recordCount,
  startedAt,
  duration,
  tickSpan,
}: {
  world: string;
  recordCount: number;
  startedAt: number | undefined;
  duration: string;
  tickSpan: number;
}) {
  return (
    <section className="panel">
      <h3 className="panel__title"><SectionIcon>📡</SectionIcon> SESSION</h3>
      <dl className="kv">
        <dt>World</dt>
        <dd className="mono">{world}</dd>
        <dt>Records</dt>
        <dd className="mono">{recordCount.toLocaleString()}</dd>
        <dt>Started</dt>
        <dd className="mono">{startedAt ? formatTime(startedAt) : "—"}</dd>
        <dt>Duration</dt>
        <dd className="mono">{duration}</dd>
        <dt>Ticks Captured</dt>
        <dd className="mono">{tickSpan > 0 ? tickSpan.toLocaleString() : "not available"}</dd>
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
    const next = String(viewMin || min);
    if (next !== minInput) setMinInput(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMin, min]);
  useEffect(() => {
    const next = String(viewMax || max);
    if (next !== maxInput) setMaxInput(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMax, max]);

  return (
    <section className="panel">
      <h3 className="panel__title"><SectionIcon>⏱</SectionIcon> TICK RANGE</h3>
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

const LIVE_RETENTION_WARN_TICKS = 2400; // 120s total — warn beyond this

function LiveRetentionPanel({
  retentionTicks,
  bufferTicks,
  onRetentionChange,
  onBufferChange,
}: {
  retentionTicks: number;
  bufferTicks: number;
  onRetentionChange: (ticks: number) => void;
  onBufferChange: (ticks: number) => void;
}) {
  const total = retentionTicks + bufferTicks;
  const warn = total > LIVE_RETENTION_WARN_TICKS;
  const retSecs = (retentionTicks / 20).toFixed(1);
  const bufSecs = (bufferTicks / 20).toFixed(1);
  const totalSecs = (total / 20).toFixed(1);

  return (
    <section className="panel">
      <h3 className="panel__title"><SectionIcon>🖹</SectionIcon> LIVE RETENTION</h3>
      <div className="row gap-6" style={{ marginBottom: 6 }}>
        <label className="muted" style={{ fontSize: 11, flex: 1 }}>Visible</label>
        <input
          className="mono"
          style={{ width: 70 }}
          type="number"
          min={20}
          value={retentionTicks}
          onChange={(e) => onRetentionChange(Number(e.target.value))}
        />
        <span className="muted mono" style={{ fontSize: 11 }}>t ({retSecs}s)</span>
      </div>
      <div className="row gap-6" style={{ marginBottom: 6 }}>
        <label className="muted" style={{ fontSize: 11, flex: 1 }}>Buffer (hidden)</label>
        <input
          className="mono"
          style={{ width: 70 }}
          type="number"
          min={0}
          value={bufferTicks}
          onChange={(e) => onBufferChange(Number(e.target.value))}
        />
        <span className="muted mono" style={{ fontSize: 11 }}>t ({bufSecs}s)</span>
      </div>
      <div className="muted mono" style={{ fontSize: 11 }}>
        Total kept: {total}t ({totalSecs}s)
      </div>
      {warn && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--warn)", lineHeight: 1.4 }}>
          ⚠ Large retention windows increase memory use under high throughput. Consider staying under {LIVE_RETENTION_WARN_TICKS}t (120s).
        </div>
      )}
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
      <h3 className="panel__title"><SectionIcon>🧪</SectionIcon> FILTERS</h3>
      <div className="filters">
        {rows.map((r) => (
          <label key={r.key} className="filter-row">
            <span className="dot" style={{ background: r.color }} />
            <span style={{ flex: 1 }}>{r.label}</span>
            <Switch checked={Boolean(value[r.key])} onChange={(v) => onChange({ [r.key]: v } as Partial<typeof value>)} />
          </label>
        ))}
        <label className="filter-row">
          <span className="muted">👁</span>
          <span style={{ flex: 1 }}>Hide Idle Ticks</span>
          <Switch checked={value.hideIdleTicks} onChange={(v) => onChange({ hideIdleTicks: v })} />
        </label>
        <label className="filter-row" title="Show the TICK COMMANDS lane — high-frequency command spam rendered as red horizontal bars (audio-track style). On by default.">
          <span style={{ color: "var(--rec)" }}>≡</span>
          <span style={{ flex: 1 }}>Tick Commands Lane</span>
          <Switch checked={value.showTickCommands} onChange={(v) => onChange({ showTickCommands: v })} />
        </label>
        <label className="filter-row" title="Hide high-frequency spam records from the other lanes. Filtered records stay visible in the TICK COMMANDS lane. Off by default.">
          <span style={{ color: "var(--rec)" }}>⚠</span>
          <span style={{ flex: 1 }}>Tick Filter (hide spam)</span>
          <Switch checked={value.hideHighFreq} onChange={(v) => onChange({ hideHighFreq: v })} />
        </label>
      </div>
    </section>
  );
}

function SearchPanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <section className="panel">
      <h3 className="panel__title"><SectionIcon>🔍</SectionIcon> SEARCH</h3>
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
      <h3 className="panel__title"><SectionIcon>✨</SectionIcon> QUICK VIEWS</h3>
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
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <span className="switch__knob" />
    </span>
  );
}

function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour12: false });
}
