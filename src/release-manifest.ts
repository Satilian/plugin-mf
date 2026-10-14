export const RELEASE_MANIFEST_VERSION = 1;

/** Paths are relative to the directory containing manifest.json. */
export type ReleaseManifest = {
  version: typeof RELEASE_MANIFEST_VERSION;
  releaseId: string;
  server?: string;
  client?: string;
  types: string;
};

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid release manifest");
  }

  const manifest = value as Record<string, unknown>;
  if (manifest.version !== RELEASE_MANIFEST_VERSION) {
    throw new Error(`Unsupported release manifest version: ${String(manifest.version)}`);
  }

  if (typeof manifest.releaseId !== "string" || !manifest.releaseId.trim() ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.releaseId)) {
    throw new Error("Invalid releaseId in release manifest");
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

/** A missing release manifest is the only signal that a provider uses the legacy layout. */
export async function loadReleaseManifest(url: string): Promise<{ manifest: ReleaseManifest; baseUrl: string } | undefined> {
  const response = await fetch(url);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Failed to load release manifest: ${response.status} ${response.statusText}`);
  }

  return { manifest: parseReleaseManifest(await response.json()), baseUrl: new URL(".", response.url).href };
}
