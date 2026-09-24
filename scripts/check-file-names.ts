import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, extname } from "node:path";

const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const codeExtensions = new Set([".js", ".jsx", ".ts", ".mts", ".tsx"]);
const excludedFiles = new Set([
  "index.ts",
  "index.tsx",
  "overmux.config.ts",
  "overmux.server.ts",
  "overmux.shared.ts",
  "routeTree.gen.ts",
  "alchemy.run.ts",
]);

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((file) => Boolean(file) && existsSync(file));

const codeFiles = files.filter((file) => codeExtensions.has(extname(file)));
const errors = codeFiles.flatMap((file) => {
  if (file.startsWith("apps/www/src/routes/")) {
    return [];
  }

  const name = basename(file);
  const stem = name.slice(0, -extname(name).length);
  const normalizedStem = stem.replace(/\.(unit|e2e)\.test$/, "");
  const errorsForFile: string[] = [];

  if (
    !excludedFiles.has(name) &&
    !name.includes(".config.") &&
    !name.endsWith(".d.ts") &&
    !kebabCase.test(normalizedStem)
  ) {
    errorsForFile.push(`${file}: file name must use kebab-case`);
  }
  if (
    /\.test\.(?:m?ts|tsx)$/.test(name) &&
    !/\.(unit|e2e)\.test\.(?:m?ts|tsx)$/.test(name)
  ) {
    errorsForFile.push(`${file}: test name must include .unit or .e2e`);
  }
  return errorsForFile;
});

const directories = [
  ...new Set(
    files.flatMap((file) => {
      const parts = dirname(file).split("/");
      return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    }),
  ),
].filter((directory) => directory !== "." && !directory.startsWith("overlay"));

const directoryErrors = directories
  .filter((directory) => {
    const name = basename(directory);
    return (
      !name.startsWith(".") && !name.startsWith("$") && !kebabCase.test(name)
    );
  })
  .map((directory) => `${directory}: directory name must use kebab-case`);

const allErrors = [...errors, ...directoryErrors];
if (allErrors.length > 0) {
  console.error(allErrors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${codeFiles.length} code file names.`);
