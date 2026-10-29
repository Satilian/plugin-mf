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
