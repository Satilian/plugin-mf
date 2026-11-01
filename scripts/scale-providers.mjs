import { createServer } from "node:http";
import { createHash } from "node:crypto";

export async function startProviders(count) {
  const versions = new Map();
  const faults = new Map();
  const requests = [];
  let active = 0;
  let peak = 0;
  const server = createServer(async (req, res) => {
    const match = req.url?.match(/^\/p(\d+)\/mf\/(.*)$/);
    if (!match || Number(match[1]) >= count) { res.writeHead(404); res.end(); return; }
    const provider = Number(match[1]);
    const file = match[2];
    const version = versions.get(provider) ?? "r1";
    const fault = faults.get(provider);
    requests.push({ provider, file });
    active++; peak = Math.max(peak, active);
    let finished = false;
    const finish = () => { if (!finished) { finished = true; active--; } };
    res.once("finish", finish); res.once("close", finish);
    if (fault === "slow") await new Promise((resolve) => setTimeout(resolve, 750));
    if (fault === "404" || fault === "503") { res.writeHead(Number(fault)); res.end(); return; }
    if (file === "manifest.json") {
      res.setHeader("content-type", "application/json");
      if (fault === "malformed") { res.end("{invalid"); return; }
      const requirements = fault === "incompatible" ? { "scale-shared": { version: "2.0.0", requiredVersion: "^2.0.0", singleton: true } } : {};
      res.end(JSON.stringify({ version: 1, releaseId: version, server: `${version}/server/manifest.json`,
        client: `${version}/client/manifest.json`, types: `${version}/types/manifest.json`, shared: { client: requirements, server: requirements } }));
      return;
    }
    const asset = file.match(/^([a-zA-Z0-9._-]+)\/(server|client)\/(.+)$/);
    if (!asset) { res.writeHead(404); res.end(); return; }
    const release = asset[1];
    const files = {
      "card.js": 'import {label} from "./chunk.js"; export const Card = () => label; export const later = () => import("./later.js");',
      "chunk.js": `export const label = ${JSON.stringify(`provider-${provider}-${release}`)};`,
      "later.js": `export const value = ${JSON.stringify(`later-${provider}-${release}`)};`,
    };
    if (asset[3] === "manifest.json") {
      res.setHeader("content-type", "application/json");
      const integrity = Object.fromEntries(Object.entries(files).map(([name, source]) => [name, createHash("sha256").update(source).digest("hex")]));
      res.end(JSON.stringify({ Card: { js: "card.js", css: [], files: Object.keys(files), integrity,
        assets: Object.entries(files).map(([name, source]) => ({ path: name, bytes: Buffer.byteLength(source), type: "js" })) } }));
      return;
    }
    if (!Object.hasOwn(files, asset[3])) { res.writeHead(404); res.end(); return; }
    res.setHeader("content-type", "text/javascript");
    res.end(fault === "corrupt" && asset[3] === "card.js" ? "throw Error('corrupted remote must never run')" : files[asset[3]]);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: (index) => `${origin}/p${index}/mf`,
    setVersion: (index, version) => versions.set(index, version),
    setFault: (index, fault) => fault ? faults.set(index, fault) : faults.delete(index),
    stats: () => ({ requests: [...requests], peakRequests: peak }),
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}
