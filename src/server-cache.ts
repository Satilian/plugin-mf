import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateAssetPath, type ModuleLoadContext } from "./asset-path";
import { hasCode, isProcessAlive, withCacheLock } from "./cache-lock";

export type ServerModule = Record<string, unknown>;

export type ServerCacheOptions = {
  cacheDir?: string;
  maxBytes?: number;
  lockTimeoutMs?: number;
};

export type CachePruneResult = {
  bytes: number;
  protectedBytes: number;
  removedEntries: number;
  overBudgetBytes: number;
};

type CacheFile = { path: string; url: string };
type CacheEntry = { key: string; files: CacheFile[]; entryPath: string };

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

function inside(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const difference = path.relative(root, target);
  if (!difference || difference === ".." || difference.startsWith(`..${path.sep}`) || path.isAbsolute(difference)) {
    throw new Error("[plugin-mf] Cache path escapes its directory");
  }
  return target;
}

async function regularFile(root: string, file: string): Promise<number> {
  const target = inside(root, file);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`[plugin-mf] Invalid cached file: ${file}`);
  const canonical = await realpath(target);
  inside(root, path.relative(root, canonical));
  return info.size;
}

function describe(url: string, context?: ModuleLoadContext): CacheEntry {
  const entry = new URL(url);
  if (entry.protocol !== "http:" && entry.protocol !== "https:") throw new Error("[plugin-mf] Unsupported module URL protocol");
  const baseUrl = context ? new URL(context.baseUrl) : new URL(".", entry);
  const paths = context?.files ?? [decodeURIComponent(entry.pathname.split("/").at(-1) || "remote.js")];
  const files = [...new Set(paths)].sort().map((file) => {
    validateAssetPath(file);
    if (["package.json", ".ready.json"].includes(file.toLowerCase())) {
      throw new Error(`[plugin-mf] Reserved cache asset path: ${file}`);
    }
    return { path: file, url: context ? new URL(file, baseUrl).href : entry.href };
  });
  const selected = files.find((file) => file.url === entry.href);
  if (!selected) throw new Error("[plugin-mf] Module entry is missing from its asset list");
  const localNames = files.map((file) => process.platform === "win32" ? file.path.toLowerCase() : file.path);
  if (new Set(localNames).size !== localNames.length) throw new Error("[plugin-mf] Cache asset paths collide");
  const key = createHash("sha256").update(JSON.stringify({
    provider: context?.provider ?? baseUrl.href,
    releaseId: context?.releaseId ?? null,
    files,
  })).digest("hex");
  return { key, files, entryPath: selected.path };
}

export class Loader {
  #import = new Function("fileUrl", "return import(fileUrl)") as (fileUrl: string) => Promise<ServerModule>;
  #cache = new Map<string, Promise<ServerModule>>();
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

