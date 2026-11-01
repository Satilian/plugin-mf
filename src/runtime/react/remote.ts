import { createElement, Fragment, lazy, type ComponentType, type LazyExoticComponent } from "react";
import { RemoteSource } from "../core/remote-source.ts";
import { RemoteLoadError } from "../../protocol/load-error.ts";

export class Remote extends RemoteSource {
  #lazyComponents = new Map<string, unknown>();
  #failedComponents = new Set<string>();

  retry(name: string): void {
    if (!this.#failedComponents.delete(name)) return;
    this.#lazyComponents.delete(name);
  }

  async component<Props extends object = Record<string, unknown>>(name: string): Promise<ComponentType<Props>> {
    const { value, stylesheets } = await this.loadExport(name);
    if (typeof value !== "function" && (typeof value !== "object" || value === null || !("$$typeof" in value))) {
      throw new RemoteLoadError(this.context("module"), "LOAD_FAILED", `Export "${name}" is not a React component`);
    }
    const Component = value as ComponentType<Props>;
    if (!stylesheets.length) return Component;
    return function StyledRemote(props: Props) {
      return createElement(Fragment, null,
        ...stylesheets.map((href) => createElement("link", { key: href, rel: "stylesheet", href, precedence: "mf" })),
        createElement(Component, props),
      );
    };
  }

  lazyComponent<Props extends object = Record<string, unknown>>(name: string): LazyExoticComponent<ComponentType<Props>> {
    const cached = this.#lazyComponents.get(name);
    if (cached) return cached as LazyExoticComponent<ComponentType<Props>>;
    const component = lazy(async () => {
      try {
        return { default: await this.component<Props>(name) };
      } catch (error) {
        this.#failedComponents.add(name);
        throw error;
      }
    });
    this.#lazyComponents.set(name, component);
    return component;
  }
}
