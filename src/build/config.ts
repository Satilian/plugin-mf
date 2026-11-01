import type { LoadingOptions } from "../protocol/load-error.ts";
import type { TypesSyncOptions } from "./types-options.ts";
import type { SharedDependency } from "../protocol/shared-dependencies.ts";
import type { NetworkOptions } from "../protocol/network-policy.ts";

export type PluginMFConfig = {
  splitChunks?: boolean;
  network?: NetworkOptions;
  types?: TypesSyncOptions;
  loading?: LoadingOptions;
  remotes?: Record<string, string>;
  expose?: Record<string, string>;
  externals?: SharedDependency[];
  shared?: SharedDependency[];
};
