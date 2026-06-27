import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import type {
  AnalyzedFunction,
  DatapackAnalysisResponse,
  DatapackCommand,
  DatapackGraphNode,
  DatapackVariable,
  FunctionEdge,
  SelectorRef,
} from "../api/types";
import { useTraceStore } from "../store/traceStore";
import { DatapackVariablesView, variableAccessKinds } from "./DatapackVariablesView";
import type { VariableAccessFilter, VariableSort } from "./DatapackVariablesView";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.2;
const NODE_WIDTH = 178;
const NODE_HEIGHT = 58;
const MISSING_NODE_WIDTH = 164;
const MISSING_NODE_HEIGHT = 50;
const EDGE_LABEL_HEIGHT = 22;
const LARGE_GRAPH_NODE_LIMIT = 120;
const LARGE_GRAPH_EDGE_LIMIT = 180;

type ScopeFilter = "all" | "tickChain" | "tickRoots";
type EdgeLabelMode = "auto" | "all" | "off";
type DatapackSubView = "graph" | "variables";
type GraphSelection = { kind: "function"; id: string } | { kind: "edge"; id: string } | null;

type GraphNode = {
  id: string;
  fn: AnalyzedFunction | null;
  x: number;
  y: number;
  width: number;
  height: number;
  degree: number;
  inDegree: number;
  outDegree: number;
  module: string;
  namespace: string;
  entrypoint: string;
  title: string;
  subtitle: string;
  missing: boolean;
  tag: boolean;
};

type GraphEdge = FunctionEdge & {
  id: string;
  source: GraphNode;
  target: GraphNode;
  callCount: number;
  lines: number[];
  conditionSummaries: string[];
  sampleCommands: string[];
  selectors: SelectorRef[];
  variablesRead: string[];
  variablesWritten: string[];
  executeSummaries: string[];
  label: string;
  labelWidth: number;
  hasVariables: boolean;
  curveOffset: number;
};

