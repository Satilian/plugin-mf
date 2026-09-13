import { Remote } from "./remote";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CACHE_DIR = path.join(process.cwd(), "node_modules/.cache/mf");

export class Loader {
  #cache = new Map();
  #cacheDir: string;
  #import = new Function("fileUrl", "return import(fileUrl)");

  constructor(cacheDir = CACHE_DIR) {
    this.#cacheDir = cacheDir;
  }

  load(url: string) {
    const cached = this.#cache.get(url);
    if (cached) return cached;

    const promise = this.#load(url);
    this.#cache.set(url, promise);

    return promise.catch((error) => {
      this.#cache.delete(url);
      throw error;
    });
  }

  async #load(url: string) {
    const fileName = url.split("/").pop() || "remote.js";
    const filePath = path.join(this.#cacheDir, fileName);

    // Пишем файл только если его ещё нет
    try {
      await access(filePath);
    } catch {
      console.log("FETCH REMOTE:", url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Failed to load remote module: ${response.status} ${response.statusText}`,
        );
      }

      const source = await response.text();

      await mkdir(this.#cacheDir, { recursive: true });
      await writeFile(filePath, source, "utf8");
    }

    return this.#import(pathToFileURL(filePath).href);
  }

  /** Можно вызвать вручную, если нужно почистить кэш */
  async clearCache() {
    this.#cache.clear();
    // При желании можно добавить удаление файлов из #cacheDir
    try {
      await rm(this.#cacheDir, { recursive: true, force: true });
    } catch (error) {
      console.error("Failed to clear cache directory:", error);
    }
  }
}

const remotes = new Map<string, Remote>();

declare const __MF_REMOTES__: Record<string, string> | undefined;

function ensureInit() {
  if (remotes.size > 0) return;

  const loader = new Loader();
  for (const [name, url] of Object.entries(__MF_REMOTES__ || {})) {
    remotes.set(name, new Remote(url, loader, "server"));
  }
}

export function getRemote(name: string): Remote {
  ensureInit();

  const remote = remotes.get(name);
  if (!remote) {
    throw new Error(
      `[plugin-mf] Remote "${name}" not found. Available: ${[...remotes.keys()].join(", ") || "none"}`,
    );
  }

  return remote;
}
