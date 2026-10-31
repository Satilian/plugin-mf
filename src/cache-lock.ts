import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, "ESRCH")) return false;
    if (hasCode(error, "EPERM")) return true;
    throw error;
  }
}

async function ownerIsAlive(directory: string): Promise<boolean> {
  try {
    const owner: unknown = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8"));
    if (!owner || typeof owner !== "object" || !("pid" in owner) ||
      typeof owner.pid !== "number" || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
      throw new Error(`[plugin-mf] Invalid cache lock owner in ${directory}`);
    }
    return isProcessAlive(owner.pid);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return true;
    throw error;
  }
}

async function tryAcquire(staging: string, target: string): Promise<boolean> {
  try {
    await rename(staging, target);
    return true;
  } catch (error) {
    if (hasCode(error, "EEXIST") || hasCode(error, "ENOTEMPTY") || hasCode(error, "EPERM") || hasCode(error, "EACCES")) {
      // On Windows, renaming over an existing nonempty directory reports EPERM/EACCES.
      try {
        await readFile(path.join(target, "owner.json"));
        return false;
      } catch (readError) {
        if (!hasCode(readError, "ENOENT")) throw readError;
        return false;
      }
    }
    throw error;
  }
}

async function renameLock(source: string, target: string, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (process.platform !== "win32" || performance.now() >= deadline ||
        !(hasCode(error, "EPERM") || hasCode(error, "EACCES") || hasCode(error, "EBUSY"))) throw error;
      await setTimeout(25);
    }
  }
}

export async function withCacheLock<T>(root: string, timeoutMs: number, callback: () => Promise<T>): Promise<T> {
  const staging = await mkdtemp(path.join(root, ".lock-owner-"));
  const target = path.join(root, ".lock");
  const recovery = path.join(root, ".recovery");
  const deadline = performance.now() + timeoutMs;
  let acquired = false;
  try {
    await writeFile(path.join(staging, "owner.json"), JSON.stringify({ pid: process.pid }), "utf8");
    while (!acquired) {
      let recovering = false;
      try {
        await readFile(path.join(recovery, "owner.json"));
        recovering = true;
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
      if (recovering && !await ownerIsAlive(recovery)) {
        throw new Error(`[plugin-mf] Interrupted cache lock recovery in ${root}; stop cache users before removing .recovery`);
      }
      if (!recovering) {
        acquired = await tryAcquire(staging, target);
        if (!acquired && !await ownerIsAlive(target)) {
          const recoveryOwner = await mkdtemp(path.join(root, ".recovery-owner-"));
          await writeFile(path.join(recoveryOwner, "owner.json"), JSON.stringify({ pid: process.pid }), "utf8");
          if (await tryAcquire(recoveryOwner, recovery)) {
            try {
              if (!await ownerIsAlive(target)) {
                const retired = await mkdtemp(path.join(root, ".retired-lock-"));
                await rm(retired, { recursive: true });
                await renameLock(target, retired, timeoutMs);
                await rm(retired, { recursive: true });
              }
            } finally {
              await renameLock(recovery, recoveryOwner, timeoutMs);
              await rm(recoveryOwner, { recursive: true });
            }
          } else {
            await rm(recoveryOwner, { recursive: true });
          }
        }
      }
      if (!acquired) {
        if (performance.now() >= deadline) throw new Error(`[plugin-mf] Timed out waiting for cache lock in ${root}`);
        await setTimeout(25);
      }
    }
    return await callback();
  } finally {
    if (acquired) {
      // Rename before removing so cleanup cannot remove the next owner's lock.
      await renameLock(target, staging, timeoutMs);
    }
    await rm(staging, { recursive: true, force: true });
  }
}
