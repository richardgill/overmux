import {
  defineOperation,
  defineOvermuxServer,
  defineStreamHandler,
} from "../../public/index";
import type {
  OperationDefinition,
  ConfigDefinition,
  QueryResourceDefinition,
  StreamHandlerDefinition,
} from "../../public/index";
import {
  defineResourceContract,
  defineStreamContract,
  noInputSchema,
} from "../../public/index";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createOvermuxHooks, type StreamResult } from "./overmux-react";
import { RuntimeContext, skipToken } from "./commands";
import { createClientTransport } from "./transport";
import { createOvermuxServerApi } from "./browser-api";
import { installInstanceForwarding } from "./host/instance-forwarding";
import { protocolVersion } from "../shared/index";

const workspace = {
  contract: defineResourceContract({
    input: noInputSchema,
    output: z.object({ name: z.string() }),
  }),
  kind: "query",
} as QueryResourceDefinition<
  typeof noInputSchema,
  z.ZodObject<{ name: z.ZodString }>
>;
const status = {
  contract: defineResourceContract({
    input: z.object({ path: z.string() }),
    output: z.object({ revision: z.string() }),
  }),
  kind: "query",
} as QueryResourceDefinition<
  z.ZodObject<{ path: z.ZodString }>,
  z.ZodObject<{ revision: z.ZodString }>
>;
const reload = {
  handle: () => undefined,
  input: noInputSchema,
  output: z.void(),
} as OperationDefinition<typeof noInputSchema, z.ZodVoid>;
const terminal = {
  contract: defineStreamContract({
    clientMessage: z.object({ data: z.string(), type: z.literal("input") }),
    input: z.object({ paneId: z.string() }),
    serverMessage: z.object({ output: z.string() }),
  }),
} as StreamHandlerDefinition<
  z.ZodObject<{ paneId: z.ZodString }>,
  z.ZodObject<{ data: z.ZodString; type: z.ZodLiteral<"input"> }>,
  z.ZodObject<{ output: z.ZodString }>
>;
const events = {
  contract: defineStreamContract({
    clientMessage: z.never(),
    input: noInputSchema,
    serverMessage: z.object({ message: z.string() }),
  }),
} as StreamHandlerDefinition<
  typeof noInputSchema,
  z.ZodNever,
  z.ZodObject<{ message: z.ZodString }>
>;
type ServerConfig = ConfigDefinition<
  { status: typeof status; workspace: typeof workspace },
  { events: typeof events; terminal: typeof terminal },
  { reload: typeof reload }
>;
const { useInstance, useOperation, useResource, useStream } =
  createOvermuxHooks<ServerConfig>();

const closePane = defineOperation({
  handle: () => ({ closed: true }),
  input: z.object({ paneId: z.string() }),
  output: z.object({ closed: z.boolean() }),
});
const server = defineOvermuxServer({
  operations: {
    closePane,
    reload,
  },
  resources: {},
  streams: {
    terminal: defineStreamHandler(terminal.contract, () => ({})),
  },
});
const integrated = createOvermuxHooks<typeof server>();

const typeExamples = () => {
  const workspaceResult = useResource({ id: "workspace" });
  const skippedResult: undefined = useResource({
    id: "status",
    input: skipToken,
  });
  const skippedWorkspace: undefined = useResource({
    id: "workspace",
    input: skipToken,
  });
  void skippedResult;
  void skippedWorkspace;
  useResource({ id: "status", input: { path: "/repo" } });
  const reloadMutation = useOperation({ id: "reload" });
  reloadMutation.mutate();
  void reloadMutation.mutateAsync();
  reloadMutation.reset();
  useStream({ id: "terminal", input: { paneId: "%1" } }).send({
    data: "ls\r",
    type: "input",
  });
  useStream({ id: "events" });

  if (workspaceResult.status === "success") {
    const name: string = workspaceResult.data.name;
    void name;
  }
  if (workspaceResult.status === "error") {
    const error: Error = workspaceResult.error;
    void error;
  }
  const refetchResult: void = workspaceResult.refetch();
  void refetchResult;
  // @ts-expect-error Resource results expose only the documented state.
  workspaceResult.isPending;

  integrated.useOperation({ id: "reload" }).mutate();
  integrated.useOperation({ id: "closePane" }).mutate({ paneId: "%1" });
  const closed = integrated
    .useOperation({ id: "closePane" })
    .mutateAsync({ paneId: "%1" });
  const typedOutput: Promise<{ closed: boolean }> = closed;
  void typedOutput;
  integrated.useStream({ id: "terminal", input: { paneId: "%1" } }).send({
    data: "ls\r",
    type: "input",
  });

  // @ts-expect-error Parameterized resources require input.
  useResource({ id: "status" });
  // @ts-expect-error No-input resources omit input.
  useResource({ id: "workspace", input: {} });
  // @ts-expect-error No-input streams omit input.
  useStream({ id: "events", input: {} });
  // @ts-expect-error IDs are inferred from the server configuration.
  useOperation({ id: "missing" });
  // @ts-expect-error Hooks use extensible object arguments.
  useResource("workspace");
  useStream({ id: "terminal", input: { paneId: "%1" } }).send({
    // @ts-expect-error Stream messages are inferred from the server configuration.
    type: "resize",
  });
};

