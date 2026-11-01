import type { NetworkOptions } from "../protocol/network-policy.ts";

const key = Symbol.for("plugin-mf.network-policy");
const shared = globalThis as typeof globalThis & { [key]?: NetworkOptions };
const policy = shared[key] ??= {};

export function configureNetwork(options: NetworkOptions): void {
  if (options.allowedProtocols?.some((protocol) => protocol !== "http:" && protocol !== "https:")) throw new Error("[plugin-mf] Only HTTP(S) protocols may be allowed");
  if (options.allowedOrigins) for (const origin of options.allowedOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) throw new Error(`[plugin-mf] Invalid allowed origin: ${origin}`);
  }
  Object.assign(policy, options);
}

export function requiresServerIntegrity(): boolean {
  return policy.requireServerIntegrity ?? false;
}

export function assertRemoteURL(value: string, provider: string): string {
  const url = new URL(value);
  const origins = policy.allowedOrigins ?? [new URL(provider).origin];
  const protocols: readonly string[] = policy.allowedProtocols ?? ["http:", "https:"];
  if (url.username || url.password || !protocols.includes(url.protocol) || !origins.includes(url.origin)) {
    throw new Error(`[plugin-mf] Remote URL is not allowed: ${url.origin}`);
  }
  return url.href;
}
