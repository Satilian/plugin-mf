import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseTypeManifest } from "../protocol/type-manifest.ts";
import { loadReleaseManifest } from "../transport/release-loader.ts";

type SyncRemoteTypesProps = {
  remotes: Record<string, string>;
  rootPath: string;
};

type TypeModule = {
  name: string;
  path: string;
  export: string;
};

export async function syncTypes({ remotes, rootPath }: SyncRemoteTypesProps): Promise<void> {
  const typesRoot = path.join(rootPath, "node_modules", ".cache", "mf-types");
  const modulesFile = path.join(rootPath, "src", "mf-types.d.ts");
  await rm(typesRoot, { recursive: true, force: true });
  await mkdir(typesRoot, { recursive: true });

  const modules: TypeModule[] = [];
  const fallbacks: string[] = [];

  for (const [name, url] of Object.entries(remotes)) {
    try {
      modules.push(...(await downloadRemoteTypes(name, url, typesRoot)));
    } catch (error) {
      console.warn(`[plugin-mf] Unable to load types for remote "${name}": ${message(error)}`);
      fallbacks.push(name);
    }
  }

  const source = [...modules.map(createModuleDeclaration), ...fallbacks.map(createFallbackDeclaration), ""].join("\n");
  await writeFile(modulesFile, source, "utf8");
}

async function downloadRemoteTypes(name: string, url: string, typesRoot: string): Promise<TypeModule[]> {
  const remoteBaseUrl = `${url.replace(/\/$/, "")}/`;
  const release = await loadReleaseManifest(new URL("manifest.json", remoteBaseUrl).href);
  const manifestUrl = release
    ? new URL(release.manifest.types, release.baseUrl).href
    : new URL("types/manifest.json", remoteBaseUrl).href;
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const manifest = parseTypeManifest(await response.json());
  const baseUrl = new URL(".", response.url);
  const remoteRoot = path.join(typesRoot, name);

  await Promise.all(
    manifest.files.map(async (filePath) => {
      const fileResponse = await fetch(new URL(filePath, baseUrl));
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
    path: `../node_modules/.cache/mf-types/${name}/${info.path.replace(/\.d\.ts$/, "")}`,
    export: info.export,
  }));
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
    "  const remote: unknown;",
    "  export default remote;",
    "}",
  ].join("\n");
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
