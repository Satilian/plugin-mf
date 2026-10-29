import { Remote } from "./remote";
import { AsyncLocalStorage } from "node:async_hooks";
import { createElement, type ComponentType } from "react";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MF_RELEASES_ELEMENT_ID, type SSRReleases } from "./ssr-releases";

const CACHE_DIR = path.join(process.cwd(), "node_modules/.cache/mf");

export class Loader {
  #cache = new Map();
  #cacheDir: string;
  #import = new Function("fileUrl", "return import(fileUrl)");

  constructor(cacheDir = CACHE_DIR) {
    this.#cacheDir = cacheDir;
  }

  load(url: string) {
    const cached = this.#cache.get(url);
    if (cached) return cached;

    const promise = this.#load(url);
    this.#cache.set(url, promise);

    return promise.catch((error) => {
      this.#cache.delete(url);
      throw error;
    });
  }

  async #load(url: string) {
    const fileName = url.split("/").pop() || "remote.js";
    const filePath = path.join(this.#cacheDir, fileName);

    // Пишем файл только если его ещё нет
    try {
      await access(filePath);
    } catch {
      console.log("FETCH REMOTE:", url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Failed to load remote module: ${response.status} ${response.statusText}`,
        );
      }

      const source = await response.text();

      await mkdir(this.#cacheDir, { recursive: true });
      await writeFile(filePath, source, "utf8");
    }

    return this.#import(pathToFileURL(filePath).href);
  }

  /** Можно вызвать вручную, если нужно почистить кэш */
  async clearCache() {
    this.#cache.clear();
    // При желании можно добавить удаление файлов из #cacheDir
    try {
      await rm(this.#cacheDir, { recursive: true, force: true });
    } catch (error) {
      console.error("Failed to clear cache directory:", error);
    }
  }
}

const remotes = new Map<string, Remote>();
// Nested remote bundles must participate in the same SSR request.
const requestContextKey = Symbol.for("plugin-mf.ssr-request-context");
const requestGlobal = globalThis as typeof globalThis & {
  [requestContextKey]?: AsyncLocalStorage<Map<string, Remote>>;
};
const requestContext = requestGlobal[requestContextKey] ??= new AsyncLocalStorage<Map<string, Remote>>();
const loader = new Loader();

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
    remotes.set(name, new Remote(url, loader, "server"));
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
      remote = new Remote(url, loader, "server");
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