type SourceGraphEdge = FunctionEdge & {
  callCount: number;
  lines: number[];
  conditionSummaries: string[];
  sampleCommands: string[];
  selectors: SelectorRef[];
  variablesRead: string[];
  variablesWritten: string[];
  executeSummaries: string[];
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

type GraphPreview = {
  nodeCount: number;
  edgeCount: number;
  packs: string[];
  namespaces: string[];
  edgeKinds: string[];
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
  const [activeDatapackView, setActiveDatapackView] = useState<DatapackSubView>("graph");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [edgeKind, setEdgeKind] = useState("all");
  const [edgeLabelMode, setEdgeLabelMode] = useState<EdgeLabelMode>("auto");
  const [highlightVariables, setHighlightVariables] = useState(true);
  const [selectedVariableKey, setSelectedVariableKey] = useState<string | null>(null);
  const [variableKindFilter, setVariableKindFilter] = useState("all");
  const [variableAccessFilter, setVariableAccessFilter] = useState<VariableAccessFilter>("all");
  const [variableSort, setVariableSort] = useState<VariableSort>("usage");
  const [largeGraphAccepted, setLargeGraphAccepted] = useState(false);
  const [largeGraphPromptDismissed, setLargeGraphPromptDismissed] = useState(false);
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<GraphSelection>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
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
      setSelectedVariableKey(null);
      setLargeGraphAccepted(false);
      setLargeGraphPromptDismissed(false);
      setWarningsExpanded(false);
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

  const preview = useMemo(
    () => buildGraphPreview(analysis, scope, groupFilter, edgeKind, deferredQuery),
    [analysis, deferredQuery, edgeKind, groupFilter, scope]
  );
  const largeGraphBlocked = Boolean(analysis) &&
    activeDatapackView === "graph" &&
    (preview.nodeCount > LARGE_GRAPH_NODE_LIMIT || preview.edgeCount > LARGE_GRAPH_EDGE_LIMIT) &&
    !largeGraphAccepted;
  const showLargeGraphPrompt = largeGraphBlocked && !largeGraphPromptDismissed;
  const graph = useMemo(
    () => activeDatapackView !== "graph"
      ? emptyGraphModel(analysis, preview)
      : largeGraphBlocked
      ? emptyGraphModel(analysis, preview)
      : buildGraphModel(analysis, scope, groupFilter, edgeKind, deferredQuery),
    [activeDatapackView, analysis, deferredQuery, edgeKind, groupFilter, largeGraphBlocked, preview, scope]
  );
  const variableKinds = useMemo(
    () => Array.from(new Set((analysis?.variables ?? []).map((variable) => variable.kind).filter(Boolean))).sort(),
    [analysis]
  );
  const accessKinds = useMemo(() => variableAccessKinds(analysis), [analysis]);

  const selectedFunction =
    selected?.kind === "function" ? graph.functionMap.get(selected.id) ?? null : null;
  const selectedEdge = selected?.kind === "edge" ? graph.edges.find((edge) => edge.id === selected.id) ?? null : null;
  const queryActive = deferredQuery.trim().length > 0;
  const orderedEdges = useMemo(
    () => graph.edges.slice().sort((a, b) => edgeRenderRank(a, selected, hoveredEdgeId) - edgeRenderRank(b, selected, hoveredEdgeId)),
    [graph.edges, hoveredEdgeId, selected]
  );

  const fitGraph = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || graph.nodes.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const bounds = graph.bounds;
    const padding = graph.nodes.length > 80 ? 160 : 72;
    const maxFitZoom = graph.nodes.length > 80 ? 0.72 : MAX_ZOOM;
    const zoom = clamp(
      Math.min((rect.width - padding) / Math.max(1, bounds.width), (rect.height - padding) / Math.max(1, bounds.height)),
      MIN_ZOOM,
      maxFitZoom
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

  useEffect(() => {
    setLargeGraphAccepted(false);
    setLargeGraphPromptDismissed(false);
  }, [baseUrl]);

  useEffect(() => {
    if (!largeGraphBlocked) {
      setLargeGraphPromptDismissed(false);
    }
  }, [largeGraphBlocked]);

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

      <div className="datapack-subtabs" role="tablist" aria-label="Datapack analysis views">
        <button
          role="tab"
          aria-selected={activeDatapackView === "graph"}
          className={activeDatapackView === "graph" ? "is-active" : ""}
          onClick={() => setActiveDatapackView("graph")}
        >
          Function Graph
        </button>
        <button
          role="tab"
          aria-selected={activeDatapackView === "variables"}
          className={activeDatapackView === "variables" ? "is-active" : ""}
          onClick={() => setActiveDatapackView("variables")}
        >
          Variables
        </button>
      </div>

      <section className="datapack__controls" aria-label="Datapack graph filters">
        <label className="datapack-control datapack-control--search">
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="function, pack, variable" />
        </label>
        {activeDatapackView === "graph" ? (
          <>
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
            <label className="datapack-control">
              <span>Labels</span>
              <select value={edgeLabelMode} onChange={(event) => setEdgeLabelMode(event.target.value as EdgeLabelMode)}>
                <option value="auto">Auto</option>
                <option value="all">All</option>
                <option value="off">Off</option>
              </select>
            </label>
            <div className="datapack-control datapack-control--check">
              <span>Variables</span>
              <label className="datapack-check">
                <input
                  type="checkbox"
                  checked={highlightVariables}
                  onChange={(event) => setHighlightVariables(event.currentTarget.checked)}
                />
                <strong>Highlight</strong>
              </label>
            </div>
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
          </>
        ) : (
          <>
            <label className="datapack-control">
              <span>Kind</span>
              <select value={variableKindFilter} onChange={(event) => setVariableKindFilter(event.target.value)}>
                <option value="all">All</option>
                {variableKinds.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label className="datapack-control">
              <span>Access</span>
              <select value={variableAccessFilter} onChange={(event) => setVariableAccessFilter(event.target.value as VariableAccessFilter)}>
                <option value="all">All</option>
                {accessKinds.map((access) => (
                  <option key={access} value={access}>{access}</option>
                ))}
              </select>
            </label>
            <label className="datapack-control">
              <span>Sort</span>
              <select value={variableSort} onChange={(event) => setVariableSort(event.target.value as VariableSort)}>
                <option value="usage">Usage</option>
                <option value="key">Key</option>
                <option value="reads">Reads</option>
                <option value="writes">Writes</option>
                <option value="kind">Kind</option>
              </select>
            </label>
            <span className="datapack-control-spacer" />
            <span className="datapack-control-spacer" />
            <span className="datapack-control-spacer" />
            <span className="datapack-control-spacer" />
          </>
        )}
      </section>

      {error && (
        <div className="datapack__notice datapack__notice--error">
          <strong>Datapack analysis failed</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="datapack__body">
        {activeDatapackView === "variables" ? (
          <DatapackVariablesView
            analysis={analysis}
            query={deferredQuery}
            kindFilter={variableKindFilter}
            accessFilter={variableAccessFilter}
            sort={variableSort}
            selectedVariableKey={selectedVariableKey}
            onSelectVariable={setSelectedVariableKey}
            onSelectFunction={(functionId) => {
              setActiveDatapackView("graph");
              setQuery(functionId);
              setSelected({ kind: "function", id: functionId });
            }}
          />
        ) : (
          <>
        <section className="datapack-graph" aria-label="Function reference graph">
          {loading && !analysis ? (
            <div className="datapack-graph__empty">Loading datapack analysis...</div>
          ) : showLargeGraphPrompt ? (
            <LargeGraphPrompt
              preview={preview}
              onRender={() => {
                setLargeGraphAccepted(true);
                setLargeGraphPromptDismissed(false);
              }}
              onFilterFirst={() => setLargeGraphPromptDismissed(true)}
            />
          ) : largeGraphBlocked ? (
            <div className="datapack-graph__empty datapack-graph__empty--large">
              <strong>Graph rendering paused</strong>
              <span>
                {preview.nodeCount.toLocaleString()} nodes / {preview.edgeCount.toLocaleString()} edges.
                Use search or filters to reduce the visible graph, or render the full graph when ready.
              </span>
              <button onClick={() => setLargeGraphAccepted(true)}>Render full graph</button>
            </div>
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
                {orderedEdges.map((edge) => {
                  const selectedEdgeNode = selected?.kind === "edge" && selected.id === edge.id;
                  const hoveredEdge = hoveredEdgeId === edge.id;
                  const edgePath = curvedEdgePath(edge);
                  const labelPosition = edgeLabelPosition(edge);
                  const showEdgeLabel = shouldShowEdgeLabel(edge, edgeLabelMode, selectedEdgeNode, hoveredEdge, queryActive, graph.edges.length);
                  return (
                    <g
                      key={edge.id}
                      className={[
                        "datapack-edge",
                        `datapack-edge--${edge.kind}`,
                        selectedEdgeNode ? "is-selected" : "",
                        hoveredEdge ? "is-hovered" : "",
                        highlightVariables && edge.hasVariables ? "has-variables" : "",
                      ].filter(Boolean).join(" ")}
                      onMouseEnter={() => setHoveredEdgeId(edge.id)}
                      onMouseLeave={() => setHoveredEdgeId((current) => (current === edge.id ? null : current))}
                    >
                      <title>{edgeTooltip(edge)}</title>
                      <path
                        className="datapack-edge__line"
                        d={edgePath}
                        markerEnd="url(#datapack-arrow)"
                      />
                      <path
                      className="datapack-edge-hit"
                        d={edgePath}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected({ kind: "edge", id: edge.id });
                      }}
                    />
                      {showEdgeLabel && (
                        <g
                          className="datapack-edge-label"
                          transform={`translate(${round(labelPosition.x)} ${round(labelPosition.y)})`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected({ kind: "edge", id: edge.id });
                          }}
                        >
                          <rect
                            x={-edge.labelWidth / 2}
                            y={-EDGE_LABEL_HEIGHT / 2}
                            width={edge.labelWidth}
                            height={EDGE_LABEL_HEIGHT}
                            rx="5"
                          />
                          <text textAnchor="middle" y="4">{edge.label}</text>
                        </g>
                      )}
                    </g>
                  );
                })}
                {graph.nodes.map((node) => {
                  const selectedNode = selected?.kind === "function" && selected.id === node.id;
                  const hovered = hoveredId === node.id;
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
                        hovered ? "is-hovered" : "",
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
                      <title>{nodeTitle(node)}</title>
                      <rect
                        className="datapack-node__box"
                        x={-node.width / 2}
                        y={-node.height / 2}
                        width={node.width}
                        height={node.height}
                        rx="7"
                      />
                      <text className="datapack-node__text" textAnchor="middle">
                        <tspan x="0" y="-5">{node.title}</tspan>
                        <tspan x="0" dy="15" className="datapack-node__meta">{node.subtitle}</tspan>
                      </text>
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
          warningsExpanded={warningsExpanded}
          onToggleWarnings={() => setWarningsExpanded((expanded) => !expanded)}
          onVariableSelect={(key) => {
            setSelectedVariableKey(key);
            setQuery(key);
            setActiveDatapackView("variables");
          }}
        />
          </>
        )}
      </div>
    </main>
  );
}

function DatapackInspector({
  analysis,
  graph,
  selectedFunction,
  selectedEdge,
  warningsExpanded,
  onToggleWarnings,
  onVariableSelect,
}: {
  analysis: DatapackAnalysisResponse | null;
  graph: GraphModel;
  selectedFunction: AnalyzedFunction | null;
  selectedEdge: GraphEdge | null;
  warningsExpanded: boolean;
  onToggleWarnings: () => void;
  onVariableSelect: (key: string) => void;
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
            ["Called", formatCalledTimes(selectedEdge.callCount)],
            ["Via Tag", selectedEdge.viaTag || "none"],
            ["Lines", formatLines(selectedEdge.lines)],
            ["Condition", firstMeaningful(selectedEdge.conditionSummaries) || "none"],
          ]}
        />
        <ListSection title="Conditions" items={selectedEdge.conditionSummaries.filter(isMeaningfulSummary)} />
        <ListSection title="Selectors" items={selectedEdge.selectors.map(formatSelector)} />
        <VariableChipSection title="Reads" items={selectedEdge.variablesRead} onSelect={onVariableSelect} />
        <VariableChipSection title="Writes" items={selectedEdge.variablesWritten} onSelect={onVariableSelect} />
        <ListSection title="Sample Commands" items={selectedEdge.sampleCommands} />
        <Warnings analysis={analysis} expanded={warningsExpanded} onToggle={onToggleWarnings} />
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
              <button key={variable.key} className="datapack-inspector__item datapack-inspector__item--button" onClick={() => onVariableSelect(variable.key)}>
                <span className="mono">{variable.key}</span>
                <strong>{variable.kind}</strong>
              </button>
            ))
          )}
          {variables.length > 32 && <div className="datapack-inspector__more">+{variables.length - 32} more</div>}
        </div>
        <Warnings analysis={analysis} expanded={warningsExpanded} onToggle={onToggleWarnings} />
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
      <Warnings analysis={analysis} expanded={warningsExpanded} onToggle={onToggleWarnings} />
    </aside>
  );
}

