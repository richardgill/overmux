import {
  defineStreamContract,
  defineStreamHandler,
  noInputSchema,
} from "../../../public/index";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createRuntimeLifecycle } from "./runtime-lifecycle";
import {
  createRuntimeStreams,
  type RuntimeStreamDefinitions,
} from "./runtime-streams";

const createContext =
  (lifecycle: ReturnType<typeof createRuntimeLifecycle>) =>
  (signal?: AbortSignal) => ({
    instance: {
      getInstanceId: () => "test",
      getDeepLinkPrefix: () => "overmux://test",
    },
    invalidate: vi.fn(),
    signal: lifecycle.requestSignal(signal),
  });

const streamById = (
  streams: ReturnType<typeof createRuntimeStreams>,
  id: string,
) => streams.get(id);

describe("runtime streams", () => {
  it("orders messages and disposes an aborted session exactly once", async () => {
    const lifecycle = createRuntimeLifecycle();
    const events: string[] = [];
    const dispose = vi.fn();
    const contract = defineStreamContract({
      clientMessage: z.string(),
      input: noInputSchema,
      serverMessage: z.string(),
    });
    const streams = createRuntimeStreams({
      context: createContext(lifecycle),
      definitions: {
        events: defineStreamHandler(contract, () => ({
          dispose,
          onMessage: async (message) => {
            await Promise.resolve();
            events.push(message);
          },
        })),
      } as RuntimeStreamDefinitions,
      lifecycle,
    });
    expect(streams.names).toEqual(["events"]);
    const request = new AbortController();
    const session = await streamById(streams, "events")!.open(
      undefined,
      vi.fn(),
      request.signal,
    );

    await Promise.all([session.send("first"), session.send("second")]);
    await expect(session.send(3)).rejects.toThrow();
    request.abort();
    await session.dispose();

    expect(events).toEqual(["first", "second"]);
    expect(dispose).toHaveBeenCalledOnce();
    await lifecycle.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("validates emitted messages and disposes failed opens", async () => {
    const lifecycle = createRuntimeLifecycle();
    const dispose = vi.fn();
    const contract = defineStreamContract({
      clientMessage: z.string(),
      input: noInputSchema,
      serverMessage: z.string(),
    });
    const streams = createRuntimeStreams({
      context: createContext(lifecycle),
      definitions: {
        malformed: defineStreamHandler(contract, (_input, { emit }) => {
          emit(3 as unknown as string);
          return { dispose };
        }),
      } as RuntimeStreamDefinitions,
      lifecycle,
    });

    await expect(
      streamById(streams, "malformed")?.open(undefined, vi.fn()),
    ).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
    await lifecycle.dispose();
  });
});
