// Bridges one browser terminal to one native tmux client. A tmux session is a persistent workspace;
// this client is its temporary viewer, so closing the browser does not stop the session.
//
// Browser -> session:
//   go-to                    opens `tmux attach-session` in a PTY; later requests reuse switch-client.
//   resize                   applies renderer geometry; initial attachment uses ignore-size.
//   input                    writes after selection completes, or queues briefly while it changes.
//   rendered                 acknowledges displayed output; if the browser falls behind,
//                            the PTY pauses until it catches up.
//
// Session -> browser:
//   data                     carries ordered PTY byte chunks.
//   location-changed         reports the full session/window/pane location observed by this client.
//   go-to-result             correlates a request with its confirmed location or rejection.
//
// tmuxAttachArguments(...) uses wait-for to discover tmux's native client name, which switch-client needs.
// resize updates the PTY; ignore-size excludes this viewer from tmux's shared size calculation.
// dispose/failure cancels work, removes notification listeners, and terminates the PTY, not the tmux session.
import { randomUUID } from "node:crypto";

import type { StreamSession } from "overmux";
import {
  spawnPty,
  type PtyDisposable,
  type PtyFactory,
  type PtyProcess,
} from "@overmux/pty/server";
import { createTerminalOutputFlow } from "@overmux/terminal-stream/server";

import { tmuxSocketArguments } from "../backend";
import type { TmuxBackend } from "../backend";
import type { TmuxControlNotification } from "../control/parser";
import {
  tmuxTerminalInputLimit,
  type TmuxTerminalClientMessage,
  type TmuxTerminalServerMessage,
  type TmuxTerminalLocation,
  type TmuxTerminalTarget,
} from "../../shared/terminal-contracts";
import { tmuxFormats } from "../../shared/tmux-values";
import {
  findTerminalLocation,
  requireTerminalTarget,
  terminalLocationFormat,
  terminalLocationMatches,
  terminalSelectionCommands,
} from "./location";

export type TmuxGeometryPolicy = "ignore-size" | "shared";
type TerminalSize = { cols: number; rows: number };
type TerminalInput = Extract<
  TmuxTerminalClientMessage,
  { type: "input" }
>["data"];
type SessionSelection = {
  requestId: number;
  target: TmuxTerminalTarget;
};

type TmuxTerminalSessionOptions = {
  allowInput: boolean;
  backend: TmuxBackend;
  emit: (message: TmuxTerminalServerMessage) => void;
  fail: (cause: unknown) => void;
  geometryPolicy: TmuxGeometryPolicy;
  outputChunkSize: number;
  ptyFactory?: PtyFactory;
  signal: AbortSignal;
};

export const defaultTmuxTerminalOutputChunkSize = 32 * 1_024;

// Builds arguments for the tmux process hosted by the browser's PTY; it does not run tmux itself.
// For example, socket=/tmp/tmux.sock, sessionId=$3, and readyChannel=overmux-ready-123 produce:
//   tmux -S /tmp/tmux.sock attach-session -E -f ignore-size -t '=$3' \
//     \; set-option -Fgq @overmux-ready-123 '#{client_name}' \
//     \; wait-for -S overmux-ready-123
// The result is a visible client attached to $3 and a handshake that reports its tmux client name.
export const tmuxAttachArguments = ({
  geometryPolicy,
  readyChannel,
  sessionId,
  socket,
}: {
  geometryPolicy: TmuxGeometryPolicy;
  readyChannel: string;
  sessionId: string;
  socket: string;
}) => [
  // Select the same tmux server as the backend: -S for a socket path or -L for a named socket.
  ...tmuxSocketArguments(socket),
  // Attach this PTY as a tmux client. -E preserves the PTY environment instead of updating it from tmux.
  "attach-session",
  "-E",
  // With ignore-size, this browser can view the session without shrinking it for other clients.
  ...(geometryPolicy === "ignore-size" ? ["-f", "ignore-size"] : []),
  "-t",
  // For example, =$3 targets session ID $3 exactly rather than using tmux's fuzzy target matching.
  `=${sessionId}`,
  // Start the next command in the same tmux command queue, now scoped to the attached client.
  ";",
  // For example, this stores /dev/pts/8 in @overmux-ready-123. -F expands the format,
  // -g makes the temporary option readable by another client, and -q suppresses option errors.
  "set-option",
  "-Fgq",
  `@${readyChannel}`,
  tmuxFormats.clientName,
  ";",
  // Equivalent to `tmux wait-for -S overmux-ready-123`: wake the backend waiter only after
  // the option contains this PTY's client name. The backend then reads and removes the option.
  "wait-for",
  "-S",
  readyChannel,
];

