import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

export type RemoteTypeManifest = {
  version: 1;
  files: string[];
  exposes: Record<string, { path: string; export: string }>;
};

type BuildTypesProps = {
  entry: Record<string, string>;
  outputPath: string;
};

export async function buildTypes({ entry, outputPath }: BuildTypesProps) {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("[plugin-mf] Unable to find tsconfig.json for remote type generation");

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(formatDiagnostics([config.error]));

  const configDirectory = path.dirname(configPath);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, configDirectory);
  if (parsed.errors.length) throw new Error(formatDiagnostics(parsed.errors));

  const typesPath = path.join(outputPath, "types");
  const compilerOptions: ts.CompilerOptions = {
    ...parsed.options,
    declaration: true,
    declarationMap: false,
    emitDeclarationOnly: true,
    listEmittedFiles: true,
    noEmit: false,
    outDir: typesPath,
  };

  await rm(typesPath, { recursive: true, force: true });
  await mkdir(typesPath, { recursive: true });
  const fileNames = Object.values(entry).map((request) => path.resolve(configDirectory, request));

  const program = ts.createProgram(fileNames, compilerOptions);
  const emitResult = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(formatDiagnostics(errors));

  const commonSourceDirectory = compilerOptions.rootDir || findCommonDirectory(parsed.fileNames);
  const checker = program.getTypeChecker();
  const exposes: RemoteTypeManifest["exposes"] = {};

  for (const [name, request] of Object.entries(entry)) {
    const sourcePath = path.resolve(configDirectory, request);
    const sourceFile = program.getSourceFile(sourcePath);
    if (!sourceFile) {
      throw new Error(`[plugin-mf] Unable to find source file for exposed module "${name}": ${request}`);
    }

    const sourceSymbol = checker.getSymbolAtLocation(sourceFile);
    const symbol = sourceSymbol && checker.getExportsOfModule(sourceSymbol).find((item) => item.name === name);
    if (!symbol) {
      throw new Error(`[plugin-mf] Exposed module "${name}" must have a named export "${name}"`);
    }

    const relativeSourcePath = path.relative(commonSourceDirectory, sourcePath);
    const declarationPath = relativeSourcePath.replace(/\.[^.]+$/, ".d.ts").replace(/\\/g, "/");
    exposes[name] = { path: declarationPath, export: name };
  }

  const files = emitResult.emittedFiles
    ?.filter((filePath) => filePath.endsWith(".d.ts"))
    .map((filePath) => path.relative(typesPath, filePath).replace(/\\/g, "/"))
    .sort();

  if (!files?.length) throw new Error("[plugin-mf] TypeScript did not emit declarations for exposed modules");

  const manifest: RemoteTypeManifest = { version: 1, files, exposes };
  await writeFile(path.join(outputPath, "types-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: process.cwd,
    getNewLine: () => "\n",
  });
}

function findCommonDirectory(fileNames: string[]) {
  const directories = fileNames.map((fileName) => path.dirname(path.resolve(fileName)).split(path.sep));
  const common = [...directories[0]];

  for (const directory of directories.slice(1)) {
    let index = 0;
    while (index < common.length && common[index] === directory[index]) index += 1;
    common.length = index;
  }

  return common.join(path.sep) || path.parse(process.cwd()).root;
}
