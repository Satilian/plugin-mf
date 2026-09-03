import { ManifestLoader } from "./manifest-loader";
import { RemoteModuleLoader } from "./module-loader";
import { lazy } from "react";

export class Remote {
  manifest?: Record<string, string>;
  baseUrl = "";

  constructor(
    private url: string,
    private manifestLoader = new ManifestLoader(),
    private moduleLoader = new RemoteModuleLoader(),
  ) {}

  async #load(url: string) {
    const { manifest, __baseUrl } = await this.manifestLoader.load(url);

    this.manifest = manifest;
    this.baseUrl = __baseUrl;
  }

  async component(name: string) {
    if (!this.manifest) await this.#load(this.url!);

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
