import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  test as testCases,
  vi,
} from "vitest";

import { initializeOvermux, type InitDependencies } from "./init";

const testDirectory = resolve(
  import.meta.dirname,
  "../../../../../../../.test-tmp/init-command",
);
const targetDirectory = resolve(testDirectory, "target");

type CommandCall = {
  args: readonly string[];
  command: string;
};

const commandSucceeded = (stdout = "") => ({ status: 0, stderr: "", stdout });

const commandMissing = () => ({
  error: Object.assign(new Error("missing"), { code: "ENOENT" }),
  status: null,
  stderr: "",
  stdout: "",
});

const createDependencies = ({
  mise = "active",
  pnpmVersion = "10.12.0",
}: {
  mise?: "absent" | "active" | "doctor-fails" | "inactive";
  pnpmVersion?: "absent" | string;
} = {}) => {
  const calls: CommandCall[] = [];
  const output: string[] = [];
  const installWorkspaces: string[] = [];
  const runCommand: InitDependencies["runCommand"] = vi.fn(
    (command, args, options) => {
      calls.push({ args, command });
      if (command === "mise" && args[0] === "--version") {
        return mise === "absent"
          ? commandMissing()
          : commandSucceeded("mise 1.0.0");
      }
      if (command === "mise" && args[0] === "doctor") {
        if (mise === "doctor-fails") {
          return { ...commandSucceeded(), status: 1, stderr: "doctor failed" };
        }
        return commandSucceeded(
          JSON.stringify({ activated: mise === "active" }),
        );
      }
      if (command === "pnpm" && args[0] === "--version") {
        return pnpmVersion === "absent"
          ? commandMissing()
          : commandSucceeded(pnpmVersion);
      }
      if (
        options?.cwd &&
        ((command === "pnpm" && args[0] === "install") ||
          (command === "mise" &&
            args.includes("pnpm") &&
            args.includes("install")))
      ) {
        installWorkspaces.push(
          readFileSync(resolve(options.cwd, "pnpm-workspace.yaml"), "utf8"),
        );
        writeFileSync(
          resolve(options.cwd, "pnpm-lock.yaml"),
          "lockfileVersion: '9.0'\n",
        );
      }
      return commandSucceeded();
    },
  );
  const dependencies: InitDependencies = {
    directory: targetDirectory,
    getLatestOvermuxVersion: vi.fn(async () => "1.2.3"),
    runCommand,
    stderr: { write: () => true },
    stdout: { write: (text) => output.push(text) },
  };
  return { calls, dependencies, installWorkspaces, output };
};

beforeEach(() => {
  rmSync(testDirectory, { force: true, recursive: true });
  mkdirSync(testDirectory, { recursive: true });
});

