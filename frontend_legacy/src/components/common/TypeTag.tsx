import type { RecordType } from '../../api/types';
import styles from './TypeTag.module.css';

interface TypeTagProps {
  type: RecordType;
  functionSource?: boolean;
}

const LABELS: Record<string, string> = {
  COMMAND: 'COMMAND',
  EVENT: 'EVENT',
};

export function TypeTag({ type, functionSource }: TypeTagProps) {
  const cls = type === 'COMMAND' ? 'command' : type === 'EVENT' ? 'event' : 'other';
  const label = LABELS[type] ?? type;
  return (
    <span className={`${styles.tag} ${styles[cls]} ${functionSource ? styles.fn : ''}`}>
      {label}
    </span>
  );
}
