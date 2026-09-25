import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { keyBindingSchema } from "@overmux/keybindings";
import {
  defineOperation,
  defineOvermuxServer,
  defineResourceContract,
  defineStreamContract,
  defineStreamHandler,
  noInputSchema,
} from "overmux";
import type { defineCommandRegistry } from "overmux/client";
import { z } from "zod";

const input = z.object({ count: z.string().transform(Number) });
const output = z.object({ count: z.number() });
const operation = defineOperation({
  input,
  output,
  handle: ({ count }) => ({ count: count + 1 }),
});
const resource = defineResourceContract({ input, output });
const stream = defineStreamContract({
  input: noInputSchema,
  clientMessage: input,
  serverMessage: output,
});
const server = defineOvermuxServer({
  operations: { increment: operation },
  resources: {
    counter: {
      kind: "query",
      contract: resource,
      read: ({ count }) => ({ count }),
    },
  },
  streams: {
    counter: defineStreamHandler(stream, (_input, { emit }) => ({
      onMessage: ({ count }) => emit({ count }),
    })),
  },
});

// Check declarations for the browser API without loading its CSS in Node.
const checkCommands = (defineCommands: typeof defineCommandRegistry) =>
  defineCommands<typeof server>()({
    increment: {
      title: "Increment",
      params: input,
      run: ({ params, overmuxServerApi }) =>
        overmuxServerApi.executeOperation("increment", {
          count: String(params.count),
        }),
    },
  });
void checkCommands;

const parsed: { count: number } = operation.input.parse({ count: "41" });
assert.equal(parsed.count, 41);
assert.deepEqual(resource.output.parse(parsed), { count: 41 });
assert.equal(
  z.object({ binding: keyBindingSchema }).parse({ binding: "Control+A" })
    .binding,
  "Control+A",
);
assert.deepEqual(z.array(noInputSchema).parse([undefined]), [undefined]);

// Both published packages must resolve the application's Zod, not a private copy.
const require = createRequire(import.meta.url);
for (const name of ["overmux", "@overmux/keybindings"]) {
  const packageRequire = createRequire(import.meta.resolve(name));
  assert.equal(packageRequire.resolve("zod"), require.resolve("zod"));
}
console.log("Application Zod schemas work with packed Overmux APIs");
