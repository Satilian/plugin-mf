import type { LoadingOptions } from "../protocol/load-error.ts";
import type { TypesSyncOptions } from "./types-options.ts";

export type PluginMFConfig = {
  types?: TypesSyncOptions;
  loading?: LoadingOptions;
  remotes?: Record<string, string>;
  expose?: Record<string, string>;
  externals?: string[];
  shared?: string[];
};
