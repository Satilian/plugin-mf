import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RemoteTypeManifest } from "./build-types";

type SyncRemoteTypesProps = {
  remotes: Record<string, string>;
};

type TypeModule = {
  name: string;
  path: string;
  export: string;
};

const TYPES_ROOT = path.join(process.cwd(), "src", "mf-types");
const MODULES_FILE = path.join(process.cwd(), "src", "mf-types.d.ts");

export async function syncRemoteTypes({ remotes }: SyncRemoteTypesProps) {
  await rm(TYPES_ROOT, { recursive: true, force: true });
  await mkdir(TYPES_ROOT, { recursive: true });

  const modules: TypeModule[] = [];
  const fallbacks: string[] = [];

  for (const [name, url] of Object.entries(remotes)) {
    try {
      modules.push(...(await downloadRemoteTypes(name, url)));
    } catch (error) {
      console.warn(`[plugin-mf] Unable to load types for remote "${name}": ${message(error)}`);
      fallbacks.push(name);
    }
  }

  const source = [...modules.map(createModuleDeclaration), ...fallbacks.map(createFallbackDeclaration), ""].join("\n");
  await writeFile(MODULES_FILE, source, "utf8");
}

async function downloadRemoteTypes(name: string, url: string): Promise<TypeModule[]> {
  const manifestUrl = new URL("client/types-manifest.json", `${url.replace(/\/$/, "")}/`).href;
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const manifest = validateManifest(await response.json());
  const baseUrl = new URL(".", response.url);
  const remoteRoot = path.join(TYPES_ROOT, name);

  await Promise.all(
    manifest.files.map(async (filePath) => {
      const fileResponse = await fetch(new URL(`types/${filePath}`, baseUrl));
      if (!fileResponse.ok) {
        throw new Error(`Unable to load declaration "${filePath}": ${fileResponse.status} ${fileResponse.statusText}`);
      }

      const outputPath = path.join(remoteRoot, ...filePath.split("/"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, await fileResponse.text(), "utf8");
    }),
  );

  return Object.entries(manifest.exposes).map(([expose, info]) => ({
    name: `${name}/${expose}`,
    path: `./mf-types/${name}/${info.path.replace(/\.d\.ts$/, "")}`,
    export: info.export,
  }));
}

function validateManifest(value: unknown): RemoteTypeManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid types manifest");

  const manifest = value as Partial<RemoteTypeManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.exposes) {
    throw new Error("Invalid types manifest");
  }

  for (const filePath of manifest.files) validatePath(filePath);

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

function validatePath(filePath: string) {
  if (!filePath.endsWith(".d.ts") || path.posix.isAbsolute(filePath) || filePath.split("/").includes("..")) {
    throw new Error(`Invalid declaration path "${filePath}"`);
  }
}

function createModuleDeclaration(module: TypeModule) {
  return [
    `declare module ${JSON.stringify(module.name)} {`,
    `  const remote: typeof import(${JSON.stringify(module.path)})[${JSON.stringify(module.export)}];`,
    "  export default remote;",
    "}",
  ].join("\n");
}

function createFallbackDeclaration(name: string) {
  return [
    `declare module ${JSON.stringify(`${name}/*`)} {`,
    "  const remote: any;",
    "  export default remote;",
    "}",
  ].join("\n");
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
