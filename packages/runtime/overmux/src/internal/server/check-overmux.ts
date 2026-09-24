import { loadOvermuxConfig } from "@overmux/shared/node";
import { dirname, isAbsolute, resolve } from "node:path";
import ts from "typescript";
import { ZodError } from "zod";

import { createRuntime } from "./runtime/create-runtime";

export type CheckDiagnostic = {
  code?: number | string;
  column?: number;
  file?: string;
  line?: number;
  message: string;
  path?: string;
  phase: "config" | "imports" | "runtime" | "types" | "ui";
};

export type CheckResult = {
  operations?: number;
  config: string;
  diagnostics: CheckDiagnostic[];
  files: number;
  ok: boolean;
};

export type CheckOvermuxOptions = {
  aliases?: Record<string, string>;
  configPath: string;
  typeAliases?: Record<string, string>;
  typesOnly?: boolean;
};

const loadCompilerOptions = (configPath: string) => {
  const tsconfig = ts.findConfigFile(dirname(configPath), ts.sys.fileExists);
  if (!tsconfig) {
    return {
      allowImportingTsExtensions: true,
      allowJs: false,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    } satisfies ts.CompilerOptions;
  }
  const loaded = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    dirname(tsconfig),
  );
  return {
    ...parsed.options,
    allowImportingTsExtensions: true,
    noEmit: true,
  };
};

const diagnosticOf = (diagnostic: ts.Diagnostic): CheckDiagnostic => {
  const position =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
  return {
    code: diagnostic.code,
    column: position ? position.character + 1 : undefined,
    file: diagnostic.file?.fileName,
    line: position ? position.line + 1 : undefined,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    phase: "types",
  };
};

const kindOf = (fileName: string, configPath: string) => {
  if (
    resolve(fileName) === resolve(configPath) ||
    fileName.match(/\.server\.[cm]?[jt]sx?$/)
  ) {
    return "server";
  }
  if (fileName.match(/\.ui\.[cm]?[jt]sx?$/)) {
    return "client";
  }
  if (fileName.match(/\.shared\.[cm]?[jt]sx?$/)) {
    return "shared";
  }
  return undefined;
};

type ModuleKind = "client" | "server" | "shared";

type ResolvedImport = {
  kind?: ModuleKind;
  node: ts.ImportDeclaration | ts.ExportDeclaration;
  source?: ts.SourceFile;
};

const kindOfSpecifier = (specifier: string): ModuleKind | undefined => {
  if (specifier === "overmux/client" || specifier.endsWith("/react")) {
    return "client";
  }
  if (
    specifier === "overmux/server" ||
    specifier.endsWith("/server") ||
    specifier.startsWith("node:")
  ) {
    return "server";
  }
  if (specifier === "overmux" || specifier.endsWith("/shared")) {
    return "shared";
  }
  return undefined;
};

const isTypeOnlyReference = (
  node: ts.ImportDeclaration | ts.ExportDeclaration,
) => {
  if (ts.isExportDeclaration(node)) {
    return Boolean(
      node.isTypeOnly ||
      (node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.every((element) => element.isTypeOnly)),
    );
  }
  const clause = node.importClause;
  if (!clause || clause.name) {
    return Boolean(clause?.isTypeOnly);
  }
  return Boolean(
    clause.isTypeOnly ||
    (clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.every((element) => element.isTypeOnly)),
  );
};

