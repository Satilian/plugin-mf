type Factory = () => Promise<unknown>;

type SharedEntry = {
  get: Factory;
  loaded?: boolean;
  version?: string;
  module?: unknown;
};

const shareScope: Record<string, Record<string, SharedEntry>> = {
  default: {},
};

export function registerShared(name: string, module: unknown, version = "0.0.0", scope = "default"): void {
  const bucket = (shareScope[scope] ??= {});
  if (!bucket[name]) {
    bucket[name] = {
      get: () => Promise.resolve(module),
      module,
      loaded: true,
      version,
    };
  }
}

export function getShared(name: string, scope = "default") {
  const entry = shareScope[scope]?.[name];

  if (!entry) {
    throw new Error(`[mf] Shared module "${name}" is not registered`);
  }

  return entry.module;
}

export function getShareScope(): Record<string, Record<string, SharedEntry>> {
  return shareScope;
}
