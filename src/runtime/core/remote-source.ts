import { ManifestLoader } from "./manifest-loader.ts";
import type { RemoteManifest, RemoteInfo } from "../../protocol/remote-manifest.ts";
import { loadReleaseManifest } from "../../transport/release-loader.ts";
import type { ResolvedRelease } from "../../protocol/release-manifest.ts";
import type { ModuleLoader, RemoteScope } from "../../protocol/module.ts";

type RemoteExport = { value: unknown; stylesheets: string[] };

export class RemoteSource {
  #manifestLoader = new ManifestLoader();
  manifest?: RemoteManifest;
  baseUrl = "";
  releaseId?: string;
  #release?: Promise<ResolvedRelease | undefined>;
  #selectedRelease?: ResolvedRelease;

  constructor(
    private url: string,
    private moduleLoader: ModuleLoader,
    private scope: RemoteScope,
    private getPinnedRelease?: () => ResolvedRelease | null | undefined,
  ) {}

  getSelectedRelease(): ResolvedRelease | null | undefined {
    return this.manifest ? this.#selectedRelease ?? null : undefined;
  }

  async #getRelease() {
    if (!this.#release) {
      const pinned = this.getPinnedRelease?.();
      if (pinned !== undefined) {
        this.#release = Promise.resolve(pinned ?? undefined);
        return this.#release;
      }
      this.#release = loadReleaseManifest(`${this.url.replace(/\/$/, "")}/manifest.json`).catch((error) => {
        this.#release = undefined;
        throw error;
      });
    }
    return this.#release;
  }

  async #loadManifest(scope: "server" | "client", release: Awaited<ReturnType<typeof loadReleaseManifest>>): Promise<RemoteInfo> {
    const manifestPath = release?.manifest[scope];
    if (release && !manifestPath) {
      throw new Error(`Release "${release.manifest.releaseId}" does not contain ${scope} assets`);
    }
    const url = release && manifestPath
      ? new URL(manifestPath, release.baseUrl).href
      : `${this.url.replace(/\/$/, "")}/${scope}/manifest.json`;
    return this.#manifestLoader.load(url);
  }

  async #load() {
    if (this.scope !== "server" && this.scope !== "client") {
      throw new Error(`Unsupported remote scope: ${this.scope}`);
    }
    const release = await this.#getRelease();
    const { manifest, __baseUrl } = await this.#loadManifest(this.scope, release);
    this.releaseId = release?.manifest.releaseId;
    this.#selectedRelease = release;
    this.manifest = manifest;
    this.baseUrl = __baseUrl;
  }

  async loadExport(name: string): Promise<RemoteExport> {
    if (!this.manifest) await this.#load();

    const path = this.manifest?.[name];

    if (!path) throw new Error(`Remote "${name}" not found in manifest`);

    const url = new URL(typeof path === "string" ? path : path.js, this.baseUrl).href;
    const module = await this.moduleLoader.load(url, this.scope === "server" ? {
      provider: this.url.replace(/\/$/, ""),
      releaseId: this.releaseId,
      baseUrl: this.baseUrl,
      files: typeof path === "string" ? [path] : path.files ?? [path.js],
    } : undefined);
    const component = module[name];

    if (!component) throw new Error(`Export "${name}" not found in ${url}`);

    let css = typeof path === "string" ? [] : path.css;
    let cssBaseUrl = this.baseUrl;
    // SSR advertises the browser build's styles, not node build assets.
    if (this.scope === "server" && typeof path !== "string") {
      const client = await this.#loadManifest("client", this.#selectedRelease);
      const entry = client.manifest[name];
      if (!entry) throw new Error(`Remote "${name}" not found in client manifest`);
      css = typeof entry === "string" ? [] : entry.css;
      cssBaseUrl = client.__baseUrl;
    }

    return { value: component, stylesheets: [...new Set(css.map((asset) => new URL(asset, cssBaseUrl).href))] };
  }
}
