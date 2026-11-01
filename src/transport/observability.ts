import { RemoteLoadError, type LoadContext } from "../protocol/load-error.ts";
import type { LoadingEvent, LoadingEventHandler, LoadingMetrics } from "../protocol/observability.ts";

const key = Symbol.for("plugin-mf.observability");
const shared = globalThis as typeof globalThis & { [key]?: {
  handler?: LoadingEventHandler; context?: () => { requestId?: string }; metrics: LoadingMetrics; sequence: number;
} };
const state = shared[key] ??= { sequence: 0, metrics: { starts: 0, successes: 0, errors: 0, cacheHits: 0, retries: 0, downloadedBytes: 0, diskHits: 0, diskDownloads: 0, prunedBytes: 0 } };

export function configureObservability(handler?: LoadingEventHandler): void { state.handler = handler; }
export function setObservationContext(context: () => { requestId?: string }): void { state.context = context; }
export function getLoadingMetrics(): LoadingMetrics { return { ...state.metrics }; }

export function emitLoadingEvent(event: LoadingEvent): void {
  const metrics = state.metrics;
  switch (event.type) {
    case "start": metrics.starts++; break;
    case "success": metrics.successes++; break;
    case "error": metrics.errors++; break;
    case "cache-hit": metrics.cacheHits++; if (event.operation === "disk") metrics.diskHits++; break;
    case "retry": metrics.retries++; break;
    case "download": metrics.downloadedBytes += event.bytes ?? 0; if (event.operation === "disk") metrics.diskDownloads++; break;
    case "prune": metrics.prunedBytes += event.bytes ?? 0; break;
  }
  if (!state.handler) return;
  let remote = event.remote;
  try {
    const url = new URL(remote);
    remote = (url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin) + url.pathname;
  } catch { remote = "unresolved"; }
  try {
    const result = state.handler(Object.freeze({ ...event, remote, ...state.context?.() }));
    if (result) void result.catch(() => console.error("[plugin-mf] Async loading event handler failed"));
  } catch { console.error("[plugin-mf] Loading event handler failed"); }
}

export async function observeLoading<T>(context: LoadContext, operation: LoadingEvent["operation"], callback: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const loadId = ++state.sequence;
  emitLoadingEvent({ ...context, type: "start", operation, loadId });
  try {
    const result = await callback();
    emitLoadingEvent({ ...context, type: "success", operation, loadId, durationMs: performance.now() - start });
    return result;
  } catch (error) {
    emitLoadingEvent({ ...context, type: "error", operation, loadId, durationMs: performance.now() - start,
      error: error instanceof RemoteLoadError ? { code: error.code, status: error.status } : { code: "LOAD_FAILED" } });
    throw error;
  }
}
