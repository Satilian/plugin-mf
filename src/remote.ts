import { lazy } from "react";
import { ManifestLoader } from "./manifest-loader";

export class Remote {
  #manifestLoader = new ManifestLoader();
  manifest?: Record<string, string>;
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

    const url = new URL(path, this.baseUrl).href;
    const module = await this.moduleLoader.load(url);
    const component = module[name];

    if (!component) throw new Error(`Export "${name}" not found in ${url}`);

    return component;
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
