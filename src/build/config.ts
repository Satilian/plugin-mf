import type { LoadingOptions } from "../protocol/load-error.ts";

export type PluginMFConfig = {
  loading?: LoadingOptions;
  remotes?: Record<string, string>;
  expose?: Record<string, string>;
  externals?: string[];
  shared?: string[];
};
