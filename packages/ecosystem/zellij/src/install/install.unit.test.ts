import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { installZellijWithDependencies, runInstallHandshake } from "./install";

type FakeInstallProcess = EventEmitter & {
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
  stderr: PassThrough;
  stdin: PassThrough;
  stdout: PassThrough;
};

const createProcess = (): FakeInstallProcess => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    kill: vi.fn(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
  });
  child.kill.mockImplementation((signal: NodeJS.Signals) => {
    queueMicrotask(() => {
      if (child.exitCode === null) {
        child.exitCode = 1;
        child.emit("exit", null, signal);
      }
    });
    return true;
  });
  return child;
};

const completeInstall = (child: FakeInstallProcess, connectionId: string) => {
  child.stdout.write(
    `${JSON.stringify({
      connectionId,
      pluginId: 4,
      pluginVersion: "0.0.1",
      protocolVersion: 1,
      type: "hello",
    })}\n${JSON.stringify({
      connectionId,
      protocolVersion: 1,
      type: "install_ok",
    })}\n${JSON.stringify({
      connectionId,
      protocolVersion: 1,
      type: "bye",
    })}\n`,
  );
  child.exitCode = 0;
  child.emit("exit", 0, null);
};

describe("Zellij install handshake", () => {
  it("installs into an explicitly selected session with unique plugin configuration", async () => {
    const child = createProcess();
    child.stdin.once("data", (chunk: Buffer) => {
      const message = JSON.parse(chunk.toString("utf8")) as {
        connectionId: string;
      };
      queueMicrotask(() => completeInstall(child, message.connectionId));
    });
    const spawnPlugin = vi.fn(() => child as never);
    const originalCurrentSession = process.env.ZELLIJ_SESSION_NAME;
    Reflect.deleteProperty(process.env, "ZELLIJ_SESSION_NAME");

    const result = await installZellijWithDependencies(
      { session: "beta" },
      {
        closePermissionPane: async () => undefined,
        installArtifact: async () => ({
          artifactPath: "/data/overmux/zellij/overmux.wasm",
          pluginVersion: "0.0.1",
          protocolVersion: 1,
          replaced: false,
          sha256: "abc",
          supportedZellijVersion: "0.45.1",
        }),
        launchPermissionPane: async () => "plugin_1",
        listPaneIds: async () => [],
        listSessions: async () => ["alpha", "beta"],
        spawnPlugin,
        timeoutMs: 1_000,
      },
    );
    if (originalCurrentSession === undefined) {
      Reflect.deleteProperty(process.env, "ZELLIJ_SESSION_NAME");
    } else {
      process.env.ZELLIJ_SESSION_NAME = originalCurrentSession;
    }

    expect(result).toMatchObject({ session: "beta", pluginVersion: "0.0.1" });
    expect(spawnPlugin).toHaveBeenCalledWith(
      expect.arrayContaining([
        "--session",
        "beta",
        "--plugin-configuration",
        expect.stringMatching(/^connection_id=/u),
      ]),
    );
  });

  it("waits for the specific floating permission pane before starting the pipe", async () => {
    vi.useFakeTimers();
    const child = createProcess();
    const launchPermissionPane = vi.fn<
      (args: readonly string[]) => Promise<string>
    >(async () => "plugin_7");
    const listPaneIds = vi
      .fn<() => Promise<readonly string[]>>()
      .mockResolvedValueOnce(["plugin_7"])
      .mockResolvedValueOnce([]);
    child.stdin.once("data", (chunk: Buffer) => {
      const { connectionId } = JSON.parse(chunk.toString("utf8")) as {
        connectionId: string;
      };
      queueMicrotask(() => completeInstall(child, connectionId));
    });
    const installed = installZellijWithDependencies(
      {},
      {
        closePermissionPane: async () => undefined,
        installArtifact: async () => ({
          artifactPath: "/data/overmux/zellij/overmux.wasm",
          pluginVersion: "0.0.1",
          protocolVersion: 1,
          replaced: false,
          sha256: "abc",
          supportedZellijVersion: "0.45.1",
        }),
        launchPermissionPane,
        listPaneIds,
        listSessions: async () => ["alpha"],
        spawnPlugin: () => child as never,
        timeoutMs: 2_000,
      },
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await installed;
    expect(launchPermissionPane).toHaveBeenCalledWith(
      expect.arrayContaining([
        "new-pane",
        "--floating",
        "--configuration",
        "purpose=install",
      ]),
      expect.any(AbortSignal),
    );
    expect(launchPermissionPane.mock.calls[0]?.[0]).not.toContain("--no-focus");
    expect(listPaneIds).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("fails boundedly if the permission pane does not close", async () => {
    vi.useFakeTimers();
    const closePermissionPane = vi.fn(async () => undefined);
    const spawnPlugin = vi.fn();
    const installed = installZellijWithDependencies(
      {},
      {
        closePermissionPane,
        installArtifact: async () => ({
          artifactPath: "/data/overmux/zellij/overmux.wasm",
          pluginVersion: "0.0.1",
          protocolVersion: 1,
          replaced: false,
          sha256: "abc",
          supportedZellijVersion: "0.45.1",
        }),
        launchPermissionPane: async () => "plugin_7",
        listPaneIds: async () => ["plugin_7"],
        listSessions: async () => ["alpha"],
        spawnPlugin,
        timeoutMs: 2_000,
      },
    );
    const rejection = expect(installed).rejects.toThrow(
      "waiting for Zellij permission approval",
    );

    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
    expect(closePermissionPane).toHaveBeenCalledWith(
      "alpha",
      "plugin_7",
      expect.any(AbortSignal),
    );
    expect(spawnPlugin).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("bounds session listing with installer cancellation", async () => {
    const controller = new AbortController();
    const listSessions = vi.fn(
      (_signal?: AbortSignal) =>
        new Promise<readonly string[]>(() => undefined),
    );
    const installed = installZellijWithDependencies(
      { signal: controller.signal },
      {
        closePermissionPane: async () => undefined,
        installArtifact: async () => ({
          artifactPath: "/data/overmux/zellij/overmux.wasm",
          pluginVersion: "0.0.1",
          protocolVersion: 1,
          replaced: false,
          sha256: "abc",
          supportedZellijVersion: "0.45.1",
        }),
        launchPermissionPane: async () => "plugin_7",
        listPaneIds: async () => [],
        listSessions,
        spawnPlugin: vi.fn(),
        timeoutMs: 1_000,
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(installed).rejects.toMatchObject({ name: "AbortError" });
    expect(listSessions).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("bounds permission pane launch with the installer deadline", async () => {
    vi.useFakeTimers();
    const launchPermissionPane = vi.fn(
      (_args: readonly string[], _signal?: AbortSignal) =>
        new Promise<string>(() => undefined),
    );
    const installed = installZellijWithDependencies(
      {},
      {
        closePermissionPane: async () => undefined,
        installArtifact: async () => ({
          artifactPath: "/data/overmux/zellij/overmux.wasm",
          pluginVersion: "0.0.1",
          protocolVersion: 1,
          replaced: false,
          sha256: "abc",
          supportedZellijVersion: "0.45.1",
        }),
        launchPermissionPane,
        listPaneIds: async () => [],
        listSessions: async () => ["alpha"],
        spawnPlugin: vi.fn(),
        timeoutMs: 100,
      },
    );
    const rejection = expect(installed).rejects.toThrow(
      "Timed out after 100ms",
    );

    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(launchPermissionPane).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(AbortSignal),
    );
    vi.useRealTimers();
  });

  it("closes its exact permission pane when cancelled during pane listing", async () => {
    const controller = new AbortController();
    const closePermissionPane = vi.fn(async () => undefined);
    const installed = installZellijWithDependencies(
      { signal: controller.signal },
      {
        closePermissionPane,
        installArtifact: async () => ({
          artifactPath: "/data/overmux/zellij/overmux.wasm",
          pluginVersion: "0.0.1",
          protocolVersion: 1,
          replaced: false,
          sha256: "abc",
          supportedZellijVersion: "0.45.1",
        }),
        launchPermissionPane: async () => "plugin_7",
        listPaneIds: () => new Promise(() => undefined),
        listSessions: async () => ["alpha"],
        spawnPlugin: vi.fn(),
        timeoutMs: 1_000,
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(installed).rejects.toMatchObject({ name: "AbortError" });
    expect(closePermissionPane).toHaveBeenCalledWith(
      "alpha",
      "plugin_7",
      expect.any(AbortSignal),
    );
  });

  it("closes its known permission pane when the handshake is cancelled", async () => {
    const child = createProcess();
    const controller = new AbortController();
    const closePermissionPane = vi.fn(async () => undefined);
    const spawnPlugin = vi.fn(() => child as never);
    const installed = installZellijWithDependencies(
      { signal: controller.signal },
      {
        closePermissionPane,
        installArtifact: async () => ({
          artifactPath: "/data/overmux/zellij/overmux.wasm",
          pluginVersion: "0.0.1",
          protocolVersion: 1,
          replaced: false,
          sha256: "abc",
          supportedZellijVersion: "0.45.1",
        }),
        launchPermissionPane: async () => "plugin_7",
        listPaneIds: async () => [],
        listSessions: async () => ["alpha"],
        spawnPlugin,
        timeoutMs: 1_000,
      },
    );
    await vi.waitFor(() => expect(spawnPlugin).toHaveBeenCalledOnce());

    controller.abort();

    await expect(installed).rejects.toMatchObject({ name: "AbortError" });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(closePermissionPane).toHaveBeenCalledWith(
      "alpha",
      "plugin_7",
      expect.any(AbortSignal),
    );
  });

  it("sends init and waits for hello, install_ok, and clean process exit", async () => {
    const child = createProcess();
    const input: Buffer[] = [];
    child.stdin.on("data", (chunk: Buffer) => input.push(chunk));
    const result = runInstallHandshake({
      connectionId: "connection-1",
      process: child as never,
      timeoutMs: 1_000,
    });

    completeInstall(child, "connection-1");

    await expect(result).resolves.toEqual({ pluginVersion: "0.0.1" });
    expect(Buffer.concat(input).toString("utf8")).toContain(
      '"purpose":"install"',
    );
    expect(Buffer.concat(input).toString("utf8")).toContain(
      '"type":"shutdown"',
    );
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects an incompatible protocol and terminates its owned process", async () => {
    const child = createProcess();
    const result = runInstallHandshake({
      connectionId: "connection-1",
      process: child as never,
      timeoutMs: 1_000,
    });

    const rejection = expect(result).rejects.toThrow(
      "protocol 2 is incompatible",
    );
    child.stdout.write(
      '{"type":"hello","protocolVersion":2,"connectionId":"connection-1","pluginVersion":"0.0.1"}\n',
    );

    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("makes malformed output terminal within its stdout chunk", async () => {
    const child = createProcess();
    const result = runInstallHandshake({
      connectionId: "connection-1",
      process: child as never,
      timeoutMs: 1_000,
    });
    child.stdout.write(
      'not-json\n{"type":"hello","protocolVersion":1,"connectionId":"connection-1","pluginId":4,"pluginVersion":"0.0.1"}\n',
    );

    await expect(result).rejects.toThrow("malformed output");
    expect(child.stdin.read()?.toString("utf8")).not.toContain("shutdown");
  });

  it("decodes protocol messages split inside a UTF-8 character", async () => {
    const child = createProcess();
    const result = runInstallHandshake({
      connectionId: "connection-1",
      process: child as never,
      timeoutMs: 1_000,
    });
    const hello = Buffer.from(
      '{"type":"hello","protocolVersion":1,"connectionId":"connection-1","pluginId":4,"pluginVersion":"v🌍"}\n',
    );
    const splitAt = hello.indexOf(Buffer.from("🌍")) + 2;
    child.stdout.write(hello.subarray(0, splitAt));
    child.stdout.write(hello.subarray(splitAt));
    child.stdout.write(
      '{"type":"install_ok","protocolVersion":1,"connectionId":"connection-1"}\n{"type":"bye","protocolVersion":1,"connectionId":"connection-1"}\n',
    );
    child.exitCode = 0;
    child.emit("exit", 0, null);

    await expect(result).resolves.toEqual({ pluginVersion: "v🌍" });
  });

  it("times out an unanswered permission prompt and terminates the pipe", async () => {
    vi.useFakeTimers();
    const child = createProcess();
    const result = runInstallHandshake({
      connectionId: "connection-1",
      process: child as never,
      timeoutMs: 50,
    });

    const rejection = expect(result).rejects.toThrow("permission approval");
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    vi.useRealTimers();
  });

  it("escalates from TERM to KILL and waits boundedly for child exit", async () => {
    vi.useFakeTimers();
    const child = createProcess();
    child.kill.mockReset().mockReturnValue(true);
    const result = runInstallHandshake({
      connectionId: "connection-1",
      process: child as never,
      timeoutMs: 10_000,
    });
    child.stdout.write("not-json\n");
    const rejection = expect(result).rejects.toThrow("malformed output");

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    vi.useRealTimers();
  });

  it("honors cancellation and terminates only its owned pipe", async () => {
    const child = createProcess();
    const controller = new AbortController();
    const result = runInstallHandshake({
      connectionId: "connection-1",
      process: child as never,
      signal: controller.signal,
      timeoutMs: 1_000,
    });

    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();

    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
