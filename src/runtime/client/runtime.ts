import type { ModuleLoader, RemoteModule } from "../../protocol/module.ts";

import { Remote } from "../react/remote.ts";
import { MF_RELEASES_ELEMENT_ID, parseSSRReleases, type SSRReleases } from "../../protocol/ssr-releases.ts";

const importModule = new Function("u", "return import(u)") as (url: string) => Promise<RemoteModule>;

export class Loader implements ModuleLoader {
  load(url: string): Promise<RemoteModule> {
    return importModule(url);
  }
}

const remotes = new Map<string, Remote>();
let releases: SSRReleases | undefined;

function readMFReleases(): SSRReleases | undefined {
  if (releases) return releases;
  const element = document.getElementById(MF_RELEASES_ELEMENT_ID);
  if (element) releases = parseSSRReleases(JSON.parse(element.textContent || ""));
  return releases;
}

export async function initializeMFReleases(): Promise<void> {
  if (document.readyState === "loading") {
    await new Promise<void>((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
  }
  readMFReleases();
}

declare const __MF_REMOTES__: Record<string, string> | undefined;

function ensureInit() {
  if (remotes.size > 0) return;

  const loader = new Loader();
  for (const [name, url] of Object.entries(__MF_REMOTES__ || {})) {
    remotes.set(name, new Remote(url, loader, "client", () => readMFReleases()?.[url.replace(/\/$/, "")]));
  }
}

export function getRemote(name: string): Remote {
  ensureInit();

  const remote = remotes.get(name);
  if (!remote) {
    throw new Error(`[plugin-mf] Remote "${name}" not found. Available: ${[...remotes.keys()].join(", ") || "none"}`);
  }

  return remote;
}
