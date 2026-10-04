export type RemoteManifest = Record<string, string | { js: string; css: string[] }>;

export type RemoteInfo = {
  manifest: RemoteManifest;
  __baseUrl: string;
};

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

    const manifest = (await response.json()) as RemoteManifest;
    const result = { manifest, __baseUrl: new URL(".", response.url).href };
    this.#validateManifest(result);

    return result;
  }

  #validateManifest({ manifest, __baseUrl }: RemoteInfo) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error("Invalid remote manifest");
    }

    if (!__baseUrl || typeof __baseUrl !== "string") {
      throw new Error("Remote manifest does not contain __baseUrl");
    }

    for (const [name, path] of Object.entries(manifest)) {
      if (typeof path === "string" && path.length) continue;
      if (!path || typeof path !== "object" || Array.isArray(path) ||
        typeof path.js !== "string" || !path.js || !Array.isArray(path.css) ||
        !path.css.every((asset) => typeof asset === "string" && asset.length > 0)) {
        throw new Error(`Invalid remote assets for "${name}"`);
      }
    }
  }
}
