import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, test as testCases, vi } from "vitest";

import { createAuthService } from "./auth-service";
import {
  discoverInstance,
  runtimeDirectory,
  sendControlRequest,
  startInstanceControl,
  type InstanceControl,
} from "./instance-control";

const directories: string[] = [];
const controls: InstanceControl[] = [];

const createTestDirectory = async () => {
  await mkdir(".test-tmp", { recursive: true });
  const directory = await mkdtemp(".test-tmp/ic-");
  directories.push(directory);
  return directory;
};

const createControlFixture = async () => {
  const directory = await createTestDirectory();
  // The unique long XDG path gives every fixture its own hashed /tmp fallback,
  // never the real user's /tmp/overmux-<uid> directory.
  vi.stubEnv("XDG_RUNTIME_DIR", resolve(directory, "runtime".repeat(12)));
  const runtime = runtimeDirectory();
  directories.push(runtime);
  const auth = createAuthService({
    config: { mode: "cli-login" },
    environment: { XDG_DATA_HOME: resolve(directory) },
    homeDirectory: "/unused",
  });
  const url = "http://127.0.0.1:4242";
  auth.setOrigins([url]);
  return {
    auth,
    directory,
    runtime,
    options: { auth, apiUrl: url, instanceId: "control-test", port: 4242, url },
  };
};

const startControl = async () => {
  const fixture = await createControlFixture();
  controls.push(await startInstanceControl(fixture.options));
  return { ...fixture, registration: await discoverInstance(4242) };
};

