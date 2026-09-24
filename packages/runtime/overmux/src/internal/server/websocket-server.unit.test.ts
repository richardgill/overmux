import {
  decodeProtocolFrame,
  encodeProtocolMessage,
  serverProtocolMessageSchema,
  webSocketCloseCode,
  type ServerProtocolMessage,
} from "../shared/index";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  request as requestHttp,
  type IncomingHttpHeaders,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import { startOvermuxServer, type OvermuxServer } from "./index";
import { discoverInstance, sendControlRequest } from "./auth/instance-control";
import { findAvailablePort } from "./test-port";

type MessageReader = {
  binaryFrames: () => number;
  count: (type: ServerProtocolMessage["type"]) => number;
  next: (type: ServerProtocolMessage["type"]) => Promise<ServerProtocolMessage>;
  textFrames: () => number;
};

const bearerToken = async (server: OvermuxServer) => {
  const instance = await discoverInstance(server.port);
  const response = await sendControlRequest(instance, {
    type: "issue-bearer",
  });
  return response.bearer.token;
};

const openSocket = async (server: OvermuxServer) => {
  const socket = new WebSocket(
    `${server.url.replace("http", "ws")}/api/socket`,
    { headers: { authorization: `Bearer ${await bearerToken(server)}` } },
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
};

const binaryData = (data: RawData) => {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

const createReader = (socket: WebSocket): MessageReader => {
  const messages: ServerProtocolMessage[] = [];
  const listeners = new Set<() => void>();
  let binaryFrames = 0;
  let textFrames = 0;
  socket.on("message", (data, isBinary) => {
    binaryFrames += Number(isBinary);
    textFrames += Number(!isBinary);
    messages.push(
      serverProtocolMessageSchema.parse(
        decodeProtocolFrame(isBinary ? binaryData(data) : data.toString()),
      ),
    );
    listeners.forEach((listener) => listener());
  });
  return {
    binaryFrames: () => binaryFrames,
    count: (type) => messages.filter((message) => message.type === type).length,
    next: (type) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${type}`)),
          2_000,
        );
        const inspect = () => {
          const index = messages.findIndex((message) => message.type === type);
          if (index < 0) {
            return;
          }
          clearTimeout(timeout);
          listeners.delete(inspect);
          resolve(messages.splice(index, 1)[0]!);
        };
        listeners.add(inspect);
        inspect();
      }),
    textFrames: () => textFrames,
  };
};

const send = (socket: WebSocket, message: unknown) => {
  socket.send(encodeProtocolMessage(message));
};

const rejectedStatus = (url: string, headers: Record<string, string>) => {
  const socket = new WebSocket(url, { headers });
  return new Promise<number>((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
      socket.terminate();
    });
    socket.once("error", reject);
  });
};

const postJson = ({
  body,
  headers,
  url,
}: {
  body: unknown;
  headers: Record<string, string>;
  url: string;
}) =>
  new Promise<{ headers: IncomingHttpHeaders; status: number }>(
    (resolve, reject) => {
      const requestBody = JSON.stringify(body);
      const request = requestHttp(
        url,
        {
          headers: {
            ...headers,
            "content-length": Buffer.byteLength(requestBody),
            "content-type": "application/json",
          },
          method: "POST",
        },
        (response) => {
          response.resume();
          response.once("end", () =>
            resolve({
              headers: response.headers,
              status: response.statusCode ?? 0,
            }),
          );
        },
      );
      request.once("error", reject);
      request.end(requestBody);
    },
  );

describe("WebSocket server", () => {
  it("handles validated operations on the socket endpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overmux-socket-"));
    const configPath = join(directory, "overmux.config.ts");
    const port = await findAvailablePort();
    let server: OvermuxServer | undefined;
    let socket: WebSocket | undefined;
    let secondSocket: WebSocket | undefined;

    try {
      await writeFile(
        configPath,
        `import { defineOvermuxConfig, defineOvermuxServer } from "overmux";
import { z } from "zod";
const input = z.object({ value: z.number() });
const resourceContract = { input, output: z.object({ doubled: z.number() }) };
const server = defineOvermuxServer({
  resources: {
    doubled: {
      contract: resourceContract,
      kind: "query",
      read: ({ value }) => ({ doubled: value * 2 }),
    },
    ready: {
      contract: { input: z.void(), output: z.literal("ready") },
      kind: "query",
      read: () => "ready",
    },
  },
  operations: {
    invalidate: {
      input,
      output: z.object({ accepted: z.number() }),
      handle: ({ value }, context) => {
        context.invalidate("doubled", { value });
        return { accepted: value };
      },
    },
    notify: {
      input: z.object({}),
      handle: (_input, context) => context.notifications.send({
        body: "The task passed",
        open: { link: "/tasks/one" },
        title: "Task finished",
      }),
    },
  },
  streams: {
    echo: {
      contract: {
        input: z.object({ prefix: z.string() }),
        clientMessage: z.string(),
        serverMessage: z.union([z.string(), z.instanceof(Uint8Array)]),
      },
      open: ({ prefix }, { emit }) => {
        emit(new Uint8Array([1, 2, 3]));
        return { onMessage: (message) => emit(prefix + message) };
      },
    },
    malformed: {
      contract: { input: z.void(), clientMessage: z.never(), serverMessage: z.string() },
      open: (_input, { emit }) => {
        setTimeout(() => emit(42), 0);
        return {};
      },
    },
    overflow: {
      contract: { input: z.void(), clientMessage: z.never(), serverMessage: z.string() },
      open: (_input, { emit }) => {
        emit("x".repeat(1048577));
        return {};
      },
    },
    failingMessage: {
      contract: { input: z.void(), clientMessage: z.string(), serverMessage: z.never() },
      open: () => ({ onMessage: () => { throw new Error("message failed"); } }),
    },
  },
});
export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  host: "127.0.0.1",
  port: ${port},
  server,
  watch: false,
});
`,
      );
      const previousDataHome = process.env.XDG_DATA_HOME;
      process.env.XDG_DATA_HOME = directory;
      try {
        server = await startOvermuxServer({
          configAliases: {
            overmux: import.meta.resolve("overmux"),
            zod: import.meta.resolve("zod"),
          },
          configPath,
        });
      } finally {
        if (previousDataHome === undefined) {
          Reflect.deleteProperty(process.env, "XDG_DATA_HOME");
        } else {
          process.env.XDG_DATA_HOME = previousDataHome;
        }
      }
      const token = await bearerToken(server);
      const manifestResponse = await fetch(
        `${server.url}/api/runtime-manifest`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const manifest = (await manifestResponse.json()) as {
        operations: string[];
        resources: string[];
        streams: string[];
      };
      expect(manifestResponse.headers.get("cache-control")).toBe("no-store");
      expect(manifestResponse.headers.get("set-cookie")).toBeNull();
      socket = await openSocket(server);
      secondSocket = await openSocket(server);
      const reader = createReader(socket);
      const secondReader = createReader(secondSocket);
      const notificationResponse = await fetch(
        `${server.url}/api/operations/notify`,
        {
          body: "{}",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          method: "POST",
        },
      );
      expect(notificationResponse.status).toBe(204);
      const expectedNotification = {
        notification: {
          body: "The task passed",
          open: { link: "/tasks/one" },
          title: "Task finished",
        },
        type: "notification",
      };
      await expect(reader.next("notification")).resolves.toEqual(
        expectedNotification,
      );
      await expect(secondReader.next("notification")).resolves.toEqual(
        expectedNotification,
      );

      send(socket, {
        operationId: "read-no-input",
        resourceName: "ready",
        type: "resource-read",
      });
      await expect(reader.next("resource-result")).resolves.toMatchObject({
        operationId: "read-no-input",
        output: "ready",
      });
      send(socket, {
        input: { value: 2 },
        operationId: "read-1",
        resourceName: "doubled",
        type: "resource-read",
      });
      await expect(reader.next("resource-result")).resolves.toMatchObject({
        operationId: "read-1",
        output: { doubled: 4 },
      });

      send(socket, {
        input: { value: 2 },
        operationId: "subscribe-1",
        resourceName: "doubled",
        subscriptionId: "subscription-1",
        type: "resource-subscribe",
      });
      const operationResponse = await fetch(
        `${server.url}/api/operations/invalidate`,
        {
          body: JSON.stringify({ value: 2 }),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          method: "POST",
        },
      );
      await expect(operationResponse.json()).resolves.toEqual({ accepted: 2 });
      await expect(reader.next("resource-invalidated")).resolves.toMatchObject({
        subscriptionId: "subscription-1",
      });
      send(socket, {
        subscriptionId: "subscription-1",
        type: "resource-unsubscribe",
      });

      send(socket, {
        input: { prefix: "echo:" },
        operationId: "stream-open-1",
        streamName: "echo",
        streamId: "stream-1",
        type: "stream-open",
      });
      await expect(reader.next("stream-opened")).resolves.toMatchObject({
        streamId: "stream-1",
      });
      await expect(reader.next("stream-output")).resolves.toMatchObject({
        message: new Uint8Array([1, 2, 3]),
      });
      send(socket, {
        message: "hello",
        streamId: "stream-1",
        type: "stream-message",
      });
      await expect(reader.next("stream-output")).resolves.toMatchObject({
        message: "echo:hello",
      });
      expect(reader.binaryFrames()).toBeGreaterThan(0);
      expect(reader.textFrames()).toBeGreaterThan(0);

      send(socket, {
        operationId: "duplicate-open",
        streamName: "echo",
        streamId: "stream-1",
        type: "stream-open",
      });
      expect(await reader.next("error")).toEqual({
        code: "conflict",
        message: "Stream ID is already active",
        operationId: "duplicate-open",
        type: "error",
      });
      send(socket, { streamId: "stream-1", type: "stream-close" });
      await expect(reader.next("stream-closed")).resolves.toMatchObject({
        streamId: "stream-1",
      });

      send(socket, {
        operationId: "malformed-open",
        streamName: "malformed",
        streamId: "malformed-stream",
        type: "stream-open",
      });
      await reader.next("stream-opened");
      await expect(reader.next("error")).resolves.toMatchObject({
        code: "bad-request",
        operationId: "malformed-stream",
      });
      await expect(reader.next("stream-closed")).resolves.toMatchObject({
        streamId: "malformed-stream",
      });

      send(socket, {
        operationId: "overflow-open",
        streamName: "overflow",
        streamId: "overflow-stream",
        type: "stream-open",
      });
      await expect(reader.next("error")).resolves.toMatchObject({
        code: "internal",
        operationId: "overflow-open",
      });

      send(socket, {
        operationId: "failing-open",
        streamName: "failingMessage",
        streamId: "failing-stream",
        type: "stream-open",
      });
      await reader.next("stream-opened");
      send(socket, {
        message: "fail",
        streamId: "failing-stream",
        type: "stream-message",
      });
      await expect(reader.next("error")).resolves.toMatchObject({
        message: "message failed",
        operationId: "failing-stream",
      });

      socket.send("not json");
      await expect(reader.next("error")).resolves.toMatchObject({
        code: "bad-request",
      });
      send(socket, {
        input: { value: "bad" },
        operationId: "read-bad",
        resourceName: "doubled",
        type: "resource-read",
      });
      await expect(reader.next("error")).resolves.toMatchObject({
        code: "bad-request",
        operationId: "read-bad",
      });
    } finally {
      socket?.terminate();
      secondSocket?.terminate();
      await server?.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("forwards the effective trusted-proxy origin to private Vite HMR", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overmux-proxy-hmr-"));
    const configPath = join(directory, "overmux.config.ts");
    const port = await findAvailablePort();
    const proxyOrigin = "https://machine.example.com";
    const vite = createServer();
    const viteSockets = new WebSocketServer({ server: vite });
    await new Promise<void>((resolve) => vite.listen(0, "127.0.0.1", resolve));
    const viteAddress = vite.address() as AddressInfo;
    let server: OvermuxServer | undefined;
    let socket: WebSocket | undefined;
    try {
      await writeFile(
        configPath,
        `import { defineOvermuxConfig, defineOvermuxServer } from "overmux";
export default defineOvermuxConfig({
  auth: {
    mode: "cli-login",
    origins: ["http://127.0.0.1:${port}", "${proxyOrigin}"],
    trustedProxyPeer: "127.0.0.1",
  },
  host: "127.0.0.1",
  port: ${port},
  server: defineOvermuxServer({ resources: {} }),
  watch: false,
});\n`,
      );
      const previousDataHome = process.env.XDG_DATA_HOME;
      process.env.XDG_DATA_HOME = directory;
      try {
        server = await startOvermuxServer({
          configAliases: { overmux: import.meta.resolve("overmux") },
          configPath,
          developmentWebTarget: `http://127.0.0.1:${viteAddress.port}`,
        });
      } finally {
        if (previousDataHome === undefined) {
          Reflect.deleteProperty(process.env, "XDG_DATA_HOME");
        } else {
          process.env.XDG_DATA_HOME = previousDataHome;
        }
      }
      const instance = await discoverInstance(server.port);
      const grant = await sendControlRequest(instance, {
        type: "create-login",
      });
      const proxyHeaders = {
        host: new URL(proxyOrigin).host,
        origin: proxyOrigin,
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": new URL(proxyOrigin).host,
        "x-forwarded-proto": "https",
      };
      const login = await postJson({
        body: { code: grant.login.code },
        headers: proxyHeaders,
        url: `${server.url}/api/auth/login`,
      });
      const cookie = login.headers["set-cookie"]?.[0]?.split(";", 1)[0];
      if (!cookie) {
        throw new Error("Expected a browser session cookie");
      }
      const upstreamRequest = new Promise<Headers>((resolve) => {
        viteSockets.once("connection", (_upstream, request) =>
          resolve(new Headers(request.headers as Record<string, string>)),
        );
      });
      socket = new WebSocket(
        `${server.url.replace("http", "ws")}/_overmux/vite/hmr`,
        { headers: { ...proxyHeaders, cookie } },
      );
      await new Promise<void>((resolve, reject) => {
        socket!.once("open", resolve);
        socket!.once("error", reject);
      });
      const headers = await upstreamRequest;

      expect(login.status).toBe(200);
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("x-forwarded-host")).toBe("machine.example.com");
      expect(headers.get("x-forwarded-port")).toBe("443");
      expect(headers.get("x-forwarded-proto")).toBe("https");
    } finally {
      socket?.terminate();
      await server?.close();
      viteSockets.clients.forEach((client) => client.terminate());
      await new Promise<void>((resolve) => viteSockets.close(() => resolve()));
      await new Promise<void>((resolve) => vite.close(() => resolve()));
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("enforces browser socket policy, fails closed, and revokes active sockets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overmux-socket-open-"));
    const configPath = join(directory, "overmux.config.ts");
    const port = await findAvailablePort();
    const unavailableVitePort = await findAvailablePort();
    let server: OvermuxServer | undefined;
    let socket: WebSocket | undefined;
    try {
      await writeFile(
        join(directory, "client.ts"),
        "export default { component: () => null };\n",
      );
      await writeFile(
        configPath,
        `import { defineOvermuxConfig, defineOvermuxServer } from "overmux";
const server = defineOvermuxServer({ resources: {} });
export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  host: "127.0.0.1",
  port: ${port},
  server,
  watch: false,
});\n`,
      );
      server = await startOvermuxServer({
        configAliases: {
          overmux: import.meta.resolve("overmux"),
        },
        configPath,
        developmentWebTarget: `http://127.0.0.1:${unavailableVitePort}`,
      });
      const socketBase = server.url.replace("http", "ws");
      const viteSocketUrl = `${socketBase}/_overmux/vite/hmr`;
      await expect(
        rejectedStatus(`${socketBase}/api/socket`, {}),
      ).resolves.toBe(401);
      await expect(rejectedStatus(viteSocketUrl, {})).resolves.toBe(401);
      await expect(rejectedStatus(`${socketBase}/wrong`, {})).resolves.toBe(
        404,
      );

      const instance = await discoverInstance(server.port);
      const grantResponse = await sendControlRequest(instance, {
        type: "create-login",
      });
      const loginResponse = await fetch(`${server.url}/api/auth/login`, {
        body: JSON.stringify({ code: grantResponse.login.code }),
        headers: {
          "content-type": "application/json",
          origin: server.url,
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      });
      const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
      if (!cookie) {
        throw new Error("Expected a browser session cookie");
      }
      await expect(
        rejectedStatus(`${socketBase}/api/socket`, {
          cookie,
          origin: "https://evil.example",
        }),
      ).resolves.toBe(403);
      await expect(
        rejectedStatus(viteSocketUrl, {
          cookie,
          origin: "https://evil.example",
        }),
      ).resolves.toBe(403);
      await expect(
        rejectedStatus(viteSocketUrl, {
          authorization: `Bearer ${await bearerToken(server)}`,
        }),
      ).resolves.toBe(401);
      await expect(
        rejectedStatus(viteSocketUrl, { cookie, origin: server.url }),
      ).rejects.toBeInstanceOf(Error);
      socket = new WebSocket(`${socketBase}/api/socket`, {
        headers: { cookie, origin: server.url },
      });
      await new Promise<void>((resolve, reject) => {
        socket!.once("open", resolve);
        socket!.once("error", reject);
      });
      const sessions = await sendControlRequest(instance, {
        type: "list-sessions",
      });
      const session = sessions.sessions.at(-1);
      if (!session) {
        throw new Error("Expected an active browser session");
      }
      const closed = new Promise<number>((resolve) =>
        socket!.once("close", (code) => resolve(code)),
      );
      await sendControlRequest(instance, {
        id: session.id,
        type: "revoke-session",
      });
      await expect(closed).resolves.toBe(
        webSocketCloseCode.authenticationRevoked,
      );
    } finally {
      socket?.terminate();
      await server?.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
