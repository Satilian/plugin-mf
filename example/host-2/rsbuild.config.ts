import { ConfigParams, defineConfig, RsbuildConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginMF } from "plugin-mf";

export default defineConfig(({ env }: ConfigParams) => {
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
        (config.ignoreWarnings ??= []).push(
          /Can't resolve 'supports-color'/i,
          /the request of a dependency is an expression/i,
        );
      },
    },
    plugins: [
      pluginReact(),
      pluginMF({
        remotes: {
          subhost1: "http://localhost:4001/mf",
        },
        expose: {
          Span: "./src/Span.tsx",
          Section: "./src/section/section.tsx",
        },
        externals: ["react", "react-dom", "react/jsx-runtime"],
        shared: ["react", "react-dom", "react/jsx-runtime"],
      }),
    ],
  };

  return config;
});
