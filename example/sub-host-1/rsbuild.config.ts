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
        expose: {
          Button: "./src/button/button.tsx",
        },
        externals: ["react", "react-dom", "react/jsx-runtime"],
      }),
    ],
  };

  return config;
});
