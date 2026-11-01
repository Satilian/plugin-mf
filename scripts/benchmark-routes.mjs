import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const { values } = parseArgs({ options: {
  "base-url": { type: "string", default: "http://localhost:3000" },
  output: { type: "string", default: "node_modules/.cache/mf-benchmark.json" },
  runs: { type: "string", default: "3" },
  "playwright-module": { type: "string", default: "playwright" },
} });
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("runs must be a positive integer");
const { chromium } = await import(values["playwright-module"]);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const samples = [];
try {
  for (const route of [{ path: "/", ready: "Welcome to the home page." }, { path: "/about", ready: "This is the about page." }]) {
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        const resources = new Map();
        cdp.on("Network.responseReceived", ({ requestId, type, response }) => {
          const pathname = new URL(response.url).pathname;
          const category = /\.m?js$/.test(pathname) ? "Script" : /\.css$/.test(pathname) ? "Stylesheet" : type;
          if (category === "Script" || category === "Stylesheet") resources.set(requestId, { type: category, bytes: 0 });
        });
        cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
          const resource = resources.get(requestId);
          if (resource) resource.bytes = encodedDataLength;
        });
        for (const cache of ["cold-browser", "repeat-browser"]) {
          resources.clear();
          const start = performance.now();
          await page.goto(new URL(route.path, values["base-url"]).href);
          await page.getByText(route.ready).waitFor();
          await page.getByRole("button", { name: /Section button|Count is 0/ }).click();
          await page.getByRole("button", { name: "Count is 1", exact: true }).waitFor();
          if (errors.length) throw new Error(errors.join("\n"));
          const entries = [...resources.values()];
          samples.push({ route: route.path, run, cache, interactiveMs: Math.round(performance.now() - start),
            jsBytes: entries.filter((item) => item.type === "Script").reduce((sum, item) => sum + item.bytes, 0),
            cssBytes: entries.filter((item) => item.type === "Stylesheet").reduce((sum, item) => sum + item.bytes, 0),
            requests: entries.length });
        }
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
await mkdir(path.dirname(values.output), { recursive: true });
await writeFile(values.output, JSON.stringify({ node: process.version, platform: process.platform, runs,
  note: "Chrome CDP encoded script/style bytes; fresh/reused browser cache; server cache is not reset between samples", samples }, null, 2) + "\n");
console.log(JSON.stringify(samples));
