import { parseReleaseManifest, type ResolvedRelease } from "../protocol/release-manifest.ts";

/** A missing release manifest is the only signal that a provider uses the legacy layout. */
export async function loadReleaseManifest(url: string): Promise<ResolvedRelease | undefined> {
  const response = await fetch(url);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Failed to load release manifest: ${response.status} ${response.statusText}`);
  }

  return { manifest: parseReleaseManifest(await response.json()), baseUrl: new URL(".", response.url).href };
}
