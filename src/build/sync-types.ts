import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseTypeManifest } from "../protocol/type-manifest.ts";
import { parseTypesLock, type TypesLock, type TypesLockEntry } from "../protocol/types-lock.ts";
import { loadReleaseManifest } from "../transport/release-loader.ts";
import { fetchResource, loadingPolicy, withDeadline, withProvider } from "../transport/loading.ts";
import type { LoadContext } from "../protocol/load-error.ts";
import { atomicWrite, hasCode, publishTypes, readCachedTypes, type CachedTypes } from "./type-cache.ts";
import { validateTypesOptions, type TypesSyncOptions } from "./types-options.ts";
import { emitLoadingEvent } from "../transport/observability.ts";

export type SyncTypesOptions = {
  remotes: Record<string, string>;
  rootPath: string;
  types?: TypesSyncOptions;
};

type Limit = <T>(callback: () => Promise<T>, signal: AbortSignal) => Promise<T>;
const running = new Map<string, Promise<void>>();

function limiter(concurrency: number): Limit {
  let active = 0;
  const queue: (() => void)[] = [];
  return async (callback, signal) => {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try {
      signal.throwIfAborted();
      return await callback();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

export function syncTypes(options: SyncTypesOptions): Promise<void> {
  const root = path.resolve(options.rootPath);
  const previous = running.get(root) ?? Promise.resolve();
  const operation = previous.then(() => synchronize({ ...options, rootPath: root }), () => synchronize({ ...options, rootPath: root }));
  running.set(root, operation);
  return operation.finally(() => {
    if (running.get(root) === operation) running.delete(root);
  });
}

async function synchronize({ remotes, rootPath, types = {} }: SyncTypesOptions): Promise<void> {
  validateTypesOptions(types);
  const mode = types.mode ?? "best-effort";
  if (mode === "off") return;
  const selected = new Set(types.remotes ?? Object.keys(remotes));
  for (const name of selected) if (!Object.hasOwn(remotes, name)) throw new Error(`[plugin-mf] Unknown types remote: ${name}`);
  const cacheRoot = path.join(rootPath, "node_modules", ".cache", "mf-types");
  const lockPath = path.resolve(rootPath, types.lockfile ?? "mf-types.lock.json");
  let lock: TypesLock = { version: 1, remotes: {} };
  try {
    lock = parseTypesLock(JSON.parse(await readFile(lockPath, "utf8")));
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    if (types.frozenLockfile || types.offline) throw new Error(`[plugin-mf] Types lock file is required: ${lockPath}`, { cause: error });
  }
  const next: TypesLock = { version: 1, remotes: { ...lock.remotes } };
  if (types.frozenLockfile) {
    for (const name of selected) {
      if (lock.remotes[name]?.provider !== remotes[name].replace(/\/$/, "")) {
        throw new Error(`[plugin-mf] No matching locked types for remote "${name}"`);
      }
    }
  }
  const limit = limiter(types.concurrency ?? 8);
  const results = await Promise.allSettled(Object.entries(remotes).map(async ([name, url]) => {
    const provider = url.replace(/\/$/, "");
    const previous = lock.remotes[name]?.provider === provider ? lock.remotes[name] : undefined;
    try {
      if (!selected.has(name)) return previous ? await readCachedTypes(cacheRoot, previous) : undefined;
      if ((types.frozenLockfile || types.offline) && !previous) throw new Error(`[plugin-mf] No locked types for remote "${name}"`);
      let cached: CachedTypes | undefined;
      if (previous) {
        try {
          cached = await readCachedTypes(cacheRoot, previous);
        } catch (error) {
          if (types.offline) throw error;
          console.warn(`[plugin-mf] Types cache unavailable for "${name}": ${message(error)}; downloading locked declarations`);
        }
      }
      if (cached && !types.updateLock) {
        emitLoadingEvent({ remote: provider, releaseId: cached.entry.releaseId, stage: "types", type: "cache-hit", operation: "types" });
        return cached;
      }
      if (types.offline) throw new Error(`[plugin-mf] No cached types for remote "${name}"`);
      const context: LoadContext = { remote: provider, releaseId: previous?.releaseId, stage: "types" };
      const result = await withProvider(context, () => withDeadline(context, loadingPolicy().typesTimeoutMs, (signal) =>
        downloadTypes(cacheRoot, provider, previous, types.updateLock ?? false, cached, context, signal, limit)));
      next.remotes = { ...next.remotes, [name]: result.entry };
      return result;
    } catch (error) {
      if (mode === "strict") throw error;
      if (previous) {
        try {
          const cached = await readCachedTypes(cacheRoot, previous);
          console.warn(`[plugin-mf] Using last successful types for "${name}" (release ${previous.releaseId ?? "legacy"}): ${message(error)}`);
          return cached;
        } catch (cacheError) {
          console.warn(`[plugin-mf] Last successful types unavailable for "${name}": ${message(cacheError)}`);
        }
      }
      console.warn(`[plugin-mf] Types unavailable for "${name}"; emitting unknown fallback: ${message(error)}`);
      return undefined;
    }
  }));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "[plugin-mf] Types synchronization failed");

  const declarations: string[] = [];
  Object.keys(remotes).forEach((name, index) => {
    const result = results[index];
    if (result.status !== "fulfilled") return;
    const cached = result.value;
    if (!cached) {
      if (selected.has(name) || lock.remotes[name]) declarations.push(fallbackDeclaration(name));
      return;
    }
    for (const [expose, info] of Object.entries(cached.manifest.exposes)) {
      const relative = path.relative(path.join(rootPath, "src"), path.join(cached.directory, info.path)).replace(/\\/g, "/").replace(/\.d\.ts$/, "");
      declarations.push([
        `declare module ${JSON.stringify(`${name}/${expose}`)} {`,
        `  const remote: typeof import(${JSON.stringify(relative.startsWith(".") ? relative : `./${relative}`)})[${JSON.stringify(info.export)}];`,
        "  export default remote;",
        "}",
      ].join("\n"));
    }
  });
  if (!types.frozenLockfile && !types.offline && JSON.stringify(next) !== JSON.stringify(lock)) {
    next.remotes = Object.fromEntries(Object.entries(next.remotes).sort(([a], [b]) => a.localeCompare(b)));
    await atomicWrite(lockPath, JSON.stringify(next, null, 2) + "\n");
  }
  await atomicWrite(path.join(rootPath, "src", "mf-types.d.ts"), declarations.join("\n") + "\n");
}

async function downloadTypes(cacheRoot: string, provider: string, previous: TypesLockEntry | undefined, update: boolean,
  cached: CachedTypes | undefined, context: LoadContext, signal: AbortSignal, limit: Limit): Promise<CachedTypes> {
  let selection: Omit<TypesLockEntry, "cacheKey">;
  if (previous && !update) {
    selection = previous;
  } else {
    const release = await limit(() => loadReleaseManifest(`${provider}/manifest.json`, { remote: provider, stage: "release-manifest" }, signal), signal);
    selection = {
      provider,
      ...(release ? { releaseId: release.manifest.releaseId } : {}),
      manifestUrl: release ? new URL(release.manifest.types, release.baseUrl).href : `${provider}/types/manifest.json`,
    };
  }
  context.releaseId = selection.releaseId;
  if (cached && selection.releaseId !== undefined && previous?.releaseId === selection.releaseId && previous.manifestUrl === selection.manifestUrl) return cached;
  const { manifest, baseUrl } = await limit(() => fetchResource(selection.manifestUrl, context, async (response) => ({
    manifest: parseTypeManifest(await response.json()), baseUrl: new URL(".", response.url),
  }), signal), signal);
  await mkdir(cacheRoot, { recursive: true });
  const staging = await mkdtemp(path.join(cacheRoot, ".download-"));
  try {
    const results = await Promise.allSettled(manifest.files.map((file) => limit(async () => {
      const source = await fetchResource(new URL(file, baseUrl).href, context, (response) => response.text(), signal);
      signal.throwIfAborted();
      const destination = path.join(staging, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source, "utf8");
    }, signal)));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    signal.throwIfAborted();
    const result = await publishTypes(cacheRoot, staging, selection, manifest);
    if (previous && !update && result.entry.cacheKey !== previous.cacheKey) throw new Error("[plugin-mf] Locked declarations changed; restore the provider artifact or explicitly update the lock");
    return result;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function fallbackDeclaration(name: string): string {
  return `declare module ${JSON.stringify(`${name}/*`)} {\n  const remote: unknown;\n  export default remote;\n}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
