import { rspack, Rspack } from "@rsbuild/core";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { formatStats } from "./format-stats";

type Externals = Rspack.RspackOptions["externals"];

export type BuildExposeProps = {
  entry: Record<string, string>;
  externals?: string[];
  config: Rspack.Configuration;
};

export async function buildExpose({ entry, externals, config: baseConfig }: BuildExposeProps) {
  const outputPath = path.resolve(baseConfig?.output?.path || "", "mf");

  const config: Rspack.RspackOptions = {
    ...baseConfig,
    name: `mf-${String(baseConfig.name || "bundle")}`,
    entry,
    output: {
      ...baseConfig.output,
      path: outputPath,
      filename: "[name].[contenthash:10].js",
      library: { type: "module" },
      module: true,
    },
    optimization: { ...baseConfig.optimization, runtimeChunk: false },
  };

  config.output ??= {};
  config.optimization ??= {};

  const mergedExternals = [];
  if (baseConfig.externals) mergedExternals.push(baseConfig.externals);
  if (externals && baseConfig.name !== "web") mergedExternals.push(externals);
  config.externals = mergedExternals.flat();

  if (baseConfig.name === "web") {
    config.output.chunkFormat = "module";
    config.output.chunkLoading = "import";

    config.optimization.splitChunks = false;

    config.externals.push(({ request }, callback) => {
      if (request && externals?.includes(request)) {
        callback(undefined, `var globalThis.__MF_GET_SHARED__(${JSON.stringify(request)})`);
        return;
      }

      callback();
    });
  }

  const compiler = rspack(config);

  try {
    const { manifest, stats } = await new Promise<{
      manifest: Record<string, string>;
      stats?: Rspack.Stats;
    }>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) return reject(error);

        if (stats?.hasErrors()) {
          console.error(stats.toString({ colors: true }));

          return reject(new Error("MF build failed"));
        }

        const manifest = (stats?.toJson({ assets: true }).assets ?? []).reduce((acc, { name, chunkNames }) => {
          return chunkNames?.[0] ? { ...acc, [chunkNames[0]]: name } : acc;
        }, {});

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
