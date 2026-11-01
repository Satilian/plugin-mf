import { defineConfig, RsbuildConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginMF } from "plugin-mf";
import mfTypes from "./mf-types.config.json";

export default defineConfig(() => {
  const config: RsbuildConfig = {
    html: {
      template: "./src/index.html",
    },
    server: {
      port: Number(process.env.PORT),
    },
    environments: {
      web: {
        output: {
          target: "web",
        },
      },
      node: {
        source: {
          entry: { server: "./src/server" },
        },
        output: {
          target: "node",
        },
      },
    },
    tools: {
      rspack: (config) => {
        (config.ignoreWarnings ??= []).push(/Can't resolve /i, /the request of a dependency is an expression/i);
      },
    },
    plugins: [
      pluginReact(),
      pluginMF({
        ...mfTypes,
        network: { requireServerIntegrity: true },
        loading: {
          manifestTimeoutMs: 2_000,
          moduleTimeoutMs: 6_000,
          typesTimeoutMs: 10_000,
          retries: 2,
          retryDelayMs: 100,
          circuitBreaker: { failureThreshold: 3, cooldownMs: 5_000 },
        },
        shared: [{ name: "react", requiredVersion: "^19.2.8", singleton: true }, "react-dom"],
      }),
    ],
  };

  return config;
});
