// Verifies the control client against isolated real tmux servers and native notifications.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, test as testCases, vi } from "vitest";

import { tmuxSocketArguments } from "../backend";
import { defineTmuxControlBackend } from "./backend";
import {
  createTmuxControlClient,
  type TmuxControlClient,
  type TmuxControlClientOptions,
} from "./client";

const execFileAsync = promisify(execFile);
const activeServerSockets: string[] = [];
const activeClients: TmuxControlClient[] = [];

const runTmux = (socket: string, args: readonly string[]) =>
  execFileAsync("tmux", [...tmuxSocketArguments(socket), ...args]);

const startTmuxServer = (socket: string) =>
  execFileAsync("tmux", [
    "-f",
    "/dev/null",
    ...tmuxSocketArguments(socket),
    "new-session",
    "-d",
    "-s",
    "control",
    "sh",
  ]);

const stopTmuxServer = async (socket: string) => {
  try {
    await runTmux(socket, ["kill-server"]);
  } catch (cause) {
    const stderr = (cause as { stderr?: unknown }).stderr;
    if (String(stderr).includes("no server running")) {
      return;
    }
    throw cause;
  }
};

const restartTmuxServer = async (socket: string) => {
  await stopTmuxServer(socket);
  // tmux may return from kill-server before its socket is ready to be reused.
  await vi.waitFor(() => startTmuxServer(socket), { timeout: 2_000 });
};

const createIsolatedControlClient = async (
  options: Pick<TmuxControlClientOptions, "processFactory"> = {},
) => {
  const socket = `overmux-control-test-${randomUUID()}`;
  activeServerSockets.push(socket);
  await startTmuxServer(socket);
  const client = createTmuxControlClient({
    reconnectMaxDelayMs: 20,
    reconnectMinDelayMs: 5,
    socket,
    ...options,
  });
  activeClients.push(client);
  return { client, socket };
};

const controlClientAttachment = async (socket: string) => {
  const { stdout } = await runTmux(socket, [
    // This probe also needs UTF-8 to preserve its tab-delimited fields.
    "-u",
    "list-clients",
    "-F",
    "#{client_pid}\t#{session_name}",
    "-f",
    "#{client_control_mode}",
  ]);
  const [pid, session] = String(stdout).trim().split("\t");
  if (!pid || !session) {
    throw new Error("Tmux control client is not attached");
  }
  return { pid, session };
};

const cleanupIsolatedTmux = async () => {
  const clientResults = await Promise.allSettled(
    activeClients.splice(0).map((client) => client.close()),
  );
  const serverResults = await Promise.allSettled(
    activeServerSockets.splice(0).map(stopTmuxServer),
  );
  const failures = [...clientResults, ...serverResults].flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length) {
    throw new AggregateError(failures, "Failed to clean up isolated tmux");
  }
};

afterEach(cleanupIsolatedTmux);

