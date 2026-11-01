import { defineConfig, RsbuildConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginMF } from "plugin-mf";

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
        loading: {
          manifestTimeoutMs: 2_000,
          moduleTimeoutMs: 6_000,
          typesTimeoutMs: 10_000,
          retries: 2,
          retryDelayMs: 100,
          circuitBreaker: { failureThreshold: 3, cooldownMs: 5_000 },
        },
        remotes: {
          host1: "http://localhost:3001/mf",
          host2: "http://localhost:3002/mf",
          subhost1: "http://localhost:4001/mf",
        },
        shared: ["react", "react-dom", "react/jsx-runtime"],
      }),
    ],
  };

  return config;
});
