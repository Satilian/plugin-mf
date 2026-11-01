import satisfies from "semver/functions/satisfies.js";
import rcompare from "semver/functions/rcompare.js";
import valid from "semver/functions/valid.js";
import type { SharedRequirements } from "../protocol/shared-dependencies.ts";

type SharedEntry = { get: () => Promise<unknown>; loaded: boolean; version: string; module: unknown; singleton: boolean };
type Registry = Map<string, Map<string, Map<string, SharedEntry>>>;
const key = Symbol.for("plugin-mf.shared-registry");
const sharedGlobal = globalThis as typeof globalThis & { [key]?: Registry };
const registry = sharedGlobal[key] ??= new Map();

export function registerShared(name: string, module: unknown, version = "0.0.0", scope = "default", singleton = true): void {
  if (!valid(version)) throw new Error(`[plugin-mf] Invalid shared version for ${name}: ${version}`);
  let bucket = registry.get(scope);
  if (!bucket) registry.set(scope, bucket = new Map());
  let versions = bucket.get(name);
  if (!versions) bucket.set(name, versions = new Map());
  const existing = versions.get(version);
  if (existing) {
    existing.singleton ||= singleton;
    return;
  }
  if (versions.size && (singleton || [...versions.values()].some((entry) => entry.singleton))) {
    throw new Error(`[plugin-mf] Shared singleton ${name} already registered at ${[...versions.keys()].join(", ")}; cannot register ${version}`);
  }
  versions.set(version, { get: () => Promise.resolve(module), module, loaded: true, version, singleton });
}

export function getShared(name: string, scope = "default", requiredVersion = "*"): unknown {
  const versions = registry.get(scope)?.get(name);
  const version = versions && [...versions.keys()].sort(rcompare).find((version) => satisfies(version, requiredVersion));
  if (!version) throw new Error(`[plugin-mf] Shared ${name} requires ${requiredVersion}; registered: ${versions ? [...versions.keys()].join(", ") : "none"}`);
  return versions?.get(version)?.module;
}

export function assertSharedRequirements(requirements: SharedRequirements, scope = "default"): void {
  for (const [name, requirement] of Object.entries(requirements)) {
    const versions = registry.get(scope)?.get(name);
    if (requirement.singleton && versions && versions.size > 1) throw new Error(`[plugin-mf] Shared ${name} requires a singleton; registered: ${[...versions.keys()].join(", ")}`);
    getShared(name, scope, requirement.requiredVersion);
    if (requirement.singleton && versions) for (const entry of versions.values()) entry.singleton = true;
  }
}

export function getShareScope(): Record<string, Record<string, SharedEntry>> {
  return Object.fromEntries([...registry].map(([scope, modules]) => [scope, Object.fromEntries([...modules].map(([name, versions]) => {
    const entry = [...versions.values()].sort((a, b) => rcompare(a.version, b.version))[0];
    return [name, entry];
  }))]));
}
