// Owns named runtime resource lookup, validated reads, dependency watchers, and invalidation.

import {
  type HandlerContext,
  type ResourceDefinition,
  type RuntimeDisposer,
} from "../../../public/index";
import { isDeepStrictEqual } from "node:util";

import {
  createResourceDependencyGraph,
  getInvalidatedResourceIds,
} from "./resource-dependency-graph";
import type { RuntimeLifecycle } from "./runtime-lifecycle";

export type RuntimeResource = {
  read: (input: unknown, signal?: AbortSignal) => Promise<unknown>;
  subscribe: (
    input: unknown,
    listener: () => void,
    signal?: AbortSignal,
  ) => Promise<RuntimeDisposer>;
};

export type RuntimeResourceDefinitions = Readonly<
  Record<string, ResourceDefinition>
>;

export type RuntimeHandlerContext = HandlerContext<Record<string, unknown>>;

export type RuntimeResources = {
  context: (signal?: AbortSignal) => RuntimeHandlerContext;
  get: (name: string) => RuntimeResource | undefined;
  invalidate: RuntimeHandlerContext["invalidate"];
  names: readonly string[];
};

type InvalidationListener = {
  input: unknown;
  listener: () => void;
  resourceId: string;
};

type CreateRuntimeResourcesOptions = {
  definitions: RuntimeResourceDefinitions;
  instance: HandlerContext["instance"];
  lifecycle: RuntimeLifecycle;
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
  // Own the lifetime before invoking userland, which can invalidate and
  // trigger unsubscribe synchronously, or await setup past cancellation.
  const release = lifecycle.track(async () => {
    invalidationListeners.delete(registeredEntry);
    await lifecycle.disposeAll(disposers);
  }, subscriptionSignal);
  const dispose = () => {
    controller.abort(new Error("Resource subscription closed"));
    return release();
  };
  invalidationListeners.add(registeredEntry);
  return {
    dispose,
    disposers,
    refresh: registeredEntry.listener,
    signal: subscriptionSignal,
  };
};

export const createRuntimeResources = ({
  definitions,
  instance,
  lifecycle,
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
        (allInputs || isDeepStrictEqual(entry.input, input))
      ) {
        entry.listener();
      }
    });
  };

  const invalidate = (resourceId: string, input?: unknown) => {
    if (!resources.has(resourceId)) {
      throw new Error(`Unknown resource ID: ${resourceId}`);
    }
    const definition = definitions[resourceId]!;
    const parsedInput =
      input === undefined ? undefined : definition.contract.input.parse(input);
    invalidateResource(resourceId, parsedInput, input === undefined);
  };

  const context = (signal?: AbortSignal): RuntimeHandlerContext => ({
    instance,
    invalidate,
    signal: lifecycle.requestSignal(signal),
  });

  const read = async (
    id: string,
    rawInput: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const definition = definitions[id]!;
    const operationSignal = lifecycle.requestSignal(signal);
    operationSignal.throwIfAborted();
    const input = definition.contract.input.parse(rawInput);
    const rawOutput =
      definition.kind === "derived"
        ? definition.combine(
            Object.fromEntries(
              await Promise.all(
                Object.entries(
                  definition.dependencies as Readonly<Record<string, string>>,
                ).map(async ([name, dependencyId]) => [
                  name,
                  await read(dependencyId, rawInput, signal),
                ]),
              ),
            ),
          )
        : await definition.read(input, context(signal));
    operationSignal.throwIfAborted();
    return definition.contract.output.parse(rawOutput);
  };

  const activateSubscriptions = async (
    id: string,
    rawInput: unknown,
    signal: AbortSignal,
    activated: Set<string>,
    disposers: RuntimeDisposer[],
  ): Promise<void> => {
    signal.throwIfAborted();
    if (activated.has(id)) {
      return;
    }
    activated.add(id);
    const definition = definitions[id]!;
    const input = definition.contract.input.parse(rawInput);
    if (definition.kind === "subscription") {
      const dispose = await definition.subscribe(
        input,
        () => {
          if (!signal.aborted) {
            invalidateResource(id, input);
          }
        },
        context(signal),
      );
      if (typeof dispose !== "function") {
        throw new Error(`Resource ${id} subscribe must return a disposer`);
      }
      // Cancellation releases acquired resources without waiting for pending
      // userland setup. A cleanup returned after cancellation is released here.
      if (signal.aborted) {
        await dispose();
        signal.throwIfAborted();
      }
      disposers.push(dispose);
      return;
    }
    if (definition.kind === "derived") {
      for (const dependencyId of graph.dependencies.get(id) ?? []) {
        await activateSubscriptions(
          dependencyId,
          rawInput,
          signal,
          activated,
          disposers,
        );
      }
    }
  };

  Object.keys(definitions).forEach((name) => {
    resources.set(name, {
      read: (input, signal) => read(name, input, signal),
      subscribe: async (rawInput, listener, signal) => {
        lifecycle.requestSignal(signal).throwIfAborted();
        const input = definitions[name]!.contract.input.parse(rawInput);
        const subscription = createSubscriptionLifetime({
          entry: { input, listener, resourceId: name },
          invalidationListeners,
          lifecycle,
          signal,
        });
        try {
          await activateSubscriptions(
            name,
            rawInput,
            subscription.signal,
            new Set(),
            subscription.disposers,
          );
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
