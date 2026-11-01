import { createHash } from "node:crypto";
import { validateAssetPath } from "../../../protocol/asset-path.ts";
import type { ModuleLoadContext } from "../../../protocol/module.ts";

type CacheFile = { path: string; url: string };
export type CacheEntry = { key: string; files: CacheFile[]; entryPath: string };

export function describe(url: string, context?: ModuleLoadContext): CacheEntry {
  const entry = new URL(url);
  if (entry.protocol !== "http:" && entry.protocol !== "https:") throw new Error("[plugin-mf] Unsupported module URL protocol");
  const baseUrl = context ? new URL(context.baseUrl) : new URL(".", entry);
  const paths = context?.files ?? [decodeURIComponent(entry.pathname.split("/").at(-1) || "remote.js")];
  const files = [...new Set(paths)].sort().map((file) => {
    validateAssetPath(file);
    if (["package.json", ".ready.json"].includes(file.toLowerCase())) {
      throw new Error(`[plugin-mf] Reserved cache asset path: ${file}`);
    }
    return { path: file, url: context ? new URL(file, baseUrl).href : entry.href };
  });
  const selected = files.find((file) => file.url === entry.href);
  if (!selected) throw new Error("[plugin-mf] Module entry is missing from its asset list");
  const localNames = files.map((file) => process.platform === "win32" ? file.path.toLowerCase() : file.path);
  if (new Set(localNames).size !== localNames.length) throw new Error("[plugin-mf] Cache asset paths collide");
  const key = createHash("sha256").update(JSON.stringify({
    provider: context?.provider ?? baseUrl.href,
    releaseId: context?.releaseId ?? null,
    files,
  })).digest("hex");
  return { key, files, entryPath: selected.path };
}
