import { defineOperation, type ConfigDefinition } from "../../public/index";
import type { RuntimeManifest } from "../shared/index";
import { noInputSchema } from "../../public/index";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createOvermuxServerApi, type OvermuxServerApi } from "./browser-api";
import type { ClientTransport } from "./transport";

const reload = defineOperation({
  handle: () => ({ reloaded: true }),
  input: noInputSchema,
  output: z.object({ reloaded: z.boolean() }),
});
const closePane = defineOperation({
  handle: () => ({ closed: true }),
  input: z.object({ paneId: z.string() }),
  output: z.object({ closed: z.boolean() }),
});
type ServerConfig = ConfigDefinition<
  {},
  {},
  { closePane: typeof closePane; reload: typeof reload }
>;

const typeExamples = (api: OvermuxServerApi<ServerConfig>) => {
  const reloaded: Promise<{ reloaded: boolean }> =
    api.executeOperation("reload");
  const closed: Promise<{ closed: boolean }> = api.executeOperation(
    "closePane",
    { paneId: "%1" },
  );
  void reloaded;
  void closed;
  // @ts-expect-error Operation names are exact.
  void api.executeOperation("missing");
  // @ts-expect-error Operations with input require it.
  void api.executeOperation("closePane");
  // @ts-expect-error No-input operations do not accept dummy input.
  void api.executeOperation("reload", {});
};

void typeExamples;

const manifest: RuntimeManifest = {
  debug: false,
  operations: ["closePane"],
  protocolVersion: 10,
  resources: ["workspace"],
  streams: ["terminal"],
};

const createTransport = () =>
  ({
    invokeOperation: vi.fn(async () => ({ closed: true })),
  }) as unknown as ClientTransport;

describe("browser Overmux server API", () => {
  it("invokes named HTTP operations with cancellation", async () => {
    const transport = createTransport();
    const api = createOvermuxServerApi({ manifest, transport });
    const controller = new AbortController();

    await expect(
      api.executeOperation("closePane", { paneId: "%1" }, controller.signal),
    ).resolves.toEqual({ closed: true });
    expect(transport.invokeOperation).toHaveBeenCalledWith({
      input: { paneId: "%1" },
      name: "closePane",
      signal: controller.signal,
    });
  });

  it("passes configured resource and stream names to transport", async () => {
    const transport = {
      ...createTransport(),
      openStream: vi.fn(() => ({ close: vi.fn(), send: vi.fn() })),
      readResource: vi.fn(async () => "ready"),
      subscribeResource: vi.fn(() => vi.fn()),
    } as unknown as ClientTransport;
    const api = createOvermuxServerApi({ manifest, transport });

    await api.readResource({ id: "workspace" });
    api.subscribeResource({
      id: "workspace",
      onError: vi.fn(),
      onInvalidate: vi.fn(),
    });
    api.openStream({
      id: "terminal",
      onClose: vi.fn(),
      onError: vi.fn(),
      onMessage: vi.fn(),
      onOpen: vi.fn(),
    });

    expect(transport.readResource).toHaveBeenCalledWith({
      input: undefined,
      resourceName: "workspace",
    });
    expect(transport.subscribeResource).toHaveBeenCalledWith(
      expect.objectContaining({ resourceName: "workspace" }),
    );
    expect(transport.openStream).toHaveBeenCalledWith(
      expect.objectContaining({ streamName: "terminal" }),
    );
  });

  it("rejects registrations absent from manifest", () => {
    const api = createOvermuxServerApi({
      manifest,
      transport: createTransport(),
    });
    const streamCallbacks = {
      onClose: vi.fn(),
      onError: vi.fn(),
      onMessage: vi.fn(),
      onOpen: vi.fn(),
    };

    expect(() => api.executeOperation("missing")).toThrow(
      "Operation is not available: missing",
    );
    expect(() => api.readResource({ id: "missing" })).toThrow(
      "Resource is not available: missing",
    );
    expect(() => api.openStream({ id: "missing", ...streamCallbacks })).toThrow(
      "Stream is not available: missing",
    );
  });
});
