import { parseRemoteManifest, type RemoteInfo } from "../../protocol/remote-manifest.ts";
import { fetchResource } from "../../transport/loading.ts";
import type { LoadContext } from "../../protocol/load-error.ts";
import { emitLoadingEvent } from "../../transport/observability.ts";

export class ManifestLoader {
  #cache = new Map<string, Promise<RemoteInfo>>();

  async load(url: string, context: LoadContext, signal?: AbortSignal): Promise<RemoteInfo> {
    const cached = this.#cache.get(url);
    if (cached) {
      emitLoadingEvent({ ...context, type: "cache-hit", operation: "fetch" });
      return cached;
    }
    const promise = fetchResource(url, context, async (response) => ({
      manifest: parseRemoteManifest(await response.json()), __baseUrl: new URL(".", response.url).href,
    }), signal);
    this.#cache.set(url, promise);

    try {
      return await promise;
    } catch (error) {
      this.#cache.delete(url);
      throw error;
    }
  }

}
