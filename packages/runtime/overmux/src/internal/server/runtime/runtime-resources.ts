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
  ) => RuntimeDisposer;
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

  const activateWatchers = (
    id: string,
    rawInput: unknown,
    signal: AbortSignal | undefined,
    activated: Set<string>,
    disposers: RuntimeDisposer[],
  ) => {
    if (activated.has(id)) {
      return;
    }
    activated.add(id);
    const definition = definitions[id]!;
    const input = definition.contract.input.parse(rawInput);
    if (definition.kind === "subscription") {
      const dispose = definition.subscribe(
        input,
        () => invalidateResource(id, input),
        context(signal),
      );
      if (typeof dispose !== "function") {
        throw new Error(`Resource ${id} subscribe must return a disposer`);
      }
      disposers.push(dispose);
      return;
    }
    if (definition.kind === "derived") {
      graph.dependencies.get(id)?.forEach((dependencyId) => {
        activateWatchers(dependencyId, rawInput, signal, activated, disposers);
      });
    }
  };

  Object.keys(definitions).forEach((name) => {
    resources.set(name, {
      read: (input, signal) => read(name, input, signal),
      subscribe: (rawInput, listener, signal) => {
        lifecycle.requestSignal(signal).throwIfAborted();
        const input = definitions[name]!.contract.input.parse(rawInput);
        const entry = { input, listener, resourceId: name };
        const watcherDisposers: RuntimeDisposer[] = [];
        invalidationListeners.add(entry);
        try {
          activateWatchers(name, rawInput, signal, new Set(), watcherDisposers);
        } catch (cause) {
          invalidationListeners.delete(entry);
          void lifecycle.disposeAll(watcherDisposers).catch(() => undefined);
          throw cause;
        }
        return lifecycle.track(async () => {
          invalidationListeners.delete(entry);
          await lifecycle.disposeAll(watcherDisposers);
        }, signal);
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
