import { useEffect, useRef } from 'react';
import { createClient, type VisibleFunctionClient } from '../api/visibleFunctionClient';
import type { TraceRecord } from '../api/types';
import { useTraceStore, type ConnectionStatus } from '../store/traceStore';
import { useRafBatch } from './useRafBatch';

interface UseStreamOptions {
  baseUrl?: string;
  mock?: boolean;
}

export function useStream(options: UseStreamOptions = {}): void {
  const mock = options.mock ?? false;
  const baseUrl = options.baseUrl;
  const setStatus = useTraceStore((s) => s.setStatus);
  const setHealth = useTraceStore((s) => s.setHealth);
  const setBaseUrl = useTraceStore((s) => s.setBaseUrl);
  const backfill = useTraceStore((s) => s.backfill);
  const appendRecordBatch = useTraceStore((s) => s.appendRecordBatch);
  const lastRecordId = useTraceStore((s) => s.lastRecordId);
  const paused = useTraceStore((s) => s.paused);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const lastIdRef = useRef(lastRecordId);
  lastIdRef.current = lastRecordId;

  const { push, flush } = useRafBatch<TraceRecord>((items) => {
    appendRecordBatch(items);
  });

  useEffect(() => {
    if (mock) {
      setStatus('mock');
      return;
    }

    let cancelled = false;
    let client: VisibleFunctionClient | null = null;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let status: ConnectionStatus = 'connecting';

    const updateStatus = (next: ConnectionStatus) => {
      if (cancelled) return;
      status = next;
      setStatus(next);
    };

    const connect = () => {
      if (cancelled) return;
      client = createClient(baseUrl);
      setBaseUrl(client.baseUrl);
      updateStatus('connecting');

      client
        .health()
        .then((health) => {
          if (cancelled || !client) return;
          setHealth(health);
          if (!health.running) {
            updateStatus('disconnected');
            scheduleReconnect();
            return;
          }
          return client
            .records(0, 5000)
            .then((records) => {
              if (cancelled) return;
              backfill(records);
              openStream();
            })
            .catch(() => {
              if (cancelled) return;
              backfill([]);
              openStream();
            });
        })
        .catch(() => {
          if (cancelled) return;
          updateStatus('disconnected');
          scheduleReconnect();
        });
    };

    const openStream = () => {
      if (cancelled || !client) return;
      updateStatus('connected');
      eventSource = client.openStream({
        onOpen: () => updateStatus('connected'),
        onHello: (health) => setHealth(health),
        onRecord: (record) => {
          if (pausedRef.current) return;
          push(record);
        },
        onError: () => {
          if (cancelled) return;
          flush();
          updateStatus('reconnecting');
          closeStream();
          scheduleReconnect();
        },
      });
    };

    const closeStream = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (status === 'reconnecting' || status === 'disconnected') {
          reconnectAfter();
        }
      }, 2000);
    };

    const reconnectAfter = () => {
      if (cancelled || !client) return;
      const after = lastIdRef.current;
      client
        .health()
        .then((health) => {
          if (cancelled || !client) return;
          setHealth(health);
          if (!health.running) {
            updateStatus('disconnected');
            scheduleReconnect();
            return;
          }
          return client
            .records(after, 5000)
            .then((records) => {
              if (cancelled) return;
              if (records.length > 0) appendRecordBatch(records);
              openStream();
            })
            .catch(() => {
              if (cancelled) return;
              openStream();
            });
        })
        .catch(() => {
          if (cancelled) return;
          updateStatus('disconnected');
          scheduleReconnect();
        });
    };

    connect();

    return () => {
      cancelled = true;
      closeStream();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mock, baseUrl]);

  useEffect(() => {
    return () => flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
