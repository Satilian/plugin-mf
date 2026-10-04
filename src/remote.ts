import { createElement, Fragment, lazy } from "react";
import { ManifestLoader, type RemoteManifest } from "./manifest-loader";

export class Remote {
  #manifestLoader = new ManifestLoader();
  manifest?: RemoteManifest;
  baseUrl = "";

  constructor(
    private url: string,
    private moduleLoader: { load: (url: string) => Promise<any> },
    private scope: string,
  ) {}

  async #load() {
    const { manifest, __baseUrl } = await this.#manifestLoader.load(
      `${this.url}/${this.scope}/manifest.json`,
    );

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
      const client = await this.#manifestLoader.load(`${this.url.replace(/\/$/, "")}/client/manifest.json`);
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

  lazyComponent(name: string) {
    return lazy(async () => {
      const component = await this.component(name);

      return {
        default: component,
      };
    });
  }
}
