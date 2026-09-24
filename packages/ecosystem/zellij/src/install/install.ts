// This orchestrates deliberate installation and the one-shot permission handshake.
// Subprocess ownership, deadlines, and cancellation are bounded so install cannot hang.
import {
  execFile as execFileCallback,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify, TextDecoder } from "node:util";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  encodeControlMessage,
  ZELLIJ_PROTOCOL_VERSION,
  type PluginMessage,
} from "../shared/plugin-protocol";
import {
  parseConnectionPluginMessage,
  pluginFatalError,
} from "../server/protocol";
import { listZellijSessions } from "../server/zellij-process";
import { installArtifact, type InstalledArtifact } from "./artifact";
import {
  ZellijMalformedOutputError,
  ZellijPermissionError,
  ZellijPipeExitedError,
  ZellijProtocolMismatchError,
  ZellijStartupTimeoutError,
} from "./errors";
import { selectInstallSession } from "./session-selection";

const execFile = promisify(execFileCallback);
const defaultTimeoutMs = 30_000;
const permissionPaneCheckIntervalMs = 1_000;
const childExitGraceMs = 500;

export type InstallProcess = ChildProcessWithoutNullStreams;

type InstallDependencies = {
  closePermissionPane: (
    session: string,
    paneId: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  installArtifact: () => Promise<InstalledArtifact>;
  launchPermissionPane: (
    args: readonly string[],
    signal?: AbortSignal,
  ) => Promise<string>;
  listPaneIds: (
    session: string,
    signal?: AbortSignal,
  ) => Promise<readonly string[]>;
  listSessions: (signal?: AbortSignal) => Promise<readonly string[]>;
  spawnPlugin: (args: readonly string[]) => InstallProcess;
  timeoutMs: number;
};

export type InstallZellijOptions = {
  readonly session?: string;
  readonly signal?: AbortSignal;
};

export type InstallZellijResult = {
  readonly artifactPath: string;
  readonly protocolVersion: number;
  readonly pluginVersion: string;
  readonly sha256: string;
  readonly replaced: boolean;
  readonly session: string;
};

const spawnPlugin = (args: readonly string[]) =>
  spawn("zellij", [...args], { stdio: ["pipe", "pipe", "pipe"] });

const launchPermissionPane = async (
  args: readonly string[],
  signal?: AbortSignal,
) => {
  const { stdout } = await execFile("zellij", [...args], {
    encoding: "utf8",
    signal,
  });
  const paneId = stdout.trim();
  if (!paneId) {
    throw new ZellijPermissionError(
      "Zellij did not return the installer permission pane ID.",
    );
  }
  return paneId;
};

const listedPanesSchema = z.array(
  z.object({ id: z.number().int().nonnegative(), is_plugin: z.boolean() }),
);

const listPaneIds = async (session: string, signal?: AbortSignal) => {
  const { stdout } = await execFile(
    "zellij",
    ["--session", session, "action", "list-panes", "--all", "--json"],
    { encoding: "utf8", signal },
  );
  try {
    return listedPanesSchema
      .parse(JSON.parse(stdout) as unknown)
      .map((pane) => `${pane.is_plugin ? "plugin" : "terminal"}_${pane.id}`);
  } catch {
    throw new ZellijPermissionError(
      "Zellij returned invalid pane data while waiting for permission approval.",
    );
  }
};

const closePermissionPane = async (
  session: string,
  paneId: string,
  signal?: AbortSignal,
) => {
  await execFile(
    "zellij",
    ["--session", session, "action", "close-pane", "--pane-id", paneId],
    { encoding: "utf8", signal },
  );
};

const waitForExit = (exited: Promise<void>) =>
  Promise.race([exited, delay(childExitGraceMs).then(() => undefined)]);

const terminateOwnedProcess = async (
  child: InstallProcess,
  exited: Promise<void>,
) => {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await waitForExit(exited);
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await waitForExit(exited);
  }
};

