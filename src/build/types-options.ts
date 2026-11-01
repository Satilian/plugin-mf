export type TypesSyncMode = "strict" | "best-effort" | "off";

export type TypesSyncOptions = {
  mode?: TypesSyncMode;
  remotes?: string[];
  concurrency?: number;
  offline?: boolean;
  frozenLockfile?: boolean;
  updateLock?: boolean;
  lockfile?: string;
};

export function validateTypesOptions(options: TypesSyncOptions): void {
  if (options.mode !== undefined && !["strict", "best-effort", "off"].includes(options.mode)) {
    throw new Error("[plugin-mf] Invalid types synchronization mode");
  }
  if (options.concurrency !== undefined && (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1)) {
    throw new Error("[plugin-mf] Types concurrency must be a positive safe integer");
  }
  if (options.updateLock && (options.offline || options.frozenLockfile)) {
    throw new Error("[plugin-mf] updateLock cannot be combined with offline or frozenLockfile");
  }
}
