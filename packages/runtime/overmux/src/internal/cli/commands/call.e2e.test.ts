import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createAuthService } from "../../server/auth/auth-service";
import { startInstanceControl } from "../../server/auth/instance-control";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin.ts", import.meta.url));

type ReceivedRequest = {
  authorization: string | undefined;
  body: string;
  method: string | undefined;
  url: string | undefined;
};

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];
const initialRuntimeDirectory = process.env.XDG_RUNTIME_DIR;

const closeServer = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const startServer = async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "overmux-call-e2e-"));
  process.env.XDG_RUNTIME_DIR = temporaryDirectory;
  let resolveRequest: (request: ReceivedRequest) => void = () => undefined;
  const requestReceived = new Promise<ReceivedRequest>((resolve) => {
    resolveRequest = resolve;
  });
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      resolveRequest({
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString(),
        method: request.method,
        url: request.url,
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ accepted: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the test server to listen on a TCP port");
  }
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const auth = createAuthService({
    config: { mode: "cli-login" },
    environment: { XDG_DATA_HOME: temporaryDirectory },
    homeDirectory: "/unused",
  });
  auth.setOrigins([apiUrl]);
  const control = await startInstanceControl({
    auth,
    apiUrl,
    instanceId: "call-cli-test",
    port: address.port,
    url: apiUrl,
  });
  cleanups.push(async () => {
    await control.close();
    await closeServer(server);
    await rm(temporaryDirectory, { force: true, recursive: true });
  });
  return { port: address.port, requestReceived };
};

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  if (initialRuntimeDirectory === undefined) {
    Reflect.deleteProperty(process.env, "XDG_RUNTIME_DIR");
  } else {
    process.env.XDG_RUNTIME_DIR = initialRuntimeDirectory;
  }
});

describe("call CLI", () => {
  // The first CLI process also pays for cold source compilation on shared CI runners.
  it("obtains a bearer from the control socket and invokes the HTTP API", async () => {
    const { port, requestReceived } = await startServer();
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "jiti/register",
      cliPath,
      "call",
      "taskFinished",
      "-p",
      String(port),
      "-i",
      '{"task":"done"}',
    ]);

    await expect(requestReceived).resolves.toMatchObject({
      authorization: expect.stringMatching(/^Bearer [A-Za-z0-9_-]+$/),
      body: '{"task":"done"}',
      method: "POST",
      url: "/api/operations/taskFinished",
    });
    expect(stdout).toBe('{"accepted":true}\n');
  }, 30_000);

  it("invokes an operation without input", async () => {
    const { port, requestReceived } = await startServer();
    await execFileAsync(process.execPath, [
      "--import",
      "jiti/register",
      cliPath,
      "call",
      "reloadTmuxConfig",
      "--port",
      String(port),
    ]);

    await expect(requestReceived).resolves.toMatchObject({
      authorization: expect.stringMatching(/^Bearer /),
      body: "",
      method: "POST",
      url: "/api/operations/reloadTmuxConfig",
    });
  }, 15_000);
});
