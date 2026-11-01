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
import { preload } from "../core/preload.ts";
import type { PreloadOptions, PreloadTarget } from "../../protocol/preload.ts";
import { getRegistryOverrides, registerStaticRemotes } from "../../transport/registry.ts";
import { MF_REGISTRY_ELEMENT_ID, findRegistrySelection, type RegistrySnapshot } from "../../protocol/registry.ts";

export { Loader } from "./loader.ts";
export type { ServerCacheOptions, CachePruneResult } from "./loader.ts";

const remotes = new Map<string, { identity: string; remote: Remote }>();
let registryInitialized = false;
const registryKey = Symbol.for("plugin-mf.ssr-request-registry");
const registryGlobal = globalThis as typeof globalThis & { [registryKey]?: AsyncLocalStorage<RegistrySnapshot> };
const requestRegistry = registryGlobal[registryKey] ??= new AsyncLocalStorage<RegistrySnapshot>();
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

export function runWithMFRequest<T>(callback: () => T, options: { signal?: AbortSignal; requestId?: string; selectionKey?: string } = {}): T {
  initializeRegistry();
  return requestRegistry.run(getRegistryOverrides(options.selectionKey), () =>
    requestTrace.run(options.requestId, () => requestSignal.run(options.signal, () => requestContext.run(new Map(), callback))));
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
  const registry = JSON.stringify(requestRegistry.getStore() ?? {}).replace(/</g, "\\u003c");
  return `<script id="${MF_RELEASES_ELEMENT_ID}" type="application/json">${json}</script><script id="${MF_REGISTRY_ELEMENT_ID}" type="application/json">${registry}</script>`;
}

declare const __MF_REMOTES__: Record<string, string> | undefined;
declare const __MF_LOADING__: LoadingOptions | undefined;
declare const __MF_NETWORK__: NetworkOptions | undefined;
if (typeof __MF_NETWORK__ !== "undefined") configureNetwork(__MF_NETWORK__);
if (typeof __MF_LOADING__ !== "undefined") configureLoading(__MF_LOADING__);

function initializeRegistry(): void {
  if (registryInitialized) return;
  registerStaticRemotes(typeof __MF_REMOTES__ === "undefined" ? {} : __MF_REMOTES__ ?? {});
  registryInitialized = true;
}

export function getRemote(name: string): Remote {
  initializeRegistry();
  const selection = findRegistrySelection(name, typeof __MF_REMOTES__ === "undefined" ? undefined : __MF_REMOTES__?.[name], requestRegistry.getStore() ?? getRegistryOverrides());
  if (!selection || selection.enabled === false) throw new RemoteLoadError({ remote: name, stage: "module" }, "LOAD_FAILED", selection ? "Remote is disabled" : "Remote not found in registry");
  const requestRemotes = requestContext.getStore();
  if (requestRemotes) {
    const key = selection.url;
    let remote = requestRemotes.get(key);
    if (!remote) {
      remote = new Remote(selection.url, getLoader(), "server", () => selection.release, requestSignal.getStore());
      requestRemotes.set(key, remote);
    }
    return remote;
  }

  const identity = JSON.stringify(selection);
  const cached = remotes.get(name);
  if (cached?.identity === identity) return cached.remote;
  const remote = new Remote(selection.url, getLoader(), "server", () => selection.release);
  remotes.set(name, { identity, remote });
  return remote;
}

export function preloadRemotes(targets: PreloadTarget[], options?: PreloadOptions): Promise<void> {
  return preload(targets.map(({ remote, expose }) => ({ source: getRemote(remote), expose })), options);
}

export function createRemoteComponent<Props extends object = Record<string, unknown>>(
  remoteName: string,
  expose: string,
): ComponentType<Props> {
  return function RequestRemote(props: Props) {
    return createElement(getRemote(remoteName).lazyComponent<Props>(expose), props);
  };
}
