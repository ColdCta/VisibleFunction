import { useTraceStore, type ConnectionStatus } from '../store/traceStore';
import styles from './ConnectionHeader.module.css';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'CONNECTING',
  connected: 'CONNECTED',
  disconnected: 'DISCONNECTED',
  reconnecting: 'RECONNECTING',
  mock: 'MOCK',
};

const STATUS_CLASS: Record<ConnectionStatus, string> = {
  connecting: styles.connecting,
  connected: styles.connected,
  disconnected: styles.disconnected,
  reconnecting: styles.reconnecting,
  mock: styles.mock,
};

interface ConnectionHeaderProps {
  onToggleMock: () => void;
  mockActive: boolean;
}

export function ConnectionHeader({ onToggleMock, mockActive }: ConnectionHeaderProps) {
  const status = useTraceStore((s) => s.status);
  const health = useTraceStore((s) => s.health);
  const baseUrl = useTraceStore((s) => s.baseUrl);
  const records = useTraceStore((s) => s.records);
  const lastRecordId = useTraceStore((s) => s.lastRecordId);
  const paused = useTraceStore((s) => s.paused);
  const togglePaused = useTraceStore((s) => s.togglePaused);

  const lastRecord = records.length > 0 ? records[records.length - 1] : null;

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <span className={`${styles.statusDot} ${STATUS_CLASS[status]}`} />
        <span className={`${styles.statusText} ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
        <span className={styles.baseUrl}>{baseUrl || '—'}</span>
        {health && (
          <span className={styles.healthInfo}>
            records: <strong>{health.records}</strong>
            {lastRecord && (
              <>
                {' '}| last id: <strong>#{lastRecordId}</strong>
              </>
            )}
          </span>
        )}
      </div>
      <div className={styles.right}>
        <button type="button" className={styles.button} onClick={togglePaused} title="Pause/Resume live stream">
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className={`${styles.button} ${mockActive ? styles.buttonActive : ''}`}
          onClick={onToggleMock}
          title="Toggle mock data mode"
        >
          {mockActive ? 'Mock: ON' : 'Mock: OFF'}
        </button>
        {status === 'disconnected' && (
          <span className={styles.hint}>Run /visiblefunction export start in Minecraft.</span>
        )}
      </div>
    </header>
  );
}
