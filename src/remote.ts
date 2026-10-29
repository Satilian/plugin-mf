import { createElement, Fragment, lazy } from "react";
import { ManifestLoader, type RemoteManifest, type RemoteInfo } from "./manifest-loader.ts";
import { loadReleaseManifest, type ResolvedRelease } from "./release-manifest.ts";

export class Remote {
  #manifestLoader = new ManifestLoader();
  #lazyComponents = new Map<string, ReturnType<typeof lazy>>();
  manifest?: RemoteManifest;
  baseUrl = "";
  releaseId?: string;
  #release?: Promise<ResolvedRelease | undefined>;
  #selectedRelease?: ResolvedRelease;

  constructor(
    private url: string,
    private moduleLoader: { load: (url: string) => Promise<any> },
    private scope: string,
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

  async component(name: string) {
    if (!this.manifest) await this.#load();

    const path = this.manifest?.[name];

    if (!path) throw new Error(`Remote "${name}" not found in manifest`);

    const url = new URL(typeof path === "string" ? path : path.js, this.baseUrl).href;
    const module = await this.moduleLoader.load(url);
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

    if (!css.length) return component;
    const stylesheets = [...new Set(css.map((asset) => new URL(asset, cssBaseUrl).href))];
    return function StyledRemote(props: any) {
      return createElement(Fragment, null,
        ...stylesheets.map((href) => createElement("link", {
          key: href, rel: "stylesheet", href, precedence: "mf",
        })),
        createElement(component, props),
      );
    };
  }

  lazyComponent(name: string): ReturnType<typeof lazy> {
    const cached = this.#lazyComponents.get(name);
    if (cached) return cached;

    const component = lazy(async () => {
      const component = await this.component(name);

      return {
        default: component,
      };
    });
    this.#lazyComponents.set(name, component);
    return component;
  }
}
