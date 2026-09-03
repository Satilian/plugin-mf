export type RemoteInfo = {
  manifest: Record<string, string>;
  __baseUrl: string;
};

export class ManifestLoader {
  #cache = new Map();

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
    console.log("FETCH  MANIFEST:", url);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to load manifest: ${response.status} ${response.statusText}`,
      );
    }

    const manifest = (await response.json()) as Record<string, string>;
    const result = { manifest, __baseUrl: new URL(".", response.url).href };
    this.#validateManifest(result);

    return result;
  }

  #validateManifest({ manifest, __baseUrl }: RemoteInfo) {
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Invalid remote manifest");
    }

    if (!__baseUrl || typeof __baseUrl !== "string") {
      throw new Error("Remote manifest does not contain __baseUrl");
    }

    for (const [name, path] of Object.entries(manifest)) {
      if (typeof path !== "string")
        throw new Error(`Invalid remote path for "${name}"`);
    }
  }
}
