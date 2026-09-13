import { Remote } from "./remote";

export class Loader {
  load(url: string) {
    return new Function("u", "return import(u)")(url);
  }
}

const remotes = new Map<string, Remote>();

declare const __MF_REMOTES__: Record<string, string> | undefined;

function ensureInit() {
  if (remotes.size > 0) return;

  const loader = new Loader();
  for (const [name, url] of Object.entries(__MF_REMOTES__ || {})) {
    remotes.set(name, new Remote(url, loader, "client"));
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
