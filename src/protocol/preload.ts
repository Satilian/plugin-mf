export type RemoteAsset = { path: string; bytes: number; type: "js" | "css" };
export type PreloadTarget = { remote: string; expose: string };
export type PreloadOptions = { concurrency?: number; maxRemotes?: number; maxJSBytes?: number; maxCSSBytes?: number; signal?: AbortSignal };