  load(url: string, context?: ModuleLoadContext): Promise<ServerModule> {
    const entry = describe(url, context);
    const memoryKey = `${entry.key}:${url}`;
    const cached = this.#cache.get(memoryKey);
    if (cached) return cached;
    const promise = this.#load(entry).catch((error: unknown) => {
      this.#cache.delete(memoryKey);
      throw error;
    });
    this.#cache.set(memoryKey, promise);
    return promise;
  }

  async #isPinned(directory: string): Promise<boolean> {
    const pins = path.join(directory, ".pins");
    let names: string[];
    try {
      if ((await lstat(pins)).isSymbolicLink()) throw new Error("[plugin-mf] Cache lease directory must not be a symbolic link");
      names = await readdir(pins);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return false;
      throw error;
    }
    let active = false;
    for (const name of names) {
      if (!/^\d+$/.test(name)) throw new Error("[plugin-mf] Invalid cache lease");
      const pid = Number(name);
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("[plugin-mf] Invalid cache lease PID");
      if (isProcessAlive(pid)) active = true;
      else await rm(path.join(pins, name), { force: true });
    }
    return active;
  }

  async #entrySize(directory: string): Promise<number> {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("[plugin-mf] Cache entry must not be a symbolic link");
    let bytes = 0;
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name === ".pins") continue;
      if (item.isSymbolicLink()) throw new Error("[plugin-mf] Cache entry contains a symbolic link");
      const file = path.join(directory, item.name);
      bytes += item.isDirectory() ? await this.#entrySize(file) : (await stat(file)).size;
    }
    return bytes;
  }

  async #prune(root: string, maxBytes: number, protectedDirectory?: string, staging?: string): Promise<CachePruneResult> {
    for (const name of await readdir(root)) {
      if (!/^\.download-[a-zA-Z0-9]+$/.test(name)) continue;
      const directory = inside(root, name);
      if (directory !== staging) await rm(directory, { recursive: true, force: true });
    }
    const entries = path.join(root, "entries");
    const candidates: { directory: string; bytes: number; pinned: boolean }[] = [];
    for (const name of (await readdir(entries)).sort()) {
      if (!/^[a-f0-9]{64}$/.test(name)) throw new Error("[plugin-mf] Unexpected directory in server cache");
      const directory = inside(entries, name);
      candidates.push({ directory, bytes: await this.#entrySize(directory), pinned: directory === protectedDirectory || await this.#isPinned(directory) });
    }
    let bytes = candidates.reduce((sum, entry) => sum + entry.bytes, 0);
    const protectedBytes = candidates.filter((entry) => entry.pinned).reduce((sum, entry) => sum + entry.bytes, 0);
    let removedEntries = 0;
    for (const entry of candidates) {
      if (bytes <= maxBytes) break;
      if (entry.pinned) continue;
      await rm(entry.directory, { recursive: true });
      bytes -= entry.bytes;
      removedEntries++;
    }
    return { bytes, protectedBytes, removedEntries, overBudgetBytes: Math.max(0, bytes - maxBytes) };
  }

  async #download(root: string, entry: CacheEntry, destination: string): Promise<void> {
    const staging = await mkdtemp(path.join(root, ".download-"));
    try {
      let downloadedBytes = 0;
      for (let offset = 0; offset < entry.files.length; offset += 8) {
        const results = await Promise.allSettled(entry.files.slice(offset, offset + 8).map(async (file) => {
          const response = await fetch(file.url);
          if (!response.ok) throw new Error(`[plugin-mf] Failed to load server asset: ${response.status} ${response.statusText}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          downloadedBytes += buffer.byteLength;
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
      const size = await this.#entrySize(staging);
      const pruned = await this.#prune(root, Math.max(0, this.#maxBytes - size), undefined, staging);
      if (size + pruned.bytes > this.#maxBytes) {
        throw new Error("[plugin-mf] Server cache limit reached by active ESM releases; raise maxBytes or restart workers");
      }
      await rename(staging, destination);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async #load(entry: CacheEntry): Promise<ServerModule> {
    const root = await this.#getRoot();
    const directory = inside(path.join(root, "entries"), entry.key);
    await withCacheLock(root, this.#lockTimeoutMs, async () => {
      let ready = false;
      try {
        if ((await lstat(directory)).isSymbolicLink()) throw new Error("[plugin-mf] Cache entry must not be a symbolic link");
        await regularFile(directory, ".ready.json");
        await regularFile(directory, "package.json");
        ready = await readFile(path.join(directory, ".ready.json"), "utf8") === JSON.stringify(entry.files);
        if (ready) for (const file of entry.files) await regularFile(directory, file.path);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
        ready = false;
      }
      if (!ready) {
        if (await this.#isPinned(directory)) throw new Error("[plugin-mf] Active server cache entry is incomplete");
        await rm(directory, { recursive: true, force: true });
        await this.#download(root, entry, directory);
      }
      const pruned = await this.#prune(root, this.#maxBytes, directory);
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
    });
    return this.#import(pathToFileURL(inside(directory, entry.entryPath)).href);
  }

  async pruneCache(): Promise<CachePruneResult> {
    const root = await this.#getRoot();
    return withCacheLock(root, this.#lockTimeoutMs, () => this.#prune(root, this.#maxBytes));
  }

  async clearCache(): Promise<CachePruneResult> {
    const root = await this.#getRoot();
    return withCacheLock(root, this.#lockTimeoutMs, () => this.#prune(root, 0));
  }
}
