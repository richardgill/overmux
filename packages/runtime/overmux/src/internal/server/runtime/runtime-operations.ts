// Registers named operations with validated input, output, and notification context.
// Lookup metadata stays aligned with the names published in the runtime manifest.

import type {
  OperationContext,
  OperationDefinition,
} from "../../../public/index";
import type { Notifications } from "../../../public/index";
import { z } from "zod";

import type { RuntimeHandlerContext } from "./runtime-resources";

export class OperationValidationError extends Error {
  constructor(
    readonly phase: "input" | "output",
    cause: z.ZodError,
  ) {
    super(cause.message, { cause });
  }
}

export type RuntimeOperation = {
  execute: (input: unknown, signal?: AbortSignal) => Promise<unknown>;
  returnsVoid: boolean;
};

export type RuntimeOperations = {
  get: (name: string) => RuntimeOperation | undefined;
  names: readonly string[];
};

type AnyOperation = OperationDefinition<
  z.ZodTypeAny,
  z.ZodTypeAny,
  OperationContext<Record<string, unknown>>
>;

export type RuntimeOperationDefinitions = Readonly<
  Record<string, AnyOperation>
>;

type CreateRuntimeOperationsOptions = {
  context: (signal?: AbortSignal) => RuntimeHandlerContext;
  definitions: RuntimeOperationDefinitions;
  notifications: Notifications;
};

export const createRuntimeOperations = ({
  context,
  definitions,
  notifications,
}: CreateRuntimeOperationsOptions): RuntimeOperations => {
  const operations = new Map<string, RuntimeOperation>();
  Object.entries(definitions).forEach(([name, definition]) => {
    if (!name) {
      throw new Error("Operation names must not be empty");
    }
    operations.set(name, {
      execute: async (rawInput, signal) => {
        const operationContext = context(signal);
        operationContext.signal.throwIfAborted();
        const input = definition.input.safeParse(rawInput);
        if (!input.success) {
          throw new OperationValidationError("input", input.error);
        }
        const rawOutput = await definition.handle(input.data, {
          ...operationContext,
          notifications,
        });
        operationContext.signal.throwIfAborted();
        const output = definition.output.safeParse(rawOutput);
        if (!output.success) {
          throw new OperationValidationError("output", output.error);
        }
        return output.data;
      },
      returnsVoid: definition.output instanceof z.ZodVoid,
    });
  });
  return {
    get: (name) => operations.get(name),
    names: [...operations.keys()],
  };
};
