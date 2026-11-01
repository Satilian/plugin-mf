import valid from "semver/functions/valid.js";
import validRange from "semver/ranges/valid.js";

export type SharedConfig = { name: string; version?: string; requiredVersion?: string; singleton?: boolean };
export type SharedDependency = string | SharedConfig;
export type SharedRequirement = { version: string; requiredVersion: string; singleton: boolean };
export type SharedRequirements = Record<string, SharedRequirement>;
export type ReleaseSharing = { client: SharedRequirements; server: SharedRequirements };

export function packageName(request: string): string {
  return request.startsWith("@") ? request.split("/").slice(0, 2).join("/") : request.split("/")[0];
}

export function parseSharedRequirements(value: unknown): SharedRequirements {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shared requirements");
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => {
    if (!name || !entry || typeof entry !== "object" || !("version" in entry) || typeof entry.version !== "string" || !valid(entry.version) ||
      !("requiredVersion" in entry) || typeof entry.requiredVersion !== "string" || !validRange(entry.requiredVersion) ||
      !("singleton" in entry) || typeof entry.singleton !== "boolean") throw new Error(`Invalid shared requirement: ${name}`);
    return [name, { version: entry.version, requiredVersion: entry.requiredVersion, singleton: entry.singleton }];
  }));
}
