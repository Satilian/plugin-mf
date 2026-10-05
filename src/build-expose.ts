import { rspack, Rspack } from "@rsbuild/core";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { formatStats } from "./format-stats";
import type { RemoteManifest } from "./manifest-loader";

export type BuildExposeProps = {
  entry: Record<string, string>;
  externals?: string[];
  config: Rspack.Configuration;
};

export function getMFOutputPath(config: Rspack.Configuration) {
  const outputPath = config.output?.path;
  if (!outputPath) throw new Error("[plugin-mf] Unable to determine MF output path");

  return path.resolve(outputPath, "mf");
}

export async function buildExpose({ entry, externals, config: baseConfig }: BuildExposeProps) {
  const scope = baseConfig.name === "node" ? "server" : "client";
  const outputPath = path.join(getMFOutputPath(baseConfig), scope);

  const config: Rspack.RspackOptions = {
    ...baseConfig,
    name: `mf-${String(baseConfig.name || "bundle")}`,
    entry,
    output: {
      ...baseConfig.output,
      path: outputPath,
      filename: "[name].[contenthash:10].js",
      cssFilename: "[name].[contenthash:10].css",
      cssChunkFilename: "[name].[contenthash:10].css",
      library: { type: "module" },
      module: true,
    },
    plugins: baseConfig.plugins?.map((plugin) =>
      plugin instanceof rspack.CssExtractRspackPlugin || plugin?.constructor.name === "CssExtractRspackPlugin"
        ? new rspack.CssExtractRspackPlugin({
            ...(plugin as InstanceType<typeof rspack.CssExtractRspackPlugin>).options,
            filename: "[name].[contenthash:10].css",
            chunkFilename: "[name].[contenthash:10].css",
          })
        : plugin,
    ),
    optimization: { ...baseConfig.optimization, runtimeChunk: false },
  };

  config.output ??= {};
  config.optimization ??= {};

  const mergedExternals = [];
  if (baseConfig.externals) mergedExternals.push(baseConfig.externals);
  config.externals = mergedExternals.flat();

  // Remotes must use the host's module instances, including during SSR.
  // Place this before inherited externals so they cannot resolve a second copy.
  config.externals.unshift(({ request }, callback) => {
    if (request && externals?.includes(request)) {
      callback(undefined, `var globalThis.__MF_GET_SHARED__(${JSON.stringify(request)})`);
      return;
    }

    callback();
  });

  if (baseConfig.name === "web") {
    config.output.chunkFormat = "module";
    config.output.chunkLoading = "import";

    config.optimization.splitChunks = false;

  }

  const compiler = rspack(config);

  try {
    const { manifest, stats } = await new Promise<{
      manifest: RemoteManifest;
      stats?: Rspack.Stats;
    }>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) return reject(error);

        if (stats?.hasErrors()) {
          console.error(stats.toString({ colors: true }));

          return reject(new Error("MF build failed"));
        }

        const manifest: RemoteManifest = {};
        for (const [name, entrypoint] of Object.entries(stats?.toJson({ entrypoints: true }).entrypoints ?? {})) {
          const assets = entrypoint.assets?.map((asset) => asset.name) ?? [];
          const js = assets.filter((asset) => /\.m?js$/.test(asset));
          if (js.length !== 1)
            return reject(new Error(`[plugin-mf] Expected one JS entry for "${name}", got ${js.length}`));
          manifest[name] = { js: js[0], css: assets.filter((asset) => asset.endsWith(".css")) };
        }

        resolve({ manifest, stats });
      });
    });

    if (stats)
      console.log(
        await formatStats({
          stats,
          outputPath: outputPath,
          environment: config.name || "",
        }),
      );

    await writeFile(path.join(outputPath, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  } finally {
    await new Promise<void>((resolve, reject) => {
      compiler.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
