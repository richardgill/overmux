import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { root } from "../scripts/shared.mts";

const packagePath = "packages/ecosystem/xterm-fork";
type TestContext = { after: (fn: () => void) => void };
type FixtureOptions = { releaseNote?: boolean; unrelatedChangeset?: boolean };

export const releaseFixture = (
  t: TestContext,
  options: FixtureOptions = {},
) => {
  mkdirSync(resolve(root, ".test-tmp"), { recursive: true });
  const repository = mkdtempSync(resolve(root, ".test-tmp/xterm-release-"));
  const cwd = resolve(repository, packagePath);
  mkdirSync(cwd, { recursive: true });
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  for (const path of [
    "scripts",
    "package.json",
    "upstream.ts",
    ".changeset",
    "CHANGELOG.md",
  ]) {
    cpSync(resolve(root, path), resolve(cwd, path), { recursive: true });
  }
  for (const name of readdirSync(resolve(cwd, ".changeset")).filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  )) {
    rmSync(resolve(cwd, ".changeset", name));
  }
  const pkg = manifest(cwd);
  writeFileSync(
    resolve(cwd, "package.json"),
    `${JSON.stringify({ ...pkg, version: "6.0.0-overmux.1" }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(cwd, "upstream.ts"),
    "export const upstream = { tag: '6.0.0' };\n",
  );
  writeFileSync(
    resolve(cwd, "CHANGELOG.md"),
    "# Changelog\n\n## 6.0.0-overmux.1\n\n- Initial.\n",
  );
  if (options.releaseNote) {
    writeFileSync(
      resolve(cwd, ".changeset/fix.md"),
      entry("patch", "@overmux/xterm-fork", "Fix input."),
    );
  }
  symlinkSync(
    resolve(root, "node_modules"),
    resolve(cwd, "node_modules"),
    "dir",
  );
  writeFileSync(resolve(repository, ".gitignore"), "node_modules\n");
  if (options.unrelatedChangeset) {
    mkdirSync(resolve(repository, ".changeset"));
    writeFileSync(
      resolve(repository, ".changeset/unrelated.md"),
      "Unrelated pending release note.\n",
    );
  }
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "release-test@example.invalid");
  git("config", "user.name", "Release Test");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  git("add", ".");
  git("commit", "-m", "Fixture");
  git("remote", "add", "origin", "git@github.com:richardgill/overmux.git");
  return { cwd, git };
};

export const entry = (
  type = "patch",
  name = "@overmux/xterm-fork",
  summary = "Fix terminal input.",
) => `---\n"${name}": ${type}\n---\n\n${summary}\n`;
export const contents = (directory: string, path: string) =>
  readFileSync(resolve(directory, path), "utf8");
export const manifest = (directory: string) =>
  JSON.parse(contents(directory, "package.json"));
export const snapshot = (directory: string) =>
  [
    "package.json",
    "CHANGELOG.md",
    ...readdirSync(resolve(directory, ".changeset")).map(
      (name) => `.changeset/${name}`,
    ),
  ].map((path) => [path, contents(directory, path)]);
