import { rspack, type RsbuildPlugin, type Rspack } from "@rsbuild/core";
import path from "node:path";
import { buildRelease } from "./build-release.ts";
import { resolver } from "./resolver.ts";
import { modifyEntry } from "./bootstrap.ts";
import { syncTypes } from "./sync-types.ts";
import type { PluginMFConfig } from "./config.ts";
import { configureLoading } from "../transport/loading.ts";
import { resolveShared } from "./shared-dependencies.ts";
import { configureNetwork } from "../transport/network-policy.ts";

export const pluginMF = (mfConfig: PluginMFConfig = {}): RsbuildPlugin => ({
  name: "plugin-mf",
  setup(api) {
    if (mfConfig.network) configureNetwork(mfConfig.network);
    const shared = resolveShared(mfConfig.shared, api.context.rootPath);
    const externals = resolveShared(mfConfig.externals, api.context.rootPath);
    if (mfConfig.loading) configureLoading(mfConfig.loading);
    let nodeConfig: Rspack.Configuration | undefined;
    let webConfig: Rspack.Configuration | undefined;

    if (mfConfig.expose && Object.keys(mfConfig.expose).length) {
      api.modifyEnvironmentConfig((config) => {
        const clean = config.output.cleanDistPath;
        const options = typeof clean === "object" ? clean : { enable: clean };
        const mfPath = path.resolve(api.context.rootPath, config.output.distPath.root ?? "dist", "mf").replace(/\\/g, "/");
        const keepMF = new RegExp(`^${mfPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/|$)`);
        config.output.cleanDistPath = { ...options, keep: [...(options.keep ?? []), keepMF] };
      });
    }

    api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
      bundlerConfigs.forEach((config) => {
        if (!nodeConfig && config.name === "node") {
          nodeConfig = config;
          return;
        }

        if (!webConfig && config.name === "web") webConfig = config;
      });

      if (!nodeConfig && webConfig)
        nodeConfig = {
          ...webConfig,
          name: "node",
          target: "node",
          externalsPresets: {
            ...webConfig.externalsPresets,
            node: true,
          },
        };
    });

    api.onAfterBuild(async () => {
      if (!mfConfig.expose || Object.keys(mfConfig.expose).length === 0) return;

      await buildRelease({ entry: mfConfig.expose, externals, splitChunks: mfConfig.splitChunks, nodeConfig, webConfig, rootPath: api.context.rootPath });
    });

    const remoteNames = Object.keys(mfConfig.remotes || {});

    api.modifyRspackConfig((config) => modifyEntry<typeof config>(config, mfConfig, shared));

    if (remoteNames.length) {
      api.onBeforeBuild(async () => {
        await syncTypes({ remotes: mfConfig.remotes ?? {}, rootPath: api.context.rootPath, types: mfConfig.types });
      });

      api.modifyRspackConfig((config) => {
        config.plugins = config.plugins || [];
        config.plugins.push(
          new rspack.DefinePlugin({
            __MF_REMOTES__: JSON.stringify(mfConfig.remotes),
            __MF_LOADING__: JSON.stringify(mfConfig.loading ?? {}),
            __MF_NETWORK__: JSON.stringify(mfConfig.network ?? {}),
          }),
        );

      });

      api.resolve(({ resolveData, environment }) => {
        resolveData.request = resolver(resolveData.request, remoteNames, environment.name);
      });
    }
  },
});
