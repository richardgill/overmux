import { threadId, isMainThread } from "node:worker_threads";
import { appendFileSync } from "node:fs";
import { z } from "zod";
import { defineOvermuxServer, noInputSchema } from "../../../../public/index";

let opened = 0;
let disposed = 0;
let subscribed = 0;
let unsubscribed = 0;
let ran = 0;
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const waiting = new Set<() => void>();
const binaryView = ({ kind, bytes }: { kind: string; bytes: number }) => {
  const backing = new ArrayBuffer(bytes);
  new Uint8Array(backing)[32] = 42;
  if (kind === "buffer") {
    return Buffer.from(backing).slice(32, 33);
  }
  if (kind === "float64") {
    return new Float64Array(backing, 32, 1);
  }
  return kind === "data-view"
    ? new DataView(backing, 32, 1)
    : new Uint8Array(backing, 32, 1);
};

export default defineOvermuxServer({
  resources: {
    binary: {
      kind: "query",
      contract: {
        input: z.object({
          kind: z.enum(["uint8", "buffer", "data-view", "float64"]),
          bytes: z.number(),
        }),
        output: z.unknown(),
      },
      read: binaryView,
    },
    nativeError: {
      kind: "query",
      contract: {
        input: z.enum(["TimeoutError", "AbortError"]),
        output: z.unknown(),
      },
      read: (name) => {
        throw new DOMException("upstream request failed", name);
      },
    },
    status: {
      kind: "query",
      contract: { input: noInputSchema, output: z.unknown() },
      read: (_input, { instance }) => ({
        opened,
        disposed,
        subscribed,
        unsubscribed,
        ran,
        threadId,
        isMainThread,
        instanceId: instance.getInstanceId(),
        deepLinkPrefix: instance.getDeepLinkPrefix(),
      }),
    },
    watched: {
      kind: "subscription",
      contract: { input: z.number(), output: z.number() },
      read: () => subscribed,
      subscribe: async (delay, invalidate) => {
        subscribed++;
        waiting.add(invalidate);
        await pause(delay);
        return () => {
          unsubscribed++;
          waiting.delete(invalidate);
        };
      },
    },
  },
  operations: {
    binaryEcho: {
      input: z.unknown(),
      output: z.unknown(),
      handle: (input) => input,
    },
    holdBytes: {
      input: z.unknown(),
      handle: (_input, { signal }) =>
        new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    },
    run: {
      input: z.enum([
        "ok",
        "exit0",
        "exit1",
        "fatal",
        "spin",
        "invalidate",
        "flood-invalidations",
      ]),
      output: z.string(),
      handle: async (action, { invalidate }) => {
        ran++;
        if (action === "exit0") {
          process.exit(0);
        }
        if (action === "exit1") {
          process.exit(1);
        }
        if (action === "fatal") {
          setImmediate(() => {
            throw new Error("async worker fatal");
          });
        }
        if (action === "spin") {
          for (;;) {
            Math.sqrt(Math.random());
          }
        }
        if (action === "invalidate") {
          invalidate("watched", 0);
        }
        if (action === "flood-invalidations") {
          for (let i = 0; i < 10_000; i++) {
            waiting.forEach((callback) => callback());
          }
        }
        return "ok";
      },
    },
    wait: {
      input: noInputSchema,
      handle: (_input, { signal }) =>
        new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    },
    invalidOutput: {
      input: noInputSchema,
      output: z.string(),
      handle: () => 123 as never,
    },
    notify: {
      input: noInputSchema,
      handle: async (_input, { notifications, instance }) => {
        await notifications.send({
          title: instance.getInstanceId(),
          body: instance.getDeepLinkPrefix(),
        });
      },
    },
  },
  streams: {
    events: {
      contract: {
        input: z.object({
          inspect: z.boolean().default(false),
          delay: z.number().default(0),
          cleanupPath: z.string().optional(),
          openingBurst: z.number().default(0),
          cleanupDelay: z.number().default(0),
          cleanupFailure: z.boolean().default(false),
        }),
        clientMessage: z.unknown(),
        serverMessage: z.unknown(),
      },
      open: async (
        {
          inspect,
          delay,
          cleanupPath,
          openingBurst,
          cleanupDelay,
          cleanupFailure,
        },
        context,
      ) => {
        const { emit, instance } = context;
        if (inspect) {
          emit({
            opened,
            disposed,
            streamThreadId: threadId,
            contextKeys: Object.keys(context).sort(),
            instanceId: instance.getInstanceId(),
          });
          return {};
        }
        opened++;
        for (let i = 0; i < openingBurst; i++) {
          emit(i);
        }
        await pause(delay);
        return {
          onMessage: (message) => {
            if (message === "flood") {
              for (let i = 0; i < 10_000; i++) {
                emit(i);
              }
            } else if (message === "byte-flood") {
              for (let i = 0; i < 12; i++) {
                emit(binaryView({ kind: "uint8", bytes: 768 * 1024 }));
              }
            } else if (message === "binary") {
              emit(new Uint8Array([1, 2, 3]));
            } else {
              emit(message);
            }
          },
          dispose: async () => {
            await pause(cleanupDelay);
            disposed++;
            if (cleanupFailure) {
              throw new Error("late cleanup failed");
            }
            if (cleanupPath) {
              appendFileSync(cleanupPath, "disposed\n");
            }
          },
        };
      },
    },
  },
});