afterEach(() => {
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("overmux init preflight", () => {
  testCases.each(["inactive", "doctor-fails"] as const)(
    "requires mise activation when mise is %s",
    async (mise) => {
      const { calls, dependencies } = createDependencies({ mise });
      await expect(initializeOvermux(dependencies)).rejects.toThrow(
        "https://mise.jdx.dev/getting-started.html#activate-mise",
      );

      expect(calls.map(({ command }) => command)).not.toContain("pnpm");
      expect(existsSync(targetDirectory)).toBe(false);
    },
  );

  testCases.each([
    { pnpmVersion: "9.15.0", expected: "found 9.15.0" },
    { pnpmVersion: "10.0.0", expected: "found 10.0.0" },
    { pnpmVersion: "10.4.1", expected: "found 10.4.1" },
    { pnpmVersion: "not-a-version", expected: "pnpm 10.5.0 or newer" },
    { pnpmVersion: "absent", expected: "pnpm 10.5.0 or newer" },
  ])("rejects pnpm $pnpmVersion", async ({ expected, pnpmVersion }) => {
    const { dependencies } = createDependencies({
      mise: "absent",
      pnpmVersion,
    });
    await expect(initializeOvermux(dependencies)).rejects.toThrow(expected);

    expect(existsSync(targetDirectory)).toBe(false);
    expect(dependencies.getLatestOvermuxVersion).not.toHaveBeenCalled();
  });

  it("does not mutate the target when the npm version lookup fails", async () => {
    const { dependencies } = createDependencies();
    dependencies.getLatestOvermuxVersion = vi.fn(async () => {
      throw new Error("registry unavailable");
    });
    await expect(initializeOvermux(dependencies)).rejects.toThrow(
      "registry unavailable",
    );

    expect(existsSync(targetDirectory)).toBe(false);
  });
});

describe("overmux init scaffold", () => {
  it("generates and validates the mise project with exact Overmux pins", async () => {
    const { calls, dependencies, output } = createDependencies();
    await initializeOvermux(dependencies);

    const packageDefinition = JSON.parse(
      readFileSync(resolve(targetDirectory, "package.json"), "utf8"),
    );
    expect(packageDefinition).toMatchObject({
      name: "my-overmux",
      dependencies: { overmux: "1.2.3" },
      scripts: {
        build: "vite build",
        check: "overmux check --config ./overmux.config.ts",
        dev: "overmux serve --config ./overmux.config.ts",
      },
    });
    expect(readFileSync(resolve(targetDirectory, "mise.toml"), "utf8")).toBe(
      '[tools]\nnode = "22"\npnpm = "10"\n"npm:overmux" = "1.2.3"\n',
    );
    expect(readFileSync(resolve(targetDirectory, "AGENTS.md"), "utf8")).toBe(
      "Immediately run `overmux docs ai-context` for documentation about Overmux.\n",
    );
    expect(readFileSync(resolve(targetDirectory, "CLAUDE.md"), "utf8")).toBe(
      "@AGENTS.md\n",
    );
    expect(
      readFileSync(resolve(targetDirectory, "src/server/index.ts"), "utf8"),
    ).toContain("defineOvermuxServer({ resources: {} })");
    expect(
      readFileSync(resolve(targetDirectory, "src/ui/app.tsx"), "utf8"),
    ).toContain("Overmux is running.");
    expect(
      readFileSync(resolve(targetDirectory, "src/ui/index.html"), "utf8"),
    ).toContain('onclick="location.reload()">Retry</button>');
    expect(
      readFileSync(resolve(targetDirectory, "src/ui/main.tsx"), "utf8"),
    ).toContain("OvermuxHost");
    expect(
      readFileSync(resolve(targetDirectory, "overmux.config.ts"), "utf8"),
    ).toContain('auth: { mode: "cli-login" }');
    expect(existsSync(resolve(targetDirectory, "pnpm-lock.yaml"))).toBe(true);
    expect(output.join("")).toContain("Next: overmux serve");
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["mise", "--version"],
      ["mise", "doctor", "--json"],
      ["mise", "install", "node@22", "pnpm@10", "--yes"],
      ["mise", "exec", "node@22", "pnpm@10", "--", "pnpm", "install"],
      [
        "mise",
        "exec",
        "node@22",
        "pnpm@10",
        "--",
        "pnpm",
        "exec",
        "overmux",
        "check",
        "--config",
        "./overmux.config.ts",
      ],
    ]);
  });

  it("uses pnpm 10 without generating mise.toml when mise is absent", async () => {
    const { calls, dependencies } = createDependencies({ mise: "absent" });
    await initializeOvermux(dependencies);

    expect(existsSync(resolve(targetDirectory, "mise.toml"))).toBe(false);
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["mise", "--version"],
      ["pnpm", "--version"],
      ["pnpm", "install"],
      ["pnpm", "exec", "overmux", "check", "--config", "./overmux.config.ts"],
    ]);
  });

  testCases.each([
    { mise: "active", pnpmVersion: "10.33.0" },
    { mise: "absent", pnpmVersion: "10.5.0" },
    { mise: "absent", pnpmVersion: "10.33.0" },
  ] as const)(
    "writes the node-pty allowlist before install and preserves it (mise $mise, pnpm $pnpmVersion)",
    async (toolchain) => {
      const { dependencies, installWorkspaces } = createDependencies(toolchain);

      await initializeOvermux(dependencies);

      const workspace = "onlyBuiltDependencies:\n  - node-pty\n";
      expect(installWorkspaces).toEqual([workspace]);
      expect(
        readFileSync(resolve(targetDirectory, "pnpm-workspace.yaml"), "utf8"),
      ).toBe(workspace);
    },
  );

  testCases.each(["AGENTS.md", "pnpm-workspace.yaml"])(
    "fails without mutation when %s exists",
    async (path) => {
      mkdirSync(targetDirectory, { recursive: true });
      const existingPath = resolve(targetDirectory, path);
      writeFileSync(existingPath, "keep me");
      const { dependencies } = createDependencies();
      await expect(initializeOvermux(dependencies)).rejects.toThrow(
        `Refusing to overwrite existing files:\n- ${path}`,
      );

      expect(readFileSync(existingPath, "utf8")).toBe("keep me");
      expect(dependencies.runCommand).not.toHaveBeenCalled();
      expect(dependencies.getLatestOvermuxVersion).not.toHaveBeenCalled();
    },
  );

  it("preserves unrelated files", async () => {
    mkdirSync(targetDirectory, { recursive: true });
    writeFileSync(resolve(targetDirectory, "notes.txt"), "keep");
    const { dependencies } = createDependencies({ mise: "absent" });

    await initializeOvermux(dependencies);

    expect(existsSync(resolve(targetDirectory, "package.json"))).toBe(true);
    expect(readFileSync(resolve(targetDirectory, "notes.txt"), "utf8")).toBe(
      "keep",
    );
  });

  it("does not expose a partially initialized target when install fails", async () => {
    const { dependencies } = createDependencies({ mise: "absent" });
    dependencies.runCommand = vi.fn((command, args) => {
      if (command === "mise") {
        return commandMissing();
      }
      if (args[0] === "--version") {
        return commandSucceeded("10.5.0");
      }
      return { ...commandSucceeded(), status: 1, stderr: "install failed" };
    });
    await expect(initializeOvermux(dependencies)).rejects.toThrow(
      "Command failed",
    );

    expect(existsSync(targetDirectory)).toBe(false);
    expect(readdirSync(testDirectory)).toEqual([]);
  });
});
