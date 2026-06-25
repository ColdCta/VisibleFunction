import { useEffect, useRef } from 'react';

export interface RafBatchFlusher<T> {
  push: (item: T) => void;
  flush: () => void;
}

export function useRafBatch<T>(onFlush: (items: T[]) => void): RafBatchFlusher<T> {
  const bufferRef = useRef<T[]>([]);
  const scheduledRef = useRef(false);
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;

  const flush = () => {
    scheduledRef.current = false;
    const items = bufferRef.current;
    if (items.length === 0) return;
    bufferRef.current = [];
    onFlushRef.current(items);
  };

  const push = (item: T) => {
    bufferRef.current.push(item);
    if (!scheduledRef.current) {
      scheduledRef.current = true;
      requestAnimationFrame(flush);
    }
  };

  useEffect(() => {
    return () => {
      bufferRef.current = [];
      scheduledRef.current = false;
    };
  }, []);

  return { push, flush };
}
