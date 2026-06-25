import { useMemo } from 'react';
import { useTraceStore } from '../store/traceStore';
import { buildFunctionTree } from '../store/selectors';
import type { FunctionTreeNode } from '../store/selectors';
import type { TraceRecord } from '../api/types';
import { TypeTag } from './common/TypeTag';
import { Badge } from './common/Badge';
import styles from './FunctionTrace.module.css';

interface FunctionTraceProps {
  search: string;
}

export function FunctionTrace({ search }: FunctionTraceProps) {
  const indexes = useTraceStore((s) => s.indexes);
  const selectRecord = useTraceStore((s) => s.selectRecord);
  const selectedRecordId = useTraceStore((s) => s.selectedRecordId);

  const tree = useMemo(
    () => buildFunctionTree(indexes.recordsByFunctionCallId, indexes.functionCallsByFunctionId),
    [indexes],
  );

  const filtered = useMemo(() => filterTreeBySearch(tree, search), [tree, search]);

  if (filtered.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>No function call records yet.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.scrollArea}>
        {filtered.map((node) => (
          <FunctionCallNode
            key={`${node.functionId}-${node.functionCallId}`}
            node={node}
            onSelect={selectRecord}
            selectedRecordId={selectedRecordId}
          />
        ))}
      </div>
    </div>
  );
}

function filterTreeBySearch(tree: FunctionTreeNode[], search: string): FunctionTreeNode[] {
  const q = search.trim().toLowerCase();
  if (!q) return tree;
  const result: FunctionTreeNode[] = [];
  for (const node of tree) {
    if (node.functionId.toLowerCase().includes(q)) {
      result.push(node);
      continue;
    }
    const matchingChildren = node.children.filter((cmd) =>
      cmd.command.toLowerCase().includes(q) ||
      cmd.commandId.toLowerCase().includes(q) ||
      cmd.events.some((e) => recordMatches(e, q)) ||
      (cmd.commandRecord != null && recordMatches(cmd.commandRecord, q)),
    );
    if (matchingChildren.length > 0) {
      result.push({ ...node, children: matchingChildren });
    }
  }
  return result;
}

function recordMatches(record: TraceRecord, q: string): boolean {
  return (
    record.subject.toLowerCase().includes(q) ||
    record.summary.toLowerCase().includes(q) ||
    record.eventAction.toLowerCase().includes(q) ||
    record.type.toLowerCase().includes(q)
  );
}

interface FunctionCallNodeProps {
  node: FunctionTreeNode;
  onSelect: (id: number) => void;
  selectedRecordId: number | null;
}

function FunctionCallNode({ node, onSelect, selectedRecordId }: FunctionCallNodeProps) {
  const lastRecord = node.records[node.records.length - 1];
  const relative = lastRecord ? relativeTime(lastRecord.timestampMillis) : '';
  return (
    <div className={styles.functionNode}>
      <div className={styles.functionHeader}>
        <span className={styles.functionName}>{node.functionId}</span>
        <span className={styles.callId}>call #{node.functionCallId}</span>
        {relative && <span className={styles.relativeTime}>{relative}</span>}
        <Badge variant="function">{node.children.length} cmds</Badge>
      </div>
      <div className={styles.children}>
        {node.children.map((cmd, i) => {
          const isLast = i === node.children.length - 1;
          return (
            <CommandBranch
              key={`${cmd.commandId}-${cmd.command}`}
              commandId={cmd.commandId}
              command={cmd.command}
              commandRecord={cmd.commandRecord}
              events={cmd.events}
              isLast={isLast}
              onSelect={onSelect}
              selectedRecordId={selectedRecordId}
            />
          );
        })}
      </div>
    </div>
  );
}

interface CommandBranchProps {
  commandId: string;
  command: string;
  commandRecord: TraceRecord | null;
  events: TraceRecord[];
  isLast: boolean;
  onSelect: (id: number) => void;
  selectedRecordId: number | null;
}

function CommandBranch({ command, commandRecord, events, isLast, onSelect, selectedRecordId }: CommandBranchProps) {
  const prefix = isLast ? '└─ ' : '├─ ';
  const childPrefix = isLast ? '   ' : '│  ';
  return (
    <div className={styles.commandBranch}>
      <div
        className={`${styles.commandLine} ${commandRecord && commandRecord.id === selectedRecordId ? styles.selected : ''}`}
        onClick={commandRecord ? () => onSelect(commandRecord.id) : undefined}
      >
        <span className={styles.treePrefix}>{prefix}</span>
        <TypeTag type="COMMAND" />
        {commandRecord && <span className={styles.recordId}>#{commandRecord.id}</span>}
        <span className={styles.commandText} title={command}>{command}</span>
      </div>
      <div className={styles.eventChildren}>
        {events.map((event, i) => {
          const eventLast = i === events.length - 1;
          return (
            <div
              key={event.id}
              className={`${styles.eventLine} ${event.id === selectedRecordId ? styles.selected : ''}`}
              onClick={() => onSelect(event.id)}
            >
              <span className={styles.treePrefix}>{childPrefix}{eventLast ? '└─ ' : '├─ '}</span>
              <TypeTag type="EVENT" />
              <span className={styles.recordId}>#{event.id}</span>
              <span className={styles.eventSubject} title={event.subject}>{event.subject}</span>
              <span className={styles.eventSummary}>{event.summary || event.eventAction}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function relativeTime(timestampMillis: number): string {
  const age = Math.max(0, Date.now() - timestampMillis);
  if (age < 1000) return 'now';
  if (age < 60_000) return Math.floor(age / 1000) + 's ago';
  if (age < 3_600_000) return Math.floor(age / 60_000) + 'm ago';
  return Math.floor(age / 3_600_000) + 'h ago';
}
