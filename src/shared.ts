type Factory = () => Promise<any>;

type SharedEntry = {
  get: Factory;
  loaded?: boolean;
  version?: string;
  module?: any; // кэш
};

const shareScope: Record<string, Record<string, SharedEntry>> = {
  default: {},
};

export function registerShared(name: string, factory: Factory, version = "0.0.0", scope = "default") {
  const bucket = (shareScope[scope] ??= {});
  // singleton: не перезаписываем, если уже есть
  if (!bucket[name]) {
    bucket[name] = { get: factory, version };
  }
}

export async function getShared(name: string, scope = "default") {
  const entry = shareScope[scope]?.[name];
  if (!entry) {
    throw new Error(`[mf] Shared module "${name}" is not registered`);
  }

  if (!entry.module) {
    entry.module = await entry.get();
    entry.loaded = true;
  }

  return entry.module;
}

export function getShareScope() {
  return shareScope;
}
