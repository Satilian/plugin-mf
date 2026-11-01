import { Remote } from "../react/remote.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createElement, type ComponentType } from "react";
import { MF_RELEASES_ELEMENT_ID, type SSRReleases } from "../../protocol/ssr-releases.ts";
import { Loader, type ServerCacheOptions } from "./loader.ts";
import { configureLoading } from "../../transport/loading.ts";
import { RemoteLoadError, type LoadingOptions } from "../../protocol/load-error.ts";
import { configureNetwork } from "../../transport/network-policy.ts";
import type { NetworkOptions } from "../../protocol/network-policy.ts";
import { setObservationContext } from "../../transport/observability.ts";

export { Loader } from "./loader.ts";
export type { ServerCacheOptions, CachePruneResult } from "./loader.ts";

const remotes = new Map<string, Remote>();
// Nested remote bundles must participate in the same SSR request.
const requestContextKey = Symbol.for("plugin-mf.ssr-request-context");
const requestGlobal = globalThis as typeof globalThis & {
  [requestContextKey]?: AsyncLocalStorage<Map<string, Remote>>;
};
const requestContext = requestGlobal[requestContextKey] ??= new AsyncLocalStorage<Map<string, Remote>>();
const signalKey = Symbol.for("plugin-mf.ssr-request-signal");
const signalGlobal = globalThis as typeof globalThis & { [signalKey]?: AsyncLocalStorage<AbortSignal | undefined> };
const requestSignal = signalGlobal[signalKey] ??= new AsyncLocalStorage<AbortSignal | undefined>();
const traceKey = Symbol.for("plugin-mf.ssr-request-trace");
const traceGlobal = globalThis as typeof globalThis & { [traceKey]?: AsyncLocalStorage<string | undefined> };
const requestTrace = traceGlobal[traceKey] ??= new AsyncLocalStorage<string | undefined>();
setObservationContext(() => ({ requestId: requestTrace.getStore() }));
const runtimeKey = Symbol.for("plugin-mf.server-runtime");
const runtimeGlobal = globalThis as typeof globalThis & {
  [runtimeKey]?: { options?: ServerCacheOptions; loader?: Loader };
};
const runtime = runtimeGlobal[runtimeKey] ??= {};

export function configureServerCache(options: ServerCacheOptions): void {
  if (runtime.loader) throw new Error("[plugin-mf] Configure the server cache before creating remotes");
  runtime.options = { ...options };
}

function getLoader(): Loader {
  return runtime.loader ??= new Loader(runtime.options);
}

export function runWithMFRequest<T>(callback: () => T, options: { signal?: AbortSignal; requestId?: string } = {}): T {
  return requestTrace.run(options.requestId, () => requestSignal.run(options.signal, () => requestContext.run(new Map(), callback)));
}

export function getMFReleases(): SSRReleases {
  const requestRemotes = requestContext.getStore();
  if (!requestRemotes) throw new Error("[plugin-mf] getMFReleases requires runWithMFRequest");

  const releases: SSRReleases = {};
  for (const [url, remote] of requestRemotes) {
    const release = remote.getSelectedRelease();
    if (release !== undefined) releases[url] = release;
  }
  return releases;
}

export function serializeMFReleases(): string {
  const json = JSON.stringify(getMFReleases()).replace(/</g, "\\u003c");
  return `<script id="${MF_RELEASES_ELEMENT_ID}" type="application/json">${json}</script>`;
}

declare const __MF_REMOTES__: Record<string, string> | undefined;
declare const __MF_LOADING__: LoadingOptions | undefined;
declare const __MF_NETWORK__: NetworkOptions | undefined;
if (typeof __MF_NETWORK__ !== "undefined") configureNetwork(__MF_NETWORK__);
if (typeof __MF_LOADING__ !== "undefined") configureLoading(__MF_LOADING__);

function ensureInit() {
  if (remotes.size > 0) return;

  for (const [name, url] of Object.entries(__MF_REMOTES__ || {})) {
    remotes.set(name, new Remote(url, getLoader(), "server"));
  }
}

export function getRemote(name: string): Remote {
  const requestRemotes = requestContext.getStore();
  if (requestRemotes) {
    const url = (__MF_REMOTES__ || {})[name];
    if (!url) {
      throw new RemoteLoadError({ remote: name, stage: "module" }, "LOAD_FAILED", `Remote not found. Available: ${Object.keys(__MF_REMOTES__ || {}).join(", ") || "none"}`);
    }

    const key = url.replace(/\/$/, "");
    let remote = requestRemotes.get(key);
    if (!remote) {
      remote = new Remote(url, getLoader(), "server", undefined, requestSignal.getStore());
      requestRemotes.set(key, remote);
    }
    return remote;
  }

  ensureInit();

  const remote = remotes.get(name);
  if (!remote) {
    throw new RemoteLoadError({ remote: name, stage: "module" }, "LOAD_FAILED", `Remote not found. Available: ${[...remotes.keys()].join(", ") || "none"}`);
  }

  return remote;
}

export function createRemoteComponent<Props extends object = Record<string, unknown>>(
  remoteName: string,
  expose: string,
): ComponentType<Props> {
  return function RequestRemote(props: Props) {
    return createElement(getRemote(remoteName).lazyComponent<Props>(expose), props);
  };
}
