import type { LoadContext } from "./load-error.ts";

export type LoadingEvent = LoadContext & {
  type: "start" | "success" | "error" | "cache-hit" | "retry" | "download" | "prune";
  operation: "remote" | "fetch" | "module" | "disk" | "types";
  durationMs?: number;
  requestId?: string;
  loadId?: number;
  bytes?: number;
  attempt?: number;
  error?: { code: string; status?: number };
};
export type LoadingEventHandler = (event: Readonly<LoadingEvent>) => void | Promise<void>;
export type LoadingMetrics = { starts: number; successes: number; errors: number; cacheHits: number; retries: number; downloadedBytes: number; diskHits: number; diskDownloads: number; prunedBytes: number };
