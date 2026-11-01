import { preloadRemotes, type PreloadTarget } from "plugin-mf/client";

export function preloadPage(page: "home" | "about"): void {
  const targets: PreloadTarget[] = [
    { remote: "host2", expose: "Section" },
    { remote: "subhost1", expose: "Button" },
    ...(page === "home" ? [{ remote: "host1", expose: "P" }, { remote: "host2", expose: "Span" }]
      : [{ remote: "host1", expose: "Div" }]),
  ];
  void preloadRemotes(targets, { concurrency: 2, maxRemotes: 3, maxJSBytes: 5_000_000, maxCSSBytes: 200_000 })
    .catch((error: unknown) => console.warn("[preload]", error instanceof Error ? error.message : "Loading failed"));
}