export const runInstallHandshake = ({
  connectionId,
  process: child,
  signal,
  timeoutMs,
}: {
  connectionId: string;
  process: InstallProcess;
  signal?: AbortSignal;
  timeoutMs: number;
}) =>
  new Promise<{ pluginVersion: string }>((resolve, reject) => {
    const decoder = new TextDecoder();
    let buffer = "";
    let phase: "hello" | "install_ok" | "bye" | "exit" = "hello";
    let pluginVersion: string | undefined;
    let terminal = false;
    let stderr = "";
    let resolveExit: () => void = () => undefined;
    const exited = new Promise<void>((exitResolve) => {
      resolveExit = exitResolve;
    });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
    };
    const settle = (
      result: { pluginVersion: string } | Error,
      terminate = false,
    ) => {
      if (terminal) {
        return;
      }
      // A protocol failure is terminal immediately, including for later lines in this chunk.
      terminal = true;
      void (async () => {
        if (terminate) {
          await terminateOwnedProcess(child, exited);
        }
        cleanup();
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      })();
    };
    const acceptMessage = (message: PluginMessage) => {
      if (message.type === "hello" && phase === "hello") {
        pluginVersion = message.pluginVersion;
        phase = "install_ok";
        return;
      }
      if (message.type === "install_ok" && phase === "install_ok") {
        phase = "bye";
        child.stdin.write(
          encodeControlMessage({
            connectionId,
            protocolVersion: ZELLIJ_PROTOCOL_VERSION,
            type: "shutdown",
          }),
        );
        return;
      }
      if (message.type === "bye" && phase === "bye") {
        phase = "exit";
        // Zellij turns stdin EOF into a new empty pipe event, so terminate after the plugin's bye.
        void terminateOwnedProcess(child, exited).then(() => {
          if (!terminal && child.exitCode === null) {
            settle(
              new ZellijPipeExitedError(
                "Zellij plugin pipe did not exit after TERM and KILL.",
              ),
            );
          }
        });
        return;
      }
      if (message.type === "fatal") {
        settle(pluginFatalError(message), true);
        return;
      }
      settle(
        new ZellijMalformedOutputError(
          `Unexpected ${message.type} message while waiting for ${phase}.`,
        ),
        true,
      );
    };
    const acceptLine = (line: string) => {
      if (terminal || line.length === 0) {
        return;
      }
      try {
        acceptMessage(parseConnectionPluginMessage(line, connectionId));
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)), true);
      }
    };
    const onStdout = (chunk: Buffer) => {
      const lines = `${buffer}${decoder.decode(chunk, { stream: true })}`.split(
        "\n",
      );
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        acceptLine(line);
        if (terminal) {
          return;
        }
      }
    };
    const onAbort = () => {
      settle(
        new DOMException("Zellij installation was cancelled", "AbortError"),
        true,
      );
    };
    const timer = setTimeout(() => {
      settle(
        new ZellijStartupTimeoutError(
          `Timed out after ${timeoutMs}ms waiting for Zellij permission approval in the selected session. Approve ReadApplicationState and ReadCliPipes, then run the command again.`,
        ),
        true,
      );
    }, timeoutMs);

    child.stdout.on("data", onStdout);
    child.stderr.on(
      "data",
      (chunk: Buffer) => (stderr += chunk.toString("utf8")),
    );
    child.on("error", (error) =>
      settle(
        new ZellijPipeExitedError(
          `Could not start the Zellij plugin pipe: ${error.message}`,
        ),
        true,
      ),
    );
    child.on("exit", (code, childSignal) => {
      resolveExit();
      if (terminal) {
        return;
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        settle(
          new ZellijMalformedOutputError(
            `The Zellij plugin ended with a truncated message: ${buffer}`,
          ),
        );
        return;
      }
      if (
        phase === "exit" &&
        pluginVersion !== undefined &&
        (code === 0 || childSignal === "SIGTERM")
      ) {
        settle({ pluginVersion });
        return;
      }
      settle(
        new ZellijPipeExitedError(
          `Zellij plugin pipe exited before installation completed (code ${String(code)}, signal ${String(childSignal)}).${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
        ),
      );
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }

    if (!terminal) {
      child.stdin.write(
        encodeControlMessage({
          connectionId,
          protocolVersion: ZELLIJ_PROTOCOL_VERSION,
          purpose: "install",
          type: "init",
        }),
      );
    }
  });

const defaultDependencies: InstallDependencies = {
  closePermissionPane,
  installArtifact,
  launchPermissionPane,
  listPaneIds,
  listSessions: listZellijSessions,
  spawnPlugin,
  timeoutMs: defaultTimeoutMs,
};

const cancellationError = () =>
  new DOMException("Zellij installation was cancelled", "AbortError");

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : cancellationError();
  }
};

const awaitWithSignal = <T>(promise: Promise<T>, signal: AbortSignal) => {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
};

const waitForPermissionPane = async ({
  paneId,
  session,
  signal,
  listPaneIds,
}: {
  paneId: string;
  session: string;
  signal: AbortSignal;
  listPaneIds: InstallDependencies["listPaneIds"];
}) => {
  for (;;) {
    throwIfAborted(signal);
    const paneIds = await awaitWithSignal(listPaneIds(session, signal), signal);
    if (!paneIds.includes(paneId)) {
      return;
    }
    await awaitWithSignal(delay(permissionPaneCheckIntervalMs), signal);
  }
};

const closeKnownPermissionPane = async ({
  closePane,
  paneId,
  session,
}: {
  closePane: InstallDependencies["closePermissionPane"];
  paneId: string;
  session: string;
}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), childExitGraceMs);
  try {
    await awaitWithSignal(
      closePane(session, paneId, controller.signal),
      controller.signal,
    );
  } catch {
    // Preserve the installation failure if the pane already closed or Zellij is unavailable.
  } finally {
    clearTimeout(timer);
  }
};

const createInstallDeadline = (
  signal: AbortSignal | undefined,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort(cancellationError());
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
  }
  const timer = setTimeout(
    () =>
      controller.abort(
        new ZellijStartupTimeoutError(
          `Timed out after ${timeoutMs}ms waiting for Zellij permission approval in the selected session. Approve ReadApplicationState and ReadCliPipes, then run the command again.`,
        ),
      ),
    timeoutMs,
  );
  return {
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
    signal: controller.signal,
  };
};

export const installZellijWithDependencies = async (
  options: InstallZellijOptions = {},
  dependencies: InstallDependencies = defaultDependencies,
): Promise<InstallZellijResult> => {
  throwIfAborted(options.signal);
  const artifact = await dependencies.installArtifact();
  throwIfAborted(options.signal);
  const deadline = createInstallDeadline(
    options.signal,
    dependencies.timeoutMs,
  );
  let paneId: string | undefined;
  let session: string | undefined;
  try {
    const sessions = await awaitWithSignal(
      dependencies.listSessions(deadline.signal),
      deadline.signal,
    );
    session = selectInstallSession({
      currentSession: process.env.ZELLIJ_SESSION_NAME,
      requestedSession: options.session,
      sessions,
    });
    paneId = await awaitWithSignal(
      dependencies.launchPermissionPane(
        [
          "--session",
          session,
          "action",
          "new-pane",
          "--floating",
          "--name",
          `overmux-install-${randomUUID()}`,
          "--plugin",
          pathToFileURL(artifact.artifactPath).href,
          "--configuration",
          "purpose=install",
        ],
        deadline.signal,
      ),
      deadline.signal,
    );
    await waitForPermissionPane({
      listPaneIds: dependencies.listPaneIds,
      paneId,
      session,
      signal: deadline.signal,
    });
    const connectionId = randomUUID();
    const child = dependencies.spawnPlugin([
      "--session",
      session,
      "pipe",
      "--name",
      `overmux-install-${connectionId}`,
      "--plugin",
      pathToFileURL(artifact.artifactPath).href,
      "--plugin-configuration",
      `connection_id=${connectionId}`,
    ]);
    const handshake = await runInstallHandshake({
      connectionId,
      process: child,
      signal: deadline.signal,
      timeoutMs: dependencies.timeoutMs,
    });
    if (handshake.pluginVersion !== artifact.pluginVersion) {
      throw new ZellijProtocolMismatchError(
        `Zellij loaded plugin version ${handshake.pluginVersion}, but this package installed version ${artifact.pluginVersion}. Zellij 0.45.1 caches plugin bytes by URL for each session lifetime; close the affected Zellij session, restart it, then run the install command again.`,
      );
    }
    return { ...artifact, session };
  } catch (error) {
    if (paneId !== undefined && session !== undefined) {
      await closeKnownPermissionPane({
        closePane: dependencies.closePermissionPane,
        paneId,
        session,
      });
    }
    throw error;
  } finally {
    deadline.dispose();
  }
};

export const installZellij = (options?: InstallZellijOptions) =>
  installZellijWithDependencies(options);
