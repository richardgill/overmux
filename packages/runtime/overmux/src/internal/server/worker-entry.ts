import { parentPort } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { isServerLogEnabled, serializeServerLogEntry } from "./server-logger";
import { loadOvermuxConfig } from "@overmux/shared/node";
import { protocolVersion } from "../shared/index";
import { createRuntime } from "./runtime/create-runtime";
import {
  serializeWorkerError,
  workerLimits,
  encodeWorkerMessage,
  decodeWorkerMessage,
  postWorkerMessage,
  type WorkerRequest,
  type WorkerEvent,
  type WorkerInit,
} from "./runtime/worker-protocol";

if (!parentPort) {
  throw new Error("Overmux worker requires a parent port");
}
const port = parentPort;

type Lifetime = {
  controller: AbortController;
  setup: Promise<void>;
  prepared: () => void;
  closing?: Promise<void>;
  dispose?: () => Promise<void>;
  send?: (message: unknown) => Promise<void>;
};
type Control =
  | { type: "cancel"; requestId: number }
  | { type: "close"; sessionId: number }
  | { type: "ack"; deliveryId: number }
  | { type: "shutdown" }
  | { type: "notification-result"; id: number; ok: boolean; error?: string };

const requests = new Map<number, AbortController>();
// IDs are unique across requests, subscriptions, and streams.
const lifetimes = new Map<number, Lifetime>();
const invalidations = new Map<number, { deliveryId: number; dirty: boolean }>();
const deliveries = new Map<
  number,
  { bytes: number; sessionId?: number; log: boolean }
>();
const notifications = new Map<
  number,
  { resolve: () => void; reject: (cause: Error) => void }
>();
let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
let instanceId: string | undefined;
let stopping = false;
let deliveryId = 0;
let notificationId = 0;
let deliveryBytes = 0;
let logCount = 0;
let logBytes = 0;
let logsSaturated = false;

const send = (
  message:
    | WorkerEvent
    | {
        type: "reply";
        id: number;
        ok: boolean;
        value?: unknown;
        error?: ReturnType<typeof serializeWorkerError>;
      },
) => {
  const envelope = { ...message, deliveryId: ++deliveryId };
  const packet = encodeWorkerMessage(envelope);
  const bytes = packet.byteLength;
  const data =
    message.type === "stream-output" ||
    message.type === "invalidate" ||
    message.type === "notification" ||
    message.type === "log";
  // Leave room for every admitted request's failure and each active stream's final error.
  const countLimit = data
    ? workerLimits.eventCount -
      workerLimits.pendingRequests -
      2 * workerLimits.lifetimes
    : workerLimits.eventCount;
  const byteLimit = data
    ? workerLimits.eventBytes - 256 * 1024
    : workerLimits.eventBytes;
  if (
    bytes > workerLimits.messageBytes ||
    deliveries.size >= countLimit ||
    deliveryBytes + bytes > byteLimit ||
    (message.type === "log" &&
      (logCount >= workerLimits.logCount ||
        logBytes + bytes > workerLimits.logBytes))
  ) {
    if (message.type === "log") {
      logsSaturated = logCount > 0;
    }
    throw new Error("Worker output queue is full or message exceeds 1 MiB");
  }
  deliveries.set(deliveryId, {
    bytes,
    log: message.type === "log",
    ...(message.type === "invalidate" ? { sessionId: message.sessionId } : {}),
  });
  deliveryBytes += bytes;
  if (message.type === "log") {
    logCount += 1;
    logBytes += bytes;
  }
  postWorkerMessage(port, packet);
  return deliveryId;
};

const closeLifetime = (id: number): Promise<void> => {
  const lifetime = lifetimes.get(id);
  if (!lifetime) {
    return Promise.resolve();
  }
  if (lifetime.closing) {
    return lifetime.closing;
  }
  invalidations.delete(id);
  lifetime.controller.abort(new Error("Worker lifetime closed"));
  // Closing resources still consume lifetime capacity until setup and cleanup settle.
  // Otherwise repeated open/close could retain arbitrarily many slow user disposers.
  lifetime.closing = lifetime.setup.then(async () => {
    try {
      await lifetime.dispose?.();
    } finally {
      if (lifetimes.get(id) === lifetime) {
        lifetimes.delete(id);
      }
    }
  });
  return lifetime.closing;
};

const failStream = (id: number, cause: unknown) => {
  const lifetime = lifetimes.get(id);
  if (!lifetime || lifetime.closing) {
    return;
  }
  // Abort ownership before user cleanup. A noisy source can report only one failure.
  void closeLifetime(id).catch(fatal);
  send({
    type: "stream-error",
    sessionId: id,
    error: serializeWorkerError(cause),
  });
};

