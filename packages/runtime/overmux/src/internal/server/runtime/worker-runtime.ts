import type { RuntimeConfigSettings } from "@overmux/shared/node";
import type { ServerLogger } from "../server-logger";
import type { InstanceIdentity } from "../../../public/index";
import type { Notifications } from "../../../public/notifications";
import { createRuntimeInstance, defaultInstanceId } from "./runtime-instance";
import type { Runtime } from "./create-runtime";
import {
  createWorkerConnection,
  type WorkerConnection,
} from "./worker-connection";
import {
  createWorkerResource,
  createWorkerOperation,
  createWorkerStream,
} from "./worker-capabilities";
import {
  workerLimits,
  type WorkerInit,
  type WorkerReady,
} from "./worker-protocol";

type CreateWorkerRuntimeOptions = {
  configPath: string;
  serverLogger?: ServerLogger;
  notifications?: Notifications;
  aliases?: Record<string, string>;
  startupMs?: number;
  shutdownMs?: number;
};
const silentNotifications: Notifications = { send: async () => undefined };
const resolveOptions = (options: CreateWorkerRuntimeOptions) => ({
  ...options,
  notifications: options.notifications ?? silentNotifications,
  aliases: options.aliases ?? {},
  startupMs: options.startupMs ?? workerLimits.startupMs,
  shutdownMs: options.shutdownMs ?? workerLimits.shutdownMs,
});
type WorkerOptions = ReturnType<typeof resolveOptions>;
type WorkerSelection = Pick<WorkerInit, "role" | "stream"> & { name: string };

const launchWorker = (
  selection: WorkerSelection,
  options: WorkerOptions,
  workers: WorkerConnection[],
) => {
  const connection = createWorkerConnection({
    name: selection.name,
    init: {
      type: "init",
      configPath: options.configPath,
      aliases: options.aliases,
      logLevel: options.serverLogger?.logLevel,
      role: selection.role,
      stream: selection.stream,
    },
    notifications: options.notifications,
    serverLogger: options.serverLogger,
    startupMs: options.startupMs,
    shutdownMs: options.shutdownMs,
  });
  // Own every launch before awaiting readiness, including concurrently starting peers.
  workers.push(connection);
  return connection;
};

// Application startup needs only data here, without importing userland in its own loop.
export const loadWorkerConfig = async (options: CreateWorkerRuntimeOptions) => {
  const workers: WorkerConnection[] = [];
  try {
    const connection = launchWorker(
      { role: "metadata", name: "config" },
      resolveOptions(options),
      workers,
    );
    const ready = await connection.ready;
    return { config: ready.settings };
  } finally {
    await Promise.all(
      workers.map((worker) =>
        worker.terminate(new Error("Config inspection finished")),
      ),
    );
  }
};

const startStreams = async (
  ready: WorkerReady,
  options: WorkerOptions,
  workers: WorkerConnection[],
) => {
  const streams = new Map<string, WorkerConnection>();
  // Bound simultaneous module evaluation without changing steady-state ownership.
  const names = ready.manifest.streams;
  for (let offset = 0; offset < names.length; offset += 4) {
    await Promise.all(
      names.slice(offset, offset + 4).map(async (name) => {
        const owner = launchWorker(
          { role: "stream", stream: name, name: `stream:${name}` },
          options,
          workers,
        );
        const streamReady = await owner.ready;
        if (
          JSON.stringify(streamReady.manifest) !==
          JSON.stringify(ready.manifest)
        ) {
          throw new Error("Server definitions changed between worker imports");
        }
        streams.set(name, owner);
      }),
    );
  }
  return streams;
};

const createWorkerIdentity = ({
  application,
  streams,
  startupMs,
}: {
  application: WorkerConnection;
  streams: Map<string, WorkerConnection>;
  startupMs: number;
}) => {
  let instance = createRuntimeInstance(defaultInstanceId);
  return {
    instance: {
      getInstanceId: () => instance.context.getInstanceId(),
      getDeepLinkPrefix: () => instance.context.getDeepLinkPrefix(),
    },
    establishInstance: async (port: number) => {
      // Only the application worker invokes the original identity function.
      const signal = AbortSignal.timeout(startupMs);
      const identity = (await application.request(
        { action: "initialize-instance-identity", port },
        signal,
      )) as InstanceIdentity;
      await Promise.all(
        [...streams.values()].map((stream) =>
          stream.request(
            {
              action: "initialize-instance-identity",
              port,
              instanceId: identity.instanceId,
            },
            signal,
          ),
        ),
      );
      instance = createRuntimeInstance(identity.instanceId);
      return instance.establish(port);
    },
  };
};

export const createWorkerRuntime = async (
  input: CreateWorkerRuntimeOptions,
): Promise<Runtime & { settings: RuntimeConfigSettings }> => {
  const options = resolveOptions(input);
  const workers: WorkerConnection[] = [];
  let disposal: Promise<void> | undefined;
  try {
    const application = launchWorker(
      { role: "application", name: "resources/operations" },
      options,
      workers,
    );
    const ready = await application.ready;
    const streams = await startStreams(ready, options, workers);
    const resources = new Map(
      ready.manifest.resources.map((name) => [
        name,
        createWorkerResource(application, name),
      ]),
    );
    const operations = new Map(
      ready.manifest.operations.map((name) => [
        name,
        createWorkerOperation(
          application,
          name,
          ready.voidOperations.includes(name),
        ),
      ]),
    );
    return {
      settings: ready.settings,
      ...createWorkerIdentity({
        application,
        streams,
        startupMs: options.startupMs,
      }),
      manifest: ready.manifest,
      dispose: () => {
        disposal =
          disposal ??
          Promise.all(workers.map((worker) => worker.stop())).then(
            () => undefined,
          );
        return disposal;
      },
      getOperation: (name) => operations.get(name),
      getResource: (name) => resources.get(name),
      getStream: (name) => {
        const owner = streams.get(name);
        return owner ? createWorkerStream(owner, name) : undefined;
      },
    };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    await Promise.all(workers.map((worker) => worker.terminate(error)));
    throw cause;
  }
};
