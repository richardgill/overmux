import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createAuthService } from "../../server/auth/auth-service";
import {
  discoverInstance,
  startInstanceControl,
} from "../../server/auth/instance-control";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin.ts", import.meta.url));
const initialRuntimeDirectory = process.env.XDG_RUNTIME_DIR;
const cleanups: (() => Promise<void>)[] = [];

const runCli = (...args: string[]) =>
  execFileAsync(process.execPath, [
    "--import",
    "jiti/register",
    cliPath,
    ...args,
  ]);

const startControl = async () => {
  const directory = await mkdtemp(join(tmpdir(), "overmux-auth-cli-"));
  process.env.XDG_RUNTIME_DIR = join(
    directory,
    "long-runtime-directory".repeat(6),
  );
  const auth = createAuthService({
    config: { mode: "cli-login" },
    environment: { XDG_DATA_HOME: directory },
    homeDirectory: "/unused",
  });
  const url = "http://127.0.0.1:4242";
  auth.setOrigins([url, "https://machine.example.com"]);
  const control = await startInstanceControl({
    auth,
    apiUrl: url,
    instanceId: "auth-cli-test",
    port: 4242,
    url,
  });
  cleanups.push(async () => {
    await control.close();
    await rm(directory, { force: true, recursive: true });
  });
  return { auth, registration: await discoverInstance(4242) };
};

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  if (initialRuntimeDirectory === undefined) {
    Reflect.deleteProperty(process.env, "XDG_RUNTIME_DIR");
  } else {
    process.env.XDG_RUNTIME_DIR = initialRuntimeDirectory;
  }
});

describe("auth CLI", () => {
  it("creates, lists, and revokes sessions without printing secrets in lists", async () => {
    const { auth, registration } = await startControl();
    expect((await stat(dirname(registration.controlSocket))).mode & 0o777).toBe(
      0o700,
    );
    expect((await stat(registration.controlSocket)).mode & 0o777).toBe(0o600);
    const loginOutput = await runCli("auth", "login", "--json");
    expect(loginOutput.stderr).toBe("");
    const login = JSON.parse(loginOutput.stdout) as {
      code: string;
      expiresAt: string;
      id: string;
      urls: string[];
    };
    expect(login).toMatchObject({
      code: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
      urls: [
        expect.stringMatching(/^http:\/\/127\.0\.0\.1:4242\/login#ticket=/),
        expect.stringMatching(
          /^https:\/\/machine\.example\.com\/login#ticket=/,
        ),
      ],
    });
    expect(new URL(login.urls[0]!).hash).toBe(new URL(login.urls[1]!).hash);
    const authenticated = await auth.consumeLoginGrant({
      code: login.code,
      origin: "http://127.0.0.1:4242",
    });
    if (authenticated.status !== "authenticated") {
      throw new Error("Expected the CLI grant to authenticate");
    }

    const listOutput = await runCli("auth", "list", "--json", "--port", "4242");
    const listed = JSON.parse(listOutput.stdout) as {
      sessions: { expiresAt?: string; id: string }[];
    };
    expect(listed.sessions).toEqual([
      expect.objectContaining({ id: authenticated.session.id }),
    ]);
    expect(listOutput.stdout).not.toContain(authenticated.token);
    expect(listed.sessions[0]).not.toHaveProperty("tokenHash");

    const revokeOutput = await runCli(
      "auth",
      "revoke",
      authenticated.session.id,
      "--json",
      "--port",
      "4242",
    );
    expect(JSON.parse(revokeOutput.stdout)).toEqual({ revoked: 1 });
    expect(
      await auth.authenticateToken(
        authenticated.token,
        "http://127.0.0.1:4242",
      ),
    ).toBeUndefined();
  }, 30_000);

  it("prints every URL by default and keeps singular format flags concise", async () => {
    await startControl();

    const standard = await runCli("auth", "login");
    const codeOnly = await runCli("auth", "login", "--code");
    const urlOnly = await runCli("auth", "login", "--url");
    const conflicting = await runCli("auth", "login", "--code", "--url").catch(
      (cause: unknown) => cause as { stderr: string },
    );

    expect(standard.stdout).toContain(
      "Login URLs:\n  http://127.0.0.1:4242/login#ticket=",
    );
    expect(standard.stdout).toContain(
      "  https://machine.example.com/login#ticket=",
    );
    expect(standard.stdout).not.toContain("Need another grant?");
    expect(codeOnly.stdout.trim()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(codeOnly.stderr).toBe("");
    expect(urlOnly.stdout.trim()).toMatch(
      /^http:\/\/127\.0\.0\.1:4242\/login#ticket=/,
    );
    expect(urlOnly.stderr).toBe("");
    expect(conflicting.stderr).toContain(
      "Only set one of: --code, --url, and --json",
    );
  }, 15_000);

  it("revokes all when there are no browser sessions", async () => {
    await startControl();

    const { stdout } = await runCli("auth", "revoke", "--all", "--json");

    expect(JSON.parse(stdout)).toEqual({ revoked: 0 });
  });
});
