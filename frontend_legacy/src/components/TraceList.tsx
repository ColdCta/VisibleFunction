import { useMemo } from 'react';
import type { TraceRecord } from '../api/types';
import { hasFunction } from '../api/types';
import { useTraceStore } from '../store/traceStore';
import { filterRecords } from '../store/selectors';
import type { FilterState } from '../store/selectors';
import { VirtualList } from './common/VirtualList';
import { TypeTag } from './common/TypeTag';
import styles from './TraceList.module.css';

interface TraceListProps {
  filter: FilterState;
  newestFirst: boolean;
  onToggleOrder: () => void;
}

const ROW_HEIGHT = 44;

export function TraceList({ filter, newestFirst, onToggleOrder }: TraceListProps) {
  const records = useTraceStore((s) => s.records);
  const selectedRecordId = useTraceStore((s) => s.selectedRecordId);
  const selectRecord = useTraceStore((s) => s.selectRecord);

  const filtered = useMemo(() => filterRecords(records, filter), [records, filter]);
  const ordered = useMemo(
    () => (newestFirst ? [...filtered].reverse() : filtered),
    [filtered, newestFirst],
  );

  const selectedIndex = useMemo(() => {
    if (selectedRecordId == null) return undefined;
    return ordered.findIndex((r) => r.id === selectedRecordId);
  }, [ordered, selectedRecordId]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <span className={styles.count}>{filtered.length} records</span>
        <button type="button" className={styles.orderButton} onClick={onToggleOrder}>
          {newestFirst ? 'newest first ↓' : 'oldest first ↑'}
        </button>
      </div>
      <div className={styles.listArea}>
        <VirtualList
          items={ordered}
          rowHeight={ROW_HEIGHT}
          getKey={(r) => r.id}
          scrollToIndex={selectedIndex}
          emptyMessage="No matching records. Run /visiblefunction export start in Minecraft."
          renderRow={(record) => (
            <TraceRow
              record={record}
              selected={record.id === selectedRecordId}
              onClick={() => selectRecord(record.id)}
            />
          )}
        />
      </div>
    </div>
  );
}

interface TraceRowProps {
  record: TraceRecord;
  selected: boolean;
  onClick: () => void;
}

function TraceRow({ record, selected, onClick }: TraceRowProps) {
  const fn = hasFunction(record);
  const summary = record.summary || record.eventAction || '';
  return (
    <div className={`${styles.row} ${selected ? styles.rowSelected : ''}`} onClick={onClick}>
      <div className={styles.rowMain}>
        <span className={styles.id}>#{record.id}</span>
        <TypeTag type={record.type} functionSource={fn} />
        <span className={styles.subject} title={record.subject}>{record.subject}</span>
      </div>
      <div className={styles.rowSub}>
        <span className={styles.summary} title={summary}>{summary}</span>
        {fn && <span className={styles.function} title={record.commandContext.function}>{record.commandContext.function}</span>}
        {!fn && record.commandContext.source !== 'unknown' && (
          <span className={styles.source}>{record.commandContext.source}</span>
        )}
      </div>
    </div>
  );
}
