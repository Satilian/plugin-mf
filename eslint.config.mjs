import tseslint from "typescript-eslint";

const forbidden = (regex, message) => ({ regex, message });
const platform = "^(?:node:|(?:fs|path|crypto|async_hooks|url|stream|buffer|util|os|http|https|zlib|timers|child_process)(?:/|$)|@rsbuild/|@rspack/|typescript$)";
const layer = (name) => "(?:^|/)(?:" + name + ")(?:/|$)";
const facades = forbidden("^plugin-mf(?:/|$)|^(?:\\.\\./)+(?:index|client|server|shared)\\.ts$", "Internal modules cannot import public facades.");
const boundaries = (files, patterns) => ({ files, rules: { "no-restricted-imports": ["error", { patterns: [facades, ...patterns] }] } });

export default [
  { ignores: ["dist/**", "node_modules/**", "example/**", ".agents/**", ".codex/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "object-shorthand": "error",
      "no-restricted-imports": ["error", { patterns: [facades] }],
    },
  },
  boundaries(["src/protocol/**/*.ts"], [
    forbidden(platform + "|^react(?:/|$)", "Protocol must be independent of Node, React and build tools."),
    forbidden(layer("build|runtime|transport|sharing"), "Protocol cannot depend on its consumers."),
  ]),
  boundaries(["src/runtime/core/**/*.ts", "src/transport/**/*.ts", "src/sharing/**/*.ts"], [
    forbidden(platform + "|^react(?:/|$)", "Common runtime must be platform independent."),
    forbidden(layer("build|client|server|react"), "Common code cannot depend on platform or React adapters."),
  ]),
  boundaries(["src/runtime/client/**/*.ts", "src/runtime/react/**/*.ts"], [
    forbidden(platform, "Browser and React code cannot import Node or build tools."),
    forbidden(layer("server|build"), "Browser and React code cannot import server or build modules."),
  ]),
  boundaries(["src/runtime/server/**/*.ts"], [
    forbidden("^@rsbuild/|^@rspack/|^typescript$|" + layer("build|client"), "Server runtime cannot depend on build tools or browser runtime."),
  ]),
  boundaries(["src/build/**/*.ts"], [
    forbidden(layer("runtime|sharing"), "Build code must use protocol and transport contracts, not runtime implementations."),
  ]),
];
