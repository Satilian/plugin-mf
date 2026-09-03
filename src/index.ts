import type { RsbuildPlugin, Rspack } from "@rsbuild/core";
import { buildExpose } from "./build-expose";
import { moduleResolver } from "./module-resolver";

export type PluginMFConfig = {
  remotes?: Record<string, string>;
  expose?: Record<string, string>;
  externals?: string[];
};

export const pluginMF = (mfConfig: PluginMFConfig = {}): RsbuildPlugin => ({
  name: "plugin-mf",
  setup(api) {
    let nodeConfig: Rspack.Configuration | undefined;

    api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
      nodeConfig = bundlerConfigs.find((config) => config.target === "node");
    });

    api.onAfterBuild(async () => {
      if (!nodeConfig) throw new Error("Node config not found");

      if (!mfConfig.expose || Object.keys(mfConfig.expose).length === 0) return;

      await buildExpose({
        entry: mfConfig.expose,
        externals: mfConfig.externals,
        nodeConfig,
      });
    });

    const remoteNames = Object.keys(mfConfig.remotes || {});

    if (remoteNames.length) {
      api.modifyRspackConfig((config) => {
        config.plugins = config.plugins || [];
        config.plugins.push(
          new (require("@rspack/core").DefinePlugin)({
            __MF_REMOTES__: JSON.stringify(mfConfig.remotes),
          }),
        );
      });

      api.resolve(({ resolveData }) => {
        resolveData.request = moduleResolver(resolveData.request, remoteNames);
      });
    }
  },
});

export { getRemote } from "./runtime";
