// Bridges one fixed stream to one ordinary `zellij attach` client in a PTY. The opening session
// name never changes: callers replace the stream to attach elsewhere, giving terminal-stream a new
// generation that resets the renderer. Closing this temporary client leaves the Zellij session alive.
import { randomUUID } from "node:crypto";

import type { StreamSession } from "overmux";
import {
  spawnPty,
  type PtyDisposable,
  type PtyFactory,
  type PtyProcess,
} from "@overmux/pty/server";
import { createTerminalOutputFlow } from "@overmux/terminal-stream/server";

import {
  zellijTerminalInputLimit,
  type ZellijTerminalClientMessage,
  type ZellijTerminalServerMessage,
} from "../../shared/terminal-contracts";
import type { ZellijBackend } from "../backend";

type TerminalInput = Extract<
  ZellijTerminalClientMessage,
  { type: "input" }
>["data"];
type TerminalSize = { cols: number; rows: number };
type ZellijTerminalSessionOptions = {
  allowInput: boolean;
  backend: ZellijBackend;
  emit: (message: ZellijTerminalServerMessage) => void;
  fail: (cause: unknown) => void;
  outputChunkSize: number;
  ptyFactory?: PtyFactory;
  sessionName: string;
  signal: AbortSignal;
};

export const defaultZellijTerminalOutputChunkSize = 32 * 1_024;
const terminalEnvironment = () => ({
  COLORTERM: "truecolor",
  TERM: "xterm-256color",
  TERM_PROGRAM: "overmux",
});
const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const requireSession = async (
  backend: ZellijBackend,
  sessionName: string,
  signal: AbortSignal,
) => {
  const state = await backend.read(signal);
  if (!state.sessions.some((session) => session.name === sessionName)) {
    throw new Error(
      `Zellij session ${JSON.stringify(sessionName)} was not found`,
    );
  }
};

export const createZellijTerminalSession = (
  options: ZellijTerminalSessionOptions,
): StreamSession<ZellijTerminalClientMessage> => {
  const lifecycleController = new AbortController();
  const lifecycleSignal = AbortSignal.any([
    options.signal,
    lifecycleController.signal,
  ]);
  const factory = options.ptyFactory ?? spawnPty;
  const terminalId = randomUUID();
  let geometry: TerminalSize | undefined;
  let opening: Promise<void> | undefined;
  let process: PtyProcess | undefined;
  let exited: Promise<void> | undefined;
  let dataSubscription: PtyDisposable | undefined;
  let exitSubscription: PtyDisposable | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const queuedInput: { entries: TerminalInput[]; length: number } = {
    entries: [],
    length: 0,
  };

  const terminate = async () => {
    const activeProcess = process;
    const activeExit = exited;
    if (!activeProcess || !activeExit) {
      return;
    }
    try {
      activeProcess.kill("SIGHUP");
    } catch {}
    await Promise.race([activeExit, delay(1_000)]);
    if (process === activeProcess) {
      try {
        activeProcess.kill("SIGKILL");
      } catch {}
      await Promise.race([activeExit, delay(1_000)]);
    }
  };
  const shutDown = async () => {
    disposed = true;
    lifecycleController.abort(new Error("Terminal session disposed"));
    await opening?.catch(() => undefined);
    await terminate();
    dataSubscription?.dispose();
    exitSubscription?.dispose();
    options.signal.removeEventListener("abort", abort);
  };
  const dispose = () => {
    if (!disposal) {
      disposal = shutDown();
    }
    return disposal;
  };
  const fail = (cause: unknown) => {
    if (disposed || options.signal.aborted) {
      return;
    }
    void dispose().finally(() => options.fail(cause));
  };
  const output = createTerminalOutputFlow({
    emit: options.emit,
    fail,
    outputChunkSize: options.outputChunkSize,
    pauseOutput: () => process?.pause(),
    resumeOutput: () => process?.resume(),
    terminalId,
  });
  const write = (data: TerminalInput) =>
    process?.write(typeof data === "string" ? data : Buffer.from(data));
  const flushInput = () => {
    queuedInput.entries.forEach(write);
    queuedInput.entries.length = 0;
    queuedInput.length = 0;
  };
  const queueInput = (data: TerminalInput) => {
    queuedInput.length += data.length;
    if (queuedInput.length > zellijTerminalInputLimit) {
      throw new Error("Terminal received too much input before attaching");
    }
    queuedInput.entries.push(data);
  };
  const open = async (initialGeometry: TerminalSize) => {
    await requireSession(options.backend, options.sessionName, lifecycleSignal);
    if (disposed || lifecycleSignal.aborted) {
      return;
    }
    const spawned = factory({
      args: ["attach", options.sessionName],
      cols: initialGeometry.cols,
      command: options.backend.executable,
      env: terminalEnvironment(),
      rows: initialGeometry.rows,
    });
    process = spawned;
    exited = new Promise((resolve) => {
      dataSubscription = spawned.onData((data) => {
        if (!disposed) {
          output.emitOutput(data);
        }
      });
      exitSubscription = spawned.onExit(({ exitCode, signal }) => {
        if (process === spawned) {
          process = undefined;
        }
        resolve();
        if (!disposed && !options.signal.aborted) {
          fail(
            new Error(
              `Zellij terminal client exited (code ${exitCode}, signal ${signal ?? "none"})`,
            ),
          );
        }
      });
    });
    const latestGeometry = geometry;
    if (
      latestGeometry &&
      (latestGeometry.cols !== initialGeometry.cols ||
        latestGeometry.rows !== initialGeometry.rows)
    ) {
      spawned.resize(latestGeometry.cols, latestGeometry.rows);
    }
    flushInput();
  };
  const resize = (size: TerminalSize) => {
    if (geometry?.cols === size.cols && geometry.rows === size.rows) {
      return;
    }
    geometry = size;
    process?.resize(size.cols, size.rows);
    if (!process && !opening) {
      const task = open(size);
      opening = task;
      void task.catch(fail).finally(() => {
        if (opening === task) {
          opening = undefined;
        }
      });
    }
  };
  const onMessage = (message: ZellijTerminalClientMessage) => {
    if (disposed) {
      return;
    }
    if (message.type === "resize") {
      resize(message);
      return;
    }
    if (message.type === "input") {
      if (!options.allowInput) {
        return;
      }
      if (process) {
        write(message.data);
      } else {
        queueInput(message.data);
      }
      return;
    }
    output.acknowledgeOutput(message);
  };
  const abort = () => void dispose();
  if (options.signal.aborted) {
    abort();
  } else {
    options.signal.addEventListener("abort", abort, { once: true });
  }

  return { dispose, onMessage };
};
