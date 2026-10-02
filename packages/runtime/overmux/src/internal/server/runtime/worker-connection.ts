import { Worker } from "node:worker_threads";
import type { Notifications } from "../../../public/notifications";
import {
  deserializeWorkerError,
  workerLimits,
  encodeWorkerMessage,
  decodeWorkerMessage,
  postWorkerMessage,
  type WorkerDelivery,
  type WorkerError,
  type WorkerRequest,
  type WorkerInit,
  type WorkerReady,
} from "./worker-protocol";

type WorkerState =
  | { status: "starting"; timer: ReturnType<typeof setTimeout> }
  | { status: "ready" }
  | {
      status: "stopping";
      cause: Error;
      completion: Promise<void>;
      finish: () => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | { status: "stopped"; cause: Error; completion: Promise<void> };

type RequestResult =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown };
// Caller settlement and remote ownership are independent: cancellation removes the
// abort listener and rejects the caller, but retains count/byte credits until reply/death.
type PendingRequest = {
  bytes: number;
  caller:
    | { status: "waiting"; settle: (result: RequestResult) => void }
    | { status: "settled" };
};
type SessionState =
  | { status: "opening"; admission: "local" | "remote" }
  | { status: "open" }
  | {
      status: "closing";
      completion: Promise<void>;
      resolve: () => void;
      reject: (cause: Error) => void;
      failure?: Error;
    }
  | { status: "closed"; completion: Promise<void>; failure?: Error };

type OpenSessionOptions = {
  action: "resource-subscribe" | "stream-open";
  name: string;
  input: unknown;
  signal?: AbortSignal;
  onEvent: (value: unknown) => void;
  onError?: (cause: Error) => void;
};
type RemoteSession = {
  id: number;
  close: () => Promise<void>;
  assertOpen: () => void;
};
type OwnedSession = RemoteSession & {
  getFailure: () => Error | undefined;
  markSent: () => void;
  opened: () => void;
  deliver: (value: unknown) => void;
  fail: (cause: Error) => void;
  finishClose: (cause?: Error) => void;
  terminate: (cause: Error) => void;
};

type WorkerMessage =
  | WorkerDelivery
  | WorkerReady
  | { type: "fatal"; error: WorkerError }
  | { type: "disposed" };

export type WorkerConnection = {
  ready: Promise<WorkerReady>;
  request: (
    message: Omit<WorkerRequest, "id">,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  openSession: (options: OpenSessionOptions) => Promise<RemoteSession>;
  stop: () => Promise<void>;
  terminate: (cause: Error) => Promise<void>;
};

type ConnectionOptions = {
  name: string;
  init: WorkerInit;
  notifications: Notifications;
  startupMs: number;
  shutdownMs: number;
};

const deliverNotification = async (
  message: Extract<WorkerDelivery, { type: "notification" }>,
  notifications: Notifications,
  postControl: (message: object) => void,
) => {
  // Return receipt credits before invoking even synchronous notification service work.
  await Promise.resolve();
  try {
    await notifications.send(message.notification as never);
    postControl({ type: "notification-result", id: message.id, ok: true });
  } catch (cause) {
    postControl({
      type: "notification-result",
      id: message.id,
      ok: false,
      error: String(cause).slice(0, 8192),
    });
  }
};

let sequence = 0;
const nextId = () => ++sequence;
const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));
// Error-reporting callbacks cannot escape the bridge, including during worker death.
const contain = (callback: () => void) => {
  try {
    callback();
  } catch {
    // A failure-reporting callback must not escape into the transport process.
  }
};
const settleCaller = (pending: PendingRequest, result: RequestResult) => {
  if (pending.caller.status === "settled") {
    return;
  }
  const { settle } = pending.caller;
  pending.caller = { status: "settled" };
  settle(result);
};