describe("real isolated tmux control client", () => {
  testCases.each([
    { name: "C locale", locale: { LC_ALL: "C", LC_CTYPE: "C", LANG: "C" } },
    {
      name: "unset locale",
      locale: { LC_ALL: undefined, LC_CTYPE: undefined, LANG: undefined },
    },
    {
      name: "C overriding UTF-8 locale",
      locale: { LC_ALL: "C", LC_CTYPE: "en_US.UTF-8", LANG: "en_US.UTF-8" },
    },
  ])("discovers the full backend hierarchy with $name", async ({ locale }) => {
    const { client, socket } = await createIsolatedControlClient({
      processFactory: (args) =>
        spawn("tmux", [...args], {
          // Clear TMUX too: nested clients assume UTF-8 regardless of locale.
          // Override all locale selectors only on the child so host settings cannot mask this case.
          env: { ...process.env, ...locale, TMUX: undefined },
          stdio: "pipe",
        }),
    });
    await runTmux(socket, [
      "rename-window",
      "-t",
      "control:0",
      "discovery window",
    ]);
    const backend = defineTmuxControlBackend({
      socket,
      controlClientFactory: () => client,
    });

    const state = await backend.refresh();

    expect(state).toMatchObject({
      connected: true,
      hierarchy: {
        sessions: [
          {
            id: "$0",
            name: "control",
            activeWindowId: "@0",
            windows: [
              {
                id: "@0",
                name: "discovery window",
                activePaneId: "%0",
                panes: [{ id: "%0", index: 0 }],
              },
            ],
          },
        ],
      },
    });
  });

  testCases.each([
    { name: "whitespace", value: "spaces and\ttabs\nline two" },
    {
      name: "shell punctuation",
      value:
        "single ' and double \" quotes; backslash \\ and printf '%s' \\\"shell snippet\\\"",
    },
    { name: "tmux format text", value: "#{pane_id}" },
    { name: "Unicode", value: "unicode λ 🌍" },
  ])("round trips $name", async ({ value }) => {
    const { client } = await createIsolatedControlClient();

    await client.command(["set-buffer", "-b", "roundtrip", value]);

    await expect(
      client.command(["show-buffer", "-b", "roundtrip"]),
    ).resolves.toBe(`${value}\n`);
  });

  it("attaches in no-output, ignore-size control mode and returns output", async () => {
    const { client, socket } = await createIsolatedControlClient();

    const sessions = await client.command([
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);
    const { stdout: clientFlags } = await runTmux(socket, [
      "list-clients",
      "-F",
      "#{client_flags}",
      "-f",
      "#{client_control_mode}",
    ]);

    expect(sessions).toBe("control\n");
    expect(clientFlags).toContain("ignore-size");
    expect(clientFlags).toContain("no-output");
  });

  testCases.each([
    { detachOnDestroy: "off", reconnects: false },
    { detachOnDestroy: "on", reconnects: true },
  ])(
    "continues after its session is destroyed with detach-on-destroy $detachOnDestroy",
    async ({ detachOnDestroy, reconnects }) => {
      const { client, socket } = await createIsolatedControlClient();
      await runTmux(socket, [
        "set-option",
        "-g",
        "detach-on-destroy",
        detachOnDestroy,
      ]);
      await client.command(["display-message", "-p", "attached"]);
      const before = await controlClientAttachment(socket);
      await runTmux(socket, ["new-session", "-d", "-s", "survivor", "sh"]);

      await runTmux(socket, ["kill-session", "-t", `=${before.session}`]);

      await vi.waitFor(
        () =>
          expect(
            client.command(["list-sessions", "-F", "#{session_name}"]),
          ).resolves.toBe("survivor\n"),
        { timeout: 2_000 },
      );
      const after = await controlClientAttachment(socket);
      if (reconnects) {
        expect(after.pid).not.toBe(before.pid);
      } else {
        expect(after.pid).toBe(before.pid);
      }
    },
  );

  it("reconnects after the isolated server restarts", async () => {
    const { client, socket } = await createIsolatedControlClient();
    await expect(
      client.command(["list-sessions", "-F", "#{session_name}"]),
    ).resolves.toBe("control\n");

    await restartTmuxServer(socket);

    await vi.waitFor(
      () =>
        expect(
          client.command(["list-sessions", "-F", "#{session_name}"]),
        ).resolves.toBe("control\n"),
      { timeout: 2_000 },
    );
  });

  it("recovers after the last session disappears and a new one starts", async () => {
    const { client, socket } = await createIsolatedControlClient();
    await expect(
      client.command(["display-message", "-p", "ready"]),
    ).resolves.toBe("ready\n");

    await runTmux(socket, ["kill-session", "-t", "=control"]);
    await vi.waitFor(() => startTmuxServer(socket), { timeout: 2_000 });

    await vi.waitFor(
      () =>
        expect(
          client.command(["list-sessions", "-F", "#{session_name}"]),
        ).resolves.toBe("control\n"),
      { timeout: 2_000 },
    );
  });

  it("receives real window, pane, layout, rename, and session notifications", async () => {
    const { client } = await createIsolatedControlClient();
    const eventTypes: string[] = [];
    client.subscribe((event) => eventTypes.push(event.type));

    await client.command([
      "new-window",
      "-d",
      "-n",
      "second",
      "-t",
      "control:",
    ]);
    await client.command([
      "split-window",
      "-d",
      "-h",
      "-t",
      "control:second",
      "sh",
    ]);
    await client.command(["select-window", "-t", "control:second"]);
    await client.command(["select-pane", "-t", "control:second.1"]);
    await client.command([
      "rename-window",
      "-t",
      "control:second",
      "renamed window",
    ]);

    await vi.waitFor(() => {
      expect(eventTypes).toEqual(
        expect.arrayContaining([
          "window-added",
          "session-window-changed",
          "window-pane-changed",
          "layout-changed",
          "window-renamed",
        ]),
      );
    });
  });
});
