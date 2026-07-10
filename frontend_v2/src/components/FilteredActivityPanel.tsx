import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TickFilterBucketPayload } from "../api/types";
import { tickFilterBucketId, tickFilterGroupsFromPayload, type TickFilterGroup } from "../store/tickFilter";
import { useTraceStore } from "../store/traceStore";

type ActivityRow =
  | { kind: "group"; group: TickFilterGroup }
  | { kind: "child"; group: TickFilterGroup; bucket: TickFilterBucketPayload };

export function FilteredActivityPanel() {
  const buckets = useTraceStore((state) => state.tickFilterBuckets);
  const visible = useTraceStore((state) => state.filters.showFilteredActivity);
  const selection = useTraceStore((state) => state.selection);
  const setSelection = useTraceStore((state) => state.setSelection);
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const autoExpandedGroupRef = useRef<string | null>(null);

  const groups = useMemo(() => tickFilterGroupsFromPayload(buckets), [buckets]);
  const active = useMemo(() => groups.filter((group) => group.bucket.active), [groups]);
  const inactive = useMemo(() => groups.filter((group) => !group.bucket.active), [groups]);

  useEffect(() => {
    const group = active.length === 1 && active[0].children.length > 0 ? active[0] : null;
    if (group && autoExpandedGroupRef.current !== group.groupId) {
      autoExpandedGroupRef.current = group.groupId;
      setExpanded((current) => new Set(current).add(group.groupId));
    }
  }, [active]);

  const rows = useMemo(() => {
    const result: ActivityRow[] = [];
    for (const group of showInactive ? groups : active) {
      result.push({ kind: "group", group });
      if (expanded.has(group.groupId)) {
        for (const bucket of group.children) result.push({ kind: "child", group, bucket });
      }
    }
    return result;
  }, [active, expanded, groups, showInactive]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => rows[index]?.kind === "child" ? 30 : 42,
    overscan: 8,
  });

  if (!visible) return null;

  const activeRate = active.reduce((total, group) => total + group.bucket.countLastSecond, 0);
  return (
    <section className="filtered-activity" aria-label="Filtered activity">
      <div className="filtered-activity__header">
        <div>
          <div className="filtered-activity__title">FILTERED ACTIVITY</div>
          <div className="filtered-activity__subtitle">
            {active.length} active static TICK groups · {activeRate.toLocaleString()}/s hidden
          </div>
        </div>
        <button
          className={"filtered-activity__inactive" + (showInactive ? " is-active" : "")}
          onClick={() => setShowInactive((value) => !value)}
        >
          Inactive {inactive.length}
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="filtered-activity__empty">No statically identified TICK function.</div>
      ) : (
        <div className="filtered-activity__scroll" ref={scrollerRef}>
          <div className="filtered-activity__virtual" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return (
                <div
                  key={row.kind === "group" ? row.group.groupId : `${row.group.groupId}:${tickFilterBucketId(row.bucket)}`}
                  className="filtered-activity__virtual-row"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === "group" ? (
                    <GroupRow
                      group={row.group}
                      expanded={expanded.has(row.group.groupId)}
                      selected={selection?.kind === "tickFilterGroup" && selection.groupId === row.group.groupId}
                      onToggle={() => setExpanded((current) => toggleSetValue(current, row.group.groupId))}
                      onSelect={() => setSelection({ kind: "tickFilterGroup", groupId: row.group.groupId })}
                    />
                  ) : (
                    <ChildRow bucket={row.bucket} onSelect={() => setSelection({ kind: "tickFilterGroup", groupId: row.group.groupId })} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function GroupRow({
  group,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  group: TickFilterGroup;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const bucket = group.bucket;
  return (
    <div className={"filtered-group" + (selected ? " is-selected" : "")}>
      <button
        className="filtered-group__toggle"
        onClick={onToggle}
        disabled={group.children.length === 0}
        aria-label={expanded ? "Collapse filtered group" : "Expand filtered group"}
      >
        {group.children.length === 0 ? "·" : expanded ? "▾" : "▸"}
      </button>
      <button className="filtered-group__main" onClick={onSelect}>
        <span className="filtered-group__name mono">{bucket.displayName}</span>
        <span className="filtered-group__reason">{bucket.reason}</span>
        <span className={"filtered-group__state" + (bucket.active ? " is-active" : "")}>{bucket.active ? "active" : "inactive"}</span>
        <span className="filtered-group__children">{group.children.length} children</span>
        <strong className="filtered-group__rate mono">{bucket.countLastSecond.toLocaleString()}/s</strong>
        <span className="filtered-group__total mono">total {bucket.totalCount.toLocaleString()}</span>
      </button>
    </div>
  );
}

function ChildRow({ bucket, onSelect }: { bucket: TickFilterBucketPayload; onSelect: () => void }) {
  return (
    <button className="filtered-child" onClick={onSelect}>
      <span className="filtered-child__type">{bucket.type}</span>
      <span className="filtered-child__name mono">{bucket.displayName}</span>
      <strong className="filtered-child__rate mono">{bucket.countLastSecond.toLocaleString()}/s</strong>
    </button>
  );
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
