import { ManifestLoader } from "./manifest-loader.ts";
import type { RemoteManifest, RemoteInfo } from "../../protocol/remote-manifest.ts";
import { loadReleaseManifest } from "../../transport/release-loader.ts";
import type { ResolvedRelease } from "../../protocol/release-manifest.ts";
import type { ModuleLoader, RemoteScope } from "../../protocol/module.ts";
import { RemoteLoadError, type LoadContext, type LoadStage } from "../../protocol/load-error.ts";
import { loadingPolicy, withDeadline, withProvider } from "../../transport/loading.ts";

type RemoteExport = { value: unknown; stylesheets: string[] };

export class RemoteSource {
  #manifestLoader = new ManifestLoader();
  manifest?: RemoteManifest;
  baseUrl = "";
  releaseId?: string;
  #release?: Promise<ResolvedRelease | undefined>;
  #selectedRelease?: ResolvedRelease;
  #exports = new Map<string, Promise<RemoteExport>>();

  constructor(
    private url: string,
    private moduleLoader: ModuleLoader,
    private scope: RemoteScope,
    private getPinnedRelease?: () => ResolvedRelease | null | undefined,
    private signal?: AbortSignal,
  ) {}

  protected context(stage: LoadStage): LoadContext {
    return { remote: this.url.replace(/\/$/, ""), releaseId: this.releaseId, stage };
  }

  getSelectedRelease(): ResolvedRelease | null | undefined {
    return this.manifest ? this.#selectedRelease ?? null : undefined;
  }

  async #getRelease(signal?: AbortSignal) {
    if (!this.#release) {
      const pinned = this.getPinnedRelease?.();
      if (pinned !== undefined) {
        this.#release = Promise.resolve(pinned ?? undefined);
        return this.#release;
      }
      this.#release = loadReleaseManifest(`${this.url.replace(/\/$/, "")}/manifest.json`, this.context("release-manifest"), signal).catch((error) => {
        this.#release = undefined;
        throw error;
      });
    }
    return this.#release;
  }

  async #loadManifest(scope: "server" | "client", release: Awaited<ReturnType<typeof loadReleaseManifest>>, signal?: AbortSignal): Promise<RemoteInfo> {
    const manifestPath = release?.manifest[scope];
    if (release && !manifestPath) {
      throw new RemoteLoadError(this.context("manifest"), "LOAD_FAILED", `Release does not contain ${scope} assets`);
    }
    const url = release && manifestPath
      ? new URL(manifestPath, release.baseUrl).href
      : `${this.url.replace(/\/$/, "")}/${scope}/manifest.json`;
    return this.#manifestLoader.load(url, this.context("manifest"), signal);
  }

  async #load(signal?: AbortSignal) {
    if (this.scope !== "server" && this.scope !== "client") {
      throw new Error(`Unsupported remote scope: ${this.scope}`);
    }
    const release = await this.#getRelease(signal);
    this.releaseId = release?.manifest.releaseId;
    this.#selectedRelease = release;
    const { manifest, __baseUrl } = await this.#loadManifest(this.scope, release, signal);
    this.manifest = manifest;
    this.baseUrl = __baseUrl;
  }

  loadExport(name: string): Promise<RemoteExport> {
    const cached = this.#exports.get(name);
    if (cached) return cached;
    const promise = withProvider(this.context("module"), () => withDeadline(this.context("module"), loadingPolicy().moduleTimeoutMs,
      (signal) => this.#loadExport(name, signal), this.signal)).catch((error: unknown) => {
      this.#exports.delete(name);
      if (error instanceof RemoteLoadError && !error.releaseId && this.releaseId) {
        throw new RemoteLoadError(this.context(error.stage), error.code, "Loading failed", { cause: error, status: error.status });
      }
      throw error;
    });
    this.#exports.set(name, promise);
    return promise;
  }

  async #loadExport(name: string, signal: AbortSignal): Promise<RemoteExport> {
    if (!this.manifest) await this.#load(signal);
    signal.throwIfAborted();

    const path = this.manifest?.[name];

    if (!path) throw new RemoteLoadError(this.context("manifest"), "LOAD_FAILED", `Remote "${name}" not found in manifest`);

    const url = new URL(typeof path === "string" ? path : path.js, this.baseUrl).href;
    const module = await this.moduleLoader.load(url, {
      provider: this.url.replace(/\/$/, ""),
      releaseId: this.releaseId,
      baseUrl: this.baseUrl,
      files: typeof path === "string" ? [path] : path.files ?? [path.js],
    });
    const component = module[name];

    if (!component) throw new RemoteLoadError(this.context("module"), "LOAD_FAILED", `Export "${name}" not found`);

    let css = typeof path === "string" ? [] : path.css;
    let cssBaseUrl = this.baseUrl;
    // SSR advertises the browser build's styles, not node build assets.
    if (this.scope === "server" && typeof path !== "string") {
      signal.throwIfAborted();
      const client = await this.#loadManifest("client", this.#selectedRelease, signal);
      const entry = client.manifest[name];
      if (!entry) throw new RemoteLoadError(this.context("manifest"), "LOAD_FAILED", `Remote "${name}" not found in client manifest`);
      css = typeof entry === "string" ? [] : entry.css;
      cssBaseUrl = client.__baseUrl;
    }

    return { value: component, stylesheets: [...new Set(css.map((asset) => new URL(asset, cssBaseUrl).href))] };
  }
}
