import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import { createOvermuxHooks, defineCommandRegistry } from "./client";
import {
  defineOvermuxServer,
  defineResourceContract,
  defineStreamHandler,
} from "./index";

const input = z.string().transform(Number);
const output = z.number().transform(String);
const server = defineOvermuxServer({
  resources: {
    count: {
      contract: defineResourceContract({ input, output }),
      kind: "query",
      read: (value) => value,
    },
    summary: {
      kind: "derived",
      contract: defineResourceContract({
        input,
        output: z.object({ count: z.string() }),
      }),
      dependencies: { count: "count" },
      combine: ({ count }) => {
        expectTypeOf(count).toEqualTypeOf<string>();
        return { count };
      },
    },
  },
  operations: { double: { input, output, handle: (value) => value * 2 } },
  streams: {
    events: defineStreamHandler(
      { input, clientMessage: input, serverMessage: output },
      (_input, { emit }) => ({ onMessage: (value) => emit(value) }),
    ),
  },
});

const useTypedWorkerCapabilities = () => {
  const { useResource, useOperation, useStream } =
    createOvermuxHooks<typeof server>();
  const count = useResource({ id: "count", input: "1" });
  if (count.status === "success") {
    expectTypeOf(count.data).toEqualTypeOf<string>();
  }
  const summary = useResource({ id: "summary", input: "1" });
  if (summary.status === "success") {
    expectTypeOf(summary.data).toEqualTypeOf<{ count: string }>();
  }
  const operation = useOperation({ id: "double" });
  expectTypeOf(operation.mutateAsync("2")).toEqualTypeOf<Promise<string>>();
  const stream = useStream({ id: "events", input: "3" });
  stream.send("4");
  stream.subscribe((message) => expectTypeOf(message).toEqualTypeOf<string>());
  // @ts-expect-error unknown capabilities are not accepted
  useResource({ id: "missing" });
  // @ts-expect-error wire inputs use the schema's input type, not its transformed output
  useResource({ id: "count", input: 1 });
  // @ts-expect-error operations preserve transformed input inference
  operation.mutate(2);
  // @ts-expect-error streams preserve transformed input inference
  stream.send(4);
};

const commands = defineCommandRegistry<typeof server>()({
  double: {
    title: "Double",
    run: async ({ overmuxServerApi }) => {
      expectTypeOf(
        overmuxServerApi.executeOperation("double", "2"),
      ).toEqualTypeOf<Promise<string>>();
      // @ts-expect-error commands share the same capability extraction
      overmuxServerApi.executeOperation("missing");
    },
  },
});

test("original server definitions retain public hook and command capabilities", () => {
  expect(useTypedWorkerCapabilities).toBeTypeOf("function");
  expect(commands.double.id).toBe("double");
});
