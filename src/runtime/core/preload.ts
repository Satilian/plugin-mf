import type { PreloadOptions } from "../../protocol/preload.ts";
import type { RemoteSource } from "./remote-source.ts";

type Target = { source: RemoteSource; expose: string };

export async function preload(targets: Target[], options: PreloadOptions = {}): Promise<void> {
  const concurrency = options.concurrency ?? 4;
  for (const [name, value] of Object.entries({ concurrency, maxRemotes: options.maxRemotes, maxJSBytes: options.maxJSBytes, maxCSSBytes: options.maxCSSBytes })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < (name === "concurrency" ? 1 : 0))) throw new Error(`[plugin-mf] Invalid preload budget: ${name}`);
  }
  const sources = new Set(targets.map((target) => target.source.provider));
  if (options.maxRemotes !== undefined && sources.size > options.maxRemotes) throw new Error("[plugin-mf] Route remote budget exceeded");
  async function map<T>(callback: (target: Target) => Promise<T>): Promise<T[]> {
    const result: T[] = [];
    let next = 0;
    const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (next < targets.length) {
        options.signal?.throwIfAborted();
        const index = next++;
        result[index] = await callback(targets[index]);
      }
    }));
    const failures = settled.filter((entry) => entry.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((entry) => entry.reason), "[plugin-mf] Route preload failed");
    return result;
  }
  const inspected = await map((target) => target.source.inspectExport(target.expose));
  if ((options.maxJSBytes !== undefined || options.maxCSSBytes !== undefined) && inspected.some((entry) => !entry.measured)) throw new Error("[plugin-mf] Route budgets require asset sizes in all provider manifests");
  const assets = new Map(inspected.flatMap((entry) => entry.assets.map((asset) => [asset.url, asset] as const)));
  const jsBytes = [...assets.values()].filter((asset) => asset.type === "js").reduce((sum, asset) => sum + asset.bytes, 0);
  const cssBytes = [...assets.values()].filter((asset) => asset.type === "css").reduce((sum, asset) => sum + asset.bytes, 0);
  if (options.maxJSBytes !== undefined && jsBytes > options.maxJSBytes) throw new Error(`[plugin-mf] Route JS budget exceeded: ${jsBytes}`);
  if (options.maxCSSBytes !== undefined && cssBytes > options.maxCSSBytes) throw new Error(`[plugin-mf] Route CSS budget exceeded: ${cssBytes}`);
  await map(async (target) => { await target.source.loadExport(target.expose); });
}
