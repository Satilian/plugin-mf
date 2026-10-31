import { Remote } from "./remote";
import { AsyncLocalStorage } from "node:async_hooks";
import { createElement, type ComponentType } from "react";
import { MF_RELEASES_ELEMENT_ID, type SSRReleases } from "./ssr-releases";
import { Loader, type ServerCacheOptions } from "./server-cache";

export { Loader } from "./server-cache";
export type { ServerCacheOptions, CachePruneResult } from "./server-cache";

const remotes = new Map<string, Remote>();
// Nested remote bundles must participate in the same SSR request.
const requestContextKey = Symbol.for("plugin-mf.ssr-request-context");
const requestGlobal = globalThis as typeof globalThis & {
  [requestContextKey]?: AsyncLocalStorage<Map<string, Remote>>;
};
const requestContext = requestGlobal[requestContextKey] ??= new AsyncLocalStorage<Map<string, Remote>>();
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

export function runWithMFRequest<T>(callback: () => T): T {
  return requestContext.run(new Map(), callback);
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
      throw new Error(`[plugin-mf] Remote "${name}" not found. Available: ${Object.keys(__MF_REMOTES__ || {}).join(", ") || "none"}`);
    }

    const key = url.replace(/\/$/, "");
    let remote = requestRemotes.get(key);
    if (!remote) {
      remote = new Remote(url, getLoader(), "server");
      requestRemotes.set(key, remote);
    }
    return remote;
  }

  ensureInit();

  const remote = remotes.get(name);
  if (!remote) {
    throw new Error(
      `[plugin-mf] Remote "${name}" not found. Available: ${[...remotes.keys()].join(", ") || "none"}`,
    );
  }

  return remote;
}

export function createRemoteComponent<Props extends object = Record<string, unknown>>(
  remoteName: string,
  expose: string,
): ComponentType<Props> {
  return function RequestRemote(props: Props) {
    return createElement(getRemote(remoteName).lazyComponent(expose), props);
  };
}
