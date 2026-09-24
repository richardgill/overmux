import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as requestHttp } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { startOvermuxServer, type OvermuxServer } from "./index";
import { discoverInstance, sendControlRequest } from "./auth/instance-control";
import { findAvailablePort } from "./test-port";

const servers: OvermuxServer[] = [];
const directories: string[] = [];

const createDirectory = async (name: string) => {
  const directory = await mkdtemp(join(tmpdir(), name));
  directories.push(directory);
  return directory;
};

const start = async (
  configPath: string,
  options: { developmentWebTarget?: string } = {},
) => {
  const server = await startOvermuxServer({
    ...options,
    configAliases: {
      overmux: import.meta.resolve("overmux"),
      zod: import.meta.resolve("zod"),
    },
    configPath,
  });
  servers.push(server);
  return server;
};

const bearerToken = async (server: OvermuxServer) => {
  const instance = await vi.waitFor(() => discoverInstance(server.port));
  const response = await sendControlRequest(instance, {
    type: "issue-bearer",
  });
  return response.bearer.token;
};

const authenticatedFetch = async (
  server: OvermuxServer,
  path: string,
  init: RequestInit = {},
) =>
  fetch(`${server.url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await bearerToken(server)}`,
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });

const rawGet = ({
  headers,
  url,
}: {
  headers: Record<string, string>;
  url: string;
}) =>
  new Promise<{ body: string; status: number }>((resolve, reject) => {
    const request = requestHttp(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () =>
        resolve({
          body: Buffer.concat(chunks).toString(),
          status: response.statusCode ?? 0,
        }),
      );
    });
    request.once("error", reject);
    request.end();
  });

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

const nextMessage = (socket: WebSocket, type: string) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      10_000,
    );
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type === type) {
        clearTimeout(timeout);
        resolve(message);
      }
    });
  });

const waitForHealth = async (server: OvermuxServer) => {
  await vi.waitFor(
    async () => {
      const response = await fetch(`${server.url}/api/health`).catch(
        () => undefined,
      );
      expect(response?.ok).toBe(true);
    },
    { interval: 100, timeout: 20_000 },
  );
};

