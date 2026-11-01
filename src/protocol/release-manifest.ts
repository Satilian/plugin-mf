import { parseSharedRequirements, type ReleaseSharing } from "./shared-dependencies.ts";

export const RELEASE_MANIFEST_VERSION = 1;

/** Paths are relative to the directory containing manifest.json. */
export type ReleaseManifest = {
  version: typeof RELEASE_MANIFEST_VERSION;
  releaseId: string;
  server?: string;
  client?: string;
  types: string;
  shared?: ReleaseSharing;
};

export type ResolvedRelease = {
  manifest: ReleaseManifest;
  baseUrl: string;
};

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid release manifest");
  }

  const manifest = value as Record<string, unknown>;
  if (manifest.version !== RELEASE_MANIFEST_VERSION) {
    throw new Error(`Unsupported release manifest version: ${String(manifest.version)}`);
  }

  parseReleaseId(manifest.releaseId);
  if (manifest.shared !== undefined) {
    const shared = manifest.shared;
    if (!shared || typeof shared !== "object" || !("client" in shared) || !("server" in shared)) throw new Error("Invalid release shared requirements");
    parseSharedRequirements(shared.client);
    parseSharedRequirements(shared.server);
  }

  for (const key of ["server", "client", "types"] as const) {
    const value = manifest[key];
    if ((key === "types" || value !== undefined) &&
      (typeof value !== "string" || !value || value.startsWith("/") ||
        value.includes("\\") || value.split("/").some((part) => !part || part === ".." || part === ".") ||
        value.includes(":") || value.includes("?") || value.includes("#"))) {
      throw new Error(`Invalid ${key} path in release manifest`);
    }
  }

  if (manifest.server === undefined && manifest.client === undefined) {
    throw new Error("Release manifest does not contain server or client assets");
  }

  return manifest as ReleaseManifest;
}

export function parseReleaseId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error("Invalid releaseId in release manifest");
  }
  return value;
}
