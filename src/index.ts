import type { RsbuildPlugin, Rspack } from "@rsbuild/core";
import { buildExpose, getMFOutputPath } from "./build-expose";
import { buildTypes } from "./build-types";
import { resolver } from "./resolver";
import { modifyEntry } from "./bootstrap";
import { syncTypes } from "./sync-types";
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RELEASE_MANIFEST_VERSION, type ReleaseManifest } from "./release-manifest";

export type PluginMFConfig = {
  remotes?: Record<string, string>;
  expose?: Record<string, string>;
  externals?: string[];
  shared?: string[];
};

export const pluginMF = (mfConfig: PluginMFConfig = {}): RsbuildPlugin => ({
  name: "plugin-mf",
  setup(api) {
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

      // One identifier per build, shared by all artifacts of this provider.
      const releaseId = randomUUID();
      const tasks: Promise<void>[] = [];

      if (nodeConfig) {
        tasks.push(
          buildExpose({
            releaseId,
            entry: mfConfig.expose,
            externals: mfConfig.externals,
            config: nodeConfig,
          }),
        );
      }

      if (webConfig) {
        tasks.push(
          buildExpose({
            releaseId,
            entry: mfConfig.expose,
            externals: mfConfig.externals,
            config: webConfig,
          }),
        );
      }

      await Promise.all(tasks);

      const outputConfig = webConfig ?? nodeConfig;
      if (outputConfig) {
        const outputPath = getMFOutputPath(outputConfig);
        await buildTypes({ entry: mfConfig.expose, outputPath: path.join(outputPath, releaseId) });

        const manifest: ReleaseManifest = {
          version: RELEASE_MANIFEST_VERSION,
          releaseId,
          ...(nodeConfig ? { server: `${releaseId}/server/manifest.json` } : {}),
          ...(webConfig ? { client: `${releaseId}/client/manifest.json` } : {}),
          types: `${releaseId}/types/manifest.json`,
        };
        const manifestSource = JSON.stringify(manifest, null, 2);
        await writeFile(path.join(outputPath, releaseId, "pointer.json"), manifestSource, "utf8");
        const temporaryPath = path.join(outputPath, `.manifest.${releaseId}.tmp`);
        try {
          await writeFile(temporaryPath, manifestSource, "utf8");
          await rename(temporaryPath, path.join(outputPath, "manifest.json"));
        } finally {
          await rm(temporaryPath, { force: true });
        }
      }
    });

    const remoteNames = Object.keys(mfConfig.remotes || {});

    if (remoteNames.length) {
      api.onBeforeBuild(async () => {
        await syncTypes({ remotes: mfConfig.remotes! });
      });

      api.modifyRspackConfig((config) => {
        config.plugins = config.plugins || [];
        config.plugins.push(
          new (require("@rspack/core").DefinePlugin)({
            __MF_REMOTES__: JSON.stringify(mfConfig.remotes),
          }),
        );

        modifyEntry<typeof config>(config, mfConfig);
      });

      api.resolve(({ resolveData, environment }) => {
        resolveData.request = resolver(resolveData.request, remoteNames, environment.name);
      });
    }
  },
});