const terminalEnvironment = () => ({
  COLORTERM: "truecolor",
  TERM: "xterm-256color",
  TERM_PROGRAM: "overmux",
});
const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

// Every tmux command has a deadline, including the attachment handshake. A wedged tmux
// server must not leave a navigation promise or shutdown waiting forever.
const boundedBackend = (backend: TmuxBackend): TmuxBackend => ({
  ...backend,
  run: (args, signal) =>
    backend.run(
      args,
      AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(10_000),
      ]),
    ),
});

// Creates the server side of one browser terminal. Navigation opens `tmux attach-session`
// in a PTY without waiting for renderer geometry. Input goes to that PTY, output goes back
// to the browser, and later requests reuse the same client with `switch-client`.
// Disposing the stream kills this temporary client, not the persistent tmux session.
export const createTmuxTerminalSession = (
  options: TmuxTerminalSessionOptions,
): StreamSession<TmuxTerminalClientMessage> => {
  // Production uses a native PTY; tests can inject a fake with the same observable behavior.
  const factory = options.ptyFactory ?? spawnPty;
  const backend = boundedBackend(options.backend);
  // Either the owning stream or an internal failure can cancel every pending tmux operation.
  const lifecycleController = new AbortController();
  const lifecycleSignal = AbortSignal.any([
    options.signal,
    lifecycleController.signal,
  ]);
  // Output acknowledgements include this ID so an old PTY cannot acknowledge a replacement's data.
  const terminalId = randomUUID();
  // The cached promise makes disposal idempotent when disconnect and failure happen together.
  const lifecycle: { disposal?: Promise<void>; disposed: boolean } = {
    disposed: false,
  };
  // State belonging to the one native tmux client and its PTY process.
  const terminal: {
    clientName?: string;
    dataSubscription?: PtyDisposable;
    exited?: Promise<void>;
    exitSubscription?: PtyDisposable;
    open: boolean;
    process?: PtyProcess;
    location?: TmuxTerminalLocation;
    locationRevision: number;
    observationTask?: Promise<void>;
  } = { open: false, locationRevision: 0 };
  // Request identity provides latest-request-wins behavior: if $3 supersedes $2 during attach,
  // retain the client and finish on $3. The epoch invalidates older location observations.
  const selection: {
    geometry?: TerminalSize;
    observationEpoch: number;
    requested?: SessionSelection;
    selectionTask?: Promise<void>;
  } = { observationEpoch: 0 };
  // Keystrokes received during attach or switch wait here so they cannot reach the old session.
  const queuedInput: { entries: TerminalInput[]; length: number } = {
    entries: [],
    length: 0,
  };
  let notificationSubscription: (() => void) | undefined;

  // Stops the PTY with SIGHUP, then escalates after one second if the process does not exit.
  // This detaches the browser's client while leaving its tmux sessions running.
  const terminateTerminal = async () => {
    const process = terminal.process;
    const exited = terminal.exited;
    if (!process || !exited) {
      return;
    }
    try {
      process.kill("SIGHUP");
    } catch {}
    await Promise.race([exited, delay(1_000)]);
    if (terminal.process === process) {
      try {
        process.kill("SIGKILL");
      } catch {}
      await Promise.race([exited, delay(1_000)]);
    }
  };
  // Cancels work, removes tmux and PTY listeners, and waits for the PTY to terminate.
  const shutDown = async () => {
    lifecycle.disposed = true;
    selection.requested = undefined;
    lifecycleController.abort(new Error("Terminal session disposed"));
    clearInterval(locationPoll);
    await Promise.allSettled([
      selection.selectionTask,
      terminal.observationTask,
    ]);
    notificationSubscription?.();
    await terminateTerminal();
    terminal.dataSubscription?.dispose();
    terminal.exitSubscription?.dispose();
    options.signal.removeEventListener("abort", abort);
  };
  // Shares one shutdown promise across every caller, making repeated disposal safe.
  const dispose = () => {
    if (!lifecycle.disposal) {
      lifecycle.disposal = shutDown();
    }
    return lifecycle.disposal;
  };
  // Cleans up before reporting an unexpected tmux or PTY failure to the stream owner.
  // Errors caused by normal disposal or external cancellation are intentionally ignored.
  const fail = (cause: unknown) => {
    if (lifecycle.disposed || options.signal.aborted) {
      return;
    }
    void dispose().finally(() => options.fail(cause));
  };

  // Sequences PTY output, emits it to the browser, and pauses a PTY whose output is not acknowledged.
  const output = createTerminalOutputFlow({
    emit: options.emit,
    fail,
    outputChunkSize: options.outputChunkSize,
    pauseOutput: () => terminal.process?.pause(),
    resumeOutput: () => terminal.process?.resume(),
    terminalId,
  });

  // Starts `tmux attach-session` in a PTY of the requested size and returns tmux's native
  // client name, such as /dev/pts/8. A unique wait-for channel coordinates this handshake:
  // tmux stores #{client_name}, signals the waiter, and the backend reads and removes the option.
  // PTY data is forwarded to the browser; an unexpected PTY exit fails the stream.
  const spawnTmuxTerminal = async (
    sessionId: string,
    geometry: TerminalSize,
  ) => {
    const readyChannel = `overmux-ready-${randomUUID()}`;
    // The tmux client signals after attach so its native client name can be read safely.
    const attached = backend.run(["wait-for", readyChannel], lifecycleSignal);
    let spawned: PtyProcess;
    try {
      spawned = factory({
        args: tmuxAttachArguments({
          // Navigation can attach before a renderer exists, so 80x24 is only a placeholder.
          // Letting that size participate in tmux's shared sizing could shrink windows
          // already visible in other clients. Ignore this client's size until the renderer
          // reports real dimensions; shared geometry is enabled when that resize is applied.
          geometryPolicy: "ignore-size",
          readyChannel,
          sessionId,
          socket: options.backend.socket,
        }),
        cols: geometry.cols,
        command: "tmux",
        env: terminalEnvironment(),
        rows: geometry.rows,
      });
    } catch (cause) {
      lifecycleController.abort(cause);
      await attached.catch(() => undefined);
      throw cause;
    }
    terminal.process = spawned;
    terminal.exited = new Promise((resolve) => {
      terminal.dataSubscription = spawned.onData((data) => {
        if (!lifecycle.disposed) {
          output.emitOutput(data);
        }
      });
      terminal.exitSubscription = spawned.onExit(({ exitCode, signal }) => {
        if (terminal.process === spawned) {
          terminal.process = undefined;
        }
        resolve();
        if (!lifecycle.disposed && !options.signal.aborted) {
          fail(
            new Error(
              `Tmux terminal client exited (code ${exitCode}, signal ${signal ?? "none"})`,
            ),
          );
        }
      });
    });
    await attached;
    const readyOption = `@${readyChannel}`;
    let clientName: string;
    try {
      clientName = (
        await backend.run(["show-options", "-gv", readyOption], lifecycleSignal)
      ).trim();
    } finally {
      await backend.run(["set-option", "-gu", readyOption], lifecycleSignal);
    }
    if (!clientName) {
      throw new Error("Tmux terminal client did not identify itself");
    }
    return clientName;
  };

  // Reports the full location currently displayed by this browser's tmux client.
  const emitLocation = (location: TmuxTerminalLocation) => {
    if (lifecycle.disposed) {
      return;
    }
    terminal.location = location;
    terminal.locationRevision += 1;
    options.emit({
      location,
      revision: terminal.locationRevision,
      type: "location-changed",
    });
  };
  const readLocation = async () => {
    const clients = await backend.run(
      ["list-clients", "-F", terminalLocationFormat],
      lifecycleSignal,
    );
    const location =
      terminal.clientName && findTerminalLocation(clients, terminal.clientName);
    if (!location) {
      throw new Error("Tmux terminal client is no longer attached");
    }
    return location;
  };
  const observeLocation = () => {
    if (
      lifecycle.disposed ||
      !terminal.open ||
      selection.selectionTask ||
      terminal.observationTask
    ) {
      return;
    }
    const epoch = selection.observationEpoch;
    const task = readLocation().then((location) => {
      // Discard an observation started before a navigation: its query may finish later.
      if (
        epoch === selection.observationEpoch &&
        (!terminal.location ||
          !terminalLocationMatches(location, terminal.location))
      ) {
        emitLocation(location);
      }
    });
    terminal.observationTask = task;
    void task.catch(fail).finally(() => {
      if (terminal.observationTask === task) {
        terminal.observationTask = undefined;
      }
    });
  };
  // Forwards tmux-native switches for this client, such as a keybinding moving /dev/pts/8 to $4.
  // Notifications for every other attached tmux client are ignored.
  const onNotification = (event: TmuxControlNotification) => {
    if (
      event.type === "client-session-changed" &&
      event.clientName !== terminal.clientName
    ) {
      return;
    }
    observeLocation();
  };
  notificationSubscription = backend.subscribeNotifications(onNotification);
  // tmux control notifications omit window/pane changes in sessions other than the control
  // client's session (verified with tmux 3.6a). Poll only attached viewers to cover that gap.
  const locationPoll = setInterval(observeLocation, 250);
  locationPoll.unref();

  // Resizes the PTY; tmux observes the new browser dimensions through that terminal.
  const applyTerminalGeometry = ({ cols, rows }: TerminalSize) => {
    terminal.process?.resize(cols, rows);
    if (terminal.clientName && options.geometryPolicy === "shared") {
      void backend
        .run(
          ["refresh-client", "-t", terminal.clientName, "-f", "!ignore-size"],
          lifecycleSignal,
        )
        .catch(fail);
    }
  };
  // Writes text directly and converts binary protocol input into the Buffer expected by the PTY.
  const writeTerminalInput = (data: TerminalInput) =>
    terminal.process?.write(
      typeof data === "string" ? data : Buffer.from(data),
    );
  // Sends keystrokes queued during selection once the requested session is definitely current.
  const flushQueuedInput = () => {
    if (!queuedInput.length || !terminal.process) {
      return;
    }
    queuedInput.entries.forEach(writeTerminalInput);
    queuedInput.entries.length = 0;
    queuedInput.length = 0;
  };
  // Buffers early input with a hard limit so a client cannot grow server memory indefinitely.
  const queueTerminalInput = (data: TerminalInput) => {
    queuedInput.length += data.length;
    if (queuedInput.length > tmuxTerminalInputLimit) {
      throw new Error(
        "Terminal received too much input before selecting a session",
      );
    }
    queuedInput.entries.push(data);
  };
  // Drops input for read-only terminals, queues it during selection, and otherwise writes it now.
  // For example, keys typed while switching from $2 to $3 are held instead of leaking into $2.
  const writePermittedInput = (data: TerminalInput) => {
    if (!options.allowInput) {
      return;
    }
    if (selection.requested || !terminal.process) {
      queueTerminalInput(data);
      return;
    }
    writeTerminalInput(data);
  };

  // Opens and identifies the first native client, then applies any renderer geometry
  // that arrived during attachment. The caller validates and confirms the navigation target.
  // If the request becomes stale after spawning, the client is kept and switched by the next task.
  const openTmuxTerminal = async (
    request: SessionSelection,
    initialGeometry: TerminalSize,
    isCurrent: () => boolean,
  ) => {
    if (lifecycle.disposed || lifecycleSignal.aborted || !isCurrent()) {
      return false;
    }
    const attachedClientName = await spawnTmuxTerminal(
      request.target.sessionId,
      initialGeometry,
    );
    if (lifecycle.disposed || lifecycleSignal.aborted) {
      return false;
    }
    // A stale initial attach is retained; the serialized selection task switches it next.
    // wait-for runs after attach-session in the same native command queue. Its signal and
    // stored client name establish readiness; the final location query confirms selection.
    terminal.clientName = attachedClientName;
    // A resize can arrive while tmux is attaching, so finish with the latest geometry.
    if (selection.geometry) {
      applyTerminalGeometry(selection.geometry);
    }
    return true;
  };
  // Reuses the existing client for later selections. For example, moving /dev/pts/8 to $4 runs
  // `tmux switch-client -c /dev/pts/8 -t '=$4'` after verifying that $4 still exists.
  const switchTmuxTerminal = async (
    request: SessionSelection,
    isCurrent: () => boolean,
  ) => {
    if (!isCurrent()) {
      return;
    }
    if (!terminal.clientName) {
      throw new Error("Tmux terminal client is not ready");
    }
    // Control mode quotes each argument, so command separators would become literal data.
    // Submit commands separately and stop before further selection if a newer request arrives.
    for (const args of terminalSelectionCommands(
      terminal.clientName,
      request.target,
    )) {
      if (!isCurrent() || lifecycleSignal.aborted) {
        return;
      }
      await backend.run(args, lifecycleSignal);
    }
  };

  // Applies one serialized request by opening the first client or switching the existing one.
  // Only the current request can confirm and release queued input. Target failures reject that
  // request; attachment/transport failures remain fatal. Superseded failures are ignored.
  const applyTerminalSelection = async (
    request: SessionSelection,
    initialGeometry: TerminalSize,
  ) => {
    const isCurrent = () => request === selection.requested;
    try {
      await requireTerminalTarget(backend, request.target, lifecycleSignal);
      if (!terminal.open) {
        terminal.open = await openTmuxTerminal(
          request,
          initialGeometry,
          isCurrent,
        );
      }
      if (!terminal.open || !isCurrent() || lifecycle.disposed) {
        return;
      }
      await switchTmuxTerminal(request, isCurrent);
      const location = await readLocation();
      if (!isCurrent() || lifecycle.disposed) {
        return;
      }
      emitLocation(location);
      // An in-process emitter may synchronously request another target or dispose this stream.
      if (!isCurrent() || lifecycle.disposed) {
        return;
      }
      if (!terminalLocationMatches(location, request.target)) {
        throw new Error(
          "Tmux selection changed before navigation could be confirmed",
        );
      }
      options.emit({
        type: "go-to-result",
        requestId: request.requestId,
        result: {
          outcome: "success",
          location,
          revision: terminal.locationRevision,
        },
      });
      if (isCurrent()) {
        selection.requested = undefined;
        flushQueuedInput();
      }
    } catch (cause) {
      if (!isCurrent() || lifecycle.disposed) {
        return;
      }
      // Invalid or vanished targets reject only this request, not the reusable terminal.
      // Never send keys queued for a failed destination to the old session.
      selection.requested = undefined;
      queuedInput.entries.length = 0;
      queuedInput.length = 0;
      options.emit({
        type: "go-to-result",
        requestId: request.requestId,
        result: {
          outcome: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        },
      });
      if (lifecycleSignal.aborted || (terminal.process && !terminal.open)) {
        fail(cause);
      }
    }
  };
  // Runs one navigation task at a time, then checks for a newer pending request.
  // Attachment can start before geometry: its 80x24 bootstrap is excluded from shared sizing.
  const applyLatestTerminalSelection = () => {
    const request = selection.requested;
    const geometry = selection.geometry ?? { cols: 80, rows: 24 };
    if (lifecycle.disposed || selection.selectionTask || !request) {
      return;
    }
    const task = applyTerminalSelection(request, geometry);
    selection.selectionTask = task;
    void task.catch(fail).finally(() => {
      if (selection.selectionTask === task) {
        selection.selectionTask = undefined;
      }
      applyLatestTerminalSelection();
      observeLocation();
    });
  };
  // Replaces the pending request and invalidates observations started before this intent.
  const goTo = (
    message: Extract<TmuxTerminalClientMessage, { type: "go-to" }>,
  ) => {
    const previous = selection.requested;
    if (previous) {
      options.emit({
        type: "go-to-result",
        requestId: previous.requestId,
        result: {
          outcome: "error",
          message: "Tmux navigation superseded by a newer request",
        },
      });
    }
    selection.observationEpoch += 1;
    selection.requested = {
      requestId: message.requestId,
      target: message.target,
    };
    applyLatestTerminalSelection();
  };
  // Saves renderer geometry and immediately resizes an open PTY. Repeated identical sizes do no work.
  const resizeTerminal = (geometry: TerminalSize) => {
    if (
      selection.geometry?.cols === geometry.cols &&
      selection.geometry.rows === geometry.rows
    ) {
      return;
    }
    selection.geometry = geometry;
    applyTerminalGeometry(geometry);
    applyLatestTerminalSelection();
  };

  // Routes browser messages: go-to opens or switches, resize changes the PTY, input
  // writes or queues keystrokes, and rendered acknowledges output for backpressure.
  const onMessage = (message: TmuxTerminalClientMessage) => {
    if (lifecycle.disposed) {
      return;
    }
    if (message.type === "go-to") {
      goTo(message);
      return;
    }
    if (message.type === "redraw") {
      if (terminal.clientName) {
        void backend
          .run(["refresh-client", "-t", terminal.clientName], lifecycleSignal)
          .catch(fail);
      }
      return;
    }
    if (message.type === "resize") {
      resizeTerminal(message);
      return;
    }
    if (message.type === "input") {
      writePermittedInput(message.data);
      return;
    }
    output.acknowledgeOutput(message);
  };

  // Adapts the owning stream's synchronous abort event to this session's asynchronous cleanup.
  const abort = () => void dispose();
  if (options.signal.aborted) {
    abort();
  } else {
    options.signal.addEventListener("abort", abort, { once: true });
  }
  // The stream sends browser messages through onMessage and disposes this session on disconnect.
  return { dispose, onMessage };
};
