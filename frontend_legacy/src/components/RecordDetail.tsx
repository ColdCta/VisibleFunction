import { useMemo } from 'react';
import type { TraceRecord } from '../api/types';
import { useTraceStore } from '../store/traceStore';
import { TypeTag } from './common/TypeTag';
import { Badge } from './common/Badge';
import styles from './RecordDetail.module.css';

export function RecordDetail() {
  const selectedRecordId = useTraceStore((s) => s.selectedRecordId);
  const recordById = useTraceStore((s) => s.recordById);
  const selectRecord = useTraceStore((s) => s.selectRecord);
  const commandFor = useTraceStore((s) => s.commandFor);
  const eventsForCommand = useTraceStore((s) => s.eventsForCommand);

  const record = selectedRecordId != null ? recordById(selectedRecordId) : undefined;

  const childEvents = useMemo<TraceRecord[]>(() => {
    if (!record || record.type !== 'COMMAND') return [];
    return eventsForCommand(record.commandContext.commandId);
  }, [record, eventsForCommand]);

  const causedByCommand = useMemo<TraceRecord | undefined>(() => {
    if (!record || record.type !== 'EVENT') return undefined;
    return commandFor(record);
  }, [record, commandFor]);

  if (!record) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Select a record to inspect details.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.scrollArea}>
        <DetailSection record={record} />

        {record.type === 'COMMAND' && childEvents.length > 0 && (
          <RelationshipPanel
            title="Child Events"
            count={childEvents.length}
            records={childEvents}
            onSelect={selectRecord}
          />
        )}

        {record.type === 'EVENT' && causedByCommand && (
          <RelationshipPanel
            title="Caused By Command"
            count={1}
            records={[causedByCommand]}
            onSelect={selectRecord}
          />
        )}

        {record.type === 'EVENT' && !causedByCommand && (
          <div className={styles.note}>No matching source command in local store.</div>
        )}
      </div>
    </div>
  );
}

interface DetailSectionProps {
  record: TraceRecord;
}

function DetailSection({ record }: DetailSectionProps) {
  const allFields = { ...record.basicFields, ...record.detailedFields };
  const deduped = Object.entries(allFields);
  const seen = new Set<string>();
  const fields = deduped.filter(([k]) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <div className={styles.detailSection}>
      <div className={styles.detailHeader}>
        <span className={styles.detailId}>#{record.id}</span>
        <TypeTag type={record.type} />
        <span className={styles.detailSubject} title={record.subject}>{record.subject}</span>
        {record.summary && <span className={styles.detailSummary}>{record.summary}</span>}
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>id</span>
        <span className={styles.metaValue}>{record.id}</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>type</span>
        <span className={styles.metaValue}>{record.type}</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>commandType</span>
        <span className={styles.metaValue}>{record.commandType}</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>eventAction</span>
        <span className={styles.metaValue}>{record.eventAction}</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>groups</span>
        <span className={styles.metaValue}>{record.groups.join(', ')}</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>timestamp</span>
        <span className={styles.metaValue}>{new Date(record.timestampMillis).toISOString()}</span>
      </div>
      <div className={styles.sectionTitle}>Command Context</div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>command</span>
        <span className={styles.metaValueMono}>{record.commandContext.command}</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>commandId</span>
        <span className={styles.metaValueMono}>{record.commandContext.commandId}</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>source</span>
        <span className={styles.metaValue}>{record.commandContext.source}</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>function</span>
        <span className={styles.metaValueMono}>{record.commandContext.function}</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>functionCallId</span>
        <span className={styles.metaValueMono}>{record.commandContext.functionCallId}</span>
      </div>
      <div className={styles.sectionTitle}>Basic Fields</div>
      {Object.entries(record.basicFields).map(([k, v]) => (
        <div key={k} className={styles.metaRow}>
          <span className={styles.metaLabel}>{k}</span>
          <span className={styles.metaValueMono}>{v}</span>
        </div>
      ))}
      <div className={styles.sectionTitle}>Detailed Fields</div>
      {fields.map(([k, v]) => (
        <div key={k} className={styles.metaRow}>
          <span className={styles.metaLabel}>{k}</span>
          <span className={styles.metaValueMono}>{v}</span>
        </div>
      ))}
    </div>
  );
}

interface RelationshipPanelProps {
  title: string;
  count: number;
  records: TraceRecord[];
  onSelect: (id: number) => void;
}

function RelationshipPanel({ title, count, records, onSelect }: RelationshipPanelProps) {
  return (
    <div className={styles.relationship}>
      <div className={styles.relationshipHeader}>
        <span className={styles.relationshipTitle}>{title}</span>
        <Badge variant="accent">{count}</Badge>
      </div>
      <div className={styles.relationshipList}>
        {records.map((r) => (
          <div key={r.id} className={styles.relatedRow} onClick={() => onSelect(r.id)}>
            <span className={styles.relatedId}>#{r.id}</span>
            <TypeTag type={r.type} />
            <span className={styles.relatedSubject} title={r.subject}>{r.subject}</span>
            <span className={styles.relatedSummary}>{r.summary || r.eventAction}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
