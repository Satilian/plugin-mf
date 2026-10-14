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
