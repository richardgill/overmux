// Maintains one lazy `tmux -C attach-session` connection to a tmux server.
// Control mode returns framed command blocks and unsolicited change messages.
// client.command(args, { signal })  Runs queued commands in order; cancellation
//                                   rejects the caller but preserves response boundaries.
// client.subscribe(fn)              Receives parsed changes and disconnect invalidation.
// client.close()                    Stops retries, rejects work, and ends the process.
// Disconnects reject outstanding work, notify listeners, then retry with bounded
// exponential delay. Queue and output limits bound memory; arguments bypass a shell.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { serializeTmuxCommand } from "./serialize-command";
import { createTmuxVersionCheck } from "./version";
import {
  createTmuxControlParser,
  isTmuxControlNotification,
  type TmuxControlNotification,
  type TmuxControlProtocolEvent,
} from "./parser";
import { tmuxSocketArguments } from "../backend";

export type TmuxControlProcess = Pick<
  ChildProcessWithoutNullStreams,
  "kill" | "on" | "once" | "stderr" | "stdin" | "stdout"
>;

export type TmuxControlClientOptions = {
  maxBufferedBytes?: number;
  maxPendingCommands?: number;
  reconnectMaxDelayMs?: number;
  reconnectMinDelayMs?: number;
  socket: string;
  processFactory?: (args: readonly string[]) => TmuxControlProcess;
  versionCheck?: (signal: AbortSignal) => Promise<void>;
};

export type TmuxControlClient = {
  close: () => Promise<void>;
  command: (
    args: readonly string[],
    options?: { signal?: AbortSignal },
  ) => Promise<string>;
  subscribe: (listener: (event: TmuxControlNotification) => void) => () => void;
};

type CommandRequest = {
  args: readonly string[];
  reject: (cause: unknown) => void;
  removeAbortListener: () => void;
  resolve: (output: string) => void;
  signal: AbortSignal | undefined;
};

const defaultProcessFactory = (args: readonly string[]) =>
  spawn("tmux", [...args], { stdio: "pipe" });

const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));

const maxTimerDelayMs = 2 ** 31 - 1;

const assertPositiveSafeInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
};

const assertTimerDelay = (value: number, name: string) => {
  if (!Number.isInteger(value) || value <= 0 || value > maxTimerDelayMs) {
    throw new Error(`${name} must be between 1 and ${maxTimerDelayMs}`);
  }
};

