// Enforces the published runtime facade and source dependency direction.
// Keeping this repository scan explicit prevents package and declaration leaks from returning.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const repositoryRoot = process.cwd();
const runtimeRoot = "packages/runtime/overmux";
const sourceExtensions = /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml)$/u;
const legacyPackages = ["core", "client", "server"].map(
  (name) => `@overmux/${name}`,
);
const runtimeDependencies = new Set([
  "@overmux/ai-context",
  "@overmux/keybindings",
  "@overmux/lib",
  "@overmux/shared",
  "@overmux/shared/node",
]);
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((file) => Boolean(file) && existsSync(file));

const moduleSpecifiers = (source: string) =>
  [
    ...source.matchAll(
      /(?:from\s*|import\s*\(|import\s+|mock\s*\()\s*["']([^"']+)["']/gu,
    ),
  ].map((match) => match[1]);

const sourceArea = (path: string) => {
  const match = path.match(
    /^packages\/runtime\/overmux\/src\/internal\/(shared|client|server)(?:\/|$)/u,
  );
  return match?.[1];
};

const resolvedArea = (file: string, specifier: string) => {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const target = relative(
    repositoryRoot,
    resolve(repositoryRoot, dirname(file), specifier),
  ).replaceAll("\\", "/");
  return sourceArea(target);
};

const dependencyViolation = (file: string, specifier: string) => {
  const from = sourceArea(file);
  const to = resolvedArea(file, specifier);
  if (from === "shared" && (to === "client" || to === "server")) {
    return `${file}: shared runtime code may not import ${to} runtime code`;
  }
  if (from === "client" && to === "server") {
    return `${file}: client runtime code may not import server runtime code`;
  }
  if (from === "server" && to === "client") {
    return `${file}: server runtime code may not import client runtime code`;
  }
  if (
    from === "shared" &&
    /^(?:node:|react(?:\/|$)|react-dom(?:\/|$))/u.test(specifier)
  ) {
    return `${file}: shared runtime code may not import ${specifier}`;
  }
  return undefined;
};

const violations = files.flatMap((file) => {
  if (!sourceExtensions.test(file) && file !== "pnpm-lock.yaml") {
    return [];
  }
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  if (
    file.startsWith(`${runtimeRoot}/src/`) &&
    !file.startsWith(`${runtimeRoot}/src/public/`) &&
    !file.startsWith(`${runtimeRoot}/src/internal/`)
  ) {
    found.push(`${file}: runtime source must be public or internal`);
  }
  legacyPackages.forEach((packageName) => {
    if (source.includes(packageName)) {
      found.push(`${file}: legacy runtime package reference ${packageName}`);
    }
  });
  moduleSpecifiers(source).forEach((specifier) => {
    if (
      specifier.startsWith("overmux/") &&
      !["overmux/client", "overmux/server"].includes(specifier)
    ) {
      found.push(`${file}: unsupported runtime deep import ${specifier}`);
    }
    const direction = dependencyViolation(file, specifier);
    if (direction) {
      found.push(direction);
    }
    if (
      file.startsWith(runtimeRoot) &&
      !file.includes(".test.") &&
      specifier.startsWith("@overmux/") &&
      !specifier.startsWith("@overmux/tsconfig") &&
      !runtimeDependencies.has(specifier)
    ) {
      found.push(
        `${file}: runtime may not depend on ecosystem package ${specifier}`,
      );
    }
  });
  return found;
});

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Runtime package boundaries are valid.");