const resolvedImports = (program: ts.Program, source: ts.SourceFile) => {
  const imports: ResolvedImport[] = [];
  source.forEachChild((node) => {
    if (
      (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
      !node.moduleSpecifier ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      isTypeOnlyReference(node)
    ) {
      return;
    }
    const specifier = node.moduleSpecifier.text;
    const resolved = ts.resolveModuleName(
      specifier,
      source.fileName,
      program.getCompilerOptions(),
      ts.sys,
    ).resolvedModule?.resolvedFileName;
    const target = resolved ? program.getSourceFile(resolved) : undefined;
    const kind = kindOfSpecifier(specifier);
    if (kind || (target && !target.isDeclarationFile)) {
      imports.push({
        kind,
        node,
        source: target?.isDeclarationFile ? undefined : target,
      });
    }
  });
  return imports;
};

const invalidImport = (source: ModuleKind, target: ModuleKind | undefined) =>
  (source === "server" && target === "client") ||
  (source === "client" && target === "server") ||
  (source === "shared" && target !== undefined && target !== "shared");

const visitImportGraph = ({
  configPath,
  diagnostics,
  kind,
  program,
  seen,
  source,
}: {
  configPath: string;
  diagnostics: CheckDiagnostic[];
  kind: ModuleKind;
  program: ts.Program;
  seen: Set<string>;
  source: ts.SourceFile;
}) => {
  const visitKey = `${kind}:${source.fileName}`;
  if (seen.has(visitKey)) {
    return;
  }
  seen.add(visitKey);
  resolvedImports(program, source).forEach(
    ({ kind: importKind, node, source: target }) => {
      const declaredKind =
        importKind ??
        (target ? kindOf(target.fileName, configPath) : undefined);
      if (invalidImport(kind, declaredKind)) {
        const position = source.getLineAndCharacterOfPosition(node.getStart());
        diagnostics.push({
          code: "OVERMUX_IMPORT_BOUNDARY",
          column: position.character + 1,
          file: source.fileName,
          line: position.line + 1,
          message: `${kind} modules may not import ${declaredKind} modules`,
          phase: "imports",
        });
        return;
      }
      if (target) {
        visitImportGraph({
          configPath,
          diagnostics,
          kind: declaredKind === "shared" ? "shared" : kind,
          program,
          seen,
          source: target,
        });
      }
    },
  );
};

const importBoundaryDiagnostics = (
  program: ts.Program,
  configPath: string,
): CheckDiagnostic[] => {
  const diagnostics: CheckDiagnostic[] = [];
  const seen = new Set<string>();
  program.getSourceFiles().forEach((source) => {
    const kind = kindOf(source.fileName, configPath);
    if (kind && !source.isDeclarationFile) {
      visitImportGraph({
        configPath,
        diagnostics,
        kind,
        program,
        seen,
        source,
      });
    }
  });
  return diagnostics;
};

const runtimeDiagnostics = (cause: unknown): CheckDiagnostic[] => {
  if (cause instanceof ZodError) {
    return cause.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.length ? issue.path.join(".") : undefined,
      phase: "runtime" as const,
    }));
  }
  return [
    {
      message: cause instanceof Error ? cause.message : String(cause),
      phase: "runtime",
    },
  ];
};

const typecheck = async ({
  aliases = {},
  configPath,
  typeAliases,
}: CheckOvermuxOptions) => {
  const options = loadCompilerOptions(configPath);
  const aliasesForTypes =
    typeAliases ??
    Object.fromEntries(
      Object.entries(aliases).filter(
        ([key]) => key === "overmux" || key.startsWith("overmux/"),
      ),
    );
  const absoluteAliases = Object.fromEntries(
    Object.entries(aliasesForTypes).map(([key, value]) => [
      key,
      [isAbsolute(value) ? value : resolve(value)],
    ]),
  );
  const program = ts.createProgram({
    options: {
      ...options,
      baseUrl: options.baseUrl ?? "/",
      paths: { ...options.paths, ...absoluteAliases },
    },
    rootNames: [configPath],
  });
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program).map(diagnosticOf),
    ...importBoundaryDiagnostics(program, configPath),
  ];
  const files = program
    .getSourceFiles()
    .filter(
      (file) =>
        !file.isDeclarationFile && !file.fileName.includes("node_modules"),
    ).length;
  return { diagnostics, files };
};

export const checkOvermux = async (
  options: CheckOvermuxOptions,
): Promise<CheckResult> => {
  const configPath = resolve(options.configPath);
  let checked;
  try {
    checked = await typecheck({ ...options, configPath });
  } catch (cause) {
    return {
      config: configPath,
      diagnostics: [
        {
          message: cause instanceof Error ? cause.message : String(cause),
          phase: "config",
        },
      ],
      files: 0,
      ok: false,
    };
  }
  if (checked.diagnostics.length || options.typesOnly) {
    return {
      config: configPath,
      diagnostics: checked.diagnostics,
      files: checked.files,
      ok: checked.diagnostics.length === 0,
    };
  }

  let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  try {
    const { config } = await loadOvermuxConfig({
      aliases: options.aliases,
      configPath,
    });
    runtime = await createRuntime({ config });
    return {
      operations: runtime.manifest.operations.length,
      config: configPath,
      diagnostics: [],
      files: checked.files,
      ok: true,
    };
  } catch (cause) {
    return {
      config: configPath,
      diagnostics: runtimeDiagnostics(cause),
      files: checked.files,
      ok: false,
    };
  } finally {
    await runtime?.dispose();
  }
};