export const createTmuxControlClient = (
  options: TmuxControlClientOptions,
): TmuxControlClient => {
  const maxBufferedBytes = options.maxBufferedBytes ?? 16 * 1_024 * 1_024;
  const maxPendingCommands = options.maxPendingCommands ?? 1_024;
  const reconnectMinDelayMs = options.reconnectMinDelayMs ?? 50;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 2_000;
  assertPositiveSafeInteger(maxBufferedBytes, "maxBufferedBytes");
  assertPositiveSafeInteger(maxPendingCommands, "maxPendingCommands");
  assertTimerDelay(reconnectMinDelayMs, "reconnectMinDelayMs");
  assertTimerDelay(reconnectMaxDelayMs, "reconnectMaxDelayMs");
  if (reconnectMaxDelayMs < reconnectMinDelayMs) {
    throw new Error(
      "reconnectMaxDelayMs must be greater than or equal to reconnectMinDelayMs",
    );
  }
  const createProcess = options.processFactory ?? defaultProcessFactory;
  const checkVersion =
    options.versionCheck ?? createTmuxVersionCheck(options.socket);
  const listeners = new Set<(event: TmuxControlNotification) => void>();
  const commands = {
    active: undefined as CommandRequest | undefined,
    pending: [] as CommandRequest[],
  };
  const connection = {
    checking: undefined as AbortController | undefined,
    bufferedBytes: 0,
    generation: 0,
    process: undefined as TmuxControlProcess | undefined,
    ready: false,
  };
  const reconnect = {
    attempts: 0,
    timer: undefined as NodeJS.Timeout | undefined,
  };
  let closed = false;

  const rejectAllCommands = (cause: unknown) => {
    const queued = [
      ...(commands.active ? [commands.active] : []),
      ...commands.pending.splice(0),
    ];
    commands.active = undefined;
    queued.forEach((command) => {
      command.removeAbortListener();
      if (!command.signal?.aborted) {
        command.reject(cause);
      }
    });
  };

  const scheduleReconnect = () => {
    if (closed || reconnect.timer) {
      return;
    }
    const delay = Math.min(
      reconnectMinDelayMs * 2 ** reconnect.attempts,
      reconnectMaxDelayMs,
    );
    reconnect.attempts += 1;
    reconnect.timer = setTimeout(() => {
      reconnect.timer = undefined;
      void ensureConnection();
    }, delay);
    reconnect.timer.unref();
  };

  const writeNextCommand = () => {
    if (!connection.ready || !connection.process || commands.active) {
      return;
    }
    commands.active = commands.pending.shift();
    if (!commands.active) {
      return;
    }
    connection.bufferedBytes = 0;
    try {
      const serialized = serializeTmuxCommand(commands.active.args);
      connection.process.stdin.write(`${serialized}\n`);
    } catch (cause) {
      handleDisconnect(connection.generation, cause);
    }
  };

  const settleActiveCommand = (
    event: Extract<
      TmuxControlProtocolEvent,
      { type: "block-completed" | "block-failed" }
    >,
  ) => {
    const command = commands.active;
    commands.active = undefined;
    connection.bufferedBytes = 0;
    if (command) {
      command.removeAbortListener();
      if (!command.signal?.aborted) {
        if (event.type === "block-completed") {
          command.resolve(event.output);
        } else {
          command.reject(
            new Error(event.output.trim() || "Tmux command failed"),
          );
        }
      }
    }
    writeNextCommand();
  };

  const handleProtocolEvents = (
    generation: number,
    events: TmuxControlProtocolEvent[],
  ) => {
    if (generation !== connection.generation || closed) {
      return;
    }
    events.forEach((event) => {
      if (generation !== connection.generation || closed) {
        return;
      }
      if (isTmuxControlNotification(event)) {
        listeners.forEach((listener) => listener(event));
        return;
      }
      if (event.type === "block-started") {
        connection.bufferedBytes = 0;
        return;
      }
      // The first response reports whether tmux attached the control client.
      if (!connection.ready) {
        if (event.type === "block-failed") {
          handleDisconnect(
            generation,
            new Error(event.output.trim() || "Tmux control attachment failed"),
          );
          return;
        }
        connection.ready = true;
        reconnect.attempts = 0;
        writeNextCommand();
        return;
      }
      settleActiveCommand(event);
    });
  };

  const handleDisconnect = (
    generation: number,
    cause: unknown,
    signal: NodeJS.Signals = "SIGHUP",
  ) => {
    if (generation !== connection.generation || closed) {
      return;
    }
    // Advancing the generation makes late events from this process harmless.
    const child = connection.process;
    connection.generation += 1;
    connection.checking?.abort();
    connection.checking = undefined;
    connection.process = undefined;
    connection.ready = false;
    child?.kill(signal);
    rejectAllCommands(asError(cause));
    listeners.forEach((listener) => listener({ type: "sessions-changed" }));
    scheduleReconnect();
  };

  const attachConnection = (generation: number) => {
    // A version probe may finish after close; never spawn a client for a stale attempt.
    if (closed || generation !== connection.generation) {
      return;
    }
    connection.checking = undefined;
    const parser = createTmuxControlParser();
    connection.ready = false;
    connection.bufferedBytes = 0;
    let child: TmuxControlProcess;
    try {
      // Control mode is still a tmux client, so it must attach to a live session before accepting commands.
      // It has no session-specific UI, so no target is supplied: tmux may choose any session and, with
      // detach-on-destroy off, move this same client when that session dies. With the option on, tmux exits
      // the client instead and Overmux's disconnect lifecycle creates a fresh targetless attachment.
      child = createProcess([
        ...tmuxSocketArguments(options.socket),
        // Force UTF-8: otherwise tmux replaces our ASCII 0x1f field separators with underscores.
        // Underscores also occur in field values, so the parser cannot reliably recover the boundaries.
        "-u",
        "-C",
        "attach-session",
        "-f",
        "no-output,ignore-size",
      ]);
    } catch (cause) {
      handleDisconnect(generation, cause);
      return;
    }
    connection.process = child;
    child.stdout.on("data", (chunk: Buffer) => {
      if (generation !== connection.generation) {
        return;
      }
      connection.bufferedBytes += chunk.byteLength;
      if (connection.bufferedBytes > maxBufferedBytes) {
        handleDisconnect(
          generation,
          new Error("Tmux control output exceeded its limit"),
          "SIGKILL",
        );
        return;
      }
      handleProtocolEvents(generation, parser.push(chunk));
    });
    child.stdout.once("error", (cause) => handleDisconnect(generation, cause));
    child.stderr.on("data", () => undefined);
    child.stderr.once("error", (cause) => handleDisconnect(generation, cause));
    child.stdin.once("error", (cause) => handleDisconnect(generation, cause));
    child.stdin.once("close", () =>
      handleDisconnect(generation, new Error("Tmux control stdin closed")),
    );
    child.once("error", (cause) => handleDisconnect(generation, cause));
    child.once("close", (code, signal) => {
      handleProtocolEvents(generation, parser.finish());
      handleDisconnect(
        generation,
        new Error(
          `Tmux control client exited (code ${code ?? "none"}, signal ${signal ?? "none"})`,
        ),
      );
    });
  };

  const ensureConnection = async () => {
    // New work waits behind an already scheduled retry so repeated failures retain bounded backoff.
    if (
      closed ||
      connection.checking ||
      connection.process ||
      reconnect.timer
    ) {
      return;
    }
    const generation = connection.generation + 1;
    connection.generation = generation;
    const controller = new AbortController();
    connection.checking = controller;
    try {
      await checkVersion(controller.signal);
      attachConnection(generation);
    } catch (cause) {
      handleDisconnect(generation, cause);
    }
  };

  const command: TmuxControlClient["command"] = (args, commandOptions) => {
    if (closed) {
      return Promise.reject(new Error("Tmux control client is closed"));
    }
    if (
      commands.pending.length + (commands.active ? 1 : 0) >=
      maxPendingCommands
    ) {
      return Promise.reject(new Error("Tmux control command queue is full"));
    }
    const signal = commandOptions?.signal;
    return new Promise<string>((resolve, reject) => {
      let request: CommandRequest;
      const abort = () => {
        const index = commands.pending.indexOf(request);
        if (index >= 0) {
          commands.pending.splice(index, 1);
          request.removeAbortListener();
        }
        reject(signal?.reason ?? new Error("Tmux command aborted"));
      };
      request = {
        args: [...args],
        reject,
        removeAbortListener: () => signal?.removeEventListener("abort", abort),
        resolve,
        signal,
      };
      commands.pending.push(request);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      void ensureConnection();
      writeNextCommand();
    });
  };

  return {
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      connection.checking?.abort();
      connection.checking = undefined;
      if (reconnect.timer) {
        clearTimeout(reconnect.timer);
        reconnect.timer = undefined;
      }
      rejectAllCommands(new Error("Tmux control client is closed"));
      const child = connection.process;
      connection.process = undefined;
      if (!child) {
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 1_000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
        child.kill("SIGHUP");
      });
    },
    command,
    subscribe: (listener) => {
      if (closed) {
        return () => undefined;
      }
      listeners.add(listener);
      void ensureConnection();
      return () => listeners.delete(listener);
    },
  };
};
