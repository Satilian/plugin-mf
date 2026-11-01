import { pathToFileURL } from "node:url";
import type { ModuleLoadContext, ModuleLoader, RemoteModule } from "../../protocol/module.ts";
import { DiskCache } from "./cache/disk-cache.ts";
import { describe } from "./cache/entry.ts";
import type { ServerCacheOptions, CachePruneResult } from "./cache/config.ts";

export type { ServerCacheOptions, CachePruneResult } from "./cache/config.ts";
export type ServerModule = RemoteModule;

export class Loader implements ModuleLoader {
  #import = new Function("fileUrl", "return import(fileUrl)") as (fileUrl: string) => Promise<RemoteModule>;
  #cache = new Map<string, Promise<RemoteModule>>();
  #disk: DiskCache;

  constructor(options: string | ServerCacheOptions = {}) {
    this.#disk = new DiskCache(options);
  }

  load(url: string, context?: ModuleLoadContext): Promise<RemoteModule> {
    const entry = describe(url, context);
    const memoryKey = entry.key + ":" + url;
    const cached = this.#cache.get(memoryKey);
    if (cached) return cached;
    const promise = this.#load(entry).catch((error: unknown) => {
      this.#cache.delete(memoryKey);
      throw error;
    });
    this.#cache.set(memoryKey, promise);
    return promise;
  }

  async #load(entry: ReturnType<typeof describe>): Promise<RemoteModule> {
    const localPath = await this.#disk.resolve(entry);
    return this.#import(pathToFileURL(localPath).href);
  }

  pruneCache(): Promise<CachePruneResult> {
    return this.#disk.pruneCache();
  }

  clearCache(): Promise<CachePruneResult> {
    return this.#disk.clearCache();
  }
}
