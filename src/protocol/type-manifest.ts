import { validateAssetPath } from "./asset-path.ts";

export type RemoteTypeManifest = {
  version: 1;
  files: string[];
  exposes: Record<string, { path: string; export: string }>;
};


export function parseTypeManifest(value: unknown): RemoteTypeManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid types manifest");

  const manifest = value as Partial<RemoteTypeManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.exposes ||
    typeof manifest.exposes !== "object" || Array.isArray(manifest.exposes)) {
    throw new Error("Invalid types manifest");
  }

  for (const filePath of manifest.files) validatePath(filePath);
  if (new Set(manifest.files.map((file) => file.toLowerCase())).size !== manifest.files.length) {
    throw new Error("Duplicate declaration paths in types manifest");
  }

  for (const [name, info] of Object.entries(manifest.exposes)) {
    if (!name || !info || typeof info.path !== "string" || typeof info.export !== "string") {
      throw new Error("Invalid exposed type in manifest");
    }

    validatePath(info.path);
    if (!manifest.files.includes(info.path)) {
      throw new Error(`Missing declaration "${info.path}" for exposed module "${name}"`);
    }
  }

  return manifest as RemoteTypeManifest;
}

function validatePath(filePath: unknown) {
  if (typeof filePath !== "string" || !filePath.endsWith(".d.ts")) {
    throw new Error(`Invalid declaration path "${filePath}"`);
  }
  validateAssetPath(filePath);
}
