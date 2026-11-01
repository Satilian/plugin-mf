export type LoadStage = "release-manifest" | "manifest" | "module" | "types";
export type LoadErrorCode = "LOAD_FAILED" | "HTTP_ERROR" | "TIMEOUT" | "ABORTED" | "CIRCUIT_OPEN";

export type LoadContext = {
  remote: string;
  releaseId?: string;
  stage: LoadStage;
};

export class RemoteLoadError extends Error {
  readonly remote: string;
  readonly releaseId?: string;
  readonly stage: LoadStage;
  readonly code: LoadErrorCode;
  readonly status?: number;

  constructor(context: LoadContext, code: LoadErrorCode, message: string, options?: { cause?: unknown; status?: number }) {
    super(`[plugin-mf] ${context.remote} (${context.releaseId ?? "unselected"}, ${context.stage}): ${message}`, options);
    this.name = "RemoteLoadError";
    this.remote = context.remote;
    this.releaseId = context.releaseId;
    this.stage = context.stage;
    this.code = code;
    this.status = options?.status;
  }
}

export type LoadingOptions = {
  manifestTimeoutMs?: number;
  moduleTimeoutMs?: number;
  typesTimeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  circuitBreaker?: { failureThreshold?: number; cooldownMs?: number };
};
