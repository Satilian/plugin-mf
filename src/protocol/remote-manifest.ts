import { validateAssetPath } from "./asset-path.ts";

export type RemoteManifest = Record<string, string | { js: string; css: string[]; files?: string[] }>;

export type RemoteInfo = {
  manifest: RemoteManifest;
  __baseUrl: string;
};

export function parseRemoteManifest(value: unknown): RemoteManifest {
  const manifest = value;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Invalid remote manifest");
  }

  for (const [name, path] of Object.entries(manifest)) {
    if (typeof path === "string" && path.length) continue;
    if (!path || typeof path !== "object" || Array.isArray(path) ||
      typeof path.js !== "string" || !path.js || !Array.isArray(path.css) ||
      !path.css.every((asset: unknown) => typeof asset === "string" && asset.length > 0)) {
      throw new Error(`Invalid remote assets for "${name}"`);
    }
    if (path.files !== undefined) {
      if (!Array.isArray(path.files) || !path.files.includes(path.js)) {
        throw new Error(`Invalid remote files for "${name}"`);
      }
      for (const file of path.files) {
        if (typeof file !== "string") throw new Error(`Invalid remote file for "${name}"`);
        validateAssetPath(file);
      }
    }
  }
  return manifest as RemoteManifest;
}