void typeExamples;

let streamResult: StreamResult<
  { data: string; type: "input" },
  { output: string }
>;
const StreamProbe = ({
  paneId,
  onLayout,
}: {
  paneId: string;
  onLayout?: (stream: typeof streamResult) => void;
}) => {
  const stream = useStream({ id: "terminal", input: { paneId } });
  streamResult = stream;
  useLayoutEffect(() => onLayout?.(stream), [onLayout, stream]);
  return null;
};

const InstanceProbe = () => (
  <span>{useInstance()?.deepLinkPrefix ?? "undiscovered"}</span>
);

const identitySocket = () =>
  Object.assign(new EventTarget(), {
    readyState: WebSocket.OPEN,
    close: vi.fn(),
  });
const discover = (socket: EventTarget, instanceId: string) =>
  socket.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({ type: "server-info", instanceId }),
    }),
  );

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

describe("createOvermuxHooks", () => {
  it("creates bound hooks", () => {
    expect(createOvermuxHooks).toBeTypeOf("function");
  });

  it("reactively discovers scoped identity and forwards each connection to the host", async () => {
    const first = identitySocket();
    const second = identitySocket();
    const sockets = [first, second];
    const transport = createClientTransport({
      createSocket: () => sockets.shift() as unknown as WebSocket,
    });
    const other = createClientTransport();
    const manifest = {
      debug: false,
      operations: [],
      protocolVersion,
      resources: [],
      streams: [],
    };
    const api = createOvermuxServerApi({ manifest, transport });
    const report = vi.fn();
    window.overmuxHost = {
      version: 1,
      platform: "linux",
      instance: { version: 1, report },
    };
    const stopForwarding = installInstanceForwarding(transport);
    try {
      await act(async () =>
        root.render(
          <RuntimeContext.Provider
            value={{
              manifest,
              overmuxServerApi: api,
              refreshCommands: vi.fn(),
              registerCommand: vi.fn(),
            }}
          >
            <InstanceProbe />
          </RuntimeContext.Provider>,
        ),
      );
      expect(container.textContent).toBe("undiscovered");
      expect(api.getInstanceId()).toBeUndefined();
      expect(api.getDeepLinkPrefix()).toBeUndefined();
      transport.activate();
      await act(async () => {
        discover(first, "work-1234");
      });
      expect(api.getInstanceId()).toBe("work-1234");
      expect(api.getDeepLinkPrefix()).toBe("overmux://work-1234");
      expect(container.textContent).toBe("overmux://work-1234");
      expect(other.getInstance()).toBeUndefined();
      expect(report).toHaveBeenLastCalledWith({ instanceId: "work-1234" });

      await act(async () => {
        first.dispatchEvent(new CloseEvent("close"));
      });
      expect(container.textContent).toBe("undiscovered");
      await vi.waitFor(() => expect(sockets).toHaveLength(0));
      await act(async () => {
        discover(second, "work-5678");
      });
      expect(container.textContent).toBe("overmux://work-5678");
      expect(report).toHaveBeenCalledTimes(2);
      expect(report).toHaveBeenLastCalledWith({ instanceId: "work-5678" });
      await act(async () => {
        transport.dispose();
        discover(second, "stale");
      });
      expect(api.getInstanceId()).toBeUndefined();
      expect(report).toHaveBeenCalledTimes(2);
    } finally {
      stopForwarding();
      transport.dispose();
      other.dispose();
      window.overmuxHost = undefined;
    }
  });

  it("identifies each server-opened stream across reconnects and effect restarts", async () => {
    const openStream = vi.fn(
      (
        _options: Parameters<
          ReturnType<typeof createOvermuxServerApi>["openStream"]
        >[0],
      ) => ({ close: vi.fn(), send: vi.fn() }),
    );
    const runtime = {
      manifest: { streams: ["terminal"] },
      overmuxServerApi: { openStream },
    };
    const onLayout = vi.fn();
    const render = (paneId: string) =>
      act(async () =>
        root.render(
          <RuntimeContext.Provider value={runtime as never}>
            <StreamProbe paneId={paneId} onLayout={onLayout} />
          </RuntimeContext.Provider>,
        ),
      );
    await render("%1");
    expect(streamResult.connectionId).toBeUndefined();
    const callbacks = openStream.mock.calls[0]![0];
    const send = streamResult.send;
    const received = vi.fn();
    const unsubscribe = streamResult.subscribe(received);
    await act(async () => callbacks.onOpen());
    const first = streamResult.connectionId;
    expect(first).toBeTypeOf("symbol");
    await render("%1");
    expect(streamResult.connectionId).toBe(first);
    expect(openStream).toHaveBeenCalledOnce();

    // The websocket transport keeps the handle and invokes onOpen again after restore.
    // Batch disconnect/reopen to prove identity does not depend on observing closed.
    await act(async () => {
      callbacks.onError(new Error("Disconnected"));
      callbacks.onOpen();
    });
    const reconnected = streamResult.connectionId;
    expect(reconnected).not.toBe(first);
    expect(streamResult.send).toBe(send);
    expect(streamResult.status).toBe("open");

    // Restarting the owning effect opens a new handle with the same public methods.
    onLayout.mockClear();
    await render("%2");
    // Consumers must see opening even in layout effects, before useStream's passive
    // effect replaces the old handle. An old acknowledgement is not readiness for %2.
    expect(onLayout.mock.calls[0]![0]).toMatchObject({
      connectionId: undefined,
      status: "opening",
    });
    expect(streamResult.connectionId).toBeUndefined();
    expect(openStream.mock.results[0]!.value.close).toHaveBeenCalledOnce();
    await act(async () => openStream.mock.calls[1]![0].onOpen());
    const restarted = streamResult.connectionId;
    expect(restarted).toBeTypeOf("symbol");
    expect(restarted).not.toBe(reconnected);
    expect(streamResult.send).toBe(send);
    await act(async () => {
      callbacks.onClose();
      callbacks.onOpen();
      callbacks.onMessage({ output: "stale" });
      openStream.mock.calls[1]![0].onMessage({ output: "current" });
    });
    expect(streamResult.connectionId).toBe(restarted);
    expect(streamResult.status).toBe("open");
    expect(received).toHaveBeenCalledExactlyOnceWith({ output: "current" });
    unsubscribe();

    await act(async () => {
      streamResult.close();
      openStream.mock.calls[1]![0].onOpen();
      openStream.mock.calls[1]![0].onMessage({ output: "after close" });
    });
    expect(streamResult.connectionId).toBeUndefined();
    expect(streamResult.status).toBe("closed");
    expect(streamResult.send({ type: "input", data: "closed" })).toBe(false);
    expect(received).toHaveBeenCalledOnce();
  });

  it("skips resource reads and subscriptions", async () => {
    const readResource = vi.fn(async () => ({ revision: "abc123" }));
    const unsubscribe = vi.fn();
    const subscribeResource = vi.fn(() => unsubscribe);
    const runtime = {
      manifest: {
        resources: ["status"],
      },
      overmuxServerApi: { readResource, subscribeResource },
      refreshCommands: vi.fn(),
      registerCommand: vi.fn(),
    };
    const queryClient = new QueryClient();
    let result: unknown;
    const Resource = ({ skipped }: { skipped: boolean }) => {
      result = useResource({
        id: "status",
        input: skipped ? skipToken : { path: "/repo" },
      });
      return null;
    };
    const render = async (skipped: boolean) =>
      act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <RuntimeContext.Provider value={runtime as never}>
              <Resource skipped={skipped} />
            </RuntimeContext.Provider>
          </QueryClientProvider>,
        ),
      );

    await render(true);

    expect(result).toBeUndefined();
    expect(readResource).not.toHaveBeenCalled();
    expect(subscribeResource).not.toHaveBeenCalled();

    await render(false);
    await vi.waitFor(() => expect(readResource).toHaveBeenCalledOnce());
    expect(subscribeResource).toHaveBeenCalledOnce();

    await render(true);

    expect(result).toBeUndefined();
    expect(readResource).toHaveBeenCalledOnce();
    expect(subscribeResource).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
