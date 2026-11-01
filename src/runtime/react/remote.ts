import { createElement, Fragment, lazy, type ComponentType, type LazyExoticComponent } from "react";
import { RemoteSource } from "../core/remote-source.ts";

export class Remote extends RemoteSource {
  #lazyComponents = new Map<string, unknown>();

  async component<Props extends object = Record<string, unknown>>(name: string): Promise<ComponentType<Props>> {
    const { value, stylesheets } = await this.loadExport(name);
    if (typeof value !== "function" && (typeof value !== "object" || value === null || !("$$typeof" in value))) {
      throw new Error('Remote export "' + name + '" is not a React component');
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
    const component = lazy(async () => ({ default: await this.component<Props>(name) }));
    this.#lazyComponents.set(name, component);
    return component;
  }
}
