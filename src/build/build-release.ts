import type { Rspack } from "@rsbuild/core";
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildExpose, getMFOutputPath } from "./build-expose.ts";
import { buildTypes } from "./build-types.ts";
import { RELEASE_MANIFEST_VERSION, type ReleaseManifest } from "../protocol/release-manifest.ts";

type BuildReleaseOptions = {
  entry: Record<string, string>;
  externals?: string[];
  nodeConfig?: Rspack.Configuration;
  webConfig?: Rspack.Configuration;
  rootPath: string;
};

export async function buildRelease({ entry, externals, nodeConfig, webConfig, rootPath }: BuildReleaseOptions): Promise<void> {
  const releaseId = randomUUID();
  const tasks: Promise<void>[] = [];

  if (nodeConfig) {
    tasks.push(
      buildExpose({
        releaseId,
        entry,
        externals,
        config: nodeConfig,
      }),
    );
  }

  if (webConfig) {
    tasks.push(
      buildExpose({
        releaseId,
        entry,
        externals,
        config: webConfig,
      }),
    );
  }

  await Promise.all(tasks);

  const outputConfig = webConfig ?? nodeConfig;
  if (outputConfig) {
    const outputPath = getMFOutputPath(outputConfig);
    await buildTypes({ rootPath, entry, outputPath: path.join(outputPath, releaseId) });

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
}
