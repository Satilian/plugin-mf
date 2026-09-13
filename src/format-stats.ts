import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { Rspack } from "@rsbuild/core";

type FormatStatsOptions = {
  stats: Rspack.Stats;
  outputPath: string;
  environment: string;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;

  return `${(bytes / 1024).toFixed(1)} kB`;
}

export async function formatStats({
  stats,
  outputPath,
  environment,
}: FormatStatsOptions) {
  const assets = stats.toJson({ assets: true }).assets ?? [];
  const rows: string[] = [];

  let totalSize = 0;
  let totalGzipSize = 0;

  for (const asset of assets) {
    if (!asset.name) continue;

    const filePath = path.join(outputPath, asset.name);
    const file = await readFile(filePath);
    const size = file.byteLength;

    totalSize += size;

    if (environment === "web") {
      const gzipSize = gzipSync(file).byteLength;
      totalGzipSize += gzipSize;

      rows.push(
        `${path.relative(process.cwd(), filePath).padEnd(48)}` +
          `${formatSize(size).padEnd(12)}` +
          formatSize(gzipSize),
      );
    } else {
      rows.push(
        `${path.relative(process.cwd(), filePath).padEnd(48)}` +
          formatSize(size),
      );
    }
  }

  const output = [
    `File (${environment})`.padEnd(48) +
      "Size".padEnd(environment === "web" ? 12 : 0) +
      (environment === "web" ? "Gzip" : ""),
    ...rows,
    "",
    environment === "web"
      ? `Total:`.padEnd(48) +
        `${formatSize(totalSize).padEnd(12)}` +
        formatSize(totalGzipSize)
      : `Total:`.padEnd(48) + formatSize(totalSize),
  ];

  return output.join("\n") + "\n";
}
