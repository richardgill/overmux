// Composes one process-lifetime runtime from cohesive lifecycle and protocol components.

import type { RuntimeConfigDefinition } from "@overmux/shared/node";

import type {
  InstanceContext,
  InstanceIdentity,
  Notifications,
} from "../../../public/index";
import { createRuntimeInstance, defaultInstanceId } from "./runtime-instance";
import { protocolVersion, type RuntimeManifest } from "../../shared/index";

import { createRuntimeLifecycle } from "./runtime-lifecycle";
import {
  createRuntimeOperations,
  type RuntimeOperation,
  type RuntimeOperationDefinitions,
} from "./runtime-operations";
import {
  createRuntimeResources,
  type RuntimeResource,
  type RuntimeResourceDefinitions,
} from "./runtime-resources";
import {
  createRuntimeStreams,
  type RuntimeStream,
  type RuntimeStreamDefinitions,
} from "./runtime-streams";

export type Runtime = {
  instance: InstanceContext;
  establishInstance: (port: number) => InstanceIdentity;
  manifest: RuntimeManifest;
  dispose: () => Promise<void>;
  getOperation: (name: string) => RuntimeOperation | undefined;
  getResource: (name: string) => RuntimeResource | undefined;
  getStream: (name: string) => RuntimeStream | undefined;
};

type CreateRuntimeOptions = {
  config: RuntimeConfigDefinition;
  debug?: boolean;
  notifications?: Notifications;
  signal?: AbortSignal;
};

export const createRuntime = async ({
  config,
  debug = true,
  notifications = { send: async () => undefined },
  signal,
}: CreateRuntimeOptions): Promise<Runtime> => {
  const lifecycle = createRuntimeLifecycle(signal);
  const instance = createRuntimeInstance(
    config.instanceId ?? defaultInstanceId,
  );
  try {
    const resources = createRuntimeResources({
      definitions: (config.server.resources ??
        {}) as RuntimeResourceDefinitions,
      instance: instance.context,
      lifecycle,
    });
    const context = resources.context;
    const operations = createRuntimeOperations({
      context,
      definitions: (config.server.operations ??
        {}) as RuntimeOperationDefinitions,
      notifications,
    });
    const streams = createRuntimeStreams({
      context,
      definitions: (config.server.streams ?? {}) as RuntimeStreamDefinitions,
      lifecycle,
    });

    lifecycle.signal.throwIfAborted();
    lifecycle.completePreparation();

    const manifest: RuntimeManifest = {
      debug,
      operations: [...operations.names],
      protocolVersion,
      resources: [...resources.names],
      streams: [...streams.names],
    };
    return {
      instance: instance.context,
      establishInstance: instance.establish,
      manifest,
      dispose: lifecycle.dispose,
      getOperation: operations.get,
      getResource: resources.get,
      getStream: streams.get,
    };
  } catch (cause) {
    await lifecycle.dispose(cause).catch(() => undefined);
    throw cause;
  }
};
