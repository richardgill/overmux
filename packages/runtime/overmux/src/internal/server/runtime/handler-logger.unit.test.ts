import { configDefinitionRuntimeSchema } from "@overmux/shared/node";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, test as testCases, vi } from "vitest";
import { z } from "zod";

import {
  defineOperation,
  defineOvermuxServer,
  defineResourceContract,
  defineStreamContract,
  defineStreamHandler,
  noInputSchema,
  type HandlerLogger,
} from "../../../public/index";
import {
  createServerLogger,
  type ServerLogger,
  type ServerLogEntry,
} from "../server-logger";
import { createRuntime } from "./create-runtime";
import { createHandlerLogger } from "./handler-logger";

const createLogDirectory = async () => {
  await mkdir(".test-tmp", { recursive: true });
  return mkdtemp(".test-tmp/handler-logs-");
};

const recordsFrom = async (logFile: string) =>
  (await readFile(logFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ServerLogEntry);

const loggingServer = (details?: Record<string, unknown>) =>
  defineOvermuxServer({
    resources: {
      count: {
        contract: defineResourceContract({
          input: noInputSchema,
          output: z.number(),
        }),
        kind: "subscription",
        read: (_input, { logger }) => {
          logger.info("read", details);
          return 1;
        },
        subscribe: (_input, _invalidate, { logger, signal }) => {
          logger.info("subscribe", details);
          return () => {
            expect(signal.aborted).toBe(true);
            logger.info("unsubscribe", details);
          };
        },
      },
    },
    operations: {
      refresh: defineOperation({
        input: noInputSchema,
        handle: (_input, { logger }) => {
          logger.info("handle", details);
        },
      }),
    },
    streams: {
      events: defineStreamHandler(
        defineStreamContract({
          input: noInputSchema,
          clientMessage: z.string(),
          serverMessage: z.string(),
        }),
        (_input, { logger, signal }) => {
          logger.info("open", details);
          return {
            onMessage: () => {
              logger.debug("message", details);
            },
            dispose: () => {
              expect(signal.aborted).toBe(true);
              logger.info("close", details);
            },
          };
        },
      ),
    },
  });

const createLoggingRuntime = (
  serverLogger: ServerLogger,
  details?: Record<string, unknown>,
) =>
  createRuntime({
    config: configDefinitionRuntimeSchema.parse({
      auth: { mode: "cli-login" },
      server: loggingServer(details),
    }),
    serverLogger,
  });

const exerciseHandlers = async (
  serverLogger: ServerLogger,
  details?: Record<string, unknown>,
) => {
  const runtime = await createLoggingRuntime(serverLogger, details);
  try {
    await expect(runtime.getResource("count")!.read(undefined)).resolves.toBe(
      1,
    );
    const unsubscribe = await runtime
      .getResource("count")!
      .subscribe(undefined, () => undefined);
    await expect(
      runtime.getOperation("refresh")!.execute(undefined),
    ).resolves.toBeUndefined();
    const session = await runtime
      .getStream("events")!
      .open(undefined, () => undefined);
    await session.send("not-automatically-logged");
    await runtime.dispose();
    await unsubscribe();
    await session.dispose();
  } finally {
    await runtime.dispose();
  }
};

describe("handler logging", () => {
  it("uses the server threshold, protects identity, and uses both existing destinations", async () => {
    const directory = await createLogDirectory();
    const logFile = join(directory, "overmux.log");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const serverLogger = createServerLogger({ logLevel: "info", logFile });
      const logger = createHandlerLogger({
        serverLogger,
        capabilityKind: "resource",
        registeredName: "count",
        handler: "read",
        correlation: { correlationId: "request-1" },
      });
      const levels = [
        "debug",
        "info",
        "warn",
        "error",
      ] as const satisfies readonly (keyof HandlerLogger)[];
      logger.debug("server-start");
      levels.forEach((level) =>
        logger[level](`handler-${level}`, {
          registeredName: "spoofed",
          correlationId: "spoofed",
        }),
      );

      const records = await recordsFrom(logFile);
      expect(records.map(({ event }) => event)).toEqual([
        "handler-info",
        "handler-warn",
        "handler-error",
      ]);
      expect(records.at(-1)).toMatchObject({
        correlationId: "request-1",
        source: "server",
        level: "error",
        details: {
          capabilityKind: "resource",
          registeredName: "count",
          handler: "read",
          data: { registeredName: "spoofed", correlationId: "spoofed" },
        },
      });
      expect(stderr.mock.calls.map(([line]) => String(line))).toEqual(
        records.map((record) => `[overmux] ${JSON.stringify(record)}\n`),
      );
    } finally {
      stderr.mockRestore();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("assigns distinct direct invocation IDs and retains them through cancelled cleanup", async () => {
    const log = vi.fn<ServerLogger["log"]>();
    const serverLogger: ServerLogger = {
      logLevel: "debug",
      id: () => "unused-transport-id",
      log,
    };
    await exerciseHandlers(serverLogger);
    await exerciseHandlers(serverLogger);

    const records = log.mock.calls.map(([entry]) => entry);
    expect(records.map(({ event }) => event)).toEqual([
      "read",
      "subscribe",
      "handle",
      "open",
      "message",
      "unsubscribe",
      "close",
      "read",
      "subscribe",
      "handle",
      "open",
      "message",
      "unsubscribe",
      "close",
    ]);
    expect(
      new Set(records.map(({ correlationId }) => correlationId)).size,
    ).toBe(8);
    const first = records.slice(0, 7);
    expect(first[4]?.correlationId).toBe(first[3]?.correlationId);
    expect(first[6]?.correlationId).toBe(first[3]?.correlationId);
    expect(first[5]?.correlationId).toBe(first[1]?.correlationId);
    expect(JSON.stringify(records)).not.toContain("not-automatically-logged");
  });

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const failures = [
    { name: "circular details", details: circular },
    { name: "bigint details", details: { value: 1n } },
    {
      name: "throwing serialization",
      details: {
        toJSON: () => {
          throw new Error("secret");
        },
      },
    },
    { name: "throwing sink", sinkFailure: true },
    { name: "throwing stderr", stderrFailure: true },
  ];
  testCases.each(failures)(
    "does not fail handlers or cleanup with $name",
    async ({ details, sinkFailure, stderrFailure }) => {
      const directory = await createLogDirectory();
      const logFile = join(directory, "overmux.log");
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      try {
        if (stderrFailure) {
          stderr.mockImplementation(() => {
            throw new Error("stderr unavailable");
          });
        }
        // Writing to a directory causes a real filesystem sink failure.
        const serverLogger = createServerLogger({
          logLevel: "debug",
          logFile: sinkFailure ? directory : logFile,
        });
        await exerciseHandlers(serverLogger, details);
        if (!sinkFailure) {
          const records = await recordsFrom(logFile);
          expect(records).toHaveLength(7);
          expect(
            records.every(({ event }) => event === "log-serialization-error"),
          ).toBe(!stderrFailure);
          expect(JSON.stringify(records)).not.toContain("secret");
        }
      } finally {
        stderr.mockRestore();
        await rm(directory, { force: true, recursive: true });
      }
    },
  );
});
