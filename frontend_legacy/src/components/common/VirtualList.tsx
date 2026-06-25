import { useRef, useLayoutEffect, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import styles from './VirtualList.module.css';

interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  renderRow: (item: T, index: number) => ReactNode;
  onRowClick?: (item: T, index: number) => void;
  getKey: (item: T, index: number) => string | number;
  className?: string;
  emptyMessage?: string;
  scrollToIndex?: number;
}

export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  onRowClick,
  getKey,
  className,
  emptyMessage = 'No records.',
  scrollToIndex,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [parentWidth, setParentWidth] = useState(0);

  useLayoutEffect(() => {
    if (!parentRef.current) return;
    const el = parentRef.current;
    const update = () => setParentWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (index) => getKey(items[index], index),
  });

  useLayoutEffect(() => {
    if (scrollToIndex !== undefined && scrollToIndex >= 0 && scrollToIndex < items.length) {
      virtualizer.scrollToIndex(scrollToIndex, { align: 'center' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToIndex]);

  if (items.length === 0) {
    return <div className={`${styles.empty} ${className ?? ''}`}>{emptyMessage}</div>;
  }

  const items2 = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className={`${styles.scrollContainer} ${className ?? ''}`}>
      <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {items2.map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={styles.rowWrapper}
              onClick={onRowClick ? () => onRowClick(item, virtualRow.index) : undefined}
            >
              {renderRow(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
      {/* parentWidth referenced to keep measurement reactive */}
      <span hidden>{parentWidth}</span>
    </div>
  );
}
