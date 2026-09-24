import assert from "node:assert/strict";
import parseChangeset from "@changesets/parse";

export const packageName = "@overmux/xterm-fork";
const stablePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const forkPattern =
  /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-overmux\.([1-9]\d*)$/;

export const parseBase = (version: string) => {
  assert.match(version, stablePattern, `Invalid upstream version: ${version}`);
  const parts = version.split(".").map(Number);
  assert.ok(
    parts.every(Number.isSafeInteger),
    `Unsafe upstream version: ${version}`,
  );
  return parts;
};

export const parseVersion = (version: string) => {
  const match = forkPattern.exec(version);
  assert.ok(
    match,
    `Invalid fork version: ${version}; expected <upstream>-overmux.<positive counter>`,
  );
  const [, base, counterText] = match;
  parseBase(base);
  const counter = Number(counterText);
  assert.ok(
    Number.isSafeInteger(counter),
    `Unsafe release counter: ${counterText}`,
  );
  return { base, counter };
};

export const validateVersionBase = (
  version: string,
  upstreamVersion: string,
) => {
  parseBase(upstreamVersion);
  assert.equal(
    parseVersion(version).base,
    upstreamVersion,
    "Package base differs from upstream.ts; prepare a release before building",
  );
};

export const nextVersion = (version: string, upstreamVersion: string) => {
  const { base, counter } = parseVersion(version);
  const current = parseBase(base);
  const target = parseBase(upstreamVersion);
  const difference =
    target
      .map((part, index) => part - current[index])
      .find((part) => part !== 0) ?? 0;
  assert.ok(
    difference >= 0,
    `Stale upstream base ${upstreamVersion}: package already uses ${base}`,
  );
  const nextCounter = difference > 0 ? 1 : counter + 1;
  assert.ok(Number.isSafeInteger(nextCounter), "Release counter exhausted");
  return `${upstreamVersion}-overmux.${nextCounter}`;
};

export const releaseNote = (contents: string, filename: string) => {
  assert.ok(
    contents.trimStart().startsWith("---\n") ||
      contents.trimStart().startsWith("---\r\n"),
    `${filename}: expected changeset frontmatter`,
  );
  const { releases, summary } = parseChangeset(contents);
  assert.ok(
    releases.length === 1 &&
      releases[0].name === packageName &&
      releases[0].type === "patch",
    `${filename}: only a patch for ${packageName} is allowed`,
  );
  assert.ok(summary.trim(), `${filename}: release note must not be empty`);
  return summary;
};
