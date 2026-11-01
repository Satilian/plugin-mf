import { RemoteLoadError, type LoadContext, type LoadingOptions } from "../protocol/load-error.ts";
import { assertRemoteURL } from "./network-policy.ts";

type Policy = Required<Omit<LoadingOptions, "circuitBreaker">> & {
  circuitBreaker: { failureThreshold: number; cooldownMs: number };
};
type Circuit = { failures: number; openedAt?: number; probing: boolean };
const key = Symbol.for("plugin-mf.loading");
const shared = globalThis as typeof globalThis & {
  [key]?: { options: Policy; circuits: Map<string, Circuit> };
};
const state = shared[key] ??= {
  options: { manifestTimeoutMs: 5_000, moduleTimeoutMs: 15_000, typesTimeoutMs: 15_000,
    retries: 2, retryDelayMs: 100, circuitBreaker: { failureThreshold: 3, cooldownMs: 10_000 } },
  circuits: new Map(),
};

export function configureLoading(options: LoadingOptions): void {
  const next = { ...state.options, ...options, circuitBreaker: { ...state.options.circuitBreaker, ...options.circuitBreaker } };
  for (const [name, value] of Object.entries({ ...next, ...next.circuitBreaker })) {
    if (name === "circuitBreaker") continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value > (name === "retries" ? 10 : 2_147_483_647) ||
      value < (name === "retries" || name === "retryDelayMs" ? 0 : 1)) {
      throw new Error(`[plugin-mf] Invalid loading option: ${name}`);
    }
  }
  state.options = next;
}

export function loadingPolicy(): Readonly<Policy> {
  return state.options;
}

export function loadError(error: unknown, context: LoadContext): RemoteLoadError {
  return error instanceof RemoteLoadError ? error : new RemoteLoadError(context, "LOAD_FAILED", "Loading failed", { cause: error });
}

export async function withDeadline<T>(context: LoadContext, timeoutMs: number, callback: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(new RemoteLoadError(context, "ABORTED", "Loading aborted", { cause: parent?.reason }));
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new RemoteLoadError(context, "TIMEOUT", `Deadline exceeded (${timeoutMs} ms)`)), timeoutMs);
  let onAbort: () => void = () => {};
  try {
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    return await Promise.race([cancelled, Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return callback(controller.signal);
    })]);
  } catch (error) {
    throw loadError(error, context);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
    parent?.removeEventListener("abort", abort);
  }
}

function transient(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof RemoteLoadError &&
    (error.code === "TIMEOUT" || (error.code === "HTTP_ERROR" && [408, 429, 500, 502, 503, 504].includes(error.status ?? 0))));
}

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function retryNetwork<T>(callback: (attempt: number) => Promise<T>, signal: AbortSignal, retryable: (error: unknown) => boolean = transient): Promise<T> {
  const policy = loadingPolicy();
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await callback(attempt);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (attempt >= policy.retries || !retryable(error)) throw error;
      await pause(Math.min(policy.retryDelayMs * 2 ** attempt, 2_147_483_647), signal);
    }
  }
}

export function fetchResource<T>(url: string, context: LoadContext, read: (response: Response) => Promise<T>, signal?: AbortSignal): Promise<T>;
export function fetchResource<T>(url: string, context: LoadContext, read: (response: Response) => Promise<T>, signal: AbortSignal | undefined, allow404: true): Promise<T | undefined>;
export async function fetchResource<T>(url: string, context: LoadContext, read: (response: Response) => Promise<T>, signal?: AbortSignal, allow404 = false): Promise<T | undefined> {
  const policy = loadingPolicy();
  const timeout = context.stage === "types" ? policy.typesTimeoutMs : context.stage === "module" ? policy.moduleTimeoutMs : policy.manifestTimeoutMs;
  return withDeadline(context, timeout, (active) => retryNetwork(async () => {
    let target = assertRemoteURL(url, context.remote);
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      response = await fetch(target, { signal: active, redirect: "manual" });
      if (response.type === "opaqueredirect") throw new RemoteLoadError(context, "LOAD_FAILED", "Opaque browser redirects are not allowed");
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects >= 5) throw new RemoteLoadError(context, "LOAD_FAILED", "Invalid redirect chain");
        target = assertRemoteURL(new URL(location, target).href, context.remote);
        continue;
      }
      assertRemoteURL(response.url || target, context.remote);
      break;
    }
    if (allow404 && response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new RemoteLoadError(context, "HTTP_ERROR", `HTTP ${response.status}`, { status: response.status });
    }
    return await read(response);
  }, active), signal);
}

export async function withProvider<T>(context: LoadContext, callback: () => Promise<T>): Promise<T> {
  const policy = loadingPolicy().circuitBreaker;
  const circuit = state.circuits.get(context.remote) ?? { failures: 0, probing: false };
  state.circuits.set(context.remote, circuit);
  const openedAt = circuit.openedAt;
  if (circuit.openedAt !== undefined) {
    if (circuit.probing || performance.now() - circuit.openedAt < policy.cooldownMs) {
      throw new RemoteLoadError(context, "CIRCUIT_OPEN", "Provider circuit is open");
    }
    circuit.probing = true;
  }
  try {
    const result = await callback();
    if (circuit.openedAt === openedAt) {
      circuit.failures = 0;
      circuit.openedAt = undefined;
    }
    return result;
  } catch (error) {
    const failure = loadError(error, context);
    if (circuit.openedAt === openedAt && failure.code !== "ABORTED" && failure.code !== "CIRCUIT_OPEN") {
      circuit.failures++;
      if (circuit.failures >= policy.failureThreshold) circuit.openedAt = performance.now();
    }
    throw failure;
  } finally {
    if (openedAt !== undefined) circuit.probing = false;
  }
}
