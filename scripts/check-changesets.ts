import { parse as parseConfig } from "@changesets/config";
import parseChangeset from "@changesets/parse";
import { shouldSkipPackage } from "@changesets/should-skip-package";
import { getPackages, type Package } from "@manypkg/get-packages";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { matchesGlob, relative } from "node:path";

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const gitPaths = (root: string, args: string[]) =>
  git(root, args).split("\0").filter(Boolean);

// These shared inputs can alter any package's output or dependency resolution.
// Do not try to infer arbitrary script imports or devDependency build graphs.
const sharedBuildInput = (file: string) =>
  [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "turbo.json",
    ".npmrc",
    ".node-version",
    ".github/workflows/release.yml",
    ".github/shared/action.yml",
  ].includes(file) ||
  /^(?:vite\.config\.[^/]+|tsconfig[^/]*\.json)$/u.test(file) ||
  (file.startsWith("scripts/") && !/\.(?:test|spec)\.[^/]+$/u.test(file));

const matchesFilesEntry = (file: string, entry: string) => {
  const pattern = entry.replace(/^\.\//u, "").replace(/\/$/u, "");
  return matchesGlob(file, pattern) || matchesGlob(file, `${pattern}/**`);
};

const affectsPackage = (file: string, pkg: Package) => {
  // Exclude only recognisable test/scratch material, and only when it is not shipped.
  // Everything else counts, including src -> generated dist, docs, assets and build inputs.
  const testMaterial =
    /(?:^|\/)(?:__tests__|__fixtures__|tests?|fixtures|testing|e2e|coverage|test-results|overlay|\.test-tmp)(?:\/|$)|\.(?:test|spec)\.[^/]+$/u.test(
      file,
    );
  if (!testMaterial) {
    return true;
  }
  const { files } = pkg.packageJson as Package["packageJson"] & {
    files?: string[];
  };
  if (!files) {
    return !pkg.packageJson.private;
  }
  return (
    files.some(
      (entry) => !entry.startsWith("!") && matchesFilesEntry(file, entry),
    ) &&
    !files.some(
      (entry) =>
        entry.startsWith("!") && matchesFilesEntry(file, entry.slice(1)),
    )
  );
};

const affectedPublishedPackages = (
  changed: Package[],
  packages: Package[],
  published: Set<Package>,
) => {
  const affected = new Set(changed);
  // Stop at a published boundary: Changesets owns subsequent dependent version bumps.
  // Set iteration visits newly added consumers once, including across dependency cycles.
  for (const pkg of affected) {
    if (!published.has(pkg)) {
      const consumers = packages.filter(
        ({ packageJson }) =>
          Object.hasOwn(packageJson.dependencies ?? {}, pkg.packageJson.name) ||
          Object.hasOwn(
            packageJson.optionalDependencies ?? {},
            pkg.packageJson.name,
          ),
      );
      for (const consumer of consumers) {
        affected.add(consumer);
      }
    }
  }
  return [...affected]
    .filter((pkg) => published.has(pkg))
    .sort((a, b) => a.packageJson.name.localeCompare(b.packageJson.name));
};

const newChangesets = (
  root: string,
  base: string,
  files: string[],
  packages: Package[],
) => {
  // Pending changesets on the target branch never cover this PR, even if edited here.
  const onBase = new Set(
    gitPaths(root, [
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      base,
      "--",
      ".changeset",
    ]),
  );
  const names = new Set(packages.map((pkg) => pkg.packageJson.name));
  return files
    .filter(
      (file) =>
        /^\.changeset\/[^/.][^/]*\.md$/u.test(file) &&
        file !== ".changeset/README.md" &&
        !onBase.has(file) &&
        existsSync(`${root}/${file}`),
    )
    .map((file) => {
      const changeset = parseChangeset(readFileSync(`${root}/${file}`, "utf8"));
      for (const release of changeset.releases) {
        if (!names.has(release.name)) {
          throw new Error(`${file}: unknown workspace package ${release.name}`);
        }
      }
      return changeset;
    });
};

const readComparison = (root: string) => {
  const baseRef = process.env.CHANGESET_BASE_REF ?? "origin/main";
  let base: string;
  let mergeBase: string;
  try {
    base = git(root, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${baseRef}^{commit}`,
    ]).trim();
    mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
  } catch {
    throw new Error(
      `Cannot resolve changeset base ${JSON.stringify(baseRef)} or its common ancestor with HEAD. Fetch the target branch/history, or set CHANGESET_BASE_REF to a valid base ref.`,
    );
  }
  // A single diff includes commits, index and working-tree edits/deletions. Disabling
  // rename detection counts both owners of a move. Untracked, nonignored files count too.
  const files = [
    ...new Set([
      ...gitPaths(root, [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        mergeBase,
        "--",
      ]),
      ...gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]),
  ];
  return { baseRef, base, files };
};

const readWorkspace = async (root: string) => {
  const workspace = await getPackages(root);
  if (workspace.root.dir !== root || workspace.tool !== "pnpm") {
    throw new Error("Expected a pnpm workspace at the Git repository root.");
  }
  const rawConfig = readJson(`${root}/.changeset/config.json`);
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error("Invalid .changeset/config.json: expected an object.");
  }
  const config = parseConfig(rawConfig, workspace);
  const packages = workspace.packages;
  const published = new Set(
    packages.filter(
      (pkg) =>
        !shouldSkipPackage(pkg, {
          ignore: config.ignore,
          allowPrivatePackages: config.privatePackages.version,
        }) &&
        (!pkg.packageJson.private ||
          pkg.packageJson.name === "@overmux/desktop"),
    ),
  );
  return { packages, published };
};

const checkChangesets = async () => {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const { baseRef, base, files } = readComparison(root);
  const { packages, published } = await readWorkspace(root);
  const shared = files.some(sharedBuildInput);
  const desktopRelease = files.includes(
    ".github/workflows/desktop-release.yml",
  );
  const changed = packages.filter((pkg) => {
    if (desktopRelease && pkg.packageJson.name === "@overmux/desktop") {
      return true;
    }
    const prefix = `${relative(root, pkg.dir)}/`;
    return files.some(
      (file) =>
        file.startsWith(prefix) &&
        affectsPackage(file.slice(prefix.length), pkg),
    );
  });
  const affected = affectedPublishedPackages(
    shared ? [...changed, ...published] : changed,
    packages,
    published,
  );
  const added = newChangesets(root, base, files, packages);
  const covered = new Set(
    added.flatMap(({ releases }) => releases.map(({ name }) => name)),
  );
  const optOut = added.some(({ releases }) => releases.length === 0);
  return {
    root,
    baseRef,
    affected,
    optOut,
    missing: optOut
      ? []
      : affected.filter((pkg) => !covered.has(pkg.packageJson.name)),
  };
};

const escapeAnnotation = (value: string) =>
  value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(",", "%2C")
    .replaceAll(":", "%3A");
const annotate = (message: string, file?: string) => {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(
      `::error ${file ? `file=${escapeAnnotation(file)},line=1,` : ""}title=Changesets::${escapeAnnotation(message)}`,
    );
  }
};
const report = (markdown: string) => {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
};

const main = async () => {
  const { root, baseRef, affected, missing, optOut } = await checkChangesets();
  const status = optOut
    ? "A new empty changeset opts out of releases for this change."
    : missing.length > 0
      ? "Missing changeset coverage."
      : "All affected published packages are covered.";
  const guidance =
    "Run `pnpm changeset` and select every missing package, or `pnpm changeset --empty` if no release is needed. A brief reason in the empty changeset body is encouraged.";
  report(
    [
      "## Changesets",
      status,
      `Base: \`${baseRef}\` (merge-base comparison, including local changes).`,
      affected.length
        ? `Affected packages: ${affected.map((pkg) => `\`${pkg.packageJson.name}\``).join(", ")}.`
        : "No affected published packages.",
      ...missing.map(
        (pkg) =>
          `- Missing: \`${pkg.packageJson.name}\` (${relative(root, pkg.dir)}/package.json)`,
      ),
      ...(missing.length
        ? [
            guidance,
            "Only newly introduced changesets count; pending changesets on the target branch do not.",
          ]
        : []),
    ].join("\n\n"),
  );
  for (const pkg of missing) {
    annotate(
      `${pkg.packageJson.name} needs a newly introduced changeset. ${guidance}`,
      `${relative(root, pkg.dir)}/package.json`,
    );
  }
  process.exitCode = missing.length ? 1 : 0;
};

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  annotate(message);
  report(`## Changesets\n\nCheck failed: ${message}`);
  process.exitCode = 1;
});
