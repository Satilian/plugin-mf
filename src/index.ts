import type { RsbuildPlugin, Rspack } from "@rsbuild/core";
import { buildExpose } from "./build-expose";
import { resolver } from "./resolver";

export type PluginMFConfig = {
  remotes?: Record<string, string>;
  expose?: Record<string, string>;
  externals?: string[];
};

export const pluginMF = (mfConfig: PluginMFConfig = {}): RsbuildPlugin => ({
  name: "plugin-mf",
  setup(api) {
    let nodeConfig: Rspack.Configuration | undefined;
    let webConfig: Rspack.Configuration | undefined;

    api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
      bundlerConfigs.forEach((config) => {
        if (!nodeConfig && config.name === "node") {
          nodeConfig = config;
          return;
        }

        if (!webConfig && config.name === "web") webConfig = config;
      });
    });

    api.onAfterBuild(async () => {
      if (!mfConfig.expose || Object.keys(mfConfig.expose).length === 0) return;

      const tasks: Promise<void>[] = [];

      if (nodeConfig) {
        tasks.push(
          buildExpose({
            entry: mfConfig.expose,
            externals: mfConfig.externals,
            config: nodeConfig,
          }),
        );
      }

      if (webConfig) {
        tasks.push(
          buildExpose({
            entry: mfConfig.expose,
            externals: mfConfig.externals,
            config: webConfig,
          }),
        );
      }

      await Promise.all(tasks);
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

      api.resolve(({ resolveData, environment }) => {
        resolveData.request = resolver(resolveData.request, remoteNames, environment.name);
      });
    }
  },
});
