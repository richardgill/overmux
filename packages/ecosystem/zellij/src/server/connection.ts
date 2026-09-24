// Runs one generation of the persistent Zellij plugin pipe and its bounded handshake.
// It owns framing, cooperative shutdown, and TERM/KILL escalation for only its child process.
// The backend decides whether an unexpected exit warrants one anchor replacement.

import { setTimeout as delay } from "node:timers/promises";

import {
  encodeControlMessage,
  ZELLIJ_PROTOCOL_VERSION,
  type PluginMessage,
} from "../shared/plugin-protocol";
import {
  ZellijMalformedOutputError,
  ZellijPipeExitedError,
  ZellijStartupTimeoutError,
} from "../install/errors";
import { createRuntimeProtocolDecoder } from "./protocol";
import type { ZellijPipeProcess } from "./zellij-process";

const shutdownGraceMs = 500;

type SnapshotMessage = Extract<PluginMessage, { type: "snapshot" }>;

const waitForExit = (exited: Promise<void>) =>
  Promise.race([exited, delay(shutdownGraceMs).then(() => undefined)]);

const closeOwnedPipe = async ({
  child,
  exited,
  requestShutdown,
}: {
  child: ZellijPipeProcess;
  exited: Promise<void>;
  requestShutdown: () => void;
}) => {
  if (child.exitCode === null) {
    requestShutdown();
    await waitForExit(exited);
  }
  if (child.exitCode === null) {
    child.stdin.end();
    await waitForExit(exited);
  }
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await waitForExit(exited);
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await waitForExit(exited);
  }
};

export type ZellijConnection = {
  anchorSession: string;
  close: () => Promise<void>;
  ready: Promise<void>;
  removePlugin: () => Promise<void>;
  requestShutdown: () => void;
};

export const openZellijConnection = ({
  anchorSession,
  child,
  connectionId,
  onFailure,
  onSnapshot,
  removePlugin,
  startupTimeoutMs,
}: {
  anchorSession: string;
  child: ZellijPipeProcess;
  connectionId: string;
  onFailure: (error: Error, replaceAnchor: boolean) => void;
  onSnapshot: (snapshot: SnapshotMessage) => void;
  removePlugin: (pluginId: number) => Promise<void>;
  startupTimeoutMs: number;
}): ZellijConnection => {
  const decoder = createRuntimeProtocolDecoder(connectionId);
  const stdoutDecoder = new TextDecoder();
  let buffer = "";
  let stderr = "";
  let helloReceived = false;
  let pluginId: number | undefined;
  let closing = false;
  let failed = false;
  let shutdownRequested = false;
  let closePromise: Promise<void> | undefined;
  let removePluginPromise: Promise<void> | undefined;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  let resolveExit: () => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const fail = (error: Error, replaceAnchor = false) => {
    if (failed || closing) {
      return;
    }
    failed = true;
    clearTimeout(startupTimer);
    rejectReady(error);
    onFailure(error, replaceAnchor);
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  };
  const acceptLine = (line: string) => {
    const event = decoder.accept(line);
    if (event.type === "error") {
      fail(event.error);
      return;
    }
    if (event.type === "hello") {
      helloReceived = true;
      pluginId = event.pluginId;
      return;
    }
    if (event.type === "snapshot") {
      clearTimeout(startupTimer);
      try {
        onSnapshot(event);
        resolveReady();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    child.stdin.end();
  };
  const onStdout = (chunk: Buffer) => {
    if (failed || closing) {
      return;
    }
    const lines =
      `${buffer}${stdoutDecoder.decode(chunk, { stream: true })}`.split("\n");
    buffer = lines.pop() ?? "";
    lines
      .filter((line) => line.length > 0)
      .some((line) => {
        acceptLine(line);
        return failed;
      });
  };
  const onStderr = (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  };
  const onError = (error: Error) =>
    fail(
      new ZellijPipeExitedError(
        `Could not start the Zellij plugin pipe: ${error.message}`,
      ),
    );
  const onStdinError = (error: Error) => {
    if (!closing && !shutdownRequested) {
      onError(error);
    }
  };
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    clearTimeout(startupTimer);
    resolveExit();
    if (closing) {
      return;
    }
    buffer += stdoutDecoder.decode();
    if (buffer.trim()) {
      fail(
        new ZellijMalformedOutputError(
          `The Zellij plugin ended with a truncated message: ${buffer}`,
        ),
      );
      return;
    }
    fail(
      new ZellijPipeExitedError(
        `Zellij plugin pipe exited unexpectedly (code ${String(code)}, signal ${String(signal)}).${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
      ),
      true,
    );
  };
  const startupTimer = setTimeout(() => {
    fail(
      new ZellijStartupTimeoutError(
        helloReceived
          ? `Timed out after ${startupTimeoutMs}ms waiting for the initial Zellij snapshot.`
          : `Timed out after ${startupTimeoutMs}ms waiting for Zellij plugin permission and hello. Run: pnpm exec overmux integration install zellij`,
      ),
    );
  }, startupTimeoutMs);
  startupTimer.unref();

  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);
  child.stdin.on("error", onStdinError);
  child.on("error", onError);
  child.on("exit", onExit);
  child.stdin.write(
    encodeControlMessage({
      connectionId,
      protocolVersion: ZELLIJ_PROTOCOL_VERSION,
      purpose: "runtime",
      type: "init",
    }),
  );

  const requestShutdown = () => {
    if (shutdownRequested || child.exitCode !== null) {
      return;
    }
    shutdownRequested = true;
    child.stdin.write(
      encodeControlMessage({
        connectionId,
        protocolVersion: ZELLIJ_PROTOCOL_VERSION,
        type: "shutdown",
      }),
    );
  };
  const close = () => {
    if (closePromise) {
      return closePromise;
    }
    closing = true;
    clearTimeout(startupTimer);
    rejectReady(new DOMException("Zellij connection closed", "AbortError"));
    closePromise = (async () => {
      await closeOwnedPipe({ child, exited, requestShutdown });
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.stdin.off("error", onStdinError);
      child.off("error", onError);
      child.off("exit", onExit);
    })();
    return closePromise;
  };

  return {
    anchorSession,
    close,
    ready,
    removePlugin: () => {
      if (removePluginPromise) {
        return removePluginPromise;
      }
      removePluginPromise =
        pluginId === undefined ? Promise.resolve() : removePlugin(pluginId);
      return removePluginPromise;
    },
    requestShutdown,
  };
};
