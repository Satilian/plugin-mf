import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { setTimeout } from "node:timers/promises";
import { parseTypeManifest, type RemoteTypeManifest } from "../protocol/type-manifest.ts";
import { parseTypesLock, type TypesLockEntry } from "../protocol/types-lock.ts";

export type CachedTypes = { entry: TypesLockEntry; directory: string; manifest: RemoteTypeManifest };
type CacheMetadata = { entry: TypesLockEntry; manifest: RemoteTypeManifest; hashes: Record<string, string> };

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function keyFor(entry: Omit<TypesLockEntry, "cacheKey">, manifest: RemoteTypeManifest, hashes: Record<string, string>): string {
  return digest(JSON.stringify([entry.provider, entry.releaseId ?? null, entry.manifestUrl, manifest,
    Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))]));
}

export function cacheDirectory(root: string, entry: TypesLockEntry): string {
  return path.join(root, entry.releaseId ?? "legacy", entry.cacheKey);
}

export async function readCachedTypes(root: string, entry: TypesLockEntry): Promise<CachedTypes> {
  const directory = cacheDirectory(root, entry);
  const metadata: unknown = JSON.parse(await readFile(path.join(directory, ".ready.json"), "utf8"));
  if (!metadata || typeof metadata !== "object" || !("manifest" in metadata) || !("entry" in metadata) ||
    !("hashes" in metadata) || !metadata.hashes || typeof metadata.hashes !== "object") {
    throw new Error("[plugin-mf] Invalid types cache metadata");
  }
  const stored = parseTypesLock({ version: 1, remotes: { cached: metadata.entry } }).remotes.cached;
  if (stored.provider !== entry.provider || stored.releaseId !== entry.releaseId || stored.manifestUrl !== entry.manifestUrl ||
    stored.cacheKey !== entry.cacheKey) throw new Error("[plugin-mf] Types cache identity mismatch");
  const manifest = parseTypeManifest(metadata.manifest);
  const hashes: Record<string, string> = {};
  for (const file of manifest.files) {
    const filePath = path.join(directory, file);
    if (!(await lstat(filePath)).isFile()) throw new Error("[plugin-mf] Invalid cached declaration file");
    const hash = digest(await readFile(filePath, "utf8"));
    if (!(file in metadata.hashes) || Reflect.get(metadata.hashes, file) !== hash) {
      throw new Error(`[plugin-mf] Corrupted cached declaration: ${file}`);
    }
    hashes[file] = hash;
  }
  if (keyFor(entry, manifest, hashes) !== entry.cacheKey) throw new Error("[plugin-mf] Types cache checksum mismatch");
  return { entry, directory, manifest };
}

export async function publishTypes(root: string, staging: string, selection: Omit<TypesLockEntry, "cacheKey">, manifest: RemoteTypeManifest): Promise<CachedTypes> {
  const files = manifest.files.map((file) => path.join(staging, file));
  const available = new Set(files);
  for (const file of files) {
    const source = ts.preProcessFile(await readFile(file, "utf8"), true);
    const references = [...source.importedFiles.filter((item) => item.fileName.startsWith(".")), ...source.referencedFiles];
    for (const reference of references) {
      const target = path.resolve(path.dirname(file), reference.fileName);
      const withoutExtension = target.replace(/\.[cm]?jsx?$/, "");
      if (![target, `${withoutExtension}.d.ts`, path.join(target, "index.d.ts")].some((candidate) => available.has(candidate))) {
        throw new Error(`[plugin-mf] Missing relative declaration: ${reference.fileName} in ${path.relative(staging, file)}`);
      }
    }
  }
  const program = ts.createProgram(files, { noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext });
  const diagnostics = program.getSyntacticDiagnostics();
  if (diagnostics.length) throw new Error(ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (file) => file, getCurrentDirectory: () => staging, getNewLine: () => "\n",
  }));
  const checker = program.getTypeChecker();
  for (const [name, expose] of Object.entries(manifest.exposes)) {
    const source = program.getSourceFile(path.join(staging, expose.path));
    const symbol = source && checker.getSymbolAtLocation(source);
    if (!symbol || !checker.getExportsOfModule(symbol).some((item) => item.name === expose.export)) {
      throw new Error(`[plugin-mf] Declaration export missing: ${name}/${expose.export}`);
    }
  }
  const hashes: Record<string, string> = {};
  for (const file of manifest.files) hashes[file] = digest(await readFile(path.join(staging, file), "utf8"));
  const entry = { ...selection, cacheKey: keyFor(selection, manifest, hashes) };
  const metadata: CacheMetadata = { entry, manifest, hashes };
  await writeFile(path.join(staging, ".ready.json"), JSON.stringify(metadata), "utf8");
  const directory = cacheDirectory(root, entry);
  await mkdir(path.dirname(directory), { recursive: true });
  try {
    await rename(staging, directory);
  } catch (error) {
    if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTEMPTY") && !hasCode(error, "EPERM")) throw error;
    try {
      return await readCachedTypes(root, entry);
    } catch (cacheError) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw cacheError;
      const retired = path.join(root, `.corrupt-${randomUUID()}`);
      await rename(directory, retired);
      try {
        await rename(staging, directory);
      } catch (publishError) {
        await rename(retired, directory);
        throw publishError;
      }
      await rm(retired, { recursive: true, force: true });
    }
  }
  return { entry, directory, manifest };
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function atomicWrite(file: string, source: string): Promise<void> {
  try {
    if (await readFile(file, "utf8") === source) return;
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, source, "utf8");
    const deadline = performance.now() + 1_000;
    while (true) {
      try {
        await rename(temporary, file);
        break;
      } catch (error) {
        if (process.platform !== "win32" || performance.now() >= deadline ||
          !(hasCode(error, "EPERM") || hasCode(error, "EACCES") || hasCode(error, "EBUSY"))) throw error;
        await setTimeout(25);
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
