import styles from './SearchBar.module.css';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder }: SearchBarProps) {
  return (
    <div className={styles.search}>
      <span className={styles.icon}>search</span>
      <input
        type="text"
        className={styles.input}
        value={value}
        placeholder={placeholder ?? 'search subject / summary / command / function / fields'}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {value && (
        <button type="button" className={styles.clear} onClick={() => onChange('')} title="Clear search">
          x
        </button>
      )}
    </div>
  );
}
