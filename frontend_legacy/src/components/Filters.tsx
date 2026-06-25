import type { FilterState, TypeFilter } from '../store/selectors';
import type { DistinctOptions } from '../store/selectors';
import styles from './Filters.module.css';

interface FiltersProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
  options: DistinctOptions;
}

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'commands', label: 'Commands' },
  { key: 'events', label: 'Events' },
  { key: 'function', label: 'Function' },
  { key: 'hidePlayer', label: 'Hide Player' },
];

export function Filters({ filter, onChange, options }: FiltersProps) {
  return (
    <div className={styles.filters}>
      <div className={styles.typeRow}>
        {TYPE_FILTERS.map((tf) => (
          <button
            key={tf.key}
            type="button"
            className={`${styles.chip} ${filter.typeFilter === tf.key ? styles.chipActive : ''}`}
            onClick={() => onChange({ ...filter, typeFilter: tf.key })}
          >
            {tf.label}
          </button>
        ))}
      </div>
      <div className={styles.selectRow}>
        <select
          className={styles.select}
          value={filter.commandType}
          onChange={(e) => onChange({ ...filter, commandType: e.target.value })}
        >
          <option value="">cmd type: any</option>
          {options.commandTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          className={styles.select}
          value={filter.eventAction}
          onChange={(e) => onChange({ ...filter, eventAction: e.target.value })}
        >
          <option value="">event action: any</option>
          {options.eventActions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          className={styles.select}
          value={filter.source}
          onChange={(e) => onChange({ ...filter, source: e.target.value })}
        >
          <option value="">source: any</option>
          {options.sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
