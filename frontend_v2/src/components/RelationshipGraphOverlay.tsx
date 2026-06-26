import { useEffect, useMemo, useRef, useState } from "react";
import { useTraceStore } from "../store/traceStore";
import {
  buildRelationshipGraph,
  relationshipGraphJson,
  type RelationshipEdge,
  type RelationshipGraphModel,
  type RelationshipLane,
  type RelationshipNode,
} from "../store/relationshipGraph";
import { recordTick } from "../store/traceTime";

const NODE_WIDTH = 250;
const NODE_HEIGHT = 64;
const COLUMN_GAP = 56;
const ROW_Y: Record<RelationshipLane, number> = {
  function: 108,
  command: 286,
  event: 464,
  eventRecord: 642,
};

export function RelationshipGraphOverlay() {
  const request = useTraceStore((s) => s.relationshipGraphRequest);
  const indexes = useTraceStore((s) => s.indexes);
  const close = useTraceStore((s) => s.closeRelationshipGraph);
  const setSelection = useTraceStore((s) => s.setSelection);
  const [compact, setCompact] = useState(false);
  const [expandedEventGroupIds, setExpandedEventGroupIds] = useState<Set<string>>(() => new Set());
  const [graphScale, setGraphScale] = useState(1);
  const [narrow, setNarrow] = useState(() => (typeof window === "undefined" ? false : window.innerWidth < 760));
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestKey = request == null ? "" : `${request.anchorEventId}:${request.eventIds.join(",")}`;

  const model = useMemo(
    () => (request == null ? null : buildRelationshipGraph(request, indexes)),
    [request, indexes]
  );

  useEffect(() => {
    if (request != null && !model) close();
  }, [close, model, request]);

  useEffect(() => {
    setExpandedEventGroupIds(new Set());
    setGraphScale(1);
  }, [requestKey]);

  useEffect(() => {
    function onResize() {
      setNarrow(window.innerWidth < 760);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const visibleGraph = useMemo(
    () => (model ? expandEventGroups(model, indexes, expandedEventGroupIds) : null),
    [expandedEventGroupIds, indexes, model]
  );
  const layout = useMemo(
    () => (visibleGraph ? layoutTree(visibleGraph, compact, narrow) : null),
    [compact, narrow, visibleGraph]
  );

  if (request == null || !model || !layout || !visibleGraph) return null;

  const json = relationshipGraphJson(model);
  const title = request.label || "Event group";

  function selectNode(node: RelationshipNode) {
    if (node.kind === "eventGroup") {
      setExpandedEventGroupIds((current) => {
        const next = new Set(current);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
    } else if (node.recordId != null) {
      setSelection({ kind: "record", id: node.recordId });
    } else if (node.functionCallId) {
      setSelection({ kind: "functionCall", functionCallId: node.functionCallId });
    }
  }

  function fitGraph() {
    const scroller = scrollRef.current;
    if (!scroller || !layout) return;
    const scaledWidth = layout.width * graphScale;
    scroller.scrollTo({
      left: Math.max(0, (scaledWidth - scroller.clientWidth) / 2),
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <div className="relationship-modal" role="dialog" aria-modal="true" aria-label="Event Relationship Graph" onMouseDown={close}>
      <section className="relationship-modal__panel" onMouseDown={(e) => e.stopPropagation()}>
        <header className="relationship-modal__header">
          <div className="relationship-modal__heading">
            <div className="relationship-modal__eyebrow">EVENT RELATIONSHIP TREE</div>
            <div className="relationship-modal__title">
              <span className="relationship-modal__event-dot" />
              <span className="relationship-modal__title-text">{title}</span>
              <span className="relationship-modal__record mono">{model.events.length} events</span>
            </div>
          </div>
          <span className="spacer" />
          <div className="relationship-modal__actions">
            <label className="relationship-modal__scale">
              <span>View Size</span>
              <input
                type="range"
                min="0.6"
                max="1.4"
                step="0.05"
                value={graphScale}
                onInput={(event) => setGraphScale(Number(event.currentTarget.value))}
                onChange={(event) => setGraphScale(Number(event.target.value))}
              />
              <strong className="mono">{Math.round(graphScale * 100)}%</strong>
            </label>
            <button onClick={fitGraph} title="Fit graph">Fit</button>
            {expandedEventGroupIds.size > 0 && (
              <button onClick={() => setExpandedEventGroupIds(new Set())} title="Collapse all event records">Collapse All</button>
            )}
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
            <div
              className="relationship-graph__scale-shell"
              style={{ width: layout.width * graphScale, height: layout.height * graphScale }}
            >
              <div
                className="relationship-graph__stage"
                style={{ width: layout.width, height: layout.height, transform: `scale(${graphScale})` }}
              >
                <div className="relationship-graph__lane-label relationship-graph__lane-label--function" style={layout.laneLabels.function}>FUNCTION</div>
                <div className="relationship-graph__lane-label relationship-graph__lane-label--command" style={layout.laneLabels.command}>COMMAND</div>
                <div className="relationship-graph__lane-label relationship-graph__lane-label--event" style={layout.laneLabels.event}>EVENT GROUP</div>
                {layout.laneLabels.eventRecord && (
                  <div className="relationship-graph__lane-label relationship-graph__lane-label--eventRecord" style={layout.laneLabels.eventRecord}>EVENT RECORDS</div>
                )}

                <svg className="relationship-graph__edges" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden>
                  <defs>
                    <marker id="relationship-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                  </defs>
                  {visibleGraph.edges.map((edge) => {
                    const from = layout.positions.get(edge.from);
                    const to = layout.positions.get(edge.to);
                    if (!from || !to) return null;
                    return (
                      <g key={edge.id} className={"relationship-edge" + (edge.dashed ? " relationship-edge--dashed" : "")}>
                        <path d={edgePath(from.x, from.y, to.x, to.y)} markerEnd="url(#relationship-arrow)" />
                      </g>
                    );
                  })}
                </svg>

                {visibleGraph.nodes.map((node) => {
                  const pos = layout.positions.get(node.id);
                  if (!pos) return null;
                  const clickable = node.kind === "eventGroup" || node.recordId != null || Boolean(node.functionCallId);
                  const expanded = node.kind === "eventGroup" && expandedEventGroupIds.has(node.id);
                  return (
                    <button
                      key={node.id}
                      className={[
                        "relationship-node",
                        `relationship-node--${node.kind}`,
                        `relationship-node--${node.lane}`,
                        expanded ? "is-expanded" : "",
                        node.emphasized ? "is-emphasized" : "",
                        node.missing ? "is-missing" : "",
                      ].filter(Boolean).join(" ")}
                      style={{ left: pos.x - NODE_WIDTH / 2, top: pos.y - NODE_HEIGHT / 2 }}
                      disabled={!clickable}
                      onClick={() => selectNode(node)}
                      title={`${node.label}\n${node.meta}`}
                      aria-pressed={node.kind === "eventGroup" ? expanded : undefined}
                    >
                      <span className="relationship-node__kind">{nodeLabel(node, expanded)}</span>
                      <span className="relationship-node__label mono">{node.label}</span>
                      <span className="relationship-node__meta">{node.meta}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <RelationshipInspector
            model={model}
            renderedNodeCount={visibleGraph.nodes.length}
            expandedGroupCount={expandedEventGroupIds.size}
            onSelectRecord={(id) => setSelection({ kind: "record", id })}
          />
        </div>
      </section>
    </div>
  );
}

function RelationshipInspector({
  model,
  renderedNodeCount,
  expandedGroupCount,
  onSelectRecord,
}: {
  model: RelationshipGraphModel;
  renderedNodeCount: number;
  expandedGroupCount: number;
  onSelectRecord: (id: number) => void;
}) {
  const actionCounts = Array.from(
    model.eventGroups.reduce((map, group) => {
      map.set(group.action, (map.get(group.action) ?? 0) + group.count);
      return map;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);
  const related = model.relatedRecords.map((record) => record.id).filter((id) => id !== model.anchorEvent.id);

  return (
    <aside className="relationship-inspector">
      <div className="relationship-inspector__title">Selected Event Group</div>
      <div className="relationship-inspector__kv">
        <span>Tick</span><strong className="mono">{recordTick(model.anchorEvent)}</strong>
        <span>Anchor Event</span><strong className="mono">#{model.anchorEvent.id}</strong>
        <span>Group Label</span><strong className="mono">{model.request.label || "-"}</strong>
        <span>Events</span><strong className="mono">{model.events.length.toLocaleString()}</strong>
        <span>Missing Links</span><strong className="mono">{model.missingLinks.length.toLocaleString()}</strong>
      </div>

      <div className="relationship-inspector__stats">
        <Stat label="Functions" value={model.nodes.filter((node) => node.lane === "function").length} />
        <Stat label="Commands" value={model.nodes.filter((node) => node.lane === "command").length} />
        <Stat label="Event groups" value={model.eventGroups.length} />
        <Stat label="Rendered nodes" value={renderedNodeCount} />
        <Stat label="Expanded groups" value={expandedGroupCount} />
      </div>

      <div className="relationship-inspector__title">Event Actions</div>
      <div className="relationship-inspector__actions">
        {actionCounts.slice(0, 12).map(([action, count]) => (
          <div key={action} className="relationship-inspector__action">
            <span className="mono">{action}</span>
            <strong className="mono">x{count}</strong>
          </div>
        ))}
        {actionCounts.length > 12 && <div className="relationship-inspector__more">+{actionCounts.length - 12} more actions</div>}
      </div>

      {model.missingLinks.length > 0 && (
        <div className="relationship-inspector__missing">
          {model.missingLinks.slice(0, 8).map((link) => (
            <div key={link}>{link}</div>
          ))}
          {model.missingLinks.length > 8 && <div>+{model.missingLinks.length - 8} more missing links</div>}
        </div>
      )}

      <div className="relationship-inspector__title">Related Records</div>
      <div className="relationship-inspector__records">
        {related.slice(0, 40).map((id) => (
          <button key={id} className="relationship-inspector__record mono" onClick={() => onSelectRecord(id)}>
            #{id}
          </button>
        ))}
        {related.length > 40 && <div className="relationship-inspector__more">+{related.length - 40} more</div>}
      </div>
    </aside>
  );
}

type VisibleRelationshipGraph = {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
};

function expandEventGroups(
  model: RelationshipGraphModel,
  indexes: ReturnType<typeof useTraceStore.getState>["indexes"],
  expandedEventGroupIds: Set<string>
): VisibleRelationshipGraph {
  const nodes = [...model.nodes];
  const edges = [...model.edges];
  for (const group of model.eventGroups) {
    if (!expandedEventGroupIds.has(group.id)) continue;
    for (const eventId of group.eventIds) {
      const event = indexes.recordsById.get(eventId);
      if (!event || event.type !== "EVENT") continue;
      const nodeId = `${group.id}-record-${eventId}`;
      nodes.push({
        id: nodeId,
        lane: "eventRecord",
        kind: "eventRecord",
        label: `#${eventId} | tick ${recordTick(event)}`,
        meta: event.commandContext.commandId ? `command ${event.commandContext.commandId}` : "command none",
        recordId: eventId,
        eventIds: [eventId],
        count: 1,
        emphasized: eventId === model.anchorEvent.id,
      });
      edges.push({
        id: `${group.id}-to-record-${eventId}`,
        from: group.id,
        to: nodeId,
      });
    }
  }
  return { nodes, edges };
}

function layoutTree(graph: VisibleRelationshipGraph, compact: boolean, narrow: boolean): {
  width: number;
  height: number;
  positions: Map<string, { x: number; y: number }>;
  laneLabels: Partial<Record<RelationshipLane, { left: number; top: number }>>;
} {
  const positions = new Map<string, { x: number; y: number }>();
  const xByNode = assignTreeColumns(graph.nodes, graph.edges);
  const maxColumn = Math.max(0, ...Array.from(xByNode.values()));
  const columnWidth = compact ? NODE_WIDTH + 28 : NODE_WIDTH + COLUMN_GAP;
  const padding = narrow ? 80 : 120;
  const width = Math.max(narrow ? 560 : 1000, padding * 2 + maxColumn * columnWidth + NODE_WIDTH);
  const hasEventRecords = graph.nodes.some((node) => node.lane === "eventRecord");
  const height = hasEventRecords ? (narrow ? 820 : 830) : (narrow ? 620 : 650);

  for (const node of graph.nodes) {
    const column = xByNode.get(node.id) ?? 0;
    positions.set(node.id, {
      x: padding + column * columnWidth + NODE_WIDTH / 2,
      y: ROW_Y[node.lane],
    });
  }

  return {
    width,
    height,
    positions,
    laneLabels: {
      function: { left: 70, top: ROW_Y.function - 72 },
      command: { left: 70, top: ROW_Y.command - 72 },
      event: { left: 70, top: ROW_Y.event - 72 },
      ...(hasEventRecords ? { eventRecord: { left: 70, top: ROW_Y.eventRecord - 72 } } : {}),
    },
  };
}

function assignTreeColumns(nodes: RelationshipNode[], edges: { from: string; to: string }[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const arr = children.get(edge.from) ?? [];
    arr.push(edge.to);
    children.set(edge.from, arr);
  }

  const positions = new Map<string, number>();
  let nextColumn = 0;
  const roots = nodes.filter((node) => node.lane === "function");

  function place(nodeId: string): number {
    if (positions.has(nodeId)) return positions.get(nodeId)!;
    const childIds = (children.get(nodeId) ?? []).filter((id) => byId.has(id));
    if (childIds.length === 0) {
      const col = nextColumn++;
      positions.set(nodeId, col);
      return col;
    }
    const childColumns = childIds.map(place);
    const col = (Math.min(...childColumns) + Math.max(...childColumns)) / 2;
    positions.set(nodeId, col);
    return col;
  }

  roots.forEach((root) => place(root.id));
  nodes.forEach((node) => {
    if (!positions.has(node.id)) place(node.id);
  });

  return positions;
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const startY = y1 + NODE_HEIGHT / 2;
  const endY = y2 - NODE_HEIGHT / 2;
  const midY = (startY + endY) / 2;
  return `M ${x1} ${startY} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${endY}`;
}

function nodeLabel(node: RelationshipNode, expanded = false): string {
  if (node.kind === "functionCall") return "FUNCTION";
  if (node.kind === "eventGroup") return expanded ? "EVENT GROUP - OPEN" : "EVENT GROUP";
  if (node.kind === "eventRecord") return "EVENT RECORD";
  if (node.kind === "summary") return "SUMMARY";
  if (node.kind === "missing") return "MISSING";
  return node.kind.toUpperCase();
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
