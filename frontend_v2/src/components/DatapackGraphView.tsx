import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import type {
  AnalyzedFunction,
  DatapackAnalysisResponse,
  DatapackVariable,
  FunctionEdge,
} from "../api/types";
import { useTraceStore } from "../store/traceStore";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.2;
const NODE_MIN_RADIUS = 9;
const NODE_MAX_RADIUS = 20;

type ScopeFilter = "all" | "tickChain" | "tickRoots";
type GraphSelection = { kind: "function"; id: string } | { kind: "edge"; id: string } | null;

type GraphNode = {
  id: string;
  fn: AnalyzedFunction | null;
  x: number;
  y: number;
  radius: number;
  degree: number;
  missing: boolean;
  tag: boolean;
};

type GraphEdge = FunctionEdge & {
  id: string;
  source: GraphNode;
  target: GraphNode;
  callCount?: number;
  conditionSummaries?: string[];
  sampleCommands?: string[];
};

type SourceGraphEdge = FunctionEdge & {
  callCount?: number;
  conditionSummaries?: string[];
  sampleCommands?: string[];
};

type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  functionMap: Map<string, AnalyzedFunction>;
  variableMap: Map<string, DatapackVariable>;
  packs: string[];
  namespaces: string[];
  edgeKinds: string[];
  bounds: { minX: number; minY: number; width: number; height: number };
  key: string;
};

