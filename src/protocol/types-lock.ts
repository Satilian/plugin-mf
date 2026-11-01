import { parseReleaseId } from "./release-manifest.ts";

export type TypesLockEntry = {
  provider: string;
  releaseId?: string;
  manifestUrl: string;
  cacheKey: string;
};

export type TypesLock = { version: 1; remotes: Record<string, TypesLockEntry> };

export function parseTypesLock(value: unknown): TypesLock {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
    !("remotes" in value) || !value.remotes || typeof value.remotes !== "object" || Array.isArray(value.remotes)) {
    throw new Error("[plugin-mf] Invalid types lock file");
  }
  const remotes: Record<string, TypesLockEntry> = {};
  for (const [name, entry] of Object.entries(value.remotes)) {
    if (!entry || typeof entry !== "object" || !("provider" in entry) || typeof entry.provider !== "string" ||
      !("manifestUrl" in entry) || typeof entry.manifestUrl !== "string" ||
      !("cacheKey" in entry) || typeof entry.cacheKey !== "string" || !/^[a-f0-9]{64}$/.test(entry.cacheKey)) {
      throw new Error(`[plugin-mf] Invalid types lock entry: ${name}`);
    }
    for (const url of [entry.provider, entry.manifestUrl]) {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error("[plugin-mf] Invalid types lock URL");
    }
    let releaseId: string | undefined;
    if ("releaseId" in entry && entry.releaseId !== undefined) {
      releaseId = parseReleaseId(entry.releaseId);
    }
    Object.defineProperty(remotes, name, { enumerable: true, value: {
      provider: entry.provider, manifestUrl: entry.manifestUrl, cacheKey: entry.cacheKey, ...(releaseId ? { releaseId } : {}),
    } });
  }
  return { version: 1, remotes };
}
