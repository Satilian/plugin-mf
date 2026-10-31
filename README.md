# Rslib project

## Setup

Install the dependencies for the entire workspace:

```bash
pnpm install
```

## Get started

Build the library, builds all examples, then starts their servers in parallel:

- Open [http://localhost:3000](http://localhost:3000) for the shell;
- host-1, host-2 and sub-host-1 run on ports 3001, 3002 and 4001.
- Press Ctrl+C to stop the servers.
- Rerun the command after changing library code.

```bash
pnpm start
```

Build the library:

```bash
pnpm run build
```

Build the library in watch mode:

```bash
pnpm run dev
```

Run tests:

```bash
pnpm run test
```

Run tests in watch mode:

```bash
pnpm run test:watch
```

## Provider releases and rollback

Provider builds preserve `dist/mf/` during Rsbuild output cleanup, including the
current pointer and previous releases. Other output files follow the configured
cleanup rules. Each successful release includes `mf/<releaseId>/pointer.json`,
a snapshot of the root `mf/manifest.json` for rollback; its paths are relative to
`mf/`, not to the snapshot directory.

Publish the complete `mf/<releaseId>/` directory before replacing
`mf/manifest.json`. On a filesystem, replace the pointer with a temporary file
and rename in the same directory; on object storage, use the storage's atomic
object replacement. Keep older release directories when deploying a new build.
Configure `Cache-Control: no-store` for the root pointer and long-lived immutable
caching for files inside release directories. Serialize deployments per provider
so an older build cannot overwrite a newer deployment's pointer.

To roll back, verify that the target release's server, client and types artifacts
are still available, then atomically replace `mf/manifest.json` with the contents
of that release's `pointer.json`. New SSR requests select the restored release;
in-flight requests and open pages keep their previously selected versions.

Releases are retained indefinitely by default; the plugin does not prune them.
A finite retention period requires a defined maximum lifetime for an open page,
including delayed imports, plus HTML/CDN cache lifetime and the rollback window.
Measure retention from the last time a release stopped being current, including
after a rollback. Never remove the current release or releases inside that window.
Incomplete unpublished release directories may be removed after their build has
stopped. Legacy providers without versioned paths cannot offer these guarantees.

## Server module cache

Configure the cache before creating remotes or starting SSR:

```ts
import { configureServerCache } from "plugin-mf/server";

configureServerCache({
  cacheDir: "./.cache/mf",
  maxBytes: 512 * 1024 * 1024,
  lockTimeoutMs: 30_000,
});
```

Defaults: `node_modules/.cache/mf` relative to the worker's working directory,
512 MiB of completed entries, and 30 seconds waiting for the filesystem lock.
`MF_CACHE_DIR` and `MF_CACHE_MAX_BYTES` provide environment defaults. An explicit
configuration takes precedence. The directory is checked for write access on
first use. Nested remote bundles share the configured loader.

Server manifests include a `files` list for each expose, containing emitted
entries, chunks and assets. The loader downloads that set before importing the
entry, preserves relative paths and binary contents, and publishes the complete
cache directory atomically. Old manifests without `files` retain entry-only
loading. Cache identity includes provider, release ID and full asset URLs;
different providers, releases and query strings cannot share a module by filename.

`new Loader(options)` creates a standalone loader; the previous
`new Loader(cacheDir)` form is also supported. `pruneCache()` removes unused
entries until `maxBytes` is satisfied. `clearCache()` removes all unused entries.
Both return `{ bytes, protectedBytes, removedEntries, overBudgetBytes }` and leave
the in-memory module cache intact. The configured limit covers completed entries,
not transient downloads or files left by the old flat-cache implementation.

Imported releases have process-lifetime leases: deleting them could break a later
dynamic import or asset read. Cleanup skips leases belonging to live processes
and removes leases of exited processes. If live releases prevent a new release
from fitting the byte limit, loading fails explicitly; raise the limit or roll
workers. Clearing files does not unload Node's ESM module cache. Select a new
release URL for new code; restart workers to unload previously imported versions.

Cache operations use an interprocess filesystem lock, so download publication,
leases and cleanup cannot race. A dead owner's lock and abandoned download
directories are recovered on the next operation. If a process dies during lock
recovery itself, an explicit recovery error is raised: stop all cache users before
removing `.recovery`. Use a dedicated directory on a local filesystem shared by
workers on the same machine; PID leases do not coordinate different hosts.