const invalidate = (id: number) => {
  if (
    !lifetimes.has(id) ||
    lifetimes.get(id)?.controller.signal.aborted ||
    stopping
  ) {
    return;
  }
  const pending = invalidations.get(id);
  if (pending) {
    pending.dirty = true;
    return;
  }
  invalidations.set(id, {
    deliveryId: send({ type: "invalidate", sessionId: id }),
    dirty: false,
  });
};

const acknowledge = (id: number) => {
  const delivery = deliveries.get(id);
  if (!delivery) {
    return;
  }
  deliveries.delete(id);
  deliveryBytes -= delivery.bytes;
  if (delivery.log) {
    logsSaturated = false;
    logCount -= 1;
    logBytes -= delivery.bytes;
  }
  if (delivery.sessionId !== undefined) {
    const pending = invalidations.get(delivery.sessionId);
    invalidations.delete(delivery.sessionId);
    if (pending?.dirty) {
      invalidate(delivery.sessionId);
    }
  }
};

const fatal = (cause: unknown) => {
  if (stopping) {
    return;
  }
  stopping = true;
  // Fatal reporting bypasses credits exactly once; never suppress default worker death.
  postWorkerMessage(
    port,
    encodeWorkerMessage({ type: "fatal", error: serializeWorkerError(cause) }),
  );
  process.exit(1);
};

const load = async ({
  configPath,
  aliases,
  logLevel,
  role,
  stream,
}: WorkerInit) => {
  const { config } = await loadOvermuxConfig({ configPath, aliases });
  const { server, instanceId: configuredIdentity, ...settings } = config;
  const manifest = {
    logLevel: logLevel ?? config.logLevel ?? "info",
    protocolVersion,
    resources: Object.keys(server.resources),
    operations: Object.keys(server.operations ?? {}),
    streams: Object.keys(server.streams ?? {}),
  };
  if (manifest.streams.length > workerLimits.streams) {
    throw new Error("Application stream worker limit exceeded");
  }
  if (role === "stream" && (!stream || !server.streams?.[stream])) {
    throw new Error("Stream definition not found");
  }
  if (role !== "metadata") {
    runtime = await createRuntime({
      config: {
        ...config,
        instanceId:
          role === "application"
            ? configuredIdentity
            : () => {
                if (!instanceId) {
                  throw new Error("Worker identity is not established");
                }
                return instanceId;
              },
        server:
          role === "application"
            ? { resources: server.resources, operations: server.operations }
            : {
                resources: {},
                streams: { [stream!]: server.streams![stream!] },
              },
      },
      serverLogger: {
        logLevel: manifest.logLevel,
        id: randomUUID,
        log: (entry) => {
          // Logs share receipt credits but have a much smaller budget. Drop at
          // saturation, before serialization, reserving work/control capacity.
          // Do not gate on stopping: cleanup closures may still log after abort.
          if (
            !isServerLogEnabled(manifest.logLevel, entry) ||
            logsSaturated ||
            logCount >= workerLimits.logCount ||
            logBytes >= workerLimits.logBytes
          ) {
            return;
          }
          try {
            send({ type: "log", entry: serializeServerLogEntry(entry) });
          } catch {
            // Best effort, including oversize entries and closed transports.
          }
        },
      },
      notifications: {
        send: async (notification) => {
          if (stopping || notifications.size >= workerLimits.notifications) {
            throw new Error("Worker notification queue is full or disposed");
          }
          const id = ++notificationId;
          await new Promise<void>((resolve, reject) => {
            notifications.set(id, { resolve, reject });
            try {
              send({ type: "notification", id, notification });
            } catch (cause) {
              notifications.delete(id);
              reject(cause);
            }
          });
        },
      },
    });
  }
  postWorkerMessage(
    port,
    encodeWorkerMessage({
      type: "ready",
      manifest,
      settings,
      voidOperations: manifest.operations.filter(
        (name) => runtime?.getOperation(name)?.returnsVoid,
      ),
    }),
  );
};

const createLifetime = (id: number, controller: AbortController) => {
  if (lifetimes.size >= workerLimits.lifetimes) {
    throw new Error("Worker lifetime limit reached");
  }
  if (lifetimes.has(id)) {
    throw new Error("Duplicate worker lifetime ID");
  }
  let prepared!: () => void;
  const setup = new Promise<void>((resolveSetup) => {
    prepared = resolveSetup;
  });
  const lifetime: Lifetime = { controller, setup, prepared };
  lifetimes.set(id, lifetime);
  return lifetime;
};

