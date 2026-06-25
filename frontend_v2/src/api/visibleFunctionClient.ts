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
  // The backend emits `hello` with the health JSON. `data` may contain a `type`-named field, so
  // destructure `type` out before spreading to avoid overwriting our discriminator.
  | { type: "hello"; running: boolean; port: number; records: number; sessionId: number }
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

  // `tail` is accepted by the backend (VisibleFunctionExportServer.parseBoolean) but undocumented
  // in the brief. When `tail && after<=0`, the server returns the last `limit` records.
  records(params: { after?: number; limit?: number; tail?: boolean } = {}): Promise<{ records: TraceRecord[] }> {
    return this.get<{ records: TraceRecord[] }>(`/api/v1/records${qs(params)}`);
  }

  grouped(params: { after?: number; limit?: number; tail?: boolean } = {}): Promise<GroupedResponse> {
    return this.get<GroupedResponse>(`/api/v1/grouped${qs(params)}`);
  }

  tickFilter(params: { after?: number; limit?: number; tail?: boolean } = {}): Promise<{ tickFilter: TickFilterBucketPayload[] }> {
    return this.get<{ tickFilter: TickFilterBucketPayload[] }>(`/api/v1/tick-filter${qs(params)}`);
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

  // Opens the SSE stream. Returns a close function. The backend emits `hello`/`record`/`records`
  // events (VisibleFunctionExportServer.stream / broadcastLoop); `records` is the batched variant.
  openStream(onMessage: (msg: StreamMessage) => void, onError: (err: Event) => void): () => void {
    const url = `${this.baseUrl}/api/v1/stream`;
    const es = new EventSource(url);
    es.addEventListener("hello", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as Record<string, unknown>;
        onMessage({
          type: "hello",
          running: Boolean(data.running),
          port: Number(data.port ?? 0),
          records: Number(data.records ?? 0),
          sessionId: Number(data.sessionId ?? 0),
        });
      } catch {
        /* ignore malformed frame */
      }
    });
    es.addEventListener("record", (ev) => {
      try {
        const record = JSON.parse((ev as MessageEvent).data) as TraceRecord;
        onMessage({ type: "record", record });
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("records", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { records?: TraceRecord[] };
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

function qs(params: { after?: number; limit?: number; tail?: boolean }): string {
  const q = new URLSearchParams();
  if (params.after !== undefined) q.set("after", String(params.after));
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.tail) q.set("tail", "true");
  const s = q.toString();
  return s ? `?${s}` : "";
}

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