const ownSession = ({
  id,
  options,
  postClose,
  release,
}: {
  id: number;
  options: OpenSessionOptions;
  postClose: () => void;
  release: () => void;
}): OwnedSession => {
  let state: SessionState = { status: "opening", admission: "local" };
  const detach = () => options.signal?.removeEventListener("abort", abort);
  const close = (failure?: Error): Promise<void> => {
    if (state.status === "closed" || state.status === "closing") {
      return state.completion;
    }
    detach();
    if (state.status === "opening" && state.admission === "local") {
      state = { status: "closed", completion: Promise.resolve(), failure };
      release();
      return state.completion;
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    state = {
      status: "closing",
      completion: promise,
      resolve,
      reject,
      failure,
    };
    // Signal/error paths cannot await cleanup; explicit disposals still observe its result.
    void promise.catch(() => undefined);
    postClose();
    return promise;
  };
  const abort = () => {
    void close();
  };
  const fail = (cause: Error) => {
    if (state.status === "closing" || state.status === "closed") {
      return;
    }
    void close(cause);
    contain(() => options.onError?.(cause));
  };
  const finishClose = (cause?: Error) => {
    if (state.status !== "closing") {
      return;
    }
    const closing = state;
    state = {
      status: "closed",
      completion: closing.completion,
      failure: closing.failure ?? cause,
    };
    release();
    cause ? closing.reject(cause) : closing.resolve();
  };
  const assertOpen = () => {
    if (state.status === "opening") {
      throw new Error("Session is still opening");
    }
    if (state.status === "closing" || state.status === "closed") {
      throw (
        state.failure ??
        new Error(
          options.action === "stream-open"
            ? "Stream is closed"
            : "Subscription is closed",
        )
      );
    }
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  return {
    id,
    close: () => close(),
    assertOpen,
    fail,
    finishClose,
    getFailure: () =>
      state.status === "closing" || state.status === "closed"
        ? state.failure
        : undefined,
    markSent: () => {
      if (state.status === "opening") {
        state = { status: "opening", admission: "remote" };
      }
    },
    opened: () => {
      if (state.status === "opening") {
        state = { status: "open" };
      }
      assertOpen();
    },
    deliver: (value) => {
      if (state.status !== "opening" && state.status !== "open") {
        return;
      }
      try {
        options.onEvent(value);
      } catch (cause) {
        // Main encoding/socket callbacks are outside the leaf runtime's try/catch.
        // Release precisely this lifetime before notifying; other workers remain usable.
        fail(asError(cause));
      }
    },
    terminate: (cause) => {
      if (state.status === "closed") {
        return;
      }
      if (state.status === "closing") {
        finishClose(cause);
        return;
      }
      detach();
      state = {
        status: "closed",
        completion: Promise.resolve(),
        failure: cause,
      };
      release();
      contain(() => options.onError?.(cause));
    },
  };
};

// These closures own one worker's lifecycle. No receiver, timer, or adapter outside
// this connection can release its requests, sessions, or transport credits.
export const createWorkerConnection = (
  options: ConnectionOptions,
): WorkerConnection => {
  const worker = new Worker(new URL(import.meta.resolve("#worker-entry")));
  const startup = Promise.withResolvers<WorkerReady>();
  const pending = new Map<number, PendingRequest>();
  const sessions = new Map<number, OwnedSession>();
  let pendingBytes = 0;
  let state: WorkerState = {
    status: "starting",
    timer: setTimeout(() => {
      void terminate(
        new Error(`Worker ${options.name} startup deadline exceeded`),
      );
    }, options.startupMs),
  };

  const terminate = (cause: Error): Promise<void> => {
    if (state.status === "stopped") {
      return state.completion;
    }
    const previous = state;
    if (previous.status === "starting" || previous.status === "stopping") {
      clearTimeout(previous.timer);
    }
    const completion = worker.terminate().then(() => undefined);
    state = { status: "stopped", cause, completion };
    if (previous.status === "starting") {
      startup.reject(cause);
    }
    if (previous.status === "stopping") {
      void completion.then(previous.finish, previous.finish);
    }
    pending.forEach((request) =>
      settleCaller(request, { ok: false, error: cause }),
    );
    pending.clear();
    pendingBytes = 0;
    sessions.forEach((session) => session.terminate(cause));
    return completion;
  };
  const postControl = (message: object) => {
    if (state.status === "stopped") {
      return;
    }
    try {
      postWorkerMessage(worker, encodeWorkerMessage(message));
    } catch (cause) {
      void terminate(asError(cause));
    }
  };
  const requireReady = () => {
    if (state.status === "stopping" || state.status === "stopped") {
      throw state.cause;
    }
    if (state.status !== "ready") {
      throw new Error(`Worker ${options.name} is not ready`);
    }
  };
  const request = async (
    message: Omit<WorkerRequest, "id">,
    signal?: AbortSignal,
    onSent?: () => void,
  ): Promise<unknown> => {
    signal?.throwIfAborted();
    requireReady();
    const id = nextId();
    const packet = encodeWorkerMessage({ ...message, id });
    signal?.throwIfAborted();
    const bytes = packet.byteLength;
    if (
      pending.size >= workerLimits.pendingRequests ||
      pendingBytes + bytes > workerLimits.pendingBytes
    ) {
      throw new Error(
        `Worker ${options.name} request queue is full or payload exceeds 1 MiB`,
      );
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        settleCaller(owned, { ok: false, error: signal?.reason });
        // Cancel has one owner per pending request; it never competes for data credits.
        postControl({ type: "cancel", requestId: id });
      };
      const owned: PendingRequest = {
        bytes,
        caller: {
          status: "waiting",
          settle: (result) => {
            signal?.removeEventListener("abort", abort);
            result.ok ? resolve(result.value) : reject(result.error);
          },
        },
      };
      pending.set(id, owned);
      pendingBytes += bytes;
      signal?.addEventListener("abort", abort, { once: true });
      try {
        postWorkerMessage(worker, packet);
        onSent?.();
      } catch (cause) {
        pending.delete(id);
        pendingBytes -= bytes;
        settleCaller(owned, { ok: false, error: cause });
      }
    });
  };
  const openSession = async (
    sessionOptions: OpenSessionOptions,
  ): Promise<RemoteSession> => {
    sessionOptions.signal?.throwIfAborted();
    requireReady();
    if (sessions.size >= workerLimits.lifetimes) {
      throw new Error("Worker lifetime limit reached");
    }
    const id = nextId();
    const session = ownSession({
      id,
      options: sessionOptions,
      postClose: () => postControl({ type: "close", sessionId: id }),
      release: () => sessions.delete(id),
    });
    // Register before send: output can precede the setup reply. Closing keeps this
    // capacity occupied until remote cleanup completes or the worker dies.
    sessions.set(id, session);
    const { action, name, input, signal } = sessionOptions;
    try {
      await request(
        {
          action,
          name,
          input,
          sessionId: id,
        },
        signal,
        session.markSent,
      );
      signal?.throwIfAborted();
      session.opened();
      return session;
    } catch (cause) {
      const failure = session.getFailure();
      void session.close();
      throw failure ?? cause;
    }
  };
  const handleReady = (message: WorkerReady) => {
    if (state.status !== "starting") {
      throw new Error("Unexpected worker ready message");
    }
    clearTimeout(state.timer);
    state = { status: "ready" };
    // Import readiness is separate from the later instance identity request.
    startup.resolve(message);
  };
  const handleRequestReply = (
    message: Extract<WorkerDelivery, { type: "reply" }>,
  ) => {
    // Validate before releasing ownership so bridge failure rejects this request too.
    const result: RequestResult = message.ok
      ? { ok: true, value: message.value }
      : { ok: false, error: deserializeWorkerError(message.error) };
    const owned = pending.get(message.id);
    if (!owned) {
      return;
    }
    pending.delete(message.id);
    pendingBytes -= owned.bytes;
    settleCaller(owned, result);
  };
  const handleDelivery = (message: WorkerDelivery) => {
    try {
      if (message.type === "reply") {
        handleRequestReply(message);
      }
      if (message.type === "closed") {
        const error =
          message.error === undefined
            ? undefined
            : deserializeWorkerError(message.error);
        sessions.get(message.sessionId)?.finishClose(error);
      }
      if (message.type === "invalidate") {
        sessions.get(message.sessionId)?.deliver(undefined);
      }
      if (message.type === "stream-output") {
        sessions.get(message.sessionId)?.deliver(message.message);
      }
      if (message.type === "stream-error") {
        const error = deserializeWorkerError(message.error);
        sessions.get(message.sessionId)?.fail(error);
      }
      if (message.type === "notification") {
        // Await semantics survive IPC. The worker caps outstanding delivery promises.
        void deliverNotification(message, options.notifications, postControl);
      }
    } finally {
      // Receipt credits are distinct from tmux's end-to-end rendered acknowledgements.
      postControl({ type: "ack", deliveryId: message.deliveryId });
    }
  };
  const receive = (packet: Uint8Array) => {
    if (state.status === "stopped") {
      return;
    }
    try {
      const message = decodeWorkerMessage<WorkerMessage>(packet);
      if (message.type === "ready") {
        handleReady(message);
      } else if (message.type === "fatal") {
        void terminate(deserializeWorkerError(message.error));
      } else if (message.type === "disposed") {
        if (state.status !== "stopping") {
          throw new Error("Unexpected worker disposed message");
        }
        void terminate(state.cause);
      } else {
        handleDelivery(message);
      }
    } catch (cause) {
      void terminate(asError(cause));
    }
  };
  const stop = (): Promise<void> => {
    if (state.status === "stopped" || state.status === "stopping") {
      return state.completion;
    }
    const cause = new Error("Worker runtime disposed");
    if (state.status === "starting") {
      return terminate(cause);
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    // Cleanup gets one bounded chance, including a stuck synchronous handler/disposer.
    state = {
      status: "stopping",
      cause,
      completion: promise,
      finish: resolve,
      timer: setTimeout(() => {
        void terminate(cause);
      }, options.shutdownMs),
    };
    pending.forEach((owned) =>
      settleCaller(owned, { ok: false, error: cause }),
    );
    sessions.forEach((session) => session.fail(cause));
    // Stopping rejects ordinary requests but still receives replies and admits controls.
    postControl({ type: "shutdown" });
    return promise;
  };

  worker.on("message", receive);
  worker.on("error", (cause) => {
    void terminate(cause);
  });
  worker.on("exit", (code) => {
    const phase = state.status === "starting" ? " during startup" : "";
    void terminate(
      new Error(`Worker ${options.name} exited${phase} (${code})`),
    );
  });
  postControl(options.init);
  return { ready: startup.promise, request, openSession, stop, terminate };
};
