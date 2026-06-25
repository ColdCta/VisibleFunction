import { useMemo, useState } from 'react';
import type { TraceRecord } from '../api/types';
import { hasFunction } from '../api/types';
import { useTraceStore } from '../store/traceStore';
import { groupRecords, filterRecords } from '../store/selectors';
import type { FilterState, GroupKey } from '../store/selectors';
import { TypeTag } from './common/TypeTag';
import { Badge } from './common/Badge';
import styles from './GroupedDashboard.module.css';

interface GroupedDashboardProps {
  filter: FilterState;
}

type Tab = GroupKey;

const TABS: { key: Tab; label: string }[] = [
  { key: 'commands', label: 'Commands' },
  { key: 'events', label: 'Events' },
  { key: 'functions', label: 'Functions' },
  { key: 'other', label: 'Other' },
];

export function GroupedDashboard({ filter }: GroupedDashboardProps) {
  const records = useTraceStore((s) => s.records);
  const selectRecord = useTraceStore((s) => s.selectRecord);
  const [tab, setTab] = useState<Tab>('commands');

  const grouped = useMemo(() => {
    const filtered = filterRecords(records, filter);
    return groupRecords(filtered);
  }, [records, filter]);

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className={styles.tabCount}>{grouped.counts[t.key]}</span>
          </button>
        ))}
      </div>
      <div className={styles.content}>
        {tab === 'commands' && (
          <GroupedByField
            title="By Command Type"
            groups={grouped.commandsByType}
            emptyMessage="No commands captured."
            onSelect={selectRecord}
          />
        )}
        {tab === 'events' && (
          <GroupedByField
            title="By Event Action"
            groups={grouped.eventsByAction}
            emptyMessage="No events captured."
            onSelect={selectRecord}
          />
        )}
        {tab === 'functions' && (
          <GroupedByField
            title="By Function"
            groups={grouped.functionsById}
            emptyMessage="No function-sourced records captured."
            onSelect={selectRecord}
            recordFunction
          />
        )}
        {tab === 'other' && (
          <RecordList title="Other Records" records={grouped.other} onSelect={selectRecord} />
        )}
      </div>
    </div>
  );
}

interface GroupedByFieldProps {
  title: string;
  groups: Map<string, TraceRecord[]>;
  emptyMessage: string;
  onSelect: (id: number) => void;
  recordFunction?: boolean;
}

function GroupedByField({ title, groups, emptyMessage, onSelect, recordFunction }: GroupedByFieldProps) {
  const entries = useMemo(() => Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length), [groups]);

  if (entries.length === 0) {
    return <div className={styles.empty}>{emptyMessage}</div>;
  }

  return (
    <div className={styles.groupScroll}>
      <div className={styles.groupTitle}>{title}</div>
      {entries.map(([key, recs]) => (
        <div key={key} className={styles.groupSection}>
          <div className={styles.groupHeader}>
            <span className={styles.groupKey}>{key}</span>
            <Badge variant="accent">{recs.length}</Badge>
          </div>
          <div className={styles.groupRecords}>
            {recs.slice(-5).reverse().map((r) => (
              <RecordRow key={r.id} record={r} onSelect={onSelect} showFunction={recordFunction} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface RecordListProps {
  title: string;
  records: TraceRecord[];
  onSelect: (id: number) => void;
}

function RecordList({ title, records, onSelect }: RecordListProps) {
  if (records.length === 0) {
    return <div className={styles.empty}>No other records captured.</div>;
  }
  return (
    <div className={styles.groupScroll}>
      <div className={styles.groupTitle}>{title}</div>
      <div className={styles.groupRecords}>
        {records.slice(-50).reverse().map((r) => (
          <RecordRow key={r.id} record={r} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

interface RecordRowProps {
  record: TraceRecord;
  onSelect: (id: number) => void;
  showFunction?: boolean;
}

function RecordRow({ record, onSelect, showFunction }: RecordRowProps) {
  const fn = hasFunction(record);
  const summary = record.summary || record.eventAction || '';
  return (
    <div className={styles.recordRow} onClick={() => onSelect(record.id)}>
      <div className={styles.recordRowMain}>
        <span className={styles.recordId}>#{record.id}</span>
        <TypeTag type={record.type} functionSource={fn} />
        <span className={styles.recordSubject} title={record.subject}>{record.subject}</span>
      </div>
      <div className={styles.recordRowSub}>
        <span className={styles.recordSummary} title={summary}>{summary}</span>
        {showFunction && fn && (
          <span className={styles.recordFunction}>{record.commandContext.function}</span>
        )}
      </div>
    </div>
  );
}
