import { useEffect, useMemo, useState } from 'react';
import { useStream } from './hooks/useStream';
import { startMockServer } from './mock/mockServer';
import { useTraceStore } from './store/traceStore';
import { distinctOptions } from './store/selectors';
import type { FilterState } from './store/selectors';
import { ConnectionHeader } from './components/ConnectionHeader';
import { SearchBar } from './components/SearchBar';
import { Filters } from './components/Filters';
import { TraceList } from './components/TraceList';
import { GroupedDashboard } from './components/GroupedDashboard';
import { RecordDetail } from './components/RecordDetail';
import { FunctionTrace } from './components/FunctionTrace';
import { Timeline } from './components/Timeline';
import styles from './App.module.css';

type View = 'list' | 'grouped' | 'function';

const VIEW_LABELS: Record<View, string> = {
  list: 'Trace List',
  grouped: 'Grouped',
  function: 'Function Tree',
};

function readInitialMock(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mock') === '1' || params.get('mock') === 'true';
}

export function App() {
  const [mockActive, setMockActive] = useState(readInitialMock());
  useStream({ mock: mockActive });

  const [view, setView] = useState<View>('list');
  const [filter, setFilter] = useState<FilterState>({
    typeFilter: 'all',
    commandType: '',
    eventAction: '',
    source: '',
    search: '',
  });
  const [sharedSearch, setSharedSearch] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);

  const records = useTraceStore((s) => s.records);
  const options = useMemo(() => distinctOptions(records), [records]);

  useEffect(() => {
    if (!mockActive) return;
    const stop = startMockServer(2500);
    return stop;
  }, [mockActive]);

  const effectiveFilter: FilterState = useMemo(
    () => ({ ...filter, search: sharedSearch }),
    [filter, sharedSearch],
  );

  return (
    <div className={styles.app}>
      <ConnectionHeader onToggleMock={() => setMockActive((v) => !v)} mockActive={mockActive} />

      <div className={styles.controls}>
        <div className={styles.viewTabs}>
          {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`${styles.viewTab} ${view === v ? styles.viewTabActive : ''}`}
              onClick={() => setView(v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        <div className={styles.searchArea}>
          <SearchBar value={sharedSearch} onChange={setSharedSearch} />
        </div>
        <div className={styles.filterArea}>
          <Filters filter={filter} onChange={setFilter} options={options} />
        </div>
      </div>

      <div className={styles.main}>
        <div className={styles.left}>
          {view === 'list' && (
            <TraceList
              filter={effectiveFilter}
              newestFirst={newestFirst}
              onToggleOrder={() => setNewestFirst((v) => !v)}
            />
          )}
          {view === 'grouped' && <GroupedDashboard filter={effectiveFilter} />}
          {view === 'function' && <FunctionTrace search={sharedSearch} />}
        </div>
        <div className={styles.right}>
          <RecordDetail />
        </div>
      </div>

      <div className={styles.timelineArea}>
        <Timeline />
      </div>
    </div>
  );
}
