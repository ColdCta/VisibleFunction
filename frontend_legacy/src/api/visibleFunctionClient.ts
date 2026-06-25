import type { Health, RecordsResponse, GroupedResponse, TraceRecord } from './types';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:17654';

export interface StreamCallbacks {
  onHello: (health: Health) => void;
  onRecord: (record: TraceRecord) => void;
  onError: () => void;
  onOpen: () => void;
}

function resolveBaseUrl(baseUrl?: string): string {
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  return DEFAULT_BASE_URL;
}

async function fetchJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`GET ${path} -> ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function createClient(baseUrl?: string) {
  const base = resolveBaseUrl(baseUrl);

  return {
    baseUrl: base,

    health(): Promise<Health> {
      return fetchJson<Health>(base, '/health');
    },

    records(after = 0, limit = 5000): Promise<TraceRecord[]> {
      return fetchJson<RecordsResponse>(base, `/api/v1/records?after=${after}&limit=${limit}`).then(
        (res) => res.records,
      );
    },

    grouped(after = 0, limit = 500): Promise<GroupedResponse> {
      return fetchJson<GroupedResponse>(base, `/api/v1/grouped?after=${after}&limit=${limit}`);
    },

    openStream(callbacks: StreamCallbacks): EventSource {
      const source = new EventSource(`${base}/api/v1/stream`);
      source.addEventListener('open', () => callbacks.onOpen());
      source.addEventListener('hello', (event) => {
        try {
          callbacks.onHello(JSON.parse((event as MessageEvent).data) as Health);
        } catch {
          /* ignore malformed hello */
        }
      });
      source.addEventListener('record', (event) => {
        try {
          callbacks.onRecord(JSON.parse((event as MessageEvent).data) as TraceRecord);
        } catch {
          /* ignore malformed record */
        }
      });
      source.addEventListener('error', () => callbacks.onError());
      return source;
    },
  };
}

export type VisibleFunctionClient = ReturnType<typeof createClient>;
