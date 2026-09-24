import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "*.ts", "*.tsx"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((file) => Boolean(file) && existsSync(file));

const hasTestCall = (source: string) =>
  /\b(?:describe|it|test)\s*\(/.test(source);

const violations = files.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  const isVitest =
    /^import\s.*from\s+"vitest"/m.test(source) && hasTestCall(source);
  const isPlaywright =
    /^import\s.*from\s+"@playwright\/test"/m.test(source) &&
    hasTestCall(source);

  if (isVitest && !/\.(?:e2e|unit)\.test\.tsx?$/.test(file)) {
    return [
      `${file}: Vitest files must use *.unit.test.ts(x) or *.e2e.test.ts(x)`,
    ];
  }
  if (isPlaywright && !file.endsWith(".e2e.test.ts")) {
    return [`${file}: Playwright files must use *.e2e.test.ts`];
  }
  return [];
});

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Test file naming is valid.");
