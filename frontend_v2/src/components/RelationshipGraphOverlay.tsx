import { useEffect, useMemo, useRef, useState } from "react";
import { useTraceStore } from "../store/traceStore";
import {
  buildRelationshipGraph,
  relationshipGraphJson,
  type RelationshipGraphModel,
  type RelationshipLane,
  type RelationshipNode,
} from "../store/relationshipGraph";
import { effectiveAction } from "../store/recordNorm";
import { recordTick } from "../store/traceTime";

const WIDE_STAGE_WIDTH = 1000;
const NARROW_STAGE_WIDTH = 560;
const NODE_WIDTH = 230;
const NODE_HEIGHT = 56;
const LANE_X: Record<RelationshipLane, number> = {
  event: 165,
  function: 500,
  command: 835,
};

export function RelationshipGraphOverlay() {
  const eventId = useTraceStore((s) => s.relationshipGraphEventId);
  const indexes = useTraceStore((s) => s.indexes);
  const close = useTraceStore((s) => s.closeRelationshipGraph);
  const setSelection = useTraceStore((s) => s.setSelection);
  const [compact, setCompact] = useState(false);
  const [narrow, setNarrow] = useState(() => (typeof window === "undefined" ? false : window.innerWidth < 760));
  const scrollRef = useRef<HTMLDivElement>(null);

  const model = useMemo(
    () => (eventId == null ? null : buildRelationshipGraph(eventId, indexes)),
    [eventId, indexes]
  );

  useEffect(() => {
    if (eventId != null && !model) {
      close();
    }
  }, [close, eventId, model]);

  useEffect(() => {
    function onResize() {
      setNarrow(window.innerWidth < 760);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const layout = useMemo(() => (model ? layoutNodes(model.nodes, compact, narrow) : null), [compact, model, narrow]);

  if (eventId == null || !model || !layout) {
    return null;
  }

  const json = relationshipGraphJson(model);

  function selectNode(node: RelationshipNode) {
    if (node.recordId != null) {
      setSelection({ kind: "record", id: node.recordId });
    } else if (node.functionCallId) {
      setSelection({ kind: "functionCall", functionCallId: node.functionCallId });
    }
  }

  function fitGraph() {
    const scroller = scrollRef.current;
    if (!scroller || !layout) return;
    scroller.scrollTo({
      left: Math.max(0, (layout.width - scroller.clientWidth) / 2),
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <div className="relationship-modal" role="dialog" aria-modal="true" aria-label="Event Relationship Graph" onMouseDown={close}>
      <section className="relationship-modal__panel" onMouseDown={(e) => e.stopPropagation()}>
        <header className="relationship-modal__header">
          <div className="relationship-modal__heading">
            <div className="relationship-modal__eyebrow">EVENT RELATIONSHIP GRAPH</div>
            <div className="relationship-modal__title">
              <span className="relationship-modal__event-dot" />
              <span className="relationship-modal__title-text">{effectiveAction(model.selectedEvent) || model.selectedEvent.subject}</span>
              <span className="relationship-modal__record mono">#{model.selectedEvent.id}</span>
            </div>
          </div>
          <span className="spacer" />
          <div className="relationship-modal__actions">
            <button onClick={fitGraph} title="Fit graph">Fit</button>
            <button onClick={() => setCompact((value) => !value)} title="Toggle compact layout">
              {compact ? "Compact" : "Expanded"}
            </button>
            <button onClick={() => copyText(json)} title="Copy graph JSON">Copy JSON</button>
            <button className="relationship-modal__close" onClick={close} title="Close" aria-label="Close relationship graph">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="relationship-modal__body">
          <div className="relationship-graph" ref={scrollRef}>
            <div className="relationship-graph__stage" style={{ width: layout.width, height: layout.height }}>
              <div className="relationship-graph__lane-label relationship-graph__lane-label--event" style={layout.laneLabels.event}>EVENT</div>
              <div className="relationship-graph__lane-label relationship-graph__lane-label--function" style={layout.laneLabels.function}>FUNCTION</div>
              <div className="relationship-graph__lane-label relationship-graph__lane-label--command" style={layout.laneLabels.command}>COMMANDS</div>
              <svg className="relationship-graph__edges" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden>
                <defs>
                  <marker id="relationship-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {model.edges.map((edge) => {
                  const from = layout.positions.get(edge.from);
                  const to = layout.positions.get(edge.to);
                  if (!from || !to) return null;
                  const edgeLine = edgeGeometry(from, to, layout.orientation);
                  return (
                    <g key={edge.id} className={"relationship-edge" + (edge.dashed ? " relationship-edge--dashed" : "")}>
                      <path d={edgePath(edgeLine.x1, edgeLine.y1, edgeLine.x2, edgeLine.y2, layout.orientation)} markerEnd="url(#relationship-arrow)" />
                      <text x={edgeLine.labelX} y={edgeLine.labelY} textAnchor="middle">{narrow ? compactEdgeLabel(edge.label) : edge.label}</text>
                    </g>
                  );
                })}
              </svg>

              {model.nodes.map((node) => {
                const pos = layout.positions.get(node.id);
                if (!pos) return null;
                const clickable = node.recordId != null || Boolean(node.functionCallId);
                return (
                  <button
                    key={node.id}
                    className={[
                      "relationship-node",
                      `relationship-node--${node.kind}`,
                      `relationship-node--${node.lane}`,
                      node.emphasized ? "is-emphasized" : "",
                      node.missing ? "is-missing" : "",
                    ].filter(Boolean).join(" ")}
                    style={{ left: pos.x - NODE_WIDTH / 2, top: pos.y - NODE_HEIGHT / 2 }}
                    disabled={!clickable}
                    onClick={() => selectNode(node)}
                    title={node.label}
                  >
                    <span className="relationship-node__kind">{nodeLabel(node)}</span>
                    <span className="relationship-node__label mono">{node.label}</span>
                    <span className="relationship-node__meta">{node.meta}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <RelationshipInspector model={model} onSelectRecord={(id) => setSelection({ kind: "record", id })} />
        </div>
      </section>
    </div>
  );
}

function RelationshipInspector({
  model,
  onSelectRecord,
}: {
  model: RelationshipGraphModel;
  onSelectRecord: (id: number) => void;
}) {
  const selected = model.selectedEvent;
  const related = uniqueIds([
    ...model.sameCommandEvents.map((record) => record.id),
    ...model.functionCallRecords.map((record) => record.id),
    ...(model.sourceCommand ? [model.sourceCommand.id] : []),
  ]).filter((id) => id !== selected.id);

  return (
    <aside className="relationship-inspector">
      <div className="relationship-inspector__title">Selected Event</div>
      <div className="relationship-inspector__kv">
        <span>Tick</span><strong className="mono">{recordTick(selected)}</strong>
        <span>Event Action</span><strong className="mono">{effectiveAction(selected) || "-"}</strong>
        <span>Function</span><strong className="mono">{selected.commandContext.function || "-"}</strong>
        <span>Command ID</span><strong className="mono">{selected.commandContext.commandId || "-"}</strong>
        <span>Function Call ID</span><strong className="mono">{selected.commandContext.functionCallId || "-"}</strong>
        <span>Source</span><strong className="mono">{selected.commandContext.source || "-"}</strong>
      </div>

      <div className="relationship-inspector__stats">
        <Stat label="Same command events" value={model.sameCommandEvents.length} />
        <Stat label="Function call records" value={model.functionCallRecords.length} />
        <Stat label="Commands" value={model.commandRecords.length} />
        <Stat label="Rendered nodes" value={model.nodes.length} />
      </div>

      {model.missingLinks.length > 0 && (
        <div className="relationship-inspector__missing">
          {model.missingLinks.map((link) => (
            <div key={link}>{link}</div>
          ))}
        </div>
      )}

      <div className="relationship-inspector__title">Related Records</div>
      <div className="relationship-inspector__records">
        {related.slice(0, 40).map((id) => (
          <button key={id} className="relationship-inspector__record mono" onClick={() => onSelectRecord(id)}>
            #{id}
          </button>
        ))}
        {related.length > 40 && (
          <div className="relationship-inspector__more">+{related.length - 40} more</div>
        )}
      </div>
    </aside>
  );
}

function layoutNodes(nodes: RelationshipNode[], compact: boolean, narrow: boolean): {
  width: number;
  height: number;
  orientation: "horizontal" | "vertical";
  positions: Map<string, { x: number; y: number }>;
  laneLabels: Record<RelationshipLane, { left: number; top: number }>;
} {
  const gap = compact ? 58 : 76;
  const width = narrow ? NARROW_STAGE_WIDTH : WIDE_STAGE_WIDTH;
  const positions = new Map<string, { x: number; y: number }>();

  if (!narrow) {
    const top = 118;
    let height = 520;
    for (const lane of ["event", "function", "command"] as const) {
      const laneNodes = nodes.filter((node) => node.lane === lane);
      for (let index = 0; index < laneNodes.length; index++) {
        const y = top + index * gap;
        positions.set(laneNodes[index].id, { x: LANE_X[lane], y });
        height = Math.max(height, y + 90);
      }
    }
    return {
      width,
      height,
      orientation: "horizontal",
      positions,
      laneLabels: {
        event: { left: LANE_X.event, top: 18 },
        function: { left: LANE_X.function, top: 18 },
        command: { left: LANE_X.command, top: 18 },
      },
    };
  }

  const center = width / 2;
  const laneLabels = {} as Record<RelationshipLane, { left: number; top: number }>;
  let cursor = 88;
  for (const lane of ["event", "function", "command"] as const) {
    const laneNodes = nodes.filter((node) => node.lane === lane);
    laneLabels[lane] = { left: center, top: Math.max(16, cursor - 62) };
    for (let index = 0; index < laneNodes.length; index++) {
      positions.set(laneNodes[index].id, { x: center, y: cursor + index * gap });
    }
    cursor += Math.max(1, laneNodes.length) * gap + 86;
  }

  return {
    width,
    height: Math.max(520, cursor - 26),
    orientation: "vertical",
    positions,
    laneLabels,
  };
}

function edgeGeometry(
  from: { x: number; y: number },
  to: { x: number; y: number },
  orientation: "horizontal" | "vertical"
): { x1: number; y1: number; x2: number; y2: number; labelX: number; labelY: number } {
  if (orientation === "vertical") {
    const skipsLane = Math.abs(to.y - from.y) > 130 && Math.abs(to.x - from.x) < 24;
    if (skipsLane) {
      const x1 = from.x + NODE_WIDTH / 2;
      const y1 = from.y;
      const x2 = to.x + NODE_WIDTH / 2;
      const y2 = to.y;
      return { x1, y1, x2, y2, labelX: x1 + 48, labelY: (y1 + y2) / 2 };
    }
    const downward = from.y <= to.y;
    const x1 = from.x;
    const y1 = from.y + (downward ? NODE_HEIGHT / 2 : -NODE_HEIGHT / 2);
    const x2 = to.x;
    const y2 = to.y + (downward ? -NODE_HEIGHT / 2 : NODE_HEIGHT / 2);
    return { x1, y1, x2, y2, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 - 8 };
  }

  const leftToRight = from.x <= to.x;
  const x1 = from.x + (leftToRight ? NODE_WIDTH / 2 : -NODE_WIDTH / 2);
  const y1 = from.y;
  const x2 = to.x + (leftToRight ? -NODE_WIDTH / 2 : NODE_WIDTH / 2);
  const y2 = to.y;
  const skipsLane = Math.abs(x2 - x1) > 360 && Math.abs(y2 - y1) < 24;
  return { x1, y1, x2, y2, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 - (skipsLane ? 48 : 12) };
}

function edgePath(x1: number, y1: number, x2: number, y2: number, orientation: "horizontal" | "vertical"): string {
  if (orientation === "vertical") {
    if (Math.abs(y2 - y1) > 130 && Math.abs(x2 - x1) < 8) {
      const bowX = x1 + 42;
      return `M ${x1} ${y1} C ${bowX} ${y1}, ${bowX} ${y2}, ${x2} ${y2}`;
    }
    const curve = Math.max(44, Math.abs(y2 - y1) * 0.35);
    const c1 = y1 < y2 ? y1 + curve : y1 - curve;
    const c2 = y1 < y2 ? y2 - curve : y2 + curve;
    return `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
  }
  if (Math.abs(x2 - x1) > 360 && Math.abs(y2 - y1) < 24) {
    const lift = 68;
    const curve = Math.max(90, Math.abs(x2 - x1) * 0.28);
    const c1 = x1 < x2 ? x1 + curve : x1 - curve;
    const c2 = x1 < x2 ? x2 - curve : x2 + curve;
    return `M ${x1} ${y1} C ${c1} ${y1 - lift}, ${c2} ${y2 - lift}, ${x2} ${y2}`;
  }
  const curve = Math.max(56, Math.abs(x2 - x1) * 0.35);
  const c1 = x1 < x2 ? x1 + curve : x1 - curve;
  const c2 = x1 < x2 ? x2 - curve : x2 + curve;
  return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
}

function compactEdgeLabel(label: string): string {
  if (label === "same functionCallId") return "functionCallId";
  if (label === "same commandId") return "commandId";
  return label;
}

function nodeLabel(node: RelationshipNode): string {
  if (node.kind === "functionCall") return "FUNCTION";
  if (node.kind === "summary") return "SUMMARY";
  if (node.kind === "missing") return "MISSING";
  return node.kind.toUpperCase();
}

function uniqueIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort((a, b) => a - b);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="relationship-inspector__stat">
      <span>{label}</span>
      <strong className="mono">{value.toLocaleString()}</strong>
    </div>
  );
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    /* ignore */
  });
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
