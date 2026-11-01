import { parseRemoteManifest, type RemoteInfo } from "../../protocol/remote-manifest.ts";

export class ManifestLoader {
  #cache = new Map<string, Promise<RemoteInfo>>();

  async load(url: string) {
    const cached = this.#cache.get(url);
    if (cached) return cached;
    const promise = this.#load(url);
    this.#cache.set(url, promise);

    try {
      return await promise;
    } catch (error) {
      this.#cache.delete(url);
      throw error;
    }
  }

  async #load(url: string) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status} ${response.statusText}`);
    }

    const manifest = parseRemoteManifest(await response.json());
    const result = { manifest, __baseUrl: new URL(".", response.url).href };

    return result;
  }

}
