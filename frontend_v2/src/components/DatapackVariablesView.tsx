import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DatapackAnalysisResponse, DatapackVariable, VariableOccurrence } from "../api/types";

export type VariableSort = "usage" | "key" | "reads" | "writes" | "kind";
export type VariableAccessFilter = "all" | "read" | "write" | "update" | "query" | "declare" | "remove";

type VariableRow = {
  variable: DatapackVariable;
  usage: number;
  occurrenceCount: number;
  functionCount: number;
  functions: string[];
};

type VariableModel = {
  rows: VariableRow[];
  kinds: string[];
  accessKinds: string[];
  kindCounts: Map<string, number>;
  variableMap: Map<string, DatapackVariable>;
};

export function DatapackVariablesView({
  analysis,
  query,
  kindFilter,
  accessFilter,
  sort,
  selectedVariableKey,
  onSelectVariable,
  onSelectFunction,
}: {
  analysis: DatapackAnalysisResponse | null;
  query: string;
  kindFilter: string;
  accessFilter: VariableAccessFilter;
  sort: VariableSort;
  selectedVariableKey: string | null;
  onSelectVariable: (key: string) => void;
  onSelectFunction: (id: string) => void;
}) {
  const model = useMemo(
    () => buildVariableModel(analysis, query, kindFilter, accessFilter, sort),
    [analysis, accessFilter, kindFilter, query, sort]
  );
  const selectedVariable = selectedVariableKey
    ? model.variableMap.get(selectedVariableKey) ?? null
    : null;

  const tableRef = useRef<HTMLDivElement>(null);
  const tableVirtualizer = useVirtualizer({
    count: model.rows.length,
    getScrollElement: () => tableRef.current,
    estimateSize: () => 54,
    overscan: 10,
  });

  return (
    <>
      <section className="datapack-variables" aria-label="Datapack variables">
        <div className="datapack-variables__summary">
          <strong>{model.rows.length.toLocaleString()}</strong>
          <span>visible variables</span>
          {model.kinds.slice(0, 6).map((kind) => (
            <em key={kind}>{kind}: {model.kindCounts.get(kind)?.toLocaleString() ?? 0}</em>
          ))}
        </div>
        <div className="datapack-variable-table">
          <div className="datapack-variable-table__head">
            <span>Variable</span>
            <span>Kind</span>
            <span>Reads</span>
            <span>Writes</span>
            <span>Occurrences</span>
            <span>Functions</span>
          </div>
          <div ref={tableRef} className="datapack-variable-table__body">
            {model.rows.length === 0 ? (
              <div className="datapack-variable-table__empty">No variables match the current filters.</div>
            ) : (
              <div style={{ height: tableVirtualizer.getTotalSize(), position: "relative" }}>
                {tableVirtualizer.getVirtualItems().map((item) => {
                  const row = model.rows[item.index];
                  const selected = row.variable.key === selectedVariableKey;
                  return (
                    <button
                      key={row.variable.key}
                      className={"datapack-variable-row" + (selected ? " is-selected" : "")}
                      style={{ transform: `translateY(${item.start}px)` }}
                      onClick={() => onSelectVariable(row.variable.key)}
                      title={row.variable.key}
                    >
                      <span className="datapack-variable-row__key mono">{row.variable.key}</span>
                      <span className={`datapack-variable-kind datapack-variable-kind--${safeClass(row.variable.kind)}`}>{row.variable.kind}</span>
                      <span className="mono">{row.variable.reads.toLocaleString()}</span>
                      <span className="mono">{row.variable.writes.toLocaleString()}</span>
                      <span className="mono">{row.occurrenceCount.toLocaleString()}</span>
                      <span className="mono">{row.functionCount.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
      <VariableInspector
        variable={selectedVariable}
        accessFilter={accessFilter}
        onSelectFunction={onSelectFunction}
      />
    </>
  );
}

export function buildVariableModel(
  analysis: DatapackAnalysisResponse | null,
  query: string,
  kindFilter: string,
  accessFilter: VariableAccessFilter,
  sort: VariableSort
): VariableModel {
  const variables = analysis?.variables ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const kinds = Array.from(new Set(variables.map((variable) => variable.kind).filter(Boolean))).sort();
  const accessKinds = Array.from(new Set(variables.flatMap((variable) => variable.occurrences.map((occurrence) => occurrence.access)))).sort();
  const kindCounts = new Map<string, number>();
  const rows: VariableRow[] = [];

  for (const variable of variables) {
    kindCounts.set(variable.kind, (kindCounts.get(variable.kind) ?? 0) + 1);
    if (kindFilter !== "all" && variable.kind !== kindFilter) continue;
    if (accessFilter !== "all" && !variable.occurrences.some((occurrence) => occurrence.access === accessFilter)) continue;
    if (normalizedQuery && !matchesVariable(variable, normalizedQuery)) continue;
    const functions = Array.from(new Set(variable.occurrences.map((occurrence) => occurrence.function))).sort();
    const occurrenceCount = variable.occurrences.length;
    rows.push({
      variable,
      occurrenceCount,
      functionCount: functions.length,
      functions,
      usage: variable.reads + variable.writes + occurrenceCount,
    });
  }

  rows.sort((a, b) => compareVariableRows(a, b, sort));
  return {
    rows,
    kinds,
    accessKinds,
    kindCounts,
    variableMap: new Map(variables.map((variable) => [variable.key, variable])),
  };
}

export function variableAccessKinds(analysis: DatapackAnalysisResponse | null): string[] {
  return Array.from(new Set((analysis?.variables ?? []).flatMap((variable) => variable.occurrences.map((occurrence) => occurrence.access)))).sort();
}

function VariableInspector({
  variable,
  accessFilter,
  onSelectFunction,
}: {
  variable: DatapackVariable | null;
  accessFilter: VariableAccessFilter;
  onSelectFunction: (id: string) => void;
}) {
  const occurrenceRef = useRef<HTMLDivElement>(null);
  const occurrences = useMemo(
    () => variable ? filterOccurrences(variable.occurrences, accessFilter) : [],
    [accessFilter, variable]
  );
  const occurrenceVirtualizer = useVirtualizer({
    count: occurrences.length,
    getScrollElement: () => occurrenceRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  if (!variable) {
    return (
      <aside className="datapack-inspector datapack-variable-inspector">
        <div className="datapack-inspector__title">Selected Variable</div>
        <div className="datapack-inspector__empty">Select a variable to inspect occurrences.</div>
      </aside>
    );
  }

  return (
    <aside className="datapack-inspector datapack-variable-inspector">
      <div className="datapack-inspector__title">Selected Variable</div>
      <div className="datapack-inspector__kv">
        <InfoRow label="Key" value={variable.key} />
        <InfoRow label="Kind" value={variable.kind} />
        <InfoRow label="Name" value={variable.name} />
        <InfoRow label="Reads" value={variable.reads.toLocaleString()} />
        <InfoRow label="Writes" value={variable.writes.toLocaleString()} />
        <InfoRow label="Occurrences" value={variable.occurrences.length.toLocaleString()} />
      </div>
      <div className="datapack-inspector__title">Occurrences</div>
      <div ref={occurrenceRef} className="datapack-variable-occurrences">
        {occurrences.length === 0 ? (
          <div className="datapack-inspector__empty">No occurrences match this access filter.</div>
        ) : (
          <div style={{ height: occurrenceVirtualizer.getTotalSize(), position: "relative" }}>
            {occurrenceVirtualizer.getVirtualItems().map((item) => {
              const occurrence = occurrences[item.index];
              return (
                <div
                  key={`${occurrence.function}:${occurrence.line}:${item.index}`}
                  className="datapack-variable-occurrence"
                  style={{ transform: `translateY(${item.start}px)` }}
                  title={occurrence.command}
                >
                  <button onClick={() => onSelectFunction(occurrence.function)} className="mono">
                    {occurrence.function}:{occurrence.line}
                  </button>
                  <span className={`datapack-variable-access datapack-variable-access--${safeClass(occurrence.access)}`}>
                    {occurrence.access}
                  </span>
                  <code>{occurrence.command}</code>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="datapack-inspector__kv-row">
      <span>{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}

function filterOccurrences(occurrences: VariableOccurrence[], accessFilter: VariableAccessFilter): VariableOccurrence[] {
  if (accessFilter === "all") return occurrences;
  return occurrences.filter((occurrence) => occurrence.access === accessFilter);
}

function matchesVariable(variable: DatapackVariable, query: string): boolean {
  return variable.key.toLowerCase().includes(query) ||
    variable.name.toLowerCase().includes(query) ||
    variable.kind.toLowerCase().includes(query) ||
    variable.occurrences.some((occurrence) =>
      occurrence.function.toLowerCase().includes(query) ||
      occurrence.command.toLowerCase().includes(query) ||
      occurrence.access.toLowerCase().includes(query)
    );
}

function compareVariableRows(a: VariableRow, b: VariableRow, sort: VariableSort): number {
  if (sort === "key") return a.variable.key.localeCompare(b.variable.key);
  if (sort === "reads") return b.variable.reads - a.variable.reads || a.variable.key.localeCompare(b.variable.key);
  if (sort === "writes") return b.variable.writes - a.variable.writes || a.variable.key.localeCompare(b.variable.key);
  if (sort === "kind") return a.variable.kind.localeCompare(b.variable.kind) || a.variable.key.localeCompare(b.variable.key);
  return b.usage - a.usage || a.variable.key.localeCompare(b.variable.key);
}

function safeClass(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}
