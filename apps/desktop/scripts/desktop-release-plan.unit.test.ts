import { execFileSync, spawnSync } from "node:child_process";
import {
  beforeEach,
  describe,
  expect,
  it,
  test as testCases,
  vi,
} from "vitest";

import {
  assertDesktopTagCommit,
  detectDesktopRelease,
  findDesktopVersionCommit,
  getDesktopChangelogEntry,
  prepareDesktopRelease,
  readDesktopReleaseState,
  validateDesktopReleaseCommit,
} from "./desktop-release-plan";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}));

const releaseCommit = "a".repeat(40);
const laterCommit = "b".repeat(40);
const previousCommit = "c".repeat(40);
const tag = "desktop-v1.2.3";
const changelog =
  "# @overmux/desktop\n\n## 1.2.3\n\n### Patch Changes\n\n- Fixed desktop.\n\n## 1.2.2\n\n- Older change.\n";
const history = [
  { commit: laterCommit, version: "1.2.3" },
  { commit: releaseCommit, version: "1.2.3" },
  { commit: previousCommit, version: "1.2.2" },
];

const mockGithub = (
  state: "missing" | "draft" | "public",
  ciSuccess = true,
) => {
  vi.mocked(spawnSync).mockImplementation((_command, args) => {
    const endpoint = String(args?.[1]);
    const body = endpoint.includes("/actions/")
      ? { workflow_runs: ciSuccess ? [{}] : [] }
      : state === "missing"
        ? { status: "404" }
        : { draft: state === "draft" };
    return {
      status: Object.hasOwn(body, "status") ? 1 : 0,
      stdout: JSON.stringify(body),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    };
  });
};

const mockGit = ({
  head = laterCommit,
  taggedCommit,
}: { head?: string; taggedCommit?: string } = {}) => {
  vi.mocked(execFileSync).mockImplementation((_command, args) => {
    const [command, argument] = args ?? [];
    if (command === "rev-parse") {
      return argument === "HEAD" ? head : (taggedCommit ?? "");
    }
    if (command === "log") {
      return history.map(({ commit }) => commit).join("\n");
    }
    if (command === "show") {
      return String(argument).endsWith("CHANGELOG.md")
        ? changelog
        : JSON.stringify(
            history.find(({ commit }) => String(argument).startsWith(commit)),
          );
    }
    if (command === "ls-remote") {
      return taggedCommit ? `${taggedCommit}\trefs/tags/${tag}` : "";
    }
    return "";
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockGithub("missing");
  mockGit();
});

describe("desktop release source", () => {
  it("pins the version introduction, not later same-version manifest changes", () => {
    expect(findDesktopVersionCommit(history, "1.2.3")).toBe(releaseCommit);
    expect(() => findDesktopVersionCommit(history, "2.0.0")).toThrow(
      "does not start",
    );
  });

  it("extracts only the matching Changesets version entry", () => {
    expect(
      getDesktopChangelogEntry(changelog.replaceAll("\n", "\r\n"), "1.2.3"),
    ).toBe("### Patch Changes\n\n- Fixed desktop.");
    expect(getDesktopChangelogEntry(changelog, "1.2.2")).toBe(
      "- Older change.",
    );
    expect(() => getDesktopChangelogEntry(changelog, "1.2")).toThrow(
      "missing an entry",
    );
  });

  testCases.each([undefined, releaseCommit])(
    "accepts a missing or matching tag: %s",
    (actual) => {
      expect(() => assertDesktopTagCommit(actual, releaseCommit)).not.toThrow();
    },
  );

  it("rejects conflicting tags without moving them", () => {
    mockGit({ taggedCommit: laterCommit });
    expect(() => detectDesktopRelease("1.2.3")).toThrow("refusing to move it");
    expect(execFileSync).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["push"]),
      expect.anything(),
    );
  });

  testCases.each(["missing", "draft"] as const)(
    "retries %s releases from the original commit on later main",
    (state) => {
      mockGithub(state);
      mockGit({ taggedCommit: state === "draft" ? releaseCommit : undefined });
      detectDesktopRelease("1.2.3");
      expect(console.log).toHaveBeenCalledWith(
        `should_release=true\nrelease_commit=${releaseCommit}\nrelease_tag=${tag}`,
      );
    },
  );

  it("skips public versions before inspecting potentially conflicting history/tags", () => {
    mockGithub("public");
    detectDesktopRelease("1.2.3");
    prepareDesktopRelease(tag, releaseCommit);
    expect(execFileSync).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("should_release=false");
  });

  it("does not treat authentication or API failures as a missing release", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: '{"status":"403"}',
      stderr: "Forbidden",
      pid: 1,
      output: [],
      signal: null,
    });
    expect(() => readDesktopReleaseState(tag)).toThrow("GitHub request failed");
  });

  it("requires successful CI for the original release commit", () => {
    mockGithub("missing", false);
    expect(() => detectDesktopRelease("1.2.3")).toThrow(
      `No successful main CI push run for ${releaseCommit}`,
    );
  });

  it("creates a missing tag at the exact checkout, and reuses an existing draft tag", () => {
    mockGit({ head: releaseCommit });
    prepareDesktopRelease(tag, releaseCommit);
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["push", "origin", `${releaseCommit}:refs/tags/${tag}`],
      expect.anything(),
    );
    vi.mocked(execFileSync).mockClear();
    mockGithub("draft");
    mockGit({ head: releaseCommit, taggedCommit: releaseCommit });
    prepareDesktopRelease(tag, releaseCommit);
    expect(execFileSync).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["push"]),
      expect.anything(),
    );
  });

  it("rejects nonexact build checkouts and missing build tags", () => {
    expect(() => validateDesktopReleaseCommit({ tag, commit: "main" })).toThrow(
      "full commit SHA",
    );
    expect(() =>
      validateDesktopReleaseCommit({ tag, commit: releaseCommit }),
    ).toThrow("checkout does not match");
    mockGit({ head: releaseCommit });
    expect(() =>
      validateDesktopReleaseCommit({ tag, commit: releaseCommit }),
    ).toThrow("tag desktop-v1.2.3 is missing");
  });
});
