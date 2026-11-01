import { validateAssetPath } from "./asset-path.ts";

export type RemoteManifest = Record<string, string | { js: string; css: string[]; files?: string[]; integrity?: Record<string, string> }>;

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
    if (path.integrity !== undefined) {
      if (!path.integrity || typeof path.integrity !== "object" || Array.isArray(path.integrity) || !path.files ||
        Object.keys(path.integrity).length !== path.files.length ||
        !path.files.every((file: string) => typeof path.integrity[file] === "string" && /^[a-f0-9]{64}$/.test(path.integrity[file]))) {
        throw new Error(`Invalid server integrity for "${name}"`);
      }
    }
  }
  return manifest as RemoteManifest;
}