afterEach(async () => {
  await Promise.allSettled(
    servers.splice(0).map(async (server) => server.close()),
  );
  await Promise.all(
    directories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe("Overmux server coordinator", () => {
  it("authenticates development traffic before proxying to Vite", async () => {
    const directory = await createDirectory("overmux-gateway-");
    const configPath = join(directory, "overmux.config.ts");
    const publicPort = await findAvailablePort();
    const proxyOrigin = "https://machine.example.com";
    const requests: { headers: Headers; path: string }[] = [];
    const vite = createServer((request, response) => {
      requests.push({
        headers: new Headers(request.headers as Record<string, string>),
        path: request.url ?? "",
      });
      response.end("private Vite");
    });
    await new Promise<void>((resolve) => vite.listen(0, "127.0.0.1", resolve));
    const address = vite.address() as AddressInfo;
    await writeFile(
      configPath,
      `import { defineOvermuxConfig, defineOvermuxServer } from "overmux";
export default defineOvermuxConfig({
  auth: {
    mode: "cli-login",
    origins: ["http://127.0.0.1:${publicPort}", "${proxyOrigin}"],
    trustedProxyPeer: "127.0.0.1",
  },
  host: "127.0.0.1",
  port: ${publicPort},
  server: defineOvermuxServer({ resources: {} }),
  watch: false,
});
`,
    );
    const server = await start(configPath, {
      developmentWebTarget: `http://127.0.0.1:${address.port}`,
    });

    try {
      expect((await fetch(`${server.url}/source.ts`)).status).toBe(401);
      expect((await fetch(`${server.url}/_overmux/settings`)).status).toBe(401);
      const response = await authenticatedFetch(server, "/source.ts", {
        headers: { forwarded: "for=attacker" },
      });
      expect(await response.text()).toBe("private Vite");
      const proxyResponse = await rawGet({
        headers: {
          authorization: `Bearer ${await bearerToken(server)}`,
          host: new URL(proxyOrigin).host,
          "x-forwarded-host": new URL(proxyOrigin).host,
          "x-forwarded-proto": "https",
        },
        url: `${server.url}/proxied.ts`,
      });
      expect(proxyResponse).toEqual({ body: "private Vite", status: 200 });
      expect(
        await (
          await authenticatedFetch(
            server,
            "/_overmux/settings?returnTo=%2Fsource",
          )
        ).text(),
      ).toBe("private Vite");
      expect(
        await (await authenticatedFetch(server, "/_overmux/logout")).text(),
      ).toBe("private Vite");
      expect((await authenticatedFetch(server, "/api/not-vite")).status).toBe(
        404,
      );
      expect(
        (await authenticatedFetch(server, "/_overmux/unknown")).status,
      ).toBe(404);
      expect(requests.map(({ path }) => path)).toEqual([
        "/source.ts",
        "/proxied.ts",
        "/_overmux/settings?returnTo=%2Fsource",
        "/_overmux/logout",
      ]);
      expect(requests[0]?.headers.get("authorization")).toBeNull();
      expect(requests[0]?.headers.get("forwarded")).toBeNull();
      expect(requests[0]?.headers.get("x-forwarded-host")).toBe(
        new URL(server.url).host,
      );
      expect(requests[1]?.headers.get("x-forwarded-host")).toBe(
        "machine.example.com",
      );
      expect(requests[1]?.headers.get("x-forwarded-port")).toBe("443");
      expect(requests[1]?.headers.get("x-forwarded-proto")).toBe("https");

      await new Promise<void>((resolve, reject) =>
        vite.close((cause) => (cause ? reject(cause) : resolve())),
      );
      const unavailable = await authenticatedFetch(server, "/source.ts");
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get("cache-control")).toBe("no-store");
    } finally {
      if (vite.listening) {
        await new Promise<void>((resolve) => vite.close(() => resolve()));
      }
    }
  });

  it("waits for a child serving the process-lifetime runtime", async () => {
    const directory = await createDirectory("overmux-start-");
    const configPath = join(directory, "overmux.config.ts");
    const port = await findAvailablePort();
    await writeFile(
      configPath,
      `import { defineOvermuxConfig, defineOvermuxServer } from "overmux";
export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  debug: true,
  host: "127.0.0.1",
  port: ${port},
  server: defineOvermuxServer({ resources: {} }),
  watch: false,
});
`,
    );

    const server = await start(configPath);
    const manifest = await (
      await authenticatedFetch(server, "/api/runtime-manifest")
    ).json();
    const missingApi = await authenticatedFetch(server, "/api/missing");

    expect(server.port).toBe(port);
    expect(manifest).not.toHaveProperty("ui");
    expect(missingApi.status).toBe(404);
    await expect(
      Promise.all([server.close(), server.close()]),
    ).resolves.toEqual([undefined, undefined]);
    servers.splice(servers.indexOf(server), 1);
  });

  it("infers the default localhost origin after an ephemeral port is assigned", async () => {
    const directory = await createDirectory("overmux-default-origin-");
    const configPath = join(directory, "overmux.config.ts");
    await writeFile(
      configPath,
      `export default {
  auth: { mode: "cli-login" },
  server: { resources: {} },
  watch: false,
};
`,
    );

    const server = await startOvermuxServer({
      configPath,
      port: 0,
      watch: false,
    });
    servers.push(server);
    const registration = await discoverInstance(server.port);
    const grant = await sendControlRequest(registration, {
      type: "create-login",
    });

    expect(server.url).toBe(`http://localhost:${server.port}`);
    expect(registration.url).toBe(server.url);
    expect(grant.login.urls[0]).toMatch(
      new RegExp(`^http://localhost:${server.port}/login#ticket=`),
    );
  });

  it("can bind an internal loopback server to an ephemeral port independently of the public address", async () => {
    const directory = await createDirectory("overmux-internal-address-");
    const configPath = join(directory, "overmux.config.ts");
    const publicPort = await findAvailablePort();
    await writeFile(
      configPath,
      `export default {
  auth: { mode: "cli-login" },
  host: "0.0.0.0",
  port: ${publicPort},
  server: { resources: {} },
  watch: false,
};
`,
    );

    const server = await startOvermuxServer({
      configPath,
      host: "127.0.0.1",
      port: 0,
      watch: false,
    });
    servers.push(server);

    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.port).toBeGreaterThan(0);
    expect(server.port).not.toBe(publicPort);
  });

  it("announces a watched update and starts one fresh child after restart", async () => {
    const directory = await createDirectory("overmux-restart-");
    const configPath = join(directory, "overmux.config.ts");
    const serverPath = join(directory, "overmux.server.ts");
    const operationStartedPath = join(directory, "operation-started");
    const operationCancelledPath = join(directory, "operation-cancelled");
    const port = await findAvailablePort();
    await writeFile(
      configPath,
      `import { defineOvermuxConfig } from "overmux";
import server from "./overmux.server";
export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  host: "127.0.0.1",
  port: ${port},
  server,
  watch: true,
});
`,
    );
    await writeFile(
      serverPath,
      `import { appendFileSync } from "node:fs";
import { defineOvermuxServer, noInputSchema } from "overmux";
import { z } from "zod";
export default defineOvermuxServer({
  operations: {
    wait: {
      input: noInputSchema,
      handle: (_input, { signal }) => new Promise((_resolve, reject) => {
        appendFileSync(${JSON.stringify(operationStartedPath)}, "started\\n");
        signal.addEventListener("abort", () => {
          appendFileSync(${JSON.stringify(operationCancelledPath)}, "cancelled\\n");
          reject(signal.reason);
        }, { once: true });
      }),
    },
  },
  resources: {
    status: {
      contract: { input: noInputSchema, output: z.literal("ready") },
      kind: "query",
      read: () => "ready",
    },
  },
});
`,
    );
    const server = await start(configPath);
    const firstManifest = (await (
      await authenticatedFetch(server, "/api/runtime-manifest")
    ).json()) as { resources: string[] };
    const socket = await openSocket(server);
    const update = nextMessage(socket, "update-available");
    const pendingOperation = authenticatedFetch(
      server,
      "/api/operations/wait",
      {
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ).catch(() => undefined);
    await vi.waitFor(async () =>
      expect(await readFile(operationStartedPath, "utf8")).toBe("started\n"),
    );

    await writeFile(serverPath, `${await readFile(serverPath, "utf8")}\n`);
    await expect(update).resolves.toMatchObject({ type: "update-available" });
    const restarting = nextMessage(socket, "restarting");
    const restartToken = await bearerToken(server);
    const responses = await Promise.all([
      fetch(`${server.url}/api/restart`, {
        headers: { authorization: `Bearer ${restartToken}` },
        method: "POST",
      }),
      fetch(`${server.url}/api/restart`, {
        headers: { authorization: `Bearer ${restartToken}` },
        method: "POST",
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    await expect(restarting).resolves.toMatchObject({ type: "restarting" });
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await pendingOperation;
    await waitForHealth(server);
    const secondManifest = (await (
      await authenticatedFetch(server, "/api/runtime-manifest")
    ).json()) as { resources: string[] };

    expect(firstManifest.resources).toEqual(["status"]);
    expect(secondManifest.resources).toEqual(["status"]);
    expect(await readFile(operationCancelledPath, "utf8")).toBe("cancelled\n");
  }, 30_000);

  it("rejects invalid startup without leaving a listening child", async () => {
    const directory = await createDirectory("overmux-invalid-");
    const configPath = join(directory, "overmux.config.ts");
    await writeFile(
      configPath,
      `export default { port: 0, server: { resources: {} } };\n`,
    );

    await expect(start(configPath)).rejects.toThrow();
  });

  it("retries a failed replacement only after a new change", async () => {
    const directory = await createDirectory("overmux-retry-");
    const configPath = join(directory, "overmux.config.ts");
    const slowStartPath = join(directory, "slow-start");
    const attemptsPath = join(directory, "attempts.txt");
    const port = await findAvailablePort();
    const changedPort = await findAvailablePort();
    const validConfig = (
      configuredPort: number,
    ) => `import { existsSync } from "node:fs";
import { defineOvermuxConfig, defineOvermuxServer } from "overmux";
if (existsSync(${JSON.stringify(slowStartPath)})) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
}
export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  host: "127.0.0.1",
  port: ${configuredPort},
  server: defineOvermuxServer({ resources: {} }),
  watch: true,
});
`;
    await writeFile(configPath, validConfig(port));
    const server = await start(configPath);
    const firstSocket = await openSocket(server);
    const firstClose = new Promise<void>((resolve) =>
      firstSocket.once("close", () => resolve()),
    );

    await writeFile(slowStartPath, "");
    const readyToRestart = nextMessage(firstSocket, "update-available");
    await writeFile(configPath, validConfig(port));
    await readyToRestart;
    await authenticatedFetch(server, "/api/restart", { method: "POST" });
    await firstClose;
    await waitForHealth(server);

    const secondSocket = await openSocket(server);
    await rm(slowStartPath);
    const update = nextMessage(secondSocket, "update-available");
    await writeFile(
      configPath,
      `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(attemptsPath)}, "attempt\\n");
export default {};
`,
    );
    await update;
    await authenticatedFetch(server, "/api/restart", { method: "POST" });
    await new Promise<void>((resolve) =>
      secondSocket.once("close", () => resolve()),
    );
    await vi.waitFor(
      async () =>
        expect(await readFile(attemptsPath, "utf8")).toBe("attempt\n"),
      { interval: 100, timeout: 10_000 },
    );

    await writeFile(configPath, validConfig(changedPort));
    await waitForHealth(server);

    expect(server.port).toBe(port);
  }, 30_000);

  it("preserves relative configured web assets", async () => {
    const directory = await createDirectory("overmux-assets-");
    const configPath = join(directory, "overmux.config.ts");
    const port = await findAvailablePort();
    await mkdir(join(directory, "web"));
    await writeFile(join(directory, "web", "index.html"), "configured web");
    await writeFile(
      configPath,
      `import { defineOvermuxConfig, defineOvermuxServer } from "overmux";
export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  host: "127.0.0.1",
  port: ${port},
  server: defineOvermuxServer({ resources: {} }),
  watch: false,
  productionWebAssetsDir: "./web",
});
`,
    );

    const server = await start(configPath);
    const response = await authenticatedFetch(server, "/");
    const settings = await authenticatedFetch(server, "/_overmux/settings");
    const logout = await authenticatedFetch(server, "/_overmux/logout");
    const unknown = await authenticatedFetch(server, "/_overmux/unknown");

    expect(await response.text()).toBe("configured web");
    expect(await settings.text()).toBe("configured web");
    expect(await logout.text()).toBe("configured web");
    expect(unknown.status).toBe(404);
    expect((await fetch(`${server.url}/_overmux/settings`)).status).toBe(401);
  });
});
