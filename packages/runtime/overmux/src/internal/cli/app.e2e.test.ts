import { fileURLToPath } from "node:url";
import { describe, expect, it, test as testCases } from "vitest";

import { runCli } from "../testing/e2e-utils";

const docsRoot = fileURLToPath(new URL("../../../docs", import.meta.url));

describe("Overmux CLI", () => {
  it("documents runtime, init, docs, desktop, and integration commands", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(/^\s+ai\s/m);
    expect(result.stdout).toContain("serve");
    expect(result.stdout).toContain("check");
    expect(result.stdout).toContain("call");
    expect(result.stdout).toContain("desktop");
    expect(result.stdout).toContain("docs");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("integration");
    expect(result.stdout).toContain("instance");
  });

  testCases.each([
    { args: ["call", "--help"], expected: "--input" },
    { args: ["instance", "--help"], expected: "--json" },
    { args: ["instance", "--help"], expected: "--port" },
    { args: ["check", "--help"], expected: "--config" },
    { args: ["desktop", "install", "--help"], expected: "--yes" },
    { args: ["serve", "--help"], expected: "--login" },
    { args: ["serve", "--help"], expected: "--no-login" },
    { args: ["serve", "--help"], expected: "--production" },
    {
      args: ["integration", "install", "zellij", "--help"],
      expected: "--session",
    },
  ])("documents command flags: $expected", async ({ args, expected }) => {
    const result = await runCli(args);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(expected);
  });

  testCases.each([
    {
      args: ["start", "--help"],
      expected: "No command registered for `start`",
    },
    {
      args: ["ai", "context", "--help"],
      expected: "No command registered for `ai`",
    },
    { args: ["check", "--port", "8080"], expected: "--port" },
    { args: ["instance", "--port", "0"], expected: "Invalid port: 0" },
    {
      args: ["call", "taskFinished", "--port", "0"],
      expected: "Invalid port: 0",
    },
    {
      args: ["call", "taskFinished", "--port", "4242", "--input", "{"],
      expected: "Operation input must be valid JSON",
    },
    {
      args: ["events", "send", "--help"],
      expected: "No command registered for `events`",
    },
    {
      args: ["serve", "--login", "--no-login"],
      expected: "Only set one of: --login and --no-login",
    },
  ])(
    "rejects invalid or misplaced flags: $expected",
    async ({ args, expected }) => {
      const result = await runCli(args);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(expected);
    },
  );

  it("prints the absolute installed documentation path", async () => {
    const result = await runCli(["docs", "path"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${docsRoot}\n`);
  });

  it("shows standard help for the docs path command", async () => {
    const result = await runCli(["docs", "path", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("overmux docs path");
    expect(result.stdout).toContain(
      "Print the installed documentation directory",
    );
    expect(result.stdout).not.toContain("--path");
    expect(result.stdout).not.toContain("topic");
  });

  testCases.each(["configuration", "context", "--path"])(
    "rejects removed docs input: %s",
    async (input) => {
      const result = await runCli(["docs", input]);

      expect(result.exitCode).not.toBe(0);
    },
  );

  testCases.each([
    { args: [], name: "bare command" },
    { args: ["--help"], name: "explicit help" },
  ])("shows docs subcommand help for $name", async ({ args }) => {
    const result = await runCli(["docs", ...args]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("overmux docs path");
    expect(result.stdout).toContain("overmux docs ai-context");
  });

  testCases.each([
    { args: [], expected: "overmux serve", name: "root" },
    { args: ["auth"], expected: "overmux auth login", name: "auth" },
  ])("shows $name help by default", async ({ args, expected }) => {
    const result = await runCli(args);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(expected);
  });

  it("does not accept startup flags without serve", async () => {
    const result = await runCli(["--port", "70000"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--port");
  });

  it("treats inputs after -- as positional arguments", async () => {
    const result = await runCli(["check", "--", "--json"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--json");
  });
});
