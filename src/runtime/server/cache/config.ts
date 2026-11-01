export type ServerCacheOptions = {
  cacheDir?: string;
  maxBytes?: number;
  lockTimeoutMs?: number;
};

export type CachePruneResult = {
  bytes: number;
  protectedBytes: number;
  removedEntries: number;
  overBudgetBytes: number;
};
