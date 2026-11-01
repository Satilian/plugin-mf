export type PluginMFConfig = {
  remotes?: Record<string, string>;
  expose?: Record<string, string>;
  externals?: string[];
  shared?: string[];
};