const execute = async (message: WorkerRequest, controller: AbortController) => {
  if (!runtime || stopping) {
    throw new Error("Worker is unavailable");
  }
  if (message.action === "initialize-instance-identity") {
    instanceId = message.instanceId;
    return runtime.establishInstance(message.port!);
  }
  if (message.action === "resource-read") {
    const resource = runtime.getResource(message.name!);
    if (!resource) {
      throw new Error("Resource not found");
    }
    return resource.read(message.input, controller.signal, message.correlation);
  }
  if (message.action === "operation") {
    const operation = runtime.getOperation(message.name!);
    if (!operation) {
      throw new Error("Operation not found");
    }
    return operation.execute(
      message.input,
      controller.signal,
      message.correlation,
    );
  }
  if (message.action === "stream-message") {
    const lifetime = lifetimes.get(message.sessionId!);
    if (!lifetime?.send) {
      throw new Error("Stream not found");
    }
    return lifetime.send(message.message);
  }
  const id = message.sessionId!;
  const lifetime = createLifetime(id, controller);
  try {
    if (message.action === "stream-open") {
      const stream = runtime.getStream(message.name!);
      if (!stream) {
        throw new Error("Stream not found");
      }
      const session = await stream.open(
        message.input,
        (output) => {
          if (
            lifetimes.get(id) === lifetime &&
            !controller.signal.aborted &&
            !stopping
          ) {
            send({ type: "stream-output", sessionId: id, message: output });
          }
        },
        controller.signal,
        (cause) => failStream(id, cause),
        message.correlation,
      );
      lifetime.dispose = session.dispose;
      lifetime.send = session.send;
    } else {
      const resource = runtime.getResource(message.name!);
      if (!resource) {
        throw new Error("Resource not found");
      }
      const dispose = await resource.subscribe(
        message.input,
        () => invalidate(id),
        controller.signal,
        undefined,
        message.correlation,
      );
      lifetime.dispose = async () => dispose();
    }
    // Close can arrive during asynchronous setup, even after the request controller settles.
    if (controller.signal.aborted || lifetimes.get(id) !== lifetime) {
      await lifetime.dispose?.();
      controller.signal.throwIfAborted();
      throw new Error("Worker lifetime closed during setup");
    }
  } catch (cause) {
    if (lifetimes.get(id) === lifetime && !lifetime.closing) {
      lifetimes.delete(id);
    }
    invalidations.delete(id);
    throw cause;
  } finally {
    lifetime.prepared();
  }
};

const handleRequest = async (message: WorkerRequest) => {
  const controller = new AbortController();
  requests.set(message.id, controller);
  try {
    const value = await execute(message, controller);
    send({ type: "reply", id: message.id, ok: true, value });
  } catch (cause) {
    try {
      send({
        type: "reply",
        id: message.id,
        ok: false,
        error: serializeWorkerError(cause),
      });
    } catch (sendCause) {
      fatal(sendCause);
    }
  } finally {
    requests.delete(message.id);
  }
};

const shutdown = async () => {
  if (stopping) {
    return;
  }
  stopping = true;
  requests.forEach((controller) =>
    controller.abort(new Error("Worker disposed")),
  );
  notifications.forEach(({ reject }) => reject(new Error("Worker disposed")));
  notifications.clear();
  await Promise.all([
    ...[...lifetimes.keys()].map(closeLifetime),
    runtime?.dispose(),
  ]);
  postWorkerMessage(port, encodeWorkerMessage({ type: "disposed" }));
};

const handleControl = (message: Control) => {
  if (message.type === "ack") {
    acknowledge(message.deliveryId);
  }
  if (message.type === "cancel") {
    requests.get(message.requestId)?.abort(new Error("Request cancelled"));
  }
  if (message.type === "close") {
    void closeLifetime(message.sessionId)
      .then(
        () => send({ type: "closed", sessionId: message.sessionId }),
        (cause) =>
          send({
            type: "closed",
            sessionId: message.sessionId,
            error: serializeWorkerError(cause),
          }),
      )
      .catch(fatal);
  }
  if (message.type === "shutdown") {
    void shutdown().catch((cause) =>
      postWorkerMessage(
        port,
        encodeWorkerMessage({
          type: "fatal",
          error: serializeWorkerError(cause),
        }),
      ),
    );
  }
  if (message.type === "notification-result") {
    const pending = notifications.get(message.id);
    notifications.delete(message.id);
    message.ok ? pending?.resolve() : pending?.reject(new Error(message.error));
  }
};

port.on("message", (packet: Uint8Array) => {
  try {
    const message = decodeWorkerMessage<WorkerInit | Control | WorkerRequest>(
      packet,
    );
    if ("action" in message) {
      void handleRequest(message);
      return;
    }
    if (message.type === "init") {
      void load(message).catch(fatal);
      return;
    }
    handleControl(message);
  } catch (cause) {
    fatal(cause);
  }
});
process.once("uncaughtException", fatal);
process.once("unhandledRejection", fatal);
