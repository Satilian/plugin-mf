import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseReleaseManifest } from "./protocol/release-manifest.ts";
import { loadReleaseManifest } from "./transport/release-loader.ts";
import { Remote } from "./runtime/react/remote.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function response(body: unknown, url: string, status = 200): Response {
  return { ok: status < 400, status, statusText: status === 404 ? "Not Found" : "OK", url,
    json: async () => body } as Response;
}

void test("release manifest validates version, paths and identifier", () => {
  const valid = { version: 1, releaseId: "release-123", server: "server/manifest.json",
    client: "client/manifest.json", types: "types/manifest.json" };
  assert.deepEqual(parseReleaseManifest(valid), valid);
  for (const invalid of [
    { ...valid, version: 2 }, { ...valid, releaseId: "../escape" },
    { ...valid, client: "../escape" }, { ...valid, types: "https://other.invalid/types" },
    { ...valid, server: undefined, client: undefined },
  ]) assert.throws(() => parseReleaseManifest(invalid));
});

void test("only 404 selects legacy layout", async () => {
  globalThis.fetch = async (url) => response(null, String(url), 404);
  assert.equal(await loadReleaseManifest("https://example.test/mf/manifest.json"), undefined);
  globalThis.fetch = async (url) => response(null, String(url), 500);
  await assert.rejects(loadReleaseManifest("https://example.test/mf/manifest.json"), /500/);
});

void test("server resolves both manifests from the same release", async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/mf/manifest.json")) return response({ version: 1, releaseId: "r1",
      server: "releases/r1/server/manifest.json", client: "releases/r1/client/manifest.json",
      types: "releases/r1/types/manifest.json" }, url);
    if (url.endsWith("/server/manifest.json")) return response({ Card: { js: "card.js", css: [] } }, url);
    if (url.endsWith("/client/manifest.json")) return response({ Card: { js: "card.js", css: ["card.css"] } }, url);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const remote = new Remote("https://example.test/mf", { load: async () => ({ Card: () => null }) }, "server");
  assert.equal(typeof await remote.component("Card"), "function");
  assert.equal(remote.releaseId, "r1");
  assert.deepEqual(urls, ["https://example.test/mf/manifest.json",
    "https://example.test/mf/releases/r1/server/manifest.json",
    "https://example.test/mf/releases/r1/client/manifest.json"]);
});

void test("legacy remote uses scope manifests without a release", async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    return url.endsWith("/mf/manifest.json") ? response(null, url, 404) : response({ Card: "card.js" }, url);
  };
  const remote = new Remote("https://example.test/mf", { load: async () => ({ Card: () => null }) }, "client");
  assert.equal(typeof await remote.component("Card"), "function");
  assert.equal(remote.releaseId, undefined);
  assert.deepEqual(urls, ["https://example.test/mf/manifest.json", "https://example.test/mf/client/manifest.json"]);
});
