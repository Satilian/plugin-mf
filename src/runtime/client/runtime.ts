import type { ModuleLoader, RemoteModule, ModuleLoadContext } from "../../protocol/module.ts";
import { createElement, type ComponentType } from "react";
import { configureLoading, fetchResource, loadingPolicy, retryNetwork, withDeadline } from "../../transport/loading.ts";
import { RemoteLoadError, type LoadingOptions } from "../../protocol/load-error.ts";
import { assertRemoteURL, configureNetwork } from "../../transport/network-policy.ts";
import type { NetworkOptions } from "../../protocol/network-policy.ts";
import { emitLoadingEvent, observeLoading } from "../../transport/observability.ts";
import { preload } from "../core/preload.ts";
import type { PreloadOptions, PreloadTarget } from "../../protocol/preload.ts";

import { Remote } from "../react/remote.ts";
import { MF_RELEASES_ELEMENT_ID, parseSSRReleases, type SSRReleases } from "../../protocol/ssr-releases.ts";

const importModule = (url: string): Promise<RemoteModule> => import(/* webpackIgnore: true, reason: "@preserve native import" */ url);

export class Loader implements ModuleLoader {
  #cache = new Map<string, Promise<RemoteModule>>();
  #attempts = new Map<string, number>();

  load(url: string, context?: ModuleLoadContext): Promise<RemoteModule> {
    const provider = context?.provider ?? url;
    assertRemoteURL(url, provider);
    const loadContext = { remote: provider, releaseId: context?.releaseId, stage: "module" as const };
    const cached = this.#cache.get(url);
    if (cached) {
      emitLoadingEvent({ ...loadContext, type: "cache-hit", operation: "module" });
      return cached;
    }
    const attempt = this.#attempts.get(url) ?? 0;
    const promise = observeLoading(loadContext, "module", () => withDeadline(loadContext,
      loadingPolicy().moduleTimeoutMs, (signal) => retryNetwork(async (retry) => {
        const target = new URL(url);
        const generation = attempt + retry;
        this.#attempts.set(url, generation);
        if (generation) target.searchParams.set("mf_retry", String(generation));
        const checked = await fetchResource(target.href, { remote: provider, releaseId: context?.releaseId, stage: "module" }, async (response) => {
          await response.arrayBuffer();
          return response.url || target.href;
        }, signal);
        return importModule(checked);
      }, signal, (error) => error instanceof TypeError && /failed to fetch dynamically imported module|error loading dynamically imported module|failed to load module script|importing a module script failed/i.test(error.message), loadContext))).catch((error: unknown) => {
      this.#cache.delete(url);
      this.#attempts.set(url, (this.#attempts.get(url) ?? attempt) + 1);
      throw error;
    });
    this.#cache.set(url, promise);
    return promise;
  }
}

const remotes = new Map<string, Remote>();
let releases: SSRReleases | undefined;

function readMFReleases(): SSRReleases | undefined {
  if (releases) return releases;
  const element = document.getElementById(MF_RELEASES_ELEMENT_ID);
  if (element) releases = parseSSRReleases(JSON.parse(element.textContent || ""));
  return releases;
}

export async function initializeMFReleases(): Promise<void> {
  if (document.readyState === "loading") {
    await new Promise<void>((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
  }
  readMFReleases();
}

declare const __MF_REMOTES__: Record<string, string> | undefined;
declare const __MF_LOADING__: LoadingOptions | undefined;
declare const __MF_NETWORK__: NetworkOptions | undefined;
if (typeof __MF_NETWORK__ !== "undefined") configureNetwork(__MF_NETWORK__);

function ensureInit() {
  if (remotes.size > 0) return;
  if (typeof __MF_LOADING__ !== "undefined") configureLoading(__MF_LOADING__);

  const loader = new Loader();
  for (const [name, url] of Object.entries(__MF_REMOTES__ || {})) {
    remotes.set(name, new Remote(url, loader, "client", () => readMFReleases()?.[url.replace(/\/$/, "")]));
  }
}

export function getRemote(name: string): Remote {
  ensureInit();

  const remote = remotes.get(name);
  if (!remote) {
    throw new RemoteLoadError({ remote: name, stage: "module" }, "LOAD_FAILED", `Remote not found. Available: ${[...remotes.keys()].join(", ") || "none"}`);
  }

  return remote;
}

export function preloadRemotes(targets: PreloadTarget[], options?: PreloadOptions): Promise<void> {
  return preload(targets.map(({ remote, expose }) => ({ source: getRemote(remote), expose })), options);
}

export function createRemoteComponent<Props extends object = Record<string, unknown>>(remoteName: string, expose: string): ComponentType<Props> {
  return function ClientRemote(props: Props) {
    return createElement(getRemote(remoteName).lazyComponent<Props>(expose), props);
  };
}
