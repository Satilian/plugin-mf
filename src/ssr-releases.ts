import { parseReleaseManifest, type ResolvedRelease } from "./release-manifest";

export const MF_RELEASES_ELEMENT_ID = "mf-releases";

export type SSRReleases = Record<string, ResolvedRelease | null>;

export function parseSSRReleases(value: unknown): SSRReleases {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("[plugin-mf] Invalid SSR release map");
  }

  return Object.fromEntries(Object.entries(value).map(([url, release]: [string, unknown]) => {
    if (release === null) return [url, null];
    if (!release || typeof release !== "object" || !("baseUrl" in release) ||
      typeof release.baseUrl !== "string" || !("manifest" in release)) {
      throw new Error(`[plugin-mf] Invalid SSR release for "${url}"`);
    }
    const baseUrl = new URL(release.baseUrl);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new Error(`[plugin-mf] Invalid SSR release base URL for "${url}"`);
    }
    return [url, { baseUrl: baseUrl.href, manifest: parseReleaseManifest(release.manifest) }];
  }));
}
