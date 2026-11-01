import { ConfigParams, defineConfig, RsbuildConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginMF } from "plugin-mf";
import mfTypes from "./mf-types.config.json";

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
        ...mfTypes,
        expose: {
          P: "./src/p/p.tsx",
          Div: "./src/div/div.tsx",
        },
        externals: [{ name: "react", requiredVersion: "^19.2.8", singleton: true }, "react-dom"],
        shared: [{ name: "react", requiredVersion: "^19.2.8", singleton: true }, "react-dom"],
      }),
    ],
  };

  return config;
});
