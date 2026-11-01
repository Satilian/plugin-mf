import type { ResolvedRelease } from "./release-manifest.ts";
import { parseSSRReleases } from "./ssr-releases.ts";

export const MF_REGISTRY_ELEMENT_ID = "mf-registry";
export type RegistrySelection = { url: string; enabled?: boolean; release?: ResolvedRelease | null };
export type RegistryEntry = RegistrySelection & { canary?: RegistrySelection & { percentage: number } };
export type RegistryConfig = Record<string, RegistryEntry>;
export type RegistrySnapshot = Record<string, RegistrySelection>;

function parseSelection(value: unknown): RegistrySelection {
  if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string") throw new Error("[plugin-mf] Invalid registry selection");
  const url = new URL(value.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("[plugin-mf] Invalid registry URL");
  if ("enabled" in value && typeof value.enabled !== "boolean") throw new Error("[plugin-mf] Invalid registry enabled flag");
  const selection: RegistrySelection = { url: url.href.replace(/\/$/, ""), enabled: !("enabled" in value) || value.enabled === true };
  if ("release" in value && value.release !== undefined) selection.release = parseSSRReleases({ [url.href]: value.release })[url.href];
  return selection;
}

export function parseRegistry(value: unknown): RegistryConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("[plugin-mf] Invalid registry");
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => {
    const selection: RegistryEntry = parseSelection(entry);
    if (entry && typeof entry === "object" && "canary" in entry && entry.canary !== undefined) {
      const canary = entry.canary;
      if (!canary || typeof canary !== "object" || !("percentage" in canary) || typeof canary.percentage !== "number" ||
        !Number.isFinite(canary.percentage) || canary.percentage < 0 || canary.percentage > 100) throw new Error(`[plugin-mf] Invalid canary percentage: ${name}`);
      selection.canary = { ...parseSelection(canary), percentage: canary.percentage };
    }
    return [name, selection];
  }));
}

export function selectRegistry(config: RegistryConfig, key: string): RegistrySnapshot {
  const selected = Object.fromEntries(Object.entries(config).map(([name, entry]) => {
    let hash = 2166136261;
    for (const char of `${name}:${key}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const choice = entry.canary && (hash >>> 0) % 10_000 < entry.canary.percentage * 100 ? entry.canary : entry;
    return [name, { url: choice.url, enabled: choice.enabled, ...(choice.release !== undefined ? { release: choice.release } : {}) }];
  }));
  const releases = new Map<string, ResolvedRelease | null>();
  for (const entry of Object.values(selected)) {
    if (entry.enabled === false || entry.release === undefined) continue;
    if (releases.has(entry.url) && JSON.stringify(releases.get(entry.url)) !== JSON.stringify(entry.release)) throw new Error(`[plugin-mf] Conflicting registry releases for ${entry.url}`);
    releases.set(entry.url, entry.release);
  }
  for (const entry of Object.values(selected)) if (releases.has(entry.url)) entry.release = releases.get(entry.url);
  return selected;
}

export function findRegistrySelection(name: string, fallback: string | undefined, snapshot: RegistrySnapshot): RegistrySelection | undefined {
  if (Object.hasOwn(snapshot, name)) return snapshot[name];
  if (!fallback) return undefined;
  const url = fallback.replace(/\/$/, "");
  const pinned = Object.values(snapshot).find((entry) => entry.url === url && entry.release !== undefined);
  return { url, enabled: true, ...(pinned?.release !== undefined ? { release: pinned.release } : {}) };
}
