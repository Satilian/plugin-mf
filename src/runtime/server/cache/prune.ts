import { lstat, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { hasCode, isProcessAlive } from "./lock.ts";
import { inside } from "./paths.ts";
import type { CachePruneResult } from "./config.ts";
import { emitLoadingEvent } from "../../../transport/observability.ts";

export async function isPinned(directory: string): Promise<boolean> {
  const pins = path.join(directory, ".pins");
  let names: string[];
  try {
    if ((await lstat(pins)).isSymbolicLink()) throw new Error("[plugin-mf] Cache lease directory must not be a symbolic link");
    names = await readdir(pins);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
  let active = false;
  for (const name of names) {
    if (!/^\d+$/.test(name)) throw new Error("[plugin-mf] Invalid cache lease");
    const pid = Number(name);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("[plugin-mf] Invalid cache lease PID");
    if (isProcessAlive(pid)) active = true;
    else await rm(path.join(pins, name), { force: true });
  }
  return active;
}

export async function entrySize(directory: string): Promise<number> {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("[plugin-mf] Cache entry must not be a symbolic link");
  let bytes = 0;
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name === ".pins") continue;
    if (item.isSymbolicLink()) throw new Error("[plugin-mf] Cache entry contains a symbolic link");
    const file = path.join(directory, item.name);
    bytes += item.isDirectory() ? await entrySize(file) : (await stat(file)).size;
  }
  return bytes;
}

export async function prune(root: string, maxBytes: number, protectedDirectory?: string, staging?: string): Promise<CachePruneResult> {
  for (const name of await readdir(root)) {
    if (!/^\.download-[a-zA-Z0-9]+$/.test(name)) continue;
    const directory = inside(root, name);
    if (directory !== staging) await rm(directory, { recursive: true, force: true });
  }
  const entries = path.join(root, "entries");
  const candidates: { directory: string; bytes: number; pinned: boolean }[] = [];
  for (const name of (await readdir(entries)).sort()) {
    if (!/^[a-f0-9]{64}$/.test(name)) throw new Error("[plugin-mf] Unexpected directory in server cache");
    const directory = inside(entries, name);
    candidates.push({ directory, bytes: await entrySize(directory), pinned: directory === protectedDirectory || await isPinned(directory) });
  }
  let bytes = candidates.reduce((sum, entry) => sum + entry.bytes, 0);
  const protectedBytes = candidates.filter((entry) => entry.pinned).reduce((sum, entry) => sum + entry.bytes, 0);
  let removedEntries = 0;
  for (const entry of candidates) {
    if (bytes <= maxBytes) break;
    if (entry.pinned) continue;
    await rm(entry.directory, { recursive: true });
    emitLoadingEvent({ remote: "cache://server", stage: "module", type: "prune", operation: "disk", bytes: entry.bytes });
    bytes -= entry.bytes;
    removedEntries++;
  }
  return { bytes, protectedBytes, removedEntries, overBudgetBytes: Math.max(0, bytes - maxBytes) };
}