type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export function DatapackGraphView() {
  const client = useTraceStore((s) => s.client);
  const baseUrl = useTraceStore((s) => s.baseUrl);
  const [analysis, setAnalysis] = useState<DatapackAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [edgeKind, setEdgeKind] = useState("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<GraphSelection>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, zoom: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const requestSeq = useRef(0);

  const loadAnalysis = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const next = await client.datapackAnalysis();
      if (seq !== requestSeq.current) return;
      setAnalysis(next);
      setSelected(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [baseUrl, client]);

  useEffect(() => {
    void loadAnalysis();
  }, [loadAnalysis]);

  const graph = useMemo(
    () => buildGraphModel(analysis, scope, groupFilter, edgeKind, deferredQuery),
    [analysis, deferredQuery, edgeKind, groupFilter, scope]
  );

  const selectedFunction =
    selected?.kind === "function" ? graph.functionMap.get(selected.id) ?? null : null;
  const selectedEdge = selected?.kind === "edge" ? graph.edges.find((edge) => edge.id === selected.id) ?? null : null;

  const fitGraph = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || graph.nodes.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const bounds = graph.bounds;
    const zoom = clamp(
      Math.min((rect.width - 72) / Math.max(1, bounds.width), (rect.height - 72) / Math.max(1, bounds.height)),
      MIN_ZOOM,
      MAX_ZOOM
    );
    setViewport({
      zoom,
      x: rect.width / 2 - (bounds.minX + bounds.width / 2) * zoom,
      y: rect.height / 2 - (bounds.minY + bounds.height / 2) * zoom,
    });
  }, [graph]);

  useEffect(() => {
    const id = window.requestAnimationFrame(fitGraph);
    return () => window.cancelAnimationFrame(id);
  }, [fitGraph, graph.key]);

  function resetGraph() {
    setViewport({ x: 40, y: 40, zoom: 1 });
  }

  function beginPan(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: viewport.x,
      baseY: viewport.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setViewport((current) => ({
      ...current,
      x: drag.baseX + event.clientX - drag.startX,
      y: drag.baseY + event.clientY - drag.startY,
    }));
  }

  function endPan(event: PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  function zoomAt(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const nextZoom = clamp(viewport.zoom * (event.deltaY > 0 ? 0.88 : 1.12), MIN_ZOOM, MAX_ZOOM);
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const worldX = (localX - viewport.x) / viewport.zoom;
    const worldY = (localY - viewport.y) / viewport.zoom;
    setViewport({
      zoom: nextZoom,
      x: localX - worldX * nextZoom,
      y: localY - worldY * nextZoom,
    });
  }

  const labelMode = graph.nodes.length <= 80 || deferredQuery.trim().length > 0;

  return (
    <main className="datapack">
      <header className="datapack__header">
        <div className="datapack__title-block">
          <div className="datapack__eyebrow">STATIC DATAPACK ANALYSIS</div>
          <h1 className="datapack__title">Datapack Function Graph</h1>
        </div>
        <div className="datapack__stats">
          <Stat label="Functions" value={analysis?.analysis.functionCount ?? graph.nodes.filter((node) => node.fn).length} />
          <Stat label="Edges" value={analysis?.analysis.edgeCount ?? graph.edges.length} />
          <Stat label="Variables" value={analysis?.analysis.variableCount ?? 0} />
          <Stat label="Warnings" value={analysis?.analysis.warnings.length ?? 0} tone={analysis?.analysis.warnings.length ? "warn" : undefined} />
        </div>
        <button onClick={() => void loadAnalysis()} disabled={loading}>
          {loading ? "Loading" : "Refresh"}
        </button>
      </header>

      <section className="datapack__controls" aria-label="Datapack graph filters">
        <label className="datapack-control datapack-control--search">
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="function, pack, variable" />
        </label>
        <label className="datapack-control">
          <span>Scope</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as ScopeFilter)}>
            <option value="all">All</option>
            <option value="tickChain">Tick Chain</option>
            <option value="tickRoots">Tick Roots</option>
          </select>
        </label>
        <label className="datapack-control">
          <span>Pack / Namespace</span>
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
            <option value="all">All</option>
            {graph.packs.map((pack) => (
              <option key={`pack:${pack}`} value={`pack:${pack}`}>pack {pack}</option>
            ))}
            {graph.namespaces.map((namespace) => (
              <option key={`namespace:${namespace}`} value={`namespace:${namespace}`}>namespace {namespace}</option>
            ))}
          </select>
        </label>
        <label className="datapack-control">
          <span>Edge Kind</span>
          <select value={edgeKind} onChange={(event) => setEdgeKind(event.target.value)}>
            <option value="all">All</option>
            {graph.edgeKinds.map((kind) => (
              <option key={kind} value={kind}>{kind}</option>
            ))}
          </select>
        </label>
        <label className="datapack-control datapack-control--zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step="0.05"
            value={viewport.zoom}
            onInput={(event) => {
              const zoom = Number(event.currentTarget.value);
              setViewport((current) => ({ ...current, zoom }));
            }}
            onChange={(event) => {
              const zoom = Number(event.currentTarget.value);
              setViewport((current) => ({ ...current, zoom }));
            }}
          />
          <strong className="mono">{Math.round(viewport.zoom * 100)}%</strong>
        </label>
        <button onClick={fitGraph} disabled={graph.nodes.length === 0}>Fit</button>
        <button onClick={resetGraph}>Reset</button>
      </section>

      {error && (
        <div className="datapack__notice datapack__notice--error">
          <strong>Datapack analysis failed</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="datapack__body">
        <section className="datapack-graph" aria-label="Function reference graph">
          {loading && !analysis ? (
            <div className="datapack-graph__empty">Loading datapack analysis...</div>
          ) : graph.nodes.length === 0 ? (
            <div className="datapack-graph__empty">No datapack functions in the current snapshot.</div>
          ) : (
            <svg
              ref={svgRef}
              className="datapack-graph__svg"
              onPointerDown={beginPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onWheel={zoomAt}
              onClick={() => setSelected(null)}
            >
              <defs>
                <marker id="datapack-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              <g transform={`translate(${round(viewport.x)} ${round(viewport.y)}) scale(${round(viewport.zoom)})`}>
                {graph.edges.map((edge) => (
                  <g key={edge.id}>
                    <line
                      className={[
                        "datapack-edge",
                        `datapack-edge--${edge.kind}`,
                        selected?.kind === "edge" && selected.id === edge.id ? "is-selected" : "",
                      ].filter(Boolean).join(" ")}
                      x1={edge.source.x}
                      y1={edge.source.y}
                      x2={edge.target.x}
                      y2={edge.target.y}
                      markerEnd="url(#datapack-arrow)"
                    />
                    <line
                      className="datapack-edge-hit"
                      x1={edge.source.x}
                      y1={edge.source.y}
                      x2={edge.target.x}
                      y2={edge.target.y}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected({ kind: "edge", id: edge.id });
                      }}
                    />
                  </g>
                ))}
                {graph.nodes.map((node) => {
                  const selectedNode = selected?.kind === "function" && selected.id === node.id;
                  const hovered = hoveredId === node.id;
                  const showLabel = labelMode || selectedNode || hovered;
                  return (
                    <g
                      key={node.id}
                      className={[
                        "datapack-node",
                        node.fn?.tickRoot ? "datapack-node--tick-root" : "",
                        node.fn?.tickFunction && !node.fn.tickRoot ? "datapack-node--tick-chain" : "",
                        node.missing ? "datapack-node--missing" : "",
                        node.tag ? "datapack-node--tag" : "",
                        selectedNode ? "is-selected" : "",
                      ].filter(Boolean).join(" ")}
                      transform={`translate(${round(node.x)} ${round(node.y)})`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected({ kind: "function", id: node.id });
                      }}
                    >
                      <circle r={node.radius} />
                      {showLabel && (
                        <text x={node.radius + 7} y="4">
                          {node.id}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </section>

        <DatapackInspector
          analysis={analysis}
          graph={graph}
          selectedFunction={selectedFunction}
          selectedEdge={selectedEdge}
        />
      </div>
    </main>
  );
}

function DatapackInspector({
  analysis,
  graph,
  selectedFunction,
  selectedEdge,
}: {
  analysis: DatapackAnalysisResponse | null;
  graph: GraphModel;
  selectedFunction: AnalyzedFunction | null;
  selectedEdge: GraphEdge | null;
}) {
  if (selectedEdge) {
    return (
      <aside className="datapack-inspector">
        <div className="datapack-inspector__title">Selected Edge</div>
        <KeyValues
          rows={[
            ["From", selectedEdge.from],
            ["To", selectedEdge.to],
            ["Kind", selectedEdge.kind],
            ["Calls", String(selectedEdge.callCount ?? 1)],
            ["Via Tag", selectedEdge.viaTag || "none"],
            ["Line", String(selectedEdge.line)],
            ["Condition", selectedEdge.conditionSummary || selectedEdge.conditionSummaries?.[0] || "none"],
          ]}
        />
        <div className="datapack-inspector__title">Command</div>
        <pre className="datapack-inspector__code">{selectedEdge.command || selectedEdge.sampleCommands?.join("\n")}</pre>
        <Warnings analysis={analysis} />
      </aside>
    );
  }

  if (selectedFunction) {
    const variables = selectedFunction.variables
      .map((key) => graph.variableMap.get(key))
      .filter((variable): variable is DatapackVariable => Boolean(variable));
    return (
      <aside className="datapack-inspector">
        <div className="datapack-inspector__title">Selected Function</div>
        <KeyValues
          rows={[
            ["Function", selectedFunction.id],
            ["Pack", selectedFunction.pack],
            ["Lines", selectedFunction.lineCount.toLocaleString()],
            ["Commands", selectedFunction.commandCount.toLocaleString()],
            ["Tick Root", selectedFunction.tickRoot ? "true" : "false"],
            ["Tick Chain", selectedFunction.tickFunction ? "true" : "false"],
          ]}
        />
        <ListSection title="Calls" items={selectedFunction.calls} />
        <ListSection title="Called By" items={selectedFunction.calledBy} />
        <div className="datapack-inspector__title">Variables</div>
        <div className="datapack-inspector__list">
          {variables.length === 0 ? (
            <div className="datapack-inspector__empty">No variables</div>
          ) : (
            variables.slice(0, 32).map((variable) => (
              <div key={variable.key} className="datapack-inspector__item">
                <span className="mono">{variable.key}</span>
                <strong>{variable.kind}</strong>
              </div>
            ))
          )}
          {variables.length > 32 && <div className="datapack-inspector__more">+{variables.length - 32} more</div>}
        </div>
        <Warnings analysis={analysis} />
      </aside>
    );
  }

  return (
    <aside className="datapack-inspector">
      <div className="datapack-inspector__title">Graph Summary</div>
      <KeyValues
        rows={[
          ["Rendered", `${graph.nodes.length.toLocaleString()} nodes / ${graph.edges.length.toLocaleString()} edges`],
          ["Generated", analysis?.analysis.generatedAtMillis ? new Date(analysis.analysis.generatedAtMillis).toLocaleString() : "-"],
          ["Tags", analysis ? Object.keys(analysis.tags).length.toLocaleString() : "0"],
        ]}
      />
      <div className="datapack-inspector__title">Legend</div>
      <div className="datapack-legend">
        <span><i className="datapack-legend__dot datapack-legend__dot--root" />Tick root</span>
        <span><i className="datapack-legend__dot datapack-legend__dot--chain" />Tick chain</span>
        <span><i className="datapack-legend__dot" />Function</span>
        <span><i className="datapack-legend__dot datapack-legend__dot--missing" />Missing/tag target</span>
      </div>
      <Warnings analysis={analysis} />
    </aside>
  );
}

function Warnings({ analysis }: { analysis: DatapackAnalysisResponse | null }) {
  const warnings = analysis?.analysis.warnings ?? [];
  if (warnings.length === 0) return null;
  return (
    <>
      <div className="datapack-inspector__title">Warnings</div>
      <div className="datapack-inspector__warnings">
        {warnings.slice(0, 8).map((warning) => (
          <div key={warning}>{warning}</div>
        ))}
        {warnings.length > 8 && <div>+{warnings.length - 8} more</div>}
      </div>
    </>
  );
}

function KeyValues({ rows }: { rows: [string, string][] }) {
  return (
    <div className="datapack-inspector__kv">
      {rows.map(([key, value]) => (
        <div key={key} className="datapack-inspector__kv-row">
          <span>{key}</span>
          <strong className="mono">{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <div className="datapack-inspector__title">{title}</div>
      <div className="datapack-inspector__list">
        {items.length === 0 ? (
          <div className="datapack-inspector__empty">None</div>
        ) : (
          items.slice(0, 40).map((item) => (
            <div key={item} className="datapack-inspector__item mono">{item}</div>
          ))
        )}
        {items.length > 40 && <div className="datapack-inspector__more">+{items.length - 40} more</div>}
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={"datapack-stat" + (tone === "warn" ? " datapack-stat--warn" : "")}>
      <span>{label}</span>
      <strong className="mono">{value.toLocaleString()}</strong>
    </div>
  );
}

function buildGraphModel(
  analysis: DatapackAnalysisResponse | null,
  scope: ScopeFilter,
  groupFilter: string,
  edgeKind: string,
  query: string
): GraphModel {
  const emptyBounds = { minX: 0, minY: 0, width: 1, height: 1 };
  if (!analysis) {
    return {
      nodes: [],
      edges: [],
      functionMap: new Map(),
      variableMap: new Map(),
      packs: [],
      namespaces: [],
      edgeKinds: [],
      bounds: emptyBounds,
      key: "empty",
    };
  }

  const normalizedQuery = query.trim().toLowerCase();
  const functionMap = new Map(analysis.functions.map((fn) => [fn.id, fn]));
  const variableMap = new Map(analysis.variables.map((variable) => [variable.key, variable]));
  const packs = Array.from(new Set(analysis.functions.map((fn) => fn.pack).filter(Boolean))).sort();
  const namespaces = Array.from(new Set(analysis.functions.map((fn) => namespaceOf(fn.id)).filter(Boolean))).sort();
  const sourceEdges = graphSourceEdges(analysis);
  const edgeKinds = Array.from(new Set(sourceEdges.map((edge) => edge.kind).filter(Boolean))).sort();

  const visibleFunctions = analysis.functions.filter((fn) => {
    if (scope === "tickChain" && !fn.tickFunction) return false;
    if (scope === "tickRoots" && !fn.tickRoot) return false;
    if (!matchesGroup(fn, groupFilter)) return false;
    if (!normalizedQuery) return true;
    if (matchesFunctionQuery(fn, normalizedQuery)) return true;
    return fn.calls.some((id) => id.toLowerCase().includes(normalizedQuery)) ||
      fn.calledBy.some((id) => id.toLowerCase().includes(normalizedQuery));
  });
  const visibleIds = new Set(visibleFunctions.map((fn) => fn.id));
  const nodeSeeds = new Map<string, GraphNode>();

  for (const fn of visibleFunctions) {
    nodeSeeds.set(fn.id, {
      id: fn.id,
      fn,
      x: 0,
      y: 0,
      radius: NODE_MIN_RADIUS,
      degree: 0,
      missing: false,
      tag: false,
    });
  }

  const rawEdges: SourceGraphEdge[] = [];
  sourceEdges.forEach((edge) => {
    if (edgeKind !== "all" && edge.kind !== edgeKind) return;
    const targetKnown = functionMap.has(edge.to);
    const sourceVisible = visibleIds.has(edge.from);
    const targetVisible = visibleIds.has(edge.to);
    const missingOrTagTarget = !targetKnown || edge.to.startsWith("#");
    const queryMatchesEdge = !normalizedQuery ||
      edge.from.toLowerCase().includes(normalizedQuery) ||
      edge.to.toLowerCase().includes(normalizedQuery) ||
      edge.command.toLowerCase().includes(normalizedQuery);
    if (!queryMatchesEdge) return;
    if (!sourceVisible || (!targetVisible && !missingOrTagTarget)) return;

    rawEdges.push(edge);
    if (!nodeSeeds.has(edge.to)) {
      nodeSeeds.set(edge.to, {
        id: edge.to,
        fn: functionMap.get(edge.to) ?? null,
        x: 0,
        y: 0,
        radius: NODE_MIN_RADIUS,
        degree: 0,
        missing: !functionMap.has(edge.to),
        tag: edge.to.startsWith("#"),
      });
    }
  });

  const nodes = Array.from(nodeSeeds.values());
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  rawEdges.forEach((edge, index) => {
    const source = nodeMap.get(edge.from);
    const target = nodeMap.get(edge.to);
    if (!source || !target) return;
    source.degree++;
    target.degree++;
    edges.push({
      ...edge,
      id: `${edge.from}->${edge.to}:${edge.kind}:${edge.line}:${index}`,
      callCount: edge.callCount,
      conditionSummaries: edge.conditionSummaries,
      sampleCommands: edge.sampleCommands,
      source,
      target,
    });
  });

  for (const node of nodes) {
    node.radius = clamp(NODE_MIN_RADIUS + Math.sqrt(node.degree) * 2.4, NODE_MIN_RADIUS, NODE_MAX_RADIUS);
  }

  const bounds = layoutForce(nodes, edges);
  return {
    nodes,
    edges,
    functionMap,
    variableMap,
    packs,
    namespaces,
    edgeKinds,
    bounds,
    key: `${scope}|${groupFilter}|${edgeKind}|${normalizedQuery}|${nodes.length}|${edges.length}`,
  };
}

function graphSourceEdges(analysis: DatapackAnalysisResponse): SourceGraphEdge[] {
  if (!analysis.graph?.edges?.length) {
    return analysis.edges;
  }
  return analysis.graph.edges.map((edge, index) => ({
    id: `${edge.from}->${edge.to}:${edge.kind}:${index}`,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    viaTag: "none",
    line: edge.lines[0] ?? 0,
    command: edge.sampleCommands[0] ?? "",
    rawCommand: edge.sampleCommands[0] ?? "",
    effectiveCommand: edge.sampleCommands[0] ?? "",
    conditionSummary: edge.conditionSummaries[0] ?? "none",
    callCount: edge.callCount,
    conditionSummaries: edge.conditionSummaries,
    sampleCommands: edge.sampleCommands,
  }));
}

function layoutForce(nodes: GraphNode[], edges: GraphEdge[]): { minX: number; minY: number; width: number; height: number } {
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
  const count = nodes.length;
  const width = Math.max(980, Math.ceil(Math.sqrt(count)) * 260);
  const height = Math.max(640, Math.ceil(Math.sqrt(count)) * 190);
  const centerX = width / 2;
  const centerY = height / 2;
  const velocities = new Map<string, { x: number; y: number }>();
  const ordered = nodes.slice().sort((a, b) => a.id.localeCompare(b.id));

  ordered.forEach((node, index) => {
    const hash = hashString(node.id);
    const angle = (index / Math.max(1, ordered.length)) * Math.PI * 2 + (hash % 360) * Math.PI / 180;
    const ring = 120 + (hash % 420);
    node.x = centerX + Math.cos(angle) * ring;
    node.y = centerY + Math.sin(angle) * ring;
    velocities.set(node.id, { x: 0, y: 0 });
  });

  const linkPairs = uniqueLinks(edges);
  const iterations = count > 320 ? 80 : count > 160 ? 110 : 145;
  for (let step = 0; step < iterations; step++) {
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i];
      const av = velocities.get(a.id)!;
      for (let j = i + 1; j < ordered.length; j++) {
        const b = ordered[j];
        const bv = velocities.get(b.id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distanceSq = dx * dx + dy * dy;
        if (distanceSq < 0.01) {
          dx = (hashString(a.id) % 7) - 3;
          dy = (hashString(b.id) % 7) - 3;
          distanceSq = dx * dx + dy * dy + 0.01;
        }
        const distance = Math.sqrt(distanceSq);
        const force = Math.min(3600 / distanceSq, 2.4);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        av.x += fx;
        av.y += fy;
        bv.x -= fx;
        bv.y -= fy;
      }
    }

    for (const [source, target] of linkPairs) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const targetDistance = source.fn?.tickRoot ? 210 : 165;
      const force = (distance - targetDistance) * 0.018;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      const sv = velocities.get(source.id)!;
      const tv = velocities.get(target.id)!;
      sv.x += fx;
      sv.y += fy;
      tv.x -= fx;
      tv.y -= fy;
    }

    for (const node of ordered) {
      const velocity = velocities.get(node.id)!;
      velocity.x += (centerX - node.x) * 0.003;
      velocity.y += (centerY - node.y) * 0.003;
      if (node.fn?.tickRoot) velocity.y -= 0.18;
      node.x = clamp(node.x + velocity.x, 60, width - 60);
      node.y = clamp(node.y + velocity.y, 60, height - 60);
      velocity.x *= 0.74;
      velocity.y *= 0.74;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius - 80);
    minY = Math.min(minY, node.y - node.radius - 80);
    maxX = Math.max(maxX, node.x + node.radius + 220);
    maxY = Math.max(maxY, node.y + node.radius + 80);
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function uniqueLinks(edges: GraphEdge[]): [GraphNode, GraphNode][] {
  const seen = new Set<string>();
  const out: [GraphNode, GraphNode][] = [];
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([edge.source, edge.target]);
  }
  return out;
}

function matchesFunctionQuery(fn: AnalyzedFunction, query: string): boolean {
  return fn.id.toLowerCase().includes(query) ||
    fn.pack.toLowerCase().includes(query) ||
    fn.variables.some((variable) => variable.toLowerCase().includes(query));
}

function matchesGroup(fn: AnalyzedFunction, groupFilter: string): boolean {
  if (groupFilter === "all") return true;
  if (groupFilter.startsWith("pack:")) return fn.pack === groupFilter.slice("pack:".length);
  if (groupFilter.startsWith("namespace:")) return namespaceOf(fn.id) === groupFilter.slice("namespace:".length);
  return true;
}

function namespaceOf(id: string): string {
  const index = id.indexOf(":");
  return index > 0 ? id.slice(0, index) : "";
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
