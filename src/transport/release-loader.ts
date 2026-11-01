import { parseReleaseManifest, type ResolvedRelease } from "../protocol/release-manifest.ts";
import { fetchResource } from "./loading.ts";
import type { LoadContext } from "../protocol/load-error.ts";

/** A missing release manifest is the only signal that a provider uses the legacy layout. */
export async function loadReleaseManifest(url: string, context: LoadContext = { remote: new URL(".", url).href, stage: "release-manifest" }, signal?: AbortSignal): Promise<ResolvedRelease | undefined> {
  return fetchResource(url, context, async (response) => ({
    manifest: parseReleaseManifest(await response.json()), baseUrl: new URL(".", response.url).href,
  }), signal, true);
}
