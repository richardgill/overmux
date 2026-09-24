import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const desktopManifest = "apps/desktop/package.json";
const desktopChangelog = "apps/desktop/CHANGELOG.md";
type ReleaseState = "missing" | "draft" | "public";

const git = (args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

const github = (endpoint: string) => {
  const result = spawnSync("gh", ["api", endpoint], { encoding: "utf8" });
  const body = result.stdout ? JSON.parse(result.stdout) : undefined;
  if (result.status === 0) {
    return body;
  }
  if (body?.status === "404" || body?.status === 404) {
    return undefined;
  }
  throw new Error(`GitHub request failed: ${endpoint}\n${result.stderr}`, {
    cause: result.error,
  });
};

export const readDesktopReleaseState = (tag: string): ReleaseState => {
  const release = github(`repos/{owner}/{repo}/releases/tags/${tag}`);
  return release ? (release.draft ? "draft" : "public") : "missing";
};

export const getDesktopChangelogEntry = (
  changelog: string,
  version: string,
) => {
  const sections = changelog.replaceAll("\r\n", "\n").split(/^## /mu);
  const section = sections.find((entry) => entry.split("\n")[0] === version);
  const notes = section?.slice(version.length).trim();
  if (!notes) {
    throw new Error(`Desktop changelog is missing an entry for ${version}`);
  }
  return notes;
};

export const assertDesktopTagCommit = (
  actual: string | undefined,
  expected: string,
) => {
  if (actual && actual !== expected) {
    throw new Error(
      `Desktop tag points to ${actual}, expected ${expected}; refusing to move it`,
    );
  }
};

const readTagCommit = (tag: string) => {
  // Fetch only this tag: never replace a conflicting local/remote ref with --force.
  const remote = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  if (!remote) {
    return undefined;
  }
  git(["fetch", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
  return git(["rev-parse", `${tag}^{commit}`]);
};

const assertSuccessfulMainCI = (commit: string) => {
  const runs = github(
    `repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&head_sha=${commit}&per_page=1`,
  );
  if (!runs?.workflow_runs?.length) {
    throw new Error(`No successful main CI push run for ${commit}`);
  }
};

const writeReleaseOutputs = (values: Record<string, string | boolean>) => {
  const output = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  console.log(output);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  }
};

export const resolveMainReleaseCommit = () => {
  const commit = git(["rev-parse", "HEAD"]);
  assertSuccessfulMainCI(commit);
  writeReleaseOutputs({ release_commit: commit });
};

export const findDesktopVersionCommit = (
  history: { commit: string; version: string }[],
  version: string,
) => {
  const boundary = history.findIndex((entry) => entry.version !== version);
  const release = history
    .slice(0, boundary < 0 ? history.length : boundary)
    .at(-1);
  if (!release) {
    throw new Error(`Release history does not start at desktop ${version}`);
  }
  return release.commit;
};

const resolveDesktopVersionCommit = (candidate: string, version: string) => {
  // First-parent history identifies the release PR's main commit, not its branch
  // commits. Later main pushes must retry that same source, never retarget a version.
  const commits = git([
    "log",
    "--first-parent",
    "--format=%H",
    candidate,
    "--",
    desktopManifest,
  ]).split("\n");
  const history = commits.map((commit) => ({
    commit,
    version: JSON.parse(git(["show", `${commit}:${desktopManifest}`]))
      .version as string,
  }));
  return findDesktopVersionCommit(history, version);
};

export const detectDesktopRelease = (version: string) => {
  const tag = `desktop-v${version}`;
  // A published version is immutable, even when later main commits change its inputs.
  // Check this before history/tag validation so unrelated releases do not conflict.
  if (readDesktopReleaseState(tag) === "public") {
    writeReleaseOutputs({ should_release: false });
    return;
  }
  const commit = resolveDesktopVersionCommit(
    git(["rev-parse", "HEAD"]),
    version,
  );
  getDesktopChangelogEntry(
    git(["show", `${commit}:${desktopChangelog}`]),
    version,
  );
  assertDesktopTagCommit(readTagCommit(tag), commit);
  assertSuccessfulMainCI(commit);
  writeReleaseOutputs({
    should_release: true,
    release_commit: commit,
    release_tag: tag,
  });
};

export const validateDesktopReleaseCommit = ({
  tag,
  commit,
  requireTag = true,
}: {
  tag: string;
  commit: string;
  requireTag?: boolean;
}) => {
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("Desktop release commit must be a full commit SHA");
  }
  if (git(["rev-parse", "HEAD"]) !== commit) {
    throw new Error(`Desktop checkout does not match release commit ${commit}`);
  }
  const taggedCommit = readTagCommit(tag);
  if (requireTag && !taggedCommit) {
    throw new Error(`Desktop release tag ${tag} is missing`);
  }
  assertDesktopTagCommit(taggedCommit, commit);
  return taggedCommit;
};

export const prepareDesktopRelease = (tag: string, commit: string) => {
  // The reusable workflow serializes the whole build/publish attempt per version.
  // Recheck public state inside that lock before any release or tag mutation.
  if (readDesktopReleaseState(tag) === "public") {
    writeReleaseOutputs({ should_release: false });
    return;
  }
  const existingTag = validateDesktopReleaseCommit({
    tag,
    commit,
    requireTag: false,
  });
  assertSuccessfulMainCI(commit);
  if (!existingTag) {
    git(["push", "origin", `${commit}:refs/tags/${tag}`]);
  }
  writeReleaseOutputs({ should_release: true });
};
