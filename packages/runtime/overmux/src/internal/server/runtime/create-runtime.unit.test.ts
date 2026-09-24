import {
  configDefinitionRuntimeSchema,
  type RuntimeConfigDefinition,
} from "@overmux/shared/node";

import {
  defineOperation,
  defineOvermuxServer,
  defineResourceContract,
  defineStreamContract,
  defineStreamHandler,
  noInputSchema,
} from "../../../public/index";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createRuntime, type Runtime } from "./create-runtime";

const prepare = (config: RuntimeConfigDefinition) => createRuntime({ config });

const parsedConfig = (server: unknown) =>
  configDefinitionRuntimeSchema.parse({
    auth: { mode: "cli-login" },
    server,
  });

const countContract = defineResourceContract({
  input: z.object({ value: z.number() }),
  output: z.object({ count: z.number() }),
});
const doubledContract = defineResourceContract({
  input: z.object({ value: z.number() }),
  output: z.object({ doubled: z.number() }),
});

const resourceById = (runtime: Runtime, id: string) => runtime.getResource(id);
const operationById = (runtime: Runtime, id: string) =>
  runtime.getOperation(id);
const streamById = (runtime: Runtime, id: string) => runtime.getStream(id);

describe("runtime", () => {
  it("publishes the trusted runtime manifest", async () => {
    const runtime = await prepare(
      configDefinitionRuntimeSchema.parse({
        auth: { mode: "cli-login" },
        server: { resources: {} },
      }),
    );

    expect(runtime.manifest).toMatchObject({
      debug: true,
      operations: [],
      resources: [],
      streams: [],
    });
    await runtime.dispose();
  });

  it("composes object-keyed resources, operations, and streams", async () => {
    const streamContract = defineStreamContract({
      clientMessage: z.string(),
      input: noInputSchema,
      serverMessage: z.string(),
    });
    const refresh = defineOperation({
      handle: () => "done" as const,
      input: noInputSchema,
      output: z.literal("done"),
    });
    const runtime = await prepare(
      parsedConfig(
        defineOvermuxServer({
          operations: { refresh },
          resources: {
            count: {
              contract: countContract,
              kind: "query",
              read: ({ value }) => ({ count: value }),
            },
            doubled: {
              combine: ({ count }) => ({ doubled: count.count * 2 }),
              contract: doubledContract,
              dependencies: { count: "count" },
              kind: "derived",
            },
          },
          streams: {
            events: defineStreamHandler(streamContract, (_input, { emit }) => {
              emit("ready");
              return {};
            }),
          },
        }),
      ),
    );

    expect(runtime.manifest).toMatchObject({
      operations: ["refresh"],
      resources: ["count", "doubled"],
      streams: ["events"],
    });
    await expect(
      resourceById(runtime, "doubled")?.read({ value: 3 }),
    ).resolves.toEqual({ doubled: 6 });
    await expect(
      operationById(runtime, "refresh")?.execute(undefined),
    ).resolves.toBe("done");
    const emit = vi.fn();
    const session = await streamById(runtime, "events")?.open(undefined, emit);
    expect(emit).toHaveBeenCalledWith("ready");
    await session?.dispose();
    await runtime.dispose();
  });
});
