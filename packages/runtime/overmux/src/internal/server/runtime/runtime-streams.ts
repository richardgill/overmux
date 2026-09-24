// Owns named stream registration and ordered, validated session messaging.
// Session abort, failure, and disposal remain exactly-once across every close path.

import type { StreamHandlerDefinition } from "../../../public/index";
import { z } from "zod";

import type { RuntimeLifecycle } from "./runtime-lifecycle";
import type { RuntimeHandlerContext } from "./runtime-resources";

export type RuntimeStreamSession = {
  dispose: () => Promise<void>;
  send: (message: unknown) => Promise<void>;
};

export type RuntimeStream = {
  open: (
    input: unknown,
    emit: (message: unknown) => void,
    signal?: AbortSignal,
    onError?: (cause: unknown) => void,
  ) => Promise<RuntimeStreamSession>;
};

export type RuntimeStreams = {
  get: (name: string) => RuntimeStream | undefined;
  names: readonly string[];
};

type AnyStream = StreamHandlerDefinition<
  z.ZodTypeAny,
  z.ZodTypeAny,
  z.ZodTypeAny,
  RuntimeHandlerContext
>;

export type RuntimeStreamDefinitions = Readonly<Record<string, AnyStream>>;

type CreateRuntimeStreamsOptions = {
  context: (signal?: AbortSignal) => RuntimeHandlerContext;
  definitions: RuntimeStreamDefinitions;
  lifecycle: RuntimeLifecycle;
};

export const createRuntimeStreams = ({
  context,
  definitions,
  lifecycle,
}: CreateRuntimeStreamsOptions): RuntimeStreams => {
  const streams = new Map<string, RuntimeStream>();
  Object.entries(definitions).forEach(([name, definition]) => {
    if (!name) {
      throw new Error("Stream names must not be empty");
    }
    streams.set(name, {
      open: async (rawInput, emit, requestSignal, onError) => {
        const sessionController = new AbortController();
        const sessionSignal = requestSignal
          ? AbortSignal.any([requestSignal, sessionController.signal])
          : sessionController.signal;
        const operationSignal = lifecycle.requestSignal(sessionSignal);
        operationSignal.throwIfAborted();
        const input = definition.contract.input.parse(rawInput);
        let acceptingMessages = true;
        let failed = false;
        let failure: unknown;
        let opened = false;
        const fail = (cause: unknown) => {
          if (failed || operationSignal.aborted) {
            return;
          }
          failed = true;
          failure = cause;
          acceptingMessages = false;
          sessionController.abort(cause);
          if (opened) {
            onError?.(cause);
          }
        };
        const session = await definition.open(input, {
          ...context(sessionSignal),
          emit: (message) => {
            if (operationSignal.aborted) {
              return;
            }
            try {
              emit(definition.contract.serverMessage.parse(message));
            } catch (cause) {
              fail(cause);
            }
          },
          fail,
          signal: operationSignal,
        });
        opened = true;
        if (failed || operationSignal.aborted) {
          await session.dispose?.();
          operationSignal.throwIfAborted();
          throw failure;
        }
        let messages = Promise.resolve();
        const dispose = lifecycle.track(async () => {
          acceptingMessages = false;
          sessionController.abort(new Error("Stream session disposed"));
          await messages.catch(() => undefined);
          await session.dispose?.();
        }, requestSignal);
        return {
          dispose: async () => dispose(),
          send: async (rawMessage) => {
            if (!acceptingMessages) {
              throw new Error("Stream session is closed");
            }
            const message = definition.contract.clientMessage.parse(rawMessage);
            messages = messages.then(async () => {
              operationSignal.throwIfAborted();
              await session.onMessage?.(message);
              operationSignal.throwIfAborted();
            });
            return messages;
          },
        };
      },
    });
  });
  return {
    get: (name) => streams.get(name),
    names: [...streams.keys()],
  };
};
