export type ModuleLoadContext = {
  provider: string;
  releaseId?: string;
  baseUrl: string;
  files: string[];
};

export type RemoteScope = "client" | "server";
export type RemoteModule = Record<string, unknown>;

export interface ModuleLoader {
  load(url: string, context?: ModuleLoadContext): Promise<RemoteModule>;
}
