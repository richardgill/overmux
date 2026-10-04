// Owns named runtime resource lookup, validated reads, dependency watchers, and invalidation.

import {
  type HandlerContext,
  type ResourceDefinition,
  type RuntimeDisposer,
} from "../../../public/index";
import { randomUUID } from "node:crypto";
import type { ServerLogger } from "../server-logger";
import {
  createHandlerLogger,
  type HandlerLogCorrelation,
} from "./handler-logger";
import { isDeepStrictEqual } from "node:util";
import {
  createResourceDependencyGraph,
  getInvalidatedResourceIds,
  type ResourceDependencyGraph,
} from "./resource-dependency-graph";
import type { RuntimeLifecycle } from "./runtime-lifecycle";

export type RuntimeResource = {
  read: (
    input: unknown,
    signal?: AbortSignal,
    correlation?: HandlerLogCorrelation,
  ) => Promise<unknown>;
  subscribe: (
    input: unknown,
    listener: () => void,
    signal?: AbortSignal,
    onError?: (cause: unknown) => void,
    correlation?: HandlerLogCorrelation,
  ) => Promise<RuntimeDisposer>;
};

export type RuntimeResourceDefinitions = Readonly<
  Record<string, ResourceDefinition>
>;

export type RuntimeHandlerContext = HandlerContext<Record<string, unknown>>;

export type RuntimeResources = {
  context: (signal?: AbortSignal) => Omit<RuntimeHandlerContext, "logger">;
  get: (name: string) => RuntimeResource | undefined;
  invalidate: RuntimeHandlerContext["invalidate"];
  names: readonly string[];
};

type InvalidationListener = {
  inputs: ReadonlyMap<string, unknown>;
  listener: () => void;
  resourceId: string;
};

type CreateRuntimeResourcesOptions = {
  definitions: RuntimeResourceDefinitions;
  instance: HandlerContext["instance"];
  lifecycle: RuntimeLifecycle;
  serverLogger?: ServerLogger;
};

const parseDependencyInputs = (
  definitions: RuntimeResourceDefinitions,
  graph: ResourceDependencyGraph,
  id: string,
  rawInput: unknown,
  inputs = new Map<string, unknown>(),
): ReadonlyMap<string, unknown> => {
  if (inputs.has(id)) {
    return inputs;
  }
  // Each contract receives the original input, not another contract's transformed
  // output. Retain each dependency's parsed key for matching invalidations.
  inputs.set(id, definitions[id]!.contract.input.parse(rawInput));
  graph.dependencies.get(id)?.forEach((dependencyId) => {
    parseDependencyInputs(definitions, graph, dependencyId, rawInput, inputs);
  });
  return inputs;
};

const createSubscriptionLifetime = ({
  entry,
  invalidationListeners,
  lifecycle,
  signal,
}: {
  entry: InvalidationListener;
  invalidationListeners: Set<InvalidationListener>;
  lifecycle: RuntimeLifecycle;
  signal?: AbortSignal;
}) => {
  const controller = new AbortController();
  const subscriptionSignal = AbortSignal.any([
    lifecycle.requestSignal(signal),
    controller.signal,
  ]);
  subscriptionSignal.throwIfAborted();
  const registeredEntry = {
    ...entry,
    listener: () => {
      if (!subscriptionSignal.aborted) {
        entry.listener();
      }
    },
  };
  const disposers: RuntimeDisposer[] = [];
  const subscription = {
    disposers,
    dispose: () => {
      controller.abort(new Error("Resource subscription closed"));
      return release();
    },
    refresh: registeredEntry.listener,
    signal: subscriptionSignal,
  };
  // Own the lifetime before invoking userland, which can invalidate and
  // trigger unsubscribe synchronously, or await setup past cancellation.
  const release = lifecycle.track(async () => {
    invalidationListeners.delete(registeredEntry);
    await lifecycle.disposeAll(disposers);
  }, subscriptionSignal);
  invalidationListeners.add(registeredEntry);
  return subscription;
};