function LargeGraphPrompt({
  preview,
  onRender,
  onFilterFirst,
}: {
  preview: GraphPreview;
  onRender: () => void;
  onFilterFirst: () => void;
}) {
  return (
    <div className="datapack-large-graph">
      <div className="datapack-large-graph__panel">
        <div className="datapack-large-graph__eyebrow">PERFORMANCE WARNING</div>
        <h2>Large datapack graph</h2>
        <p>
          This snapshot contains {preview.nodeCount.toLocaleString()} nodes and {preview.edgeCount.toLocaleString()} edges.
          Rendering the full force layout may take a while.
        </p>
        <div className="datapack-large-graph__stats">
          <span><strong>{preview.nodeCount.toLocaleString()}</strong> nodes</span>
          <span><strong>{preview.edgeCount.toLocaleString()}</strong> edges</span>
        </div>
        <div className="datapack-large-graph__actions">
          <button onClick={onRender}>Render full graph</button>
          <button onClick={onFilterFirst}>Use filters first</button>
        </div>
      </div>
    </div>
  );
}

function Warnings({
  analysis,
  expanded,
  onToggle,
}: {
  analysis: DatapackAnalysisResponse | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const warnings = analysis?.analysis.warnings ?? [];
  if (warnings.length === 0) return null;
  return (
    <section className="datapack-warnings">
      <button className="datapack-warnings__header" onClick={onToggle}>
        <span>Warnings</span>
        <strong className="mono">{warnings.length.toLocaleString()}</strong>
        <em>{expanded ? "Collapse" : "Expand"}</em>
      </button>
      {expanded && (
        <div className="datapack-inspector__warnings" role="log" aria-label="Datapack analysis warnings">
        {warnings.slice(0, 8).map((warning) => (
            <div key={warning}><span>WARN</span><code>{warning}</code></div>
        ))}
          {warnings.length > 8 && <div><span>&gt;</span><code>+{warnings.length - 8} more warnings</code></div>}
      </div>
      )}
    </section>
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

function VariableChipSection({ title, items, onSelect }: { title: string; items: string[]; onSelect: (key: string) => void }) {
  return (
    <>
      <div className="datapack-inspector__title">{title}</div>
      <div className="datapack-variable-chips">
        {items.length === 0 ? (
          <div className="datapack-inspector__empty">None</div>
        ) : (
          items.slice(0, 40).map((item) => (
            <button key={item} className="datapack-variable-chip mono" onClick={() => onSelect(item)} title={item}>
              {item}
            </button>
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

function emptyGraphModel(analysis: DatapackAnalysisResponse | null, preview: GraphPreview): GraphModel {
  return {
    nodes: [],
    edges: [],
    functionMap: new Map(analysis?.functions.map((fn) => [fn.id, fn]) ?? []),
    variableMap: new Map(analysis?.variables.map((variable) => [variable.key, variable]) ?? []),
    packs: preview.packs,
    namespaces: preview.namespaces,
    edgeKinds: preview.edgeKinds,
    bounds: { minX: 0, minY: 0, width: 1, height: 1 },
    key: `deferred|${preview.key}`,
  };
}

function buildGraphPreview(
  analysis: DatapackAnalysisResponse | null,
  scope: ScopeFilter,
  groupFilter: string,
  edgeKind: string,
  query: string
): GraphPreview {
  if (!analysis) {
    return { nodeCount: 0, edgeCount: 0, packs: [], namespaces: [], edgeKinds: [], key: "empty" };
  }
  const normalizedQuery = query.trim().toLowerCase();
  const functionMap = new Map(analysis.functions.map((fn) => [fn.id, fn]));
  const packs = Array.from(new Set(analysis.functions.map((fn) => fn.pack).filter(Boolean))).sort();
  const namespaces = Array.from(new Set(analysis.functions.map((fn) => namespaceOf(fn.id)).filter(Boolean))).sort();
  const sourceEdges = graphSourceEdges(analysis);
  const edgeKinds = Array.from(new Set(sourceEdges.map((edge) => edge.kind).filter(Boolean))).sort();
  const allowedFunctions = analysis.functions.filter((fn) => {
    if (scope === "tickChain" && !fn.tickFunction) return false;
    if (scope === "tickRoots" && !fn.tickRoot) return false;
    return matchesGroup(fn, groupFilter);
  });
  const allowedIds = new Set(allowedFunctions.map((fn) => fn.id));
  const visibleIds = new Set<string>();

  if (!normalizedQuery) {
    allowedFunctions.forEach((fn) => visibleIds.add(fn.id));
  } else {
    for (const fn of allowedFunctions) {
      if (
        matchesFunctionQuery(fn, normalizedQuery) ||
        fn.calls.some((id) => id.toLowerCase().includes(normalizedQuery)) ||
        fn.calledBy.some((id) => id.toLowerCase().includes(normalizedQuery))
      ) {
        visibleIds.add(fn.id);
        fn.calls.forEach((id) => visibleIds.add(id));
        fn.calledBy.forEach((id) => visibleIds.add(id));
      }
    }
    for (const edge of sourceEdges) {
      if (allowedIds.has(edge.from) && matchesEdgeQuery(edge, normalizedQuery)) {
        visibleIds.add(edge.from);
        visibleIds.add(edge.to);
      }
    }
  }

  let edgeCount = 0;
  for (const edge of sourceEdges) {
    if (edgeKind !== "all" && edge.kind !== edgeKind) continue;
    const targetKnown = functionMap.has(edge.to);
    const sourceVisible = visibleIds.has(edge.from) || (normalizedQuery.length > 0 && allowedIds.has(edge.from) && matchesEdgeQuery(edge, normalizedQuery));
    const targetVisible = visibleIds.has(edge.to) || (normalizedQuery.length > 0 && allowedIds.has(edge.from) && matchesEdgeQuery(edge, normalizedQuery));
    const missingOrTagTarget = !targetKnown || edge.to.startsWith("#");
    const queryMatchesEdge = !normalizedQuery ||
      matchesEdgeQuery(edge, normalizedQuery) ||
      visibleIds.has(edge.from) ||
      visibleIds.has(edge.to);
    if (!queryMatchesEdge) continue;
    if (!sourceVisible || (!targetVisible && !missingOrTagTarget)) continue;
    edgeCount++;
    visibleIds.add(edge.from);
    visibleIds.add(edge.to);
  }

  return {
    nodeCount: visibleIds.size,
    edgeCount,
    packs,
    namespaces,
    edgeKinds,
    key: `${scope}|${groupFilter}|${edgeKind}|${normalizedQuery}|${visibleIds.size}|${edgeCount}`,
  };
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
  const graphNodeMap = new Map((analysis.graph?.nodes ?? []).map((node) => [node.id, node]));
  const packs = Array.from(new Set(analysis.functions.map((fn) => fn.pack).filter(Boolean))).sort();
  const namespaces = Array.from(new Set(analysis.functions.map((fn) => namespaceOf(fn.id)).filter(Boolean))).sort();
  const sourceEdges = graphSourceEdges(analysis);
  const edgeKinds = Array.from(new Set(sourceEdges.map((edge) => edge.kind).filter(Boolean))).sort();

  const allowedFunctions = analysis.functions.filter((fn) => {
    if (scope === "tickChain" && !fn.tickFunction) return false;
    if (scope === "tickRoots" && !fn.tickRoot) return false;
    return matchesGroup(fn, groupFilter);
  });
  const allowedIds = new Set(allowedFunctions.map((fn) => fn.id));
  const visibleIds = new Set<string>();
  if (!normalizedQuery) {
    allowedFunctions.forEach((fn) => visibleIds.add(fn.id));
  } else {
    for (const fn of allowedFunctions) {
      if (
        matchesFunctionQuery(fn, normalizedQuery) ||
        fn.calls.some((id) => id.toLowerCase().includes(normalizedQuery)) ||
        fn.calledBy.some((id) => id.toLowerCase().includes(normalizedQuery))
      ) {
        visibleIds.add(fn.id);
        fn.calls.forEach((id) => visibleIds.add(id));
        fn.calledBy.forEach((id) => visibleIds.add(id));
      }
    }
    for (const edge of sourceEdges) {
      if (allowedIds.has(edge.from) && matchesEdgeQuery(edge, normalizedQuery)) {
        visibleIds.add(edge.from);
        visibleIds.add(edge.to);
      }
    }
  }
  const nodeSeeds = new Map<string, GraphNode>();

  for (const id of visibleIds) {
    const fn = functionMap.get(id);
    if (fn) {
      nodeSeeds.set(id, makeGraphNode(id, fn, graphNodeMap.get(id)));
    }
  }

  const rawEdges: SourceGraphEdge[] = [];
  sourceEdges.forEach((edge) => {
    if (edgeKind !== "all" && edge.kind !== edgeKind) return;
    const targetKnown = functionMap.has(edge.to);
    const sourceVisible = visibleIds.has(edge.from) || (normalizedQuery.length > 0 && allowedIds.has(edge.from) && matchesEdgeQuery(edge, normalizedQuery));
    const targetVisible = visibleIds.has(edge.to) || (normalizedQuery.length > 0 && allowedIds.has(edge.from) && matchesEdgeQuery(edge, normalizedQuery));
    const missingOrTagTarget = !targetKnown || edge.to.startsWith("#");
    const queryMatchesEdge = !normalizedQuery ||
      matchesEdgeQuery(edge, normalizedQuery) ||
      visibleIds.has(edge.from) ||
      visibleIds.has(edge.to);
    if (!queryMatchesEdge) return;
    if (!sourceVisible || (!targetVisible && !missingOrTagTarget)) return;

    rawEdges.push(edge);
    if (!nodeSeeds.has(edge.from)) {
      const fn = functionMap.get(edge.from);
      nodeSeeds.set(edge.from, makeGraphNode(edge.from, fn ?? null, graphNodeMap.get(edge.from)));
    }
    if (!nodeSeeds.has(edge.to)) {
      nodeSeeds.set(edge.to, makeGraphNode(edge.to, functionMap.get(edge.to) ?? null, graphNodeMap.get(edge.to)));
    }
  });

  const nodes = Array.from(nodeSeeds.values());
  for (const node of nodes) {
    node.degree = 0;
    node.inDegree = 0;
    node.outDegree = 0;
  }
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  rawEdges.forEach((edge, index) => {
    const source = nodeMap.get(edge.from);
    const target = nodeMap.get(edge.to);
    if (!source || !target) return;
    source.degree++;
    source.outDegree++;
    target.degree++;
    target.inDegree++;
    const label = edgeLabel(edge);
    edges.push({
      ...edge,
      id: edge.id ?? `${edge.from}->${edge.to}:${edge.kind}:${edge.line}:${index}`,
      callCount: edge.callCount,
      lines: edge.lines,
      conditionSummaries: edge.conditionSummaries,
      sampleCommands: edge.sampleCommands,
      selectors: edge.selectors,
      variablesRead: edge.variablesRead,
      variablesWritten: edge.variablesWritten,
      executeSummaries: edge.executeSummaries,
      label,
      labelWidth: clamp(label.length * 6.5 + 22, 72, 270),
      hasVariables: edge.variablesRead.length > 0 || edge.variablesWritten.length > 0,
      curveOffset: 0,
      source,
      target,
    });
  });

  assignEdgeOffsets(edges);

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
  const detailIndex = detailEdgeIndex(analysis.edges, analysis.commands ?? []);
  if (!analysis.graph?.edges?.length) {
    return analysis.edges.map((edge, index) => normalizeDetailedEdge(edge, index, detailIndex.get(edgeGroupKey(edge.from, edge.to, edge.kind)) ?? [edge]));
  }
  return analysis.graph.edges.map((edge, index) => ({
    ...normalizeDetailedEdge(
      {
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
      },
      index,
      detailIndex.get(edgeGroupKey(edge.from, edge.to, edge.kind)) ?? []
    ),
    callCount: edge.callCount,
    lines: uniqueNumbers([...(edge.lines ?? []), ...((detailIndex.get(edgeGroupKey(edge.from, edge.to, edge.kind)) ?? []).map((detail) => detail.line))]),
    conditionSummaries: uniqueStrings([...(edge.conditionSummaries ?? []), ...((detailIndex.get(edgeGroupKey(edge.from, edge.to, edge.kind)) ?? []).map((detail) => detail.conditionSummary ?? ""))]).filter(isMeaningfulSummary),
    sampleCommands: uniqueStrings([...(edge.sampleCommands ?? []), ...((detailIndex.get(edgeGroupKey(edge.from, edge.to, edge.kind)) ?? []).flatMap((detail) => [detail.effectiveCommand ?? "", detail.rawCommand ?? "", detail.command ?? ""]))]).filter(Boolean),
  }));
}

function normalizeDetailedEdge(edge: FunctionEdge, index: number, details: FunctionEdge[]): SourceGraphEdge {
  const detailSet = details.length ? details : [edge];
  const conditionSummaries = uniqueStrings([edge.conditionSummary ?? "", ...detailSet.map((detail) => detail.conditionSummary ?? "")]).filter(isMeaningfulSummary);
  const executeSummaries = uniqueStrings(detailSet.flatMap(executeSummariesForEdge)).filter(isMeaningfulSummary);
  const sampleCommands = uniqueStrings([edge.effectiveCommand ?? "", edge.rawCommand ?? "", edge.command ?? "", ...detailSet.flatMap((detail) => [detail.effectiveCommand ?? "", detail.rawCommand ?? "", detail.command ?? ""])]).filter(Boolean);
  const selectors = uniqueSelectors(detailSet.flatMap((detail) => detail.selectors ?? []));
  const variablesRead = uniqueStrings(detailSet.flatMap((detail) => detail.variablesRead ?? []));
  const variablesWritten = uniqueStrings(detailSet.flatMap((detail) => detail.variablesWritten ?? []));
  const lines = uniqueNumbers([edge.line, ...detailSet.map((detail) => detail.line)]).filter((line) => line > 0);
  return {
    ...edge,
    id: edge.id ?? `${edge.from}->${edge.to}:${edge.kind}:${edge.line}:${index}`,
    line: lines[0] ?? edge.line ?? 0,
    command: sampleCommands[0] ?? edge.command ?? "",
    rawCommand: edge.rawCommand ?? sampleCommands[0] ?? edge.command ?? "",
    effectiveCommand: edge.effectiveCommand ?? sampleCommands[0] ?? edge.command ?? "",
    conditionSummary: conditionSummaries[0] ?? "none",
    selectors,
    variablesRead,
    variablesWritten,
    callCount: Math.max(1, detailSet.length),
    lines,
    conditionSummaries,
    sampleCommands,
    executeSummaries,
  };
}

function detailEdgeIndex(edges: FunctionEdge[], commands: DatapackCommand[]): Map<string, FunctionEdge[]> {
  const index = new Map<string, FunctionEdge[]>();
  for (const edge of edges) {
    addDetailEdge(index, edgeGroupKey(edge.from, edge.to, edge.kind), edge);
  }
  for (const command of commands) {
    for (const call of command.calls) {
      const commandEdge: FunctionEdge = {
        id: `${command.id}:${call.kind}:${call.id}`,
        from: command.function,
        to: call.tag ? `#${call.id}` : call.id,
        kind: call.kind,
        viaTag: call.tag ? call.id : "none",
        line: command.line,
        command: command.effectiveCommand || command.rawCommand,
        rawCommand: command.rawCommand,
        effectiveCommand: command.effectiveCommand,
        conditionSummary: command.conditionSummary,
        execute: command.execute,
        selectors: command.selectors,
        variablesRead: command.variablesRead,
        variablesWritten: command.variablesWritten,
      };
      addDetailEdge(index, edgeGroupKey(commandEdge.from, commandEdge.to, commandEdge.kind), commandEdge);
    }
  }
  return index;
}

function addDetailEdge(index: Map<string, FunctionEdge[]>, key: string, edge: FunctionEdge) {
  const existing = index.get(key);
  if (existing) existing.push(edge);
  else index.set(key, [edge]);
}

function layoutForce(nodes: GraphNode[], edges: GraphEdge[]): { minX: number; minY: number; width: number; height: number } {
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
  const count = nodes.length;
  const modules = Array.from(new Set(nodes.map((node) => node.module || node.namespace || "unknown"))).sort();
  const moduleColumns = Math.max(1, Math.ceil(Math.sqrt(modules.length)));
  const moduleRows = Math.max(1, Math.ceil(modules.length / moduleColumns));
  const width = Math.max(1680, moduleColumns * 740 + 360, Math.ceil(Math.sqrt(count)) * 470);
  const height = Math.max(1080, moduleRows * 560 + 320, Math.ceil(Math.sqrt(count)) * 370);
  const centerX = width / 2;
  const centerY = height / 2;
  const velocities = new Map<string, { x: number; y: number }>();
  const ordered = nodes.slice().sort((a, b) => a.id.localeCompare(b.id));
  const moduleCenters = new Map<string, { x: number; y: number }>();

  modules.forEach((module, index) => {
    const column = index % moduleColumns;
    const row = Math.floor(index / moduleColumns);
    moduleCenters.set(module, {
      x: ((column + 1) / (moduleColumns + 1)) * width,
      y: ((row + 1) / (moduleRows + 1)) * height,
    });
  });

  ordered.forEach((node, index) => {
    const hash = hashString(node.id);
    const moduleCenter = moduleCenters.get(node.module || node.namespace || "unknown") ?? { x: centerX, y: centerY };
    const angle = ((hash % 360) * Math.PI) / 180 + (index / Math.max(1, ordered.length)) * 0.7;
    const ring = 130 + (hash % 300);
    node.x = moduleCenter.x + Math.cos(angle) * ring;
    node.y = moduleCenter.y + Math.sin(angle) * ring;
    velocities.set(node.id, { x: 0, y: 0 });
  });

  const linkPairs = uniqueLinks(edges);
  const iterations = count > 320 ? 120 : count > 160 ? 150 : 210;
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
        const force = Math.min(22000 / distanceSq, 5.8);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        av.x += fx;
        av.y += fy;
        bv.x -= fx;
        bv.y -= fy;

        const overlapX = (a.width + b.width) / 2 + 96 - Math.abs(dx);
        const overlapY = (a.height + b.height) / 2 + 70 - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          const push = Math.min(12, Math.min(overlapX, overlapY) * 0.14);
          if (overlapX < overlapY) {
            const sx = dx >= 0 ? 1 : -1;
            av.x += push * sx;
            bv.x -= push * sx;
          } else {
            const sy = dy >= 0 ? 1 : -1;
            av.y += push * sy;
            bv.y -= push * sy;
          }
        }
      }
    }

    for (const [source, target] of linkPairs) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const targetDistance = (source.width + target.width) * 0.72 + 220;
      const force = (distance - targetDistance) * 0.011;
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
      const moduleCenter = moduleCenters.get(node.module || node.namespace || "unknown") ?? { x: centerX, y: centerY };
      velocity.x += (moduleCenter.x - node.x) * 0.0032;
      velocity.y += (moduleCenter.y - node.y) * 0.0032;
      velocity.x += (centerX - node.x) * 0.00045;
      velocity.y += (centerY - node.y) * 0.00045;
      if (node.fn?.tickRoot) velocity.y -= 0.16;
      if (node.entrypoint === "noCaller") velocity.x -= 0.08;
      node.x = clamp(node.x + velocity.x, node.width / 2 + 120, width - node.width / 2 - 120);
      node.y = clamp(node.y + velocity.y, node.height / 2 + 110, height - node.height / 2 - 110);
      velocity.x *= 0.68;
      velocity.y *= 0.68;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.width / 2 - 240);
    minY = Math.min(minY, node.y - node.height / 2 - 190);
    maxX = Math.max(maxX, node.x + node.width / 2 + 240);
    maxY = Math.max(maxY, node.y + node.height / 2 + 190);
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

function makeGraphNode(id: string, fn: AnalyzedFunction | null, graphNode: DatapackGraphNode | undefined): GraphNode {
  const namespace = graphNode?.namespace ?? namespaceOf(id);
  const module = graphNode?.module ?? (fn?.pack || namespace || "unknown");
  const entrypoint = graphNode?.entrypoint ?? (fn?.tickRoot ? "tickRoot" : "none");
  const inDegree = graphNode?.inDegree ?? 0;
  const outDegree = graphNode?.outDegree ?? 0;
  const missing = !fn;
  const tag = id.startsWith("#");
  const title = truncateMiddle(id, missing ? 24 : 28);
  const subtitle = missing
    ? (tag ? "tag target" : "missing target")
    : [
        fn.tickRoot ? "tick root" : fn.tickFunction ? "tick chain" : moduleLabel(module),
        `${inDegree} in / ${outDegree} out`,
      ].filter(Boolean).join(" | ");
  return {
    id,
    fn,
    x: 0,
    y: 0,
    width: missing ? MISSING_NODE_WIDTH : Math.min(238, Math.max(NODE_WIDTH, title.length * 7 + 42)),
    height: missing ? MISSING_NODE_HEIGHT : NODE_HEIGHT,
    degree: graphNode?.degree ?? inDegree + outDegree,
    inDegree,
    outDegree,
    module,
    namespace,
    entrypoint,
    title,
    subtitle: truncateMiddle(subtitle, 34),
    missing,
    tag,
  };
}

function assignEdgeOffsets(edges: GraphEdge[]) {
  const groups = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const key = [edge.from, edge.to].sort().join("<>");
    const group = groups.get(key);
    if (group) group.push(edge);
    else groups.set(key, [edge]);
  }
  groups.forEach((group) => {
    group
      .sort((a, b) => a.kind.localeCompare(b.kind))
      .forEach((edge, index) => {
        edge.curveOffset = (index - (group.length - 1) / 2) * 36;
        if (edge.from > edge.to) edge.curveOffset *= -1;
      });
  });
}

function curvedEdgePath(edge: GraphEdge): string {
  if (edge.source.id === edge.target.id) {
    const x = edge.source.x + edge.source.width / 2;
    const y = edge.source.y - edge.source.height / 2;
    return `M ${round(x)} ${round(y)} C ${round(x + 90)} ${round(y - 90)} ${round(x - 90)} ${round(y - 90)} ${round(x)} ${round(y)}`;
  }
  const source = rectAnchor(edge.source, edge.target);
  const target = rectAnchor(edge.target, edge.source);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = -dy / distance;
  const ny = dx / distance;
  const curve = edge.curveOffset;
  const cx = (source.x + target.x) / 2 + nx * curve;
  const cy = (source.y + target.y) / 2 + ny * curve;
  return `M ${round(source.x)} ${round(source.y)} Q ${round(cx)} ${round(cy)} ${round(target.x)} ${round(target.y)}`;
}

function edgeLabelPosition(edge: GraphEdge): { x: number; y: number } {
  const source = rectAnchor(edge.source, edge.target);
  const target = rectAnchor(edge.target, edge.source);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = -dy / distance;
  const ny = dx / distance;
  const cx = (source.x + target.x) / 2 + nx * edge.curveOffset;
  const cy = (source.y + target.y) / 2 + ny * edge.curveOffset;
  return {
    x: source.x * 0.25 + cx * 0.5 + target.x * 0.25,
    y: source.y * 0.25 + cy * 0.5 + target.y * 0.25,
  };
}

function rectAnchor(from: GraphNode, to: GraphNode): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
    return { x: from.x, y: from.y };
  }
  const scale = 1 / Math.max(Math.abs(dx) / (from.width / 2), Math.abs(dy) / (from.height / 2), 0.01);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function shouldShowEdgeLabel(
  edge: GraphEdge,
  mode: EdgeLabelMode,
  selected: boolean,
  hovered: boolean,
  queryActive: boolean,
  edgeCount: number
): boolean {
  if (mode === "off") return selected || hovered;
  if (mode === "all") return true;
  if (selected || hovered || queryActive) return true;
  if (edge.callCount > 1) return true;
  if (edgeCount <= 18) return edge.conditionSummaries.length > 0 || edge.executeSummaries.length > 0;
  return edgeCount <= 36 && edge.label.length <= 20 && (edge.conditionSummaries.length > 0 || edge.executeSummaries.length > 0);
}

function edgeRenderRank(edge: GraphEdge, selected: GraphSelection, hoveredEdgeId: string | null): number {
  if (selected?.kind === "edge" && selected.id === edge.id) return 3;
  if (hoveredEdgeId === edge.id) return 2;
  if (edge.hasVariables) return 1;
  return 0;
}

function edgeLabel(edge: SourceGraphEdge): string {
  const condition = firstMeaningful(edge.conditionSummaries);
  const execute = firstMeaningful(edge.executeSummaries);
  const called = edge.callCount > 1 ? formatCalledTimes(edge.callCount) : "";
  if (condition && called) return truncateMiddle(`${condition} | ${called}`, 34);
  if (condition) return truncateMiddle(condition, 34);
  if (execute && called) return truncateMiddle(`${execute} | ${called}`, 34);
  if (execute) return truncateMiddle(execute, 34);
  if (called) return called;
  return edge.kind;
}

function edgeTooltip(edge: GraphEdge): string {
  const parts = [
    `${edge.from} -> ${edge.to}`,
    edge.kind,
    formatCalledTimes(edge.callCount),
    edge.conditionSummaries.length ? `conditions: ${edge.conditionSummaries.join("; ")}` : "",
    edge.selectors.length ? `selectors: ${edge.selectors.map(formatSelector).join("; ")}` : "",
    edge.variablesRead.length ? `reads: ${edge.variablesRead.join(", ")}` : "",
    edge.variablesWritten.length ? `writes: ${edge.variablesWritten.join(", ")}` : "",
    edge.sampleCommands.length ? `commands: ${edge.sampleCommands.join(" | ")}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function nodeTitle(node: GraphNode): string {
  return [
    node.id,
    node.module ? `module: ${node.module}` : "",
    node.entrypoint && node.entrypoint !== "none" ? `entrypoint: ${node.entrypoint}` : "",
    `${node.inDegree} incoming / ${node.outDegree} outgoing`,
  ].filter(Boolean).join("\n");
}

function matchesEdgeQuery(edge: SourceGraphEdge, query: string): boolean {
  return edge.from.toLowerCase().includes(query) ||
    edge.to.toLowerCase().includes(query) ||
    edge.kind.toLowerCase().includes(query) ||
    edge.command.toLowerCase().includes(query) ||
    edge.sampleCommands.some((command) => command.toLowerCase().includes(query)) ||
    edge.conditionSummaries.some((summary) => summary.toLowerCase().includes(query)) ||
    edge.executeSummaries.some((summary) => summary.toLowerCase().includes(query)) ||
    edge.selectors.some((selector) => formatSelector(selector).toLowerCase().includes(query)) ||
    edge.variablesRead.some((variable) => variable.toLowerCase().includes(query)) ||
    edge.variablesWritten.some((variable) => variable.toLowerCase().includes(query));
}

function executeSummariesForEdge(edge: FunctionEdge): string[] {
  const execute = edge.execute;
  if (!execute?.present) return [];
  return [
    ...(execute.conditions ?? []).map((clause) => clause.summary || clause.raw),
    ...(execute.contextModifiers ?? []).map((clause) => clause.summary || clause.raw),
    ...(execute.stores ?? []).map((clause) => clause.summary || clause.raw),
  ].filter(Boolean);
}

function edgeGroupKey(from: string, to: string, kind: string): string {
  return `${from}|${to}|${kind}`;
}

function firstMeaningful(values: string[] | undefined): string {
  return values?.find(isMeaningfulSummary) ?? "";
}

function isMeaningfulSummary(value: string | undefined): value is string {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 && normalized !== "none";
}

function formatCalledTimes(count: number): string {
  return `called ${count.toLocaleString()} ${count === 1 ? "time" : "times"}`;
}

function formatLines(lines: number[]): string {
  if (lines.length === 0) return "-";
  if (lines.length <= 6) return lines.join(", ");
  return `${lines.slice(0, 6).join(", ")} +${lines.length - 6}`;
}

function formatSelector(selector: SelectorRef): string {
  const filters = Object.entries(selector.filters ?? {})
    .slice(0, 4)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return filters ? `${selector.target}[${filters}]` : selector.raw || selector.target;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort((a, b) => a - b);
}

function uniqueSelectors(values: SelectorRef[]): SelectorRef[] {
  const seen = new Set<string>();
  const out: SelectorRef[] = [];
  for (const selector of values) {
    const key = `${selector.raw}|${selector.target}|${JSON.stringify(selector.filters ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(selector);
  }
  return out;
}

function moduleLabel(module: string): string {
  const slash = module.lastIndexOf("/");
  return slash >= 0 ? module.slice(slash + 1) : module;
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 5) return value.slice(0, maxLength);
  const keep = maxLength - 3;
  const head = Math.ceil(keep * 0.58);
  const tail = keep - head;
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
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
