import { threadId } from "node:worker_threads";
import { z } from "zod";
import { defineOvermuxServer, noInputSchema } from "../../../../public/index";

let count = 0;
let reads = 0;
let subscribed = 0;
let unsubscribed = 0;
const sourceOutput = z.object({ count: z.number(), threadId: z.number() });

export default defineOvermuxServer({
  resources: {
    source: {
      kind: "subscription",
      contract: { input: z.string().transform(Number), output: sourceOutput },
      read: (input) => {
        reads++;
        return { count: count + input, threadId };
      },
      subscribe: () => {
        subscribed++;
        return async () => {
          unsubscribed++;
        };
      },
    },
    left: {
      kind: "derived",
      contract: {
        input: z.string().transform((key) => ({ key })),
        output: sourceOutput,
      },
      dependencies: { source: "source" },
      combine: ({ source }) => source,
    },
    right: {
      kind: "derived",
      contract: { input: z.string(), output: sourceOutput },
      dependencies: { source: "source" },
      combine: ({ source }) => source,
    },
    summary: {
      kind: "derived",
      contract: {
        input: z.string().transform((key) => `summary:${key}`),
        output: z.object({ count: z.number(), threads: z.array(z.number()) }),
      },
      dependencies: { left: "left", right: "right" },
      combine: ({ left, right }) => ({
        count: left.count + right.count,
        threads: [threadId, left.threadId, right.threadId],
      }),
    },
    stats: {
      kind: "query",
      contract: {
        input: noInputSchema,
        output: z.object({
          reads: z.number(),
          subscribed: z.number(),
          unsubscribed: z.number(),
        }),
      },
      read: () => ({ reads, subscribed, unsubscribed }),
    },
  },
  operations: {
    increment: {
      input: z.string(),
      handle: (input, { invalidate }) => {
        count++;
        invalidate("source", input);
      },
    },
  },
});
