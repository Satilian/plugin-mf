import { parseRegistry, selectRegistry, type RegistryConfig, type RegistrySnapshot } from "../protocol/registry.ts";
import { fetchResource } from "./loading.ts";
import { assertRemoteURL } from "./network-policy.ts";

export type RegistryOptions = { remotes?: RegistryConfig; url?: string; maxAgeMs?: number; selectionKey?: string };
const key = Symbol.for("plugin-mf.runtime-registry");
const shared = globalThis as typeof globalThis & { [key]?: {
  static: RegistryConfig; local: RegistryConfig; remote: RegistryConfig; options: RegistryOptions;
  refreshed?: number; pending?: Promise<boolean>; lastResult?: boolean;
} };
const state = shared[key] ??= { static: {}, local: {}, remote: {}, options: {} };

export function registerStaticRemotes(remotes: Record<string, string>): void {
  state.static = { ...state.static, ...parseRegistry(Object.fromEntries(Object.entries(remotes).map(([name, url]) => [name, { url }]))) };
}

export function configureRegistry(options: RegistryOptions): void {
  if (options.maxAgeMs !== undefined && (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 0)) throw new Error("[plugin-mf] Invalid registry maxAgeMs");
  if (options.url) assertRemoteURL(options.url, options.url);
  if (options.remotes) state.local = parseRegistry(structuredClone(options.remotes));
  if (options.url !== undefined && options.url !== state.options.url) {
    state.refreshed = undefined;
    state.pending = undefined;
  }
  state.options = { ...state.options, ...options };
}

function snapshotFor(config: RegistryConfig, selectionKey: string): RegistrySnapshot {
  const snapshot = selectRegistry(config, selectionKey);
  for (const entry of Object.values(snapshot)) {
    assertRemoteURL(entry.url, entry.url);
    if (entry.release) assertRemoteURL(entry.release.baseUrl, entry.url);
  }
  return structuredClone(snapshot);
}

export function getRegistrySnapshot(selectionKey = state.options.selectionKey ?? ""): RegistrySnapshot {
  return snapshotFor({ ...state.static, ...state.local, ...state.remote }, selectionKey);
}

export function getRegistryOverrides(selectionKey = state.options.selectionKey ?? ""): RegistrySnapshot {
  return snapshotFor({ ...state.local, ...state.remote }, selectionKey);
}

export async function refreshRegistry(options: { force?: boolean } = {}): Promise<boolean> {
  const url = state.options.url;
  if (!url) return true;
  if (state.pending) return state.pending;
  if (!options.force && state.refreshed !== undefined && performance.now() - state.refreshed < (state.options.maxAgeMs ?? 30_000)) return state.lastResult ?? true;
  const pending = (async () => {
    try {
      const config = await fetchResource(url, { remote: url, stage: "manifest" }, async (response) => parseRegistry(await response.json()));
      for (const entry of Object.values(config)) {
        assertRemoteURL(entry.url, entry.url);
        if (entry.release) assertRemoteURL(entry.release.baseUrl, entry.url);
        if (entry.canary) {
          assertRemoteURL(entry.canary.url, entry.canary.url);
          if (entry.canary.release) assertRemoteURL(entry.canary.release.baseUrl, entry.canary.url);
        }
      }
      if (state.options.url !== url) return false;
      state.remote = config;
      state.refreshed = performance.now();
      state.lastResult = true;
      return true;
    } catch {
      if (state.options.url !== url) return false;
      state.refreshed = performance.now();
      state.lastResult = false;
      console.warn("[plugin-mf] Registry refresh failed; retaining the last successful configuration");
      return false;
    }
  })();
  state.pending = pending;
  try { return await pending; } finally { if (state.pending === pending) state.pending = undefined; }
}