export const createRuntimeResources = ({
  definitions,
  instance,
  lifecycle,
  serverLogger,
}: CreateRuntimeResourcesOptions): RuntimeResources => {
  const graph = createResourceDependencyGraph(definitions);
  const invalidationListeners = new Set<InvalidationListener>();
  const resources = new Map<string, RuntimeResource>();

  const invalidateResource = (
    id: string,
    input: unknown,
    allInputs = false,
  ) => {
    if (lifecycle.signal.aborted) {
      return;
    }
    const ids = getInvalidatedResourceIds(graph, id);
    invalidationListeners.forEach((entry) => {
      if (
        ids.has(entry.resourceId) &&
        (allInputs || isDeepStrictEqual(entry.inputs.get(id), input))
      ) {
        entry.listener();
      }
    });
  };

  const invalidate = (resourceId: string, input?: unknown) => {
    if (!Object.hasOwn(definitions, resourceId)) {
      throw new Error(`Unknown resource ID: ${resourceId}`);
    }
    const definition = definitions[resourceId]!;
    const parsedInput =
      input === undefined ? undefined : definition.contract.input.parse(input);
    invalidateResource(resourceId, parsedInput, input === undefined);
  };

  const context: RuntimeResources["context"] = (signal) => ({
    instance,
    invalidate,
    signal: lifecycle.requestSignal(signal),
  });

  const read = (
    id: string,
    rawInput: unknown,
    signal?: AbortSignal,
    correlation: HandlerLogCorrelation = { correlationId: randomUUID() },
    reads = new Map<string, Promise<unknown>>(),
  ): Promise<unknown> => {
    const existing = reads.get(id);
    if (existing) {
      return existing;
    }
    const pending = readDefinition(id, rawInput, signal, correlation, reads);
    reads.set(id, pending);
    return pending;
  };

  const readDefinition = async (
    id: string,
    rawInput: unknown,
    signal: AbortSignal | undefined,
    correlation: HandlerLogCorrelation,
    reads: Map<string, Promise<unknown>>,
  ) => {
    const definition = definitions[id]!;
    const handlerContext = {
      ...context(signal),
      logger: createHandlerLogger({
        serverLogger,
        correlation,
        capabilityKind: "resource",
        registeredName: id,
        handler: "read",
      }),
    };
    handlerContext.signal.throwIfAborted();
    const input = definition.contract.input.parse(rawInput);
    const dependencies =
      definition.kind === "derived"
        ? Object.fromEntries(
            await Promise.all(
              Object.entries(
                definition.dependencies as Readonly<Record<string, string>>,
              ).map(async ([name, dependencyId]) => [
                name,
                await read(
                  dependencyId,
                  rawInput,
                  handlerContext.signal,
                  correlation,
                  reads,
                ),
              ]),
            ),
          )
        : undefined;
    // Dependency reads may finish after cancellation; never call combine then.
    handlerContext.signal.throwIfAborted();
    const output =
      definition.kind === "derived"
        ? definition.combine(dependencies)
        : await definition.read(input, handlerContext);
    handlerContext.signal.throwIfAborted();
    return definition.contract.output.parse(output);
  };

  const activateSubscriptions = async (
    inputs: ReadonlyMap<string, unknown>,
    subscription: ReturnType<typeof createSubscriptionLifetime>,
    correlation: HandlerLogCorrelation,
  ) => {
    // Inputs are collected in dependency order and deduplicated before userland
    // runs, so synchronous invalidation can already match every reachable key.
    for (const [id, input] of inputs) {
      subscription.signal.throwIfAborted();
      const definition = definitions[id]!;
      if (definition.kind === "subscription") {
        const dispose = await definition.subscribe(
          input,
          () => {
            if (!subscription.signal.aborted) {
              invalidateResource(id, input);
            }
          },
          {
            ...context(subscription.signal),
            logger: createHandlerLogger({
              serverLogger,
              correlation,
              capabilityKind: "resource",
              registeredName: id,
              handler: "subscribe",
            }),
          },
        );
        if (typeof dispose !== "function") {
          throw new Error(`Resource ${id} subscribe must return a disposer`);
        }
        // Cancellation releases acquired resources without waiting for pending
        // userland setup. A cleanup returned after cancellation is released here.
        if (subscription.signal.aborted) {
          await dispose();
          subscription.signal.throwIfAborted();
        }
        subscription.disposers.push(dispose);
      }
    }
  };

  Object.keys(definitions).forEach((name) => {
    resources.set(name, {
      read: (rawInput, signal, correlation) =>
        read(name, rawInput, signal, correlation),
      subscribe: async (
        rawInput,
        listener,
        signal,
        _onError,
        correlation = { correlationId: randomUUID() },
      ) => {
        lifecycle.requestSignal(signal).throwIfAborted();
        const inputs = parseDependencyInputs(
          definitions,
          graph,
          name,
          rawInput,
        );
        const subscription = createSubscriptionLifetime({
          entry: { inputs, listener, resourceId: name },
          invalidationListeners,
          lifecycle,
          signal,
        });
        try {
          await activateSubscriptions(inputs, subscription, correlation);
          subscription.signal.throwIfAborted();
          // Refresh only this subscriber to cover changes during setup. Returning
          // cleanup does not imply an external event source is already ready.
          subscription.refresh();
          subscription.signal.throwIfAborted();
          return subscription.dispose;
        } catch (cause) {
          try {
            await subscription.dispose();
          } catch (cleanupError) {
            throw new AggregateError(
              [cause, cleanupError],
              "Resource subscription setup and cleanup failed",
            );
          }
          throw cause;
        }
      },
    });
  });

  return {
    context,
    get: (name) => resources.get(name),
    invalidate,
    names: [...resources.keys()],
  };
};