afterEach(async () => {
  await Promise.all(controls.splice(0).map((control) => control.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runtime directory selection", () => {
  testCases.each([
    { name: "unset XDG", xdg: undefined, expected: "/tmp/overmux-12345" },
    { name: "empty XDG", xdg: "", expected: "/tmp/overmux-12345" },
    { name: "relative XDG", xdg: "relative", expected: "/tmp/overmux-12345" },
    {
      name: "absolute XDG",
      xdg: "/run/user/12345",
      expected: "/run/user/12345/overmux",
    },
    {
      name: "80 ASCII bytes",
      xdg: `/${"a".repeat(71)}`,
      expected: `/${"a".repeat(71)}/overmux`,
    },
    {
      name: "80 UTF-8 bytes",
      xdg: `/${"é".repeat(35)}a`,
      expected: `/${"é".repeat(35)}a/overmux`,
    },
  ])("uses $name", ({ xdg, expected }) => {
    vi.spyOn(process, "getuid").mockReturnValue(12345);
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    vi.stubEnv("XDG_STATE_HOME", "/ignored-state");
    vi.stubEnv("TMPDIR", "/ignored-temp");
    expect(runtimeDirectory()).toBe(expected);
  });

  testCases.each([
    { name: "81 ASCII bytes", xdg: `/${"a".repeat(72)}` },
    { name: "81 UTF-8 bytes", xdg: `/${"é".repeat(36)}` },
    { name: "very long path", xdg: `/${"long/".repeat(100)}runtime` },
  ])("hashes $name independently of TMPDIR", ({ xdg }) => {
    vi.spyOn(process, "getuid").mockReturnValue(12345);
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    const hash = createHash("sha256")
      .update(`${xdg}/overmux`)
      .digest("hex")
      .slice(0, 12);
    const expected = `/tmp/overmux-12345-${hash}`;
    expect(runtimeDirectory()).toBe(expected);
    vi.stubEnv("TMPDIR", "/a/different/temp/directory");
    expect(runtimeDirectory()).toBe(expected);
  });

  it("rejects platforms without Unix user IDs", () => {
    vi.stubGlobal("process", { ...process, getuid: undefined });
    try {
      expect(runtimeDirectory).toThrow("requires a Unix user ID");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("private instance control", () => {
  it("registers a same-user socket and administers login grants and sessions", async () => {
    const { auth, registration, runtime } = await startControl();
    expect(dirname(registration.controlSocket)).toBe(runtime);
    expect(runtime).toMatch(/^\/tmp\/overmux-\d+-[a-f0-9]{12}$/);
    expect(Buffer.byteLength(registration.controlSocket)).toBeLessThanOrEqual(
      103,
    );
    const origin = registration.url;
    await expect(
      sendControlRequest(registration, { type: "get-instance" }),
    ).resolves.toEqual({ instanceId: "control-test", ok: true });

    expect((await stat(dirname(registration.controlSocket))).mode & 0o777).toBe(
      0o700,
    );
    expect((await stat(registration.controlSocket)).mode & 0o777).toBe(0o600);
    expect(
      (
        await stat(
          join(dirname(registration.controlSocket), `${registration.id}.json`),
        )
      ).mode & 0o777,
    ).toBe(0o600);

    const created = await sendControlRequest(registration, {
      type: "create-login",
    });
    const authenticated = await auth.consumeLoginGrant({
      code: created.login.code,
      origin,
    });
    if (authenticated.status !== "authenticated") {
      throw new Error(
        "Expected the control-issued login grant to authenticate",
      );
    }

    const listed = await sendControlRequest(registration, {
      type: "list-sessions",
    });
    expect(listed.sessions).toEqual([
      expect.objectContaining({ id: authenticated.session.id }),
    ]);
    expect(listed).not.toHaveProperty("sessions.0.tokenHash");

    const bearer = await sendControlRequest(registration, {
      type: "issue-bearer",
    });
    await expect(
      auth.authenticateToken(bearer.bearer.token),
    ).resolves.toMatchObject({
      kind: "local",
    });

    await expect(
      sendControlRequest(registration, {
        id: authenticated.session.id,
        type: "revoke-session",
      }),
    ).resolves.toMatchObject({ ok: true, revoked: true });
    await expect(
      auth.authenticateToken(authenticated.token, origin),
    ).resolves.toBeUndefined();
  });

  testCases.each(["symlink", "file", "wrong owner"])(
    "rejects a runtime directory that is a %s for startup and discovery",
    async (kind) => {
      if (kind === "wrong owner") {
        vi.spyOn(process, "getuid").mockReturnValue(process.getuid!() + 1);
      }
      const { directory, runtime, options } = await createControlFixture();
      if (kind === "symlink") {
        await symlink(resolve(directory), runtime);
      } else if (kind === "file") {
        await writeFile(runtime, "not a directory");
      } else {
        await mkdir(runtime);
      }
      const mode = kind === "file" ? 0o644 : 0o755;
      await chmod(runtime, mode);

      await expect(startInstanceControl(options)).rejects.toThrow();
      await expect(discoverInstance()).rejects.toThrow();
      expect((await stat(runtime)).mode & 0o777).toBe(mode);
    },
  );

  it("secures existing directories before registration and discovery", async () => {
    const { runtime, options } = await createControlFixture();
    await mkdir(runtime);
    await chmod(runtime, 0o755);
    controls.push(await startInstanceControl(options));
    expect((await stat(runtime)).mode & 0o777).toBe(0o700);

    await chmod(runtime, 0o777);
    await expect(discoverInstance(4242)).resolves.toMatchObject({ port: 4242 });
    expect((await stat(runtime)).mode & 0o777).toBe(0o700);
  });

  it("ignores symlinked and public registrations without changing permissions", async () => {
    const { directory, runtime, registration } = await startControl();
    const target = join(directory, "target.json");
    const publicRecord = join(runtime, "public.json");
    await writeFile(target, JSON.stringify(registration), { mode: 0o600 });
    await symlink(resolve(target), join(runtime, "planted.json"));
    await writeFile(publicRecord, JSON.stringify(registration));
    await chmod(publicRecord, 0o644);

    await expect(discoverInstance(4242)).resolves.toEqual(registration);
    expect((await stat(publicRecord)).mode & 0o777).toBe(0o644);
  });

  it("reports missing servers without creating the runtime directory", async () => {
    const { runtime } = await createControlFixture();
    await expect(discoverInstance()).rejects.toThrow(
      "No running Overmux server was found",
    );
    await expect(stat(runtime)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a malformed successful response", async () => {
    const directory = await createTestDirectory();
    const socketPath = join(directory, "control.sock");
    const server = createServer((socket) => {
      socket.once("data", () =>
        socket.end('{"instanceId":"INVALID","ok":true}\n'),
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    controls.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((cause) => (cause ? reject(cause) : resolve())),
        ),
    });

    await expect(
      sendControlRequest(
        {
          apiUrl: "http://127.0.0.1:4242",
          controlSocket: socketPath,
          id: "malformed-response",
          pid: process.pid,
          port: 4242,
          url: "http://127.0.0.1:4242",
        },
        { type: "get-instance" },
      ),
    ).rejects.toThrow("Invalid control response");
  });

  it("revokes every session with the revoke-all request", async () => {
    const { auth, registration } = await startControl();
    const origin = registration.url;
    const created = await sendControlRequest(registration, {
      type: "create-login",
    });
    const authenticated = await auth.consumeLoginGrant({
      code: created.login.code,
      origin,
    });
    if (authenticated.status !== "authenticated") {
      throw new Error(
        "Expected the control-issued login grant to authenticate",
      );
    }

    await expect(
      sendControlRequest(registration, { type: "revoke-all" }),
    ).resolves.toMatchObject({ count: 1, ok: true });
    await expect(
      auth.authenticateToken(authenticated.token, origin),
    ).resolves.toBeUndefined();
  });
});
