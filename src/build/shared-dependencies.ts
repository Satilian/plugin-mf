import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { packageName, parseSharedRequirements, type SharedDependency, type SharedRequirements } from "../protocol/shared-dependencies.ts";

function installedVersion(request: string, root: string): string {
  const name = packageName(request);
  const require = createRequire(path.join(root, "package.json"));
  let directory = path.dirname(require.resolve(request));
  while (true) {
    try {
      const metadata: unknown = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
      if (metadata && typeof metadata === "object" && "name" in metadata && metadata.name === name &&
        "version" in metadata && typeof metadata.version === "string") return metadata.version;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`[plugin-mf] Cannot determine installed version: ${request}`);
    directory = parent;
  }
}

export function resolveShared(dependencies: SharedDependency[] = [], root: string): SharedRequirements {
  const options = dependencies.map((item) => typeof item === "string" ? { name: item } : item);
  const expanded = [...options];
  if (options.some((item) => item.name === "react")) {
    for (const name of ["react/jsx-runtime", "react/jsx-dev-runtime"]) {
      if (!expanded.some((item) => item.name === name)) expanded.push({ ...options.find((item) => item.name === "react"), name });
    }
  }
  const entries = expanded.map((item) => {
    const inherited = options.find((option) => option.name === packageName(item.name));
    const config = { ...inherited, ...item };
    const version = installedVersion(item.name, root);
    if (config.version !== undefined && config.version !== version) throw new Error(`[plugin-mf] ${item.name}: configured version ${config.version} differs from installed ${version}`);
    return [item.name, { version, requiredVersion: config.requiredVersion ?? `^${version}`, singleton: config.singleton ?? true }];
  });
  return parseSharedRequirements(Object.fromEntries(entries));
}
