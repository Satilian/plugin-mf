import { rspack, Rspack } from "@rsbuild/core";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export type BuildExposeProps = {
  entry: Record<string, string>;
  externals?: string[];
  nodeConfig: Rspack.Configuration;
};

export async function buildExpose({
  entry,
  externals,
  nodeConfig,
}: BuildExposeProps) {
  const config = {
    ...nodeConfig,
    name: `mf`,
    entry,
    externals,
    output: {
      ...nodeConfig.output,
      path: path.resolve(nodeConfig?.output?.path || "", "mf"),
      filename: "[name].[contenthash:10].js",
      library: { type: "module" },
      module: true,
    },
    experiments: { ...nodeConfig.experiments, outputModule: true },
    optimization: { ...nodeConfig.optimization, runtimeChunk: false },
  };

  const compiler = rspack(config);

  try {
    const manifest = await new Promise<Record<string, string>>(
      (resolve, reject) => {
        compiler.run((error, stats) => {
          if (error) return reject(error);

          if (stats?.hasErrors()) {
            console.error(stats.toString({ colors: true }));

            return reject(new Error("MF build failed"));
          }

          const manifest = (
            stats?.toJson({ assets: true }).assets ?? []
          ).reduce((acc, { name, chunkNames }) => {
            return chunkNames?.[0] ? { ...acc, [chunkNames[0]]: name } : acc;
          }, {});

          resolve(manifest);
        });
      },
    );

    const outputPath = path.resolve(nodeConfig.output?.path || "", "mf");

    await writeFile(
      path.join(outputPath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      compiler.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
