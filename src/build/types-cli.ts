#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { syncTypes } from "./sync-types.ts";
import { validateTypesOptions, type TypesSyncOptions } from "./types-options.ts";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    config: { type: "string", default: "mf-types.config.json" },
    mode: { type: "string" }, remote: { type: "string", multiple: true },
    offline: { type: "boolean" }, "frozen-lockfile": { type: "boolean" },
    "update-lock": { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("plugin-mf-types [--config mf-types.config.json] [--mode strict|best-effort|off] [--remote name] [--offline] [--frozen-lockfile] [--update-lock]");
    return;
  }
  const configPath = path.resolve(values.config);
  const config: unknown = JSON.parse(await readFile(configPath, "utf8"));
  if (!config || typeof config !== "object" || !("remotes" in config) || !config.remotes || typeof config.remotes !== "object" || Array.isArray(config.remotes)) {
    throw new Error("[plugin-mf] Types config must contain a remotes object");
  }
  const remotes: Record<string, string> = {};
  for (const [name, url] of Object.entries(config.remotes)) {
    if (typeof url !== "string" || !["http:", "https:"].includes(new URL(url).protocol)) throw new Error(`[plugin-mf] Invalid provider URL: ${name}`);
    Object.defineProperty(remotes, name, { value: url, enumerable: true });
  }
  const types: TypesSyncOptions = {};
  if ("types" in config) {
    if (!config.types || typeof config.types !== "object" || Array.isArray(config.types)) throw new Error("[plugin-mf] Invalid types options");
    const options = config.types;
    if ("mode" in options) {
      if (options.mode !== "strict" && options.mode !== "best-effort" && options.mode !== "off") throw new Error("[plugin-mf] Invalid types mode");
      types.mode = options.mode;
    }
    if ("remotes" in options) {
      if (!Array.isArray(options.remotes) || !options.remotes.every((name: unknown) => typeof name === "string")) throw new Error("[plugin-mf] Invalid types remotes");
      types.remotes = options.remotes;
    }
    if ("concurrency" in options) {
      if (typeof options.concurrency !== "number") throw new Error("[plugin-mf] Invalid types concurrency");
      types.concurrency = options.concurrency;
    }
    if ("lockfile" in options) {
      if (typeof options.lockfile !== "string") throw new Error("[plugin-mf] Invalid types lockfile");
      types.lockfile = options.lockfile;
    }
    for (const name of ["offline", "frozenLockfile", "updateLock"] as const) {
      if (name in options) {
        const value = Reflect.get(options, name);
        if (typeof value !== "boolean") throw new Error(`[plugin-mf] Invalid types option: ${name}`);
        types[name] = value;
      }
    }
  }
  if (values.mode !== undefined) {
    if (values.mode !== "strict" && values.mode !== "best-effort" && values.mode !== "off") throw new Error("[plugin-mf] Invalid types mode");
    types.mode = values.mode;
  }
  if (values.remote) types.remotes = values.remote;
  if (values.offline !== undefined) types.offline = values.offline;
  if (values["frozen-lockfile"] !== undefined) types.frozenLockfile = values["frozen-lockfile"];
  if (values["update-lock"] !== undefined) types.updateLock = values["update-lock"];
  validateTypesOptions(types);
  await syncTypes({ remotes, rootPath: path.dirname(configPath), types });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
