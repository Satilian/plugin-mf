import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasCode, withCacheLock } from "./lock.ts";
import { inside, regularFile } from "./paths.ts";
import { entrySize, isPinned, prune } from "./prune.ts";
import type { CacheEntry } from "./entry.ts";
import type { ServerCacheOptions, CachePruneResult } from "./config.ts";
import type { LoadContext } from "../../../protocol/load-error.ts";
import { fetchResource } from "../../../transport/loading.ts";
import { emitLoadingEvent } from "../../../transport/observability.ts";

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

export class DiskCache {
  #root: Promise<string> | undefined;
  #cacheDir: string;
  #maxBytes: number;
  #lockTimeoutMs: number;

  constructor(options: string | ServerCacheOptions = {}) {
    const config = typeof options === "string" ? { cacheDir: options } : options;
    this.#cacheDir = path.resolve(config.cacheDir ?? process.env.MF_CACHE_DIR ?? path.join(process.cwd(), "node_modules/.cache/mf"));
    this.#maxBytes = config.maxBytes ?? (process.env.MF_CACHE_MAX_BYTES ? Number(process.env.MF_CACHE_MAX_BYTES) : DEFAULT_MAX_BYTES);
    this.#lockTimeoutMs = config.lockTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes <= 0 ||
      !Number.isSafeInteger(this.#lockTimeoutMs) || this.#lockTimeoutMs <= 0) {
      throw new Error("[plugin-mf] Cache maxBytes and lockTimeoutMs must be positive safe integers");
    }
  }

  async #initialize(): Promise<string> {
    await mkdir(this.#cacheDir, { recursive: true });
    const root = await realpath(this.#cacheDir);
    if (root === path.parse(root).root) throw new Error("[plugin-mf] Cache directory must not be a filesystem root");
    const probe = path.join(root, `.probe-${randomUUID()}`);
    try {
      const handle = await open(probe, "wx");
      try {
        await handle.writeFile("probe");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw new Error(`[plugin-mf] Cache directory is not writable: ${root}`, { cause: error });
    } finally {
      await rm(probe, { force: true });
    }
    const entries = path.join(root, "entries");
    await mkdir(entries, { recursive: true });
    if ((await lstat(entries)).isSymbolicLink()) throw new Error("[plugin-mf] Cache entries directory must not be a symbolic link");
    return root;
  }

  #getRoot(): Promise<string> {
    this.#root ??= this.#initialize().catch((error: unknown) => {
      this.#root = undefined;
      throw error;
    });
    return this.#root;
  }

  async #download(root: string, entry: CacheEntry, destination: string, context: LoadContext, deadlineSignal: AbortSignal): Promise<void> {
    const staging = await mkdtemp(path.join(root, ".download-"));
    try {
      let downloadedBytes = 0;
      for (let offset = 0; offset < entry.files.length; offset += 8) {
        deadlineSignal.throwIfAborted();
        const results = await Promise.allSettled(entry.files.slice(offset, offset + 8).map(async (file) => {
          const buffer = Buffer.from(await fetchResource(file.url, context, (response) => response.arrayBuffer(), deadlineSignal));
          if (file.integrity && createHash("sha256").update(buffer).digest("hex") !== file.integrity) throw new Error(`[plugin-mf] Server asset integrity mismatch: ${file.path}`);
          deadlineSignal.throwIfAborted();
          downloadedBytes += buffer.byteLength;
          emitLoadingEvent({ ...context, type: "download", operation: "disk", bytes: buffer.byteLength });
          if (downloadedBytes > this.#maxBytes) throw new Error("[plugin-mf] Server release exceeds cache maxBytes");
          const target = inside(staging, file.path);
          await mkdir(path.dirname(target), { recursive: true });
          const temporary = `${target}.${randomUUID()}.tmp`;
          const handle = await open(temporary, "wx");
          try {
            await handle.writeFile(buffer);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporary, target);
        }));
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      }
      await writeFile(path.join(staging, "package.json"), '{"type":"module"}', "utf8");
      await writeFile(path.join(staging, ".ready.json"), JSON.stringify(entry.files), "utf8");
      deadlineSignal.throwIfAborted();
      const size = await entrySize(staging);
      const pruned = await prune(root, Math.max(0, this.#maxBytes - size), undefined, staging);
      if (size + pruned.bytes > this.#maxBytes) {
        throw new Error("[plugin-mf] Server cache limit reached by active ESM releases; raise maxBytes or restart workers");
      }
      await rename(staging, destination);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async resolve(entry: CacheEntry, context: LoadContext, deadlineSignal: AbortSignal): Promise<string> {
    const root = await this.#getRoot();
    const directory = inside(path.join(root, "entries"), entry.key);
    await withCacheLock(root, this.#lockTimeoutMs, async () => {
      deadlineSignal.throwIfAborted();
      let ready = false;
      try {
        if ((await lstat(directory)).isSymbolicLink()) throw new Error("[plugin-mf] Cache entry must not be a symbolic link");
        await regularFile(directory, ".ready.json");
        await regularFile(directory, "package.json");
        ready = await readFile(path.join(directory, ".ready.json"), "utf8") === JSON.stringify(entry.files);
        if (ready) for (const file of entry.files) {
          await regularFile(directory, file.path);
          if (file.integrity && createHash("sha256").update(await readFile(inside(directory, file.path))).digest("hex") !== file.integrity) {
            throw new Error(`[plugin-mf] Cached server asset integrity mismatch: ${file.path}`);
          }
        }
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
        ready = false;
      }
      if (!ready) {
        if (await isPinned(directory)) throw new Error("[plugin-mf] Active server cache entry is incomplete");
        await rm(directory, { recursive: true, force: true });
        await this.#download(root, entry, directory, context, deadlineSignal);
      } else {
        emitLoadingEvent({ ...context, type: "cache-hit", operation: "disk" });
      }
      const pruned = await prune(root, this.#maxBytes, directory);
      if (pruned.overBudgetBytes) throw new Error("[plugin-mf] Server cache limit reached by active ESM releases; raise maxBytes or restart workers");
      const pins = path.join(directory, ".pins");
      await mkdir(pins, { recursive: true });
      if ((await lstat(pins)).isSymbolicLink()) throw new Error("[plugin-mf] Cache lease directory must not be a symbolic link");
      const pin = path.join(pins, String(process.pid));
      try {
        await writeFile(pin, "", { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        await regularFile(pins, String(process.pid));
      }
    }, deadlineSignal);
    return inside(directory, entry.entryPath);
  }

  async pruneCache(): Promise<CachePruneResult> {
    const root = await this.#getRoot();
    return withCacheLock(root, this.#lockTimeoutMs, () => prune(root, this.#maxBytes));
  }

  async clearCache(): Promise<CachePruneResult> {
    const root = await this.#getRoot();
    return withCacheLock(root, this.#lockTimeoutMs, () => prune(root, 0));
  }
}
