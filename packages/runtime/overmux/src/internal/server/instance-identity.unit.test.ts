import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { discoverInstance, sendControlRequest } from "./auth/instance-control";
import {
  startApplicationServer,
  type ApplicationServer,
} from "./start-application-server";

const servers: ApplicationServer[] = [];
const sockets: WebSocket[] = [];
let testDirectory: string;

beforeEach(async () => {
  const root = resolve(".test-tmp");
  await mkdir(root, { recursive: true });
  testDirectory = await mkdtemp(join(root, "identity-"));
  vi.stubEnv("XDG_RUNTIME_DIR", testDirectory);
  vi.stubEnv("XDG_DATA_HOME", testDirectory);
  vi.stubEnv("XDG_STATE_HOME", testDirectory);
});

const start = async (instanceId?: string) => {
  const directory = await mkdtemp(join(testDirectory, "instance-"));
  const configPath = join(directory, "overmux.config.ts");
  await writeFile(
    configPath,
    `
import { z } from "zod";
let calls = 0;
const identity = (_input, { instance }) => ({
  instanceId: instance.getInstanceId(), deepLinkPrefix: instance.getDeepLinkPrefix(), calls,
});
const contract = { input: z.void(), output: z.object({ instanceId: z.string(), deepLinkPrefix: z.string(), calls: z.number() }) };
export default {
  auth: { mode: "cli-login" }, host: "127.0.0.1", watch: false,
  ${instanceId === undefined ? "" : `instanceId: ${instanceId},`}
  server: {
    resources: { identity: { contract, kind: "query", read: identity } },
    operations: { identity: { ...contract, handle: identity } },
    streams: { identity: {
      contract: { input: z.void(), clientMessage: z.never(), serverMessage: contract.output },
      open: (_input, context) => { context.emit(identity(undefined, context)); return {}; },
    } },
  },
};
`,
  );
  const server = await startApplicationServer({
    onRestartRequested: vi.fn(),
    options: {
      configPath,
      configAliases: { zod: import.meta.resolve("zod") },
      port: 0,
    },
  });
  servers.push(server);
  return server;
};

const connect = async (server: ApplicationServer, address = server.url) => {
  const control = await discoverInstance(server.port);
  const { bearer } = await sendControlRequest(control, {
    type: "issue-bearer",
  });
  const socket = new WebSocket(`${address.replace("http", "ws")}/api/socket`, {
    family: 4,
    headers: { authorization: `Bearer ${bearer.token}` },
  });
  sockets.push(socket);
  const messages: Record<string, unknown>[] = [];
  socket.on("message", (frame) => messages.push(JSON.parse(frame.toString())));
  await vi.waitFor(() => expect(messages.length).toBeGreaterThan(0));
  return { socket, messages, token: bearer.token };
};

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.terminate());
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await rm(testDirectory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("runtime instance identity", () => {
  it("resolves once from the bound port and scopes HTTP, resource and stream handlers", async () => {
    const server = await start(
      "({ port }) => { calls++; return `rich-work-${port}`; }",
    );
    const other = await start(
      "({ port }) => { calls++; return `rich-work-${port}`; }",
    );
    expect(server.port).not.toBe(0);
    const identity = {
      instanceId: `rich-work-${server.port}`,
      deepLinkPrefix: `overmux://rich-work-${server.port}`,
      calls: 1,
    };
    const { socket, messages, token } = await connect(server);
    expect(messages[0]).toEqual({
      type: "server-info",
      instanceId: identity.instanceId,
    });
    const response = await fetch(`${server.url}/api/operations/identity`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual(identity);
    socket.send(
      JSON.stringify({
        type: "resource-read",
        resourceName: "identity",
        operationId: "read",
      }),
    );
    socket.send(
      JSON.stringify({
        type: "stream-open",
        streamName: "identity",
        streamId: "stream",
        operationId: "stream",
      }),
    );
    await vi.waitFor(() => {
      expect(messages).toContainEqual({
        type: "resource-result",
        operationId: "read",
        output: identity,
      });
      expect(messages).toContainEqual({
        type: "stream-output",
        streamId: "stream",
        message: identity,
      });
    });
    const otherConnection = await connect(other);
    expect(otherConnection.messages[0]).toEqual({
      type: "server-info",
      instanceId: `rich-work-${other.port}`,
    });
    expect(other.port).not.toBe(server.port);

    socket.terminate();
    server.announceUpdateAvailable();
    const reconnected = await connect(
      server,
      `http://localhost:${server.port}`,
    );
    await vi.waitFor(() => expect(reconnected.messages).toHaveLength(2));
    expect(reconnected.messages).toEqual([
      { type: "server-info", instanceId: identity.instanceId },
      { type: "update-available" },
    ]);
  });

  it("defaults to the unmodified hostname and actual port", async () => {
    const server = await start();
    const { messages } = await connect(server);
    expect(messages[0]).toEqual({
      type: "server-info",
      instanceId: `${hostname()}-${server.port}`,
    });
  });

  it("uses a fixed configured instance ID", async () => {
    const server = await start('"fixed-instance"');
    const { messages } = await connect(server);

    expect(messages[0]).toEqual({
      type: "server-info",
      instanceId: "fixed-instance",
    });
  });

  it("rejects invalid callback results during startup", async () => {
    await expect(start('() => "Not Canonical"')).rejects.toThrow(
      "configure instanceId",
    );
  });
});
