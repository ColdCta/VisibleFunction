import type {
  GroupedResponse,
  HealthResponse,
  RecordingPayload,
  RecordingStatus,
  RecordingsList,
  TickFilterBucketPayload,
  TraceRecord,
} from "./types";

export type StreamMessage =
  | { type: "hello"; running: boolean; port: number; records: number; sessionId?: number }
  | { type: "record"; record: TraceRecord }
  | { type: "records"; records: TraceRecord[] };

export class VisibleFunctionClient {
  constructor(private baseUrl: string) {}

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, "");
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await withTimeout(
      fetch(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
      }),
      2500,
      path
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${path}`);
    }
    return (await res.json()) as T;
  }

  health(): Promise<HealthResponse> {
    return this.get<HealthResponse>("/health");
  }

  records(params: { after?: number; limit?: number; tail?: boolean } = {}): Promise<{ records: TraceRecord[] }> {
    const q = new URLSearchParams();
    if (params.after !== undefined) q.set("after", String(params.after));
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.tail) q.set("tail", "true");
    const qs = q.toString();
    return this.get<{ records: TraceRecord[] }>(`/api/v1/records${qs ? `?${qs}` : ""}`);
  }

  grouped(params: { after?: number; limit?: number; tail?: boolean } = {}): Promise<GroupedResponse> {
    const q = new URLSearchParams();
    if (params.after !== undefined) q.set("after", String(params.after));
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.tail) q.set("tail", "true");
    const qs = q.toString();
    return this.get<GroupedResponse>(`/api/v1/grouped${qs ? `?${qs}` : ""}`);
  }

  tickFilter(params: { after?: number; limit?: number; tail?: boolean } = {}): Promise<{ tickFilter: TickFilterBucketPayload[] }> {
    const q = new URLSearchParams();
    if (params.after !== undefined) q.set("after", String(params.after));
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.tail) q.set("tail", "true");
    const qs = q.toString();
    return this.get<{ tickFilter: TickFilterBucketPayload[] }>(`/api/v1/tick-filter${qs ? `?${qs}` : ""}`);
  }

  recordingStatus(): Promise<RecordingStatus> {
    return this.get<RecordingStatus>("/api/v1/recording/status");
  }

  recordings(): Promise<RecordingsList> {
    return this.get<RecordingsList>("/api/v1/recordings");
  }

  latestRecording(): Promise<RecordingPayload> {
    return this.get<RecordingPayload>("/api/v1/recordings/latest");
  }

  recording(id: string): Promise<RecordingPayload> {
    return this.get<RecordingPayload>(`/api/v1/recordings/${encodeURIComponent(id)}`);
  }

  openStream(onMessage: (msg: StreamMessage) => void, onError: (err: Event) => void): () => void {
    const url = `${this.baseUrl}/api/v1/stream`;
    const es = new EventSource(url);
    es.addEventListener("hello", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        onMessage({ type: "hello", ...data });
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("record", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        onMessage({ type: "record", record: data });
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("records", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        onMessage({ type: "records", records: data.records ?? [] });
      } catch {
        /* ignore */
      }
    });
    es.onerror = (err) => onError(err);
    return () => es.close();
  }
}

export const DEFAULT_BASE_URL = "http://127.0.0.1:17654";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms for ${label}`)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}
