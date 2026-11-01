import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export function inside(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const difference = path.relative(root, target);
  if (!difference || difference === ".." || difference.startsWith(`..${path.sep}`) || path.isAbsolute(difference)) {
    throw new Error("[plugin-mf] Cache path escapes its directory");
  }
  return target;
}

export async function regularFile(root: string, file: string): Promise<number> {
  const target = inside(root, file);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`[plugin-mf] Invalid cached file: ${file}`);
  const canonical = await realpath(target);
  inside(root, path.relative(root, canonical));
  return info.size;
}
