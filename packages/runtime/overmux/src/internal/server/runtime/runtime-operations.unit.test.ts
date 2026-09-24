import { defineOperation, noInputSchema } from "../../../public/index";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createRuntimeLifecycle } from "./runtime-lifecycle";
import {
  createRuntimeOperations,
  OperationValidationError,
  type RuntimeOperationDefinitions,
} from "./runtime-operations";

const createContext = () => {
  const lifecycle = createRuntimeLifecycle();
  return {
    context: (signal?: AbortSignal) => ({
      instance: {
        getInstanceId: () => "test",
        getDeepLinkPrefix: () => "overmux://test",
      },
      invalidate: vi.fn(),
      signal: lifecycle.requestSignal(signal),
    }),
    lifecycle,
  };
};

describe("runtime operations", () => {
  it("preserves validation phases and void response semantics", async () => {
    const { context, lifecycle } = createContext();
    const operations = createRuntimeOperations({
      context,
      definitions: {
        malformed: defineOperation({
          handle: () => "bad" as unknown as number,
          input: z.object({ value: z.number() }),
          output: z.number(),
        }),
        nothing: defineOperation({
          handle: () => undefined,
          input: noInputSchema,
        }),
      } as RuntimeOperationDefinitions,
      notifications: { send: async () => undefined },
    });

    const malformed = operations.get("malformed")!;
    const inputError = await malformed
      .execute({ value: "bad" })
      .catch((cause: unknown) => cause);
    const outputError = await malformed
      .execute({ value: 1 })
      .catch((cause: unknown) => cause);

    expect(inputError).toBeInstanceOf(OperationValidationError);
    expect(inputError).toMatchObject({ phase: "input" });
    expect(outputError).toBeInstanceOf(OperationValidationError);
    expect(outputError).toMatchObject({ phase: "output" });
    expect(operations.get("nothing")?.returnsVoid).toBe(true);
    await expect(operations.get("nothing")?.execute(undefined)).resolves.toBe(
      undefined,
    );
    await lifecycle.dispose();
  });

  it("provides notifications and request cancellation to handlers", async () => {
    const { context, lifecycle } = createContext();
    const send = vi.fn(async () => undefined);
    const operation = defineOperation({
      handle: async (_input, handlerContext) => {
        await handlerContext.notifications.send({ title: "Started" });
        handlerContext.signal.throwIfAborted();
      },
      input: noInputSchema,
    });
    const operations = createRuntimeOperations({
      context,
      definitions: { notify: operation } as RuntimeOperationDefinitions,
      notifications: { send },
    });
    await operations.get("notify")?.execute(undefined);
    const request = new AbortController();
    request.abort(new Error("request stopped"));

    await expect(
      operations.get("notify")?.execute(undefined, request.signal),
    ).rejects.toThrow("request stopped");
    expect(send).toHaveBeenCalledOnce();
    await lifecycle.dispose();
  });
});
