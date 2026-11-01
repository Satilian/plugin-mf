import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { createElement, Suspense } from "react";
import { configureRegistry, configureServerCache, configureLoading, configureNetwork, configureObservability,
  getLoadingMetrics, getRemote, runWithMFRequest, createRemoteComponent, Loader } from "../dist/server.js";
import { registerShared } from "../dist/shared.js";
import { startProviders } from "./scale-providers.mjs";

const { renderToPipeableStream, renderToString } = createRequire(new URL("../example/shell/package.json", import.meta.url))("react-dom/server");

const { values } = parseArgs({ options: { count: { type: "string", default: "120" },
  output: { type: "string", default: "node_modules/.cache/mf-scale-report.json" },
  updates: { type: "string", default: "20" }, active: { type: "string" },
  child: { type: "boolean" }, url: { type: "string" }, cache: { type: "string" } } });
configureNetwork({ requireServerIntegrity: true });
configureLoading({ manifestTimeoutMs: 500, moduleTimeoutMs: 30_000, retries: 1, retryDelayMs: 5,
  circuitBreaker: { failureThreshold: 100, cooldownMs: 50 } });

if (values.child) {
  configureServerCache({ cacheDir: values.cache });
  if (values.active) {
    const active = Number(values.active);
    const origin = new URL(values.url).origin;
    configureRegistry({ remotes: Object.fromEntries(Array.from({ length: active }, (_, index) => [`p${index}`, { url: `${origin}/p${index}/mf` }])) });
    const start = performance.now();
    const components = await runWithMFRequest(() => Promise.all(Array.from({ length: active }, (_, index) => getRemote(`p${index}`).component("Card"))));
    const html = renderToString(createElement("main", null, ...components.map((Component, index) => createElement(Component, { key: index }))));
    for (let index = 0; index < active; index++) assert.ok(html.includes(`provider-${index}-r1`));
    console.log(JSON.stringify({ result: "cold-SSR", active, ms: Math.round(performance.now() - start), htmlBytes: Buffer.byteLength(html) }));
  } else {
    configureRegistry({ remotes: { child: { url: values.url } } });
    const result = await runWithMFRequest(async () => (await getRemote("child").component("Card"))({}));
    console.log(JSON.stringify({ result }));
  }
} else {
  const count = Number(values.count);
  if (!Number.isSafeInteger(count) || count < 100) throw new Error("count must be at least 100");
  const updateCount = Number(values.updates);
  if (!Number.isSafeInteger(updateCount) || updateCount < 1) throw new Error("updates must be a positive integer");
  const providers = await startProviders(count);
  await mkdir("node_modules/.cache", { recursive: true });
  const workspace = await mkdtemp(path.resolve("node_modules/.cache/mf-scale-"));
  const cache = path.join(workspace, "cache");
  configureServerCache({ cacheDir: cache, maxBytes: 32 * 1024 * 1024 });
  configureRegistry({ remotes: Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, { url: providers.url(index) }])) });
  const samples = [];
  let flipOnSelection = false;
  configureObservability((event) => {
    if (flipOnSelection && event.remote === providers.url(0) && event.stage === "release-manifest" && event.type === "success") {
      flipOnSelection = false;
      providers.setVersion(0, "r2");
    }
  });

  async function render(active, requestId) {
    const start = performance.now();
    const result = await runWithMFRequest(() => new Promise((resolve, reject) => {
      const errors = [];
      const output = new PassThrough();
      const chunks = [];
      const children = Array.from({ length: active }, (_, index) => createElement(Suspense,
        { key: index, fallback: `fallback-${index}` }, createElement(createRemoteComponent(`p${index}`, "Card"))));
      const deadline = setTimeout(() => { stream.abort(); reject(new Error("SSR workload exceeded 30 seconds")); }, 30_000);
      output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      output.on("error", (error) => { clearTimeout(deadline); reject(error); });
      output.on("end", () => { clearTimeout(deadline); resolve({ html: Buffer.concat(chunks).toString("utf8"), errors: errors.length }); });
      const stream = renderToPipeableStream(createElement("main", null, ...children), {
        onAllReady() { stream.pipe(output); }, onError(error) { errors.push(String(error)); },
        onShellError(error) { clearTimeout(deadline); reject(error); },
      });
    }), { requestId, selectionKey: "scale-cohort" });
    return { ...result, ms: Math.round(performance.now() - start) };
  }

  try {
    for (const active of [...new Set([1, 10, 100, count])]) {
      const startRequests = providers.stats().requests.length;
      const result = await render(active, `active-${active}`);
      assert.equal(result.errors, 0);
      for (let index = 0; index < active; index++) assert.ok(result.html.includes(`provider-${index}-r1`));
      const requests = providers.stats().requests.slice(startRequests);
      assert.ok(requests.every((request) => request.provider < active));
      samples.push({ scenario: "registered-vs-active", registered: count, active, ms: result.ms, requests: requests.length });
    }
    const start = performance.now();
    const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => render(10, `parallel-${index}`)));
    assert.ok(concurrent.every((entry) => entry.errors === 0));
    assert.ok(concurrent.every((entry) => entry.ms < 5_000));
    samples.push({ scenario: "concurrent-SSR", requests: 8, active: 10, ms: Math.round(performance.now() - start), durationsMs: concurrent.map((entry) => entry.ms) });

    const multiCache = path.join(workspace, "multi-cache");
    const last = count - 1;
    const startAssets = providers.stats().requests.filter((request) => request.provider === last && /\/server\/.*\.js$/.test(request.file)).length;
    async function worker(active) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", "--url", active ? providers.url(0) : providers.url(last), "--cache", active ? path.join(workspace, "cold-cache") : multiCache,
          ...(active ? ["--active", String(active)] : [])],
          { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        let stdout = "", stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code !== 0) { reject(new Error(stderr || `worker exited ${code}`)); return; }
          try { resolve(JSON.parse(stdout.trim())); } catch (error) { reject(error); }
        });
      });
    }
    const workerResults = await Promise.allSettled([worker(), worker(), worker()]);
    const failedWorkers = workerResults.filter((entry) => entry.status === "rejected");
    if (failedWorkers.length) throw new AggregateError(failedWorkers.map((entry) => entry.reason), "Shared-cache workload failed");
    const workers = workerResults.map((entry) => entry.value);
    assert.ok(workers.every((worker) => worker.result === `provider-${last}-r1`));
    const downloaded = providers.stats().requests.filter((request) => request.provider === last && /\/server\/.*\.js$/.test(request.file)).length - startAssets;
    assert.equal(downloaded, 3);
    const reclaimed = await new Loader({ cacheDir: multiCache }).clearCache();
    assert.equal(reclaimed.bytes, 0);
    samples.push({ scenario: "multi-process-shared-cache", workers: 3, assetDownloads: downloaded, reclaimedEntries: reclaimed.removedEntries });
    const cold = await worker(count);
    assert.ok(cold.ms < 30_000);
    const coldDisk = await new Loader({ cacheDir: path.join(workspace, "cold-cache") }).clearCache();
    samples.push({ scenario: "fresh-process-cold-SSR", ...cold, reclaimedEntries: coldDisk.removedEntries });

    flipOnSelection = true;
    assert.ok((await render(1, "deploy-in-flight")).html.includes("provider-0-r1"));
    assert.ok((await render(1, "new-release")).html.includes("provider-0-r2"));
    providers.setVersion(0, "r1");
    assert.ok((await render(1, "rollback")).html.includes("provider-0-r1"));
    samples.push({ scenario: "deploy-and-rollback", inFlight: "r1", nextRequest: "r2", rollback: "r1" });

    registerShared("scale-shared", {}, "1.0.0");
    for (const fault of ["slow", "404", "503", "malformed", "corrupt", "incompatible"]) {
      providers.setVersion(0, `fault-${fault}`); providers.setFault(0, fault);
      configureLoading({ manifestTimeoutMs: 100 });
      const start = performance.now();
      await assert.rejects(runWithMFRequest(() => getRemote("p0").component("Card")), (error) => {
        if (fault === "slow") return error.code === "TIMEOUT";
        if (fault === "404" || fault === "503") return error.status === Number(fault);
        if (fault === "corrupt") return error.cause?.message.includes("integrity mismatch");
        if (fault === "incompatible") return error.message.includes("scale-shared");
        return error.code === "LOAD_FAILED";
      });
      const ms = Math.round(performance.now() - start);
      assert.ok(ms < 5_000);
      samples.push({ scenario: "provider-fault", fault, ms });
      providers.setFault(0); providers.setVersion(0, "r1");
    }
    configureLoading({ manifestTimeoutMs: 500 });
    providers.setFault(1, "404");
    const partial = await render(3, "partial-failure");
    assert.ok(partial.html.includes("provider-0-r1") && partial.html.includes("provider-2-r1") && partial.html.includes("fallback-1"));
    providers.setFault(1);
    samples.push({ scenario: "local-fallback", healthyRemotes: 2, failedBoundaries: partial.errors, ms: partial.ms });

    const manifest = await (await fetch(`${providers.url(0)}/r1/server/manifest.json`)).json();
    const loader = new Loader({ cacheDir: cache });
    const module = await loader.load(`${providers.url(0)}/r1/server/card.js`, { provider: providers.url(0), releaseId: "r1",
      baseUrl: `${providers.url(0)}/r1/server/`, files: manifest.Card.files, integrity: manifest.Card.integrity });
    const protectedCache = await loader.clearCache();
    assert.equal((await module.later()).value, "later-0-r1");
    assert.ok(protectedCache.protectedBytes > 0);
    samples.push({ scenario: "active-lease-and-dynamic-import", protectedBytes: protectedCache.protectedBytes });

    global.gc?.();
    const memoryBefore = process.memoryUsage();
    const updates = [];
    for (let index = 3; index < 3 + updateCount; index++) {
      providers.setVersion(0, `r${index}`);
      const result = await render(1, `update-${index}`);
      assert.ok(result.html.includes(`provider-0-r${index}`));
      updates.push(result.ms);
    }
    global.gc?.();
    const memoryAfter = process.memoryUsage();
    const disk = await loader.pruneCache();
    assert.equal(disk.overBudgetBytes, 0);
    assert.ok(memoryAfter.heapUsed - memoryBefore.heapUsed < 64 * 1024 * 1024);
    samples.push({ scenario: "sequential-updates", releases: updateCount, durationsMs: updates, rssBefore: memoryBefore.rss,
      rssAfter: memoryAfter.rss, heapBefore: memoryBefore.heapUsed, heapAfter: memoryAfter.heapUsed, disk });
    const report = { node: process.version, platform: process.platform, gcExposed: !!global.gc, registered: count,
      note: "Synthetic tiny ESM providers; local disk/network; includes real React SSR, not full production bundles or browser heap", samples,
      limits: { coldSSRMs: 30_000, warmSSRMs: 5_000, faultMs: 5_000, heapGrowthBytes: 64 * 1024 * 1024, cacheBytes: 32 * 1024 * 1024 },
      metrics: getLoadingMetrics(), peakProviderRequests: providers.stats().peakRequests };
    await mkdir(path.dirname(values.output), { recursive: true });
    await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally { configureObservability(); await providers.close(); }
}
