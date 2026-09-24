import { Rspack } from "@rsbuild/core";
import { PluginMFConfig } from ".";

type Config = {
  name?: string;
  entry?: Rspack.Entry;
};

export function modifyEntry<T extends Config>(config: T, mfConfig: PluginMFConfig) {
  if (config.name !== "web" || !mfConfig.shared?.length || !config.entry) return;

  const bootstrap = createSharedBootstrap(mfConfig.shared);

  if (typeof config.entry === "string" || Array.isArray(config.entry)) {
    config.entry = [bootstrap, config.entry] as T["entry"];
    return;
  }

  const entry = config.entry as Rspack.EntryObject;

  for (const [name, value] of Object.entries(entry)) {
    if (typeof value === "string") {
      entry[name] = [bootstrap, value];
      continue;
    }

    if (Array.isArray(value)) {
      entry[name] = [bootstrap, ...value];
      continue;
    }

    const imports = Array.isArray(value.import) ? value.import : [value.import];
    value.import = [bootstrap, ...imports];
  }
}

function createSharedBootstrap(shared: string[]) {
  const imports = shared
    .map((request, index) => `import * as shared${index} from ${JSON.stringify(request)};`)
    .join("\n");

  const registrations = shared
    .map((request, index) => `registerShared(${JSON.stringify(request)}, shared${index});`)
    .join("\n");

  const source = `
    ${imports}
    import { getShared, registerShared } from "plugin-mf/shared";

    ${registrations}
    globalThis.__MF_GET_SHARED__ = getShared;
  `;

  return `data:text/javascript,${encodeURIComponent(source)}`;
}
