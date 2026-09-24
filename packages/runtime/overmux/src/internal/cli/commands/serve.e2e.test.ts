import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, test as testCases, vi } from "vitest";

import {
  discoverInstance,
  sendControlRequest,
} from "../../server/auth/instance-control";

const cliPath = fileURLToPath(
  new URL("../../../../dist/bin.js", import.meta.url),
);
const repositoryRoot = fileURLToPath(
  new URL("../../../../../../../", import.meta.url),
);
const testTemporaryRoot = join(repositoryRoot, ".test-tmp");

type ExitResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type RunningCli = {
  child: ChildProcess;
  exit: Promise<ExitResult>;
  stderr: string;
  stdout: string;
};

const listenOnAvailablePort = (server: Server) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected a TCP test server address"));
        return;
      }
      resolve(address.port);
    });
  });

const closeNetServer = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((cause) => (cause ? reject(cause) : resolve()));
  });

const findAvailablePorts = async () => {
  const servers = [createServer(), createServer()];
  try {
    return await Promise.all(servers.map(listenOnAvailablePort));
  } finally {
    await Promise.all(servers.map(closeNetServer));
  }
};

const createConfig = async (configuredPort: number) => {
  await mkdir(testTemporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(testTemporaryRoot, "serve-e2e-"));
  const configPath = join(directory, "overmux.config.ts");
  await Promise.all([
    writeFile(join(directory, "index.html"), "<main>production web</main>"),
    writeFile(
      join(directory, "vite.config.ts"),
      'import { defineConfig } from "vite"; export default defineConfig({ build: { outDir: "dist" } });',
    ),
  ]);
  await writeFile(
    configPath,
    `import {
  defineOvermuxConfig,
  defineOvermuxServer,
  defineStreamHandler,
} from "overmux";
import { z } from "zod";

const value = { input: z.void(), output: z.string() };
const server = defineOvermuxServer({
  operations: {
    cliOperation: { input: z.void(), handle: () => undefined },
  },
  resources: {
    cliResource: { contract: value, kind: "query", read: () => "ready" },
  },
  streams: {
    cliStream: defineStreamHandler(
      { input: z.void(), clientMessage: z.never(), serverMessage: z.string() },
      () => ({}),
    ),
  },
});

export default defineOvermuxConfig({
  auth: { mode: "cli-login", origins: ["http://127.0.0.1:${configuredPort}"] },
  host: "127.0.0.1",
  port: ${configuredPort},
  productionWebAssetsDir: "./dist",
  server,
  vite: "./vite.config.ts",
  watch: false,
});
`,
  );
  return { configPath, directory };
};

const startCli = ({
  arguments: serveArguments = ["--production"],
  configPath,
  dataHome,
}: {
  arguments?: string[];
  configPath: string;
  dataHome: string;
}): RunningCli => {
  const child = spawn(
    process.execPath,
    [cliPath, "serve", "--config", configPath, ...serveArguments],
    {
      detached: true,
      env: { ...process.env, STRICLI_NO_COLOR: "1", XDG_DATA_HOME: dataHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const running: RunningCli = {
    child,
    exit: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    stderr: "",
    stdout: "",
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    running.stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    running.stderr += chunk.toString();
  });
  return running;
};

const processOutput = (cli: RunningCli) =>
  `CLI stdout:\n${cli.stdout || "<empty>"}\nCLI stderr:\n${cli.stderr || "<empty>"}`;

const waitForHealth = async (cli: RunningCli, url: string) => {
  try {
    await vi.waitFor(
      async () => {
        const response = await fetch(`${url}/api/health`).catch(
          () => undefined,
        );
        expect(response?.status).toBe(200);
      },
      { interval: 50, timeout: 20_000 },
    );
  } catch (cause) {
    throw new Error(
      `Packaged CLI did not become ready\n${processOutput(cli)}`,
      {
        cause,
      },
    );
  }
};

const waitForExit = async (cli: RunningCli, timeout = 10_000) => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      cli.exit,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`CLI did not exit\n${processOutput(cli)}`)),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const signalProcessGroup = (
  cli: RunningCli,
  signal: NodeJS.Signals,
  ignoreMissing: boolean,
) => {
  const pid = cli.child.pid;
  if (pid === undefined) {
    if (ignoreMissing) {
      return;
    }
    throw new Error("CLI process has no PID");
  }
  try {
    process.kill(-pid, signal);
  } catch (cause) {
    if (ignoreMissing && (cause as NodeJS.ErrnoException).code === "ESRCH") {
      return;
    }
    throw cause;
  }
};

const cleanupProcessGroup = async (cli: RunningCli) => {
  signalProcessGroup(cli, "SIGTERM", true);
  await waitForExit(cli, 5_000).catch(() => undefined);
  signalProcessGroup(cli, "SIGKILL", true);
};

const assertPortReleased = async (port: number) => {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } finally {
    if (server.listening) {
      await closeNetServer(server);
    }
  }
};

describe("serve packaged CLI", () => {
  it("serves existing production assets with --no-build and listener overrides", async () => {
    const [configuredPort, overridePort] = await findAvailablePorts();
    const { configPath, directory } = await createConfig(configuredPort!);
    await mkdir(join(directory, "dist"));
    await writeFile(join(directory, "dist/index.html"), "existing production");
    const cli = startCli({
      arguments: [
        "--production",
        "--no-build",
        "--host",
        "127.0.0.1",
        "--port",
        String(overridePort),
      ],
      configPath,
      dataHome: directory,
    });
    const url = `http://127.0.0.1:${overridePort}`;

    try {
      await waitForHealth(cli, url);
      await vi.waitFor(() =>
        expect(cli.stdout).toContain(
          `Login with \`overmux auth login --port ${overridePort}\``,
        ),
      );
      const instance = await vi.waitFor(() => discoverInstance(overridePort));
      const credential = await sendControlRequest(instance, {
        type: "issue-bearer",
      });
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${credential.bearer.token}` },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("existing production");
      await assertPortReleased(configuredPort!);
    } finally {
      await cleanupProcessGroup(cli);
      await rm(directory, { force: true, recursive: true });
    }
  }, 20_000);

  it("rejects --no-build without --production", async () => {
    const [configuredPort] = await findAvailablePorts();
    const { configPath, directory } = await createConfig(configuredPort!);
    const cli = startCli({
      arguments: ["--no-build"],
      configPath,
      dataHome: directory,
    });

    try {
      const exit = await waitForExit(cli);
      expect(exit.code).not.toBe(0);
      expect(cli.stderr).toContain("--no-build requires --production");
    } finally {
      await cleanupProcessGroup(cli);
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("starts concurrent development servers on distinct private Vite ports", async () => {
    const ports = await findAvailablePorts();
    const configurations = await Promise.all(ports.map(createConfig));
    const servers = configurations.map(({ configPath, directory }) =>
      startCli({ arguments: [], configPath, dataHome: directory }),
    );
    const urls = ports.map((port) => `http://127.0.0.1:${port}`);

    try {
      await Promise.all(
        servers.map((server, index) => waitForHealth(server, urls[index]!)),
      );
      const responses = await Promise.all(
        servers.map(async (_server, index) => {
          const instance = await vi.waitFor(() =>
            discoverInstance(ports[index]!),
          );
          const credential = await sendControlRequest(instance, {
            type: "issue-bearer",
          });
          return fetch(`${urls[index]}/@vite/client`, {
            headers: {
              authorization: `Bearer ${credential.bearer.token}`,
            },
          });
        }),
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
    } finally {
      await Promise.all(servers.map(cleanupProcessGroup));
      await Promise.all(
        configurations.map(({ directory }) =>
          rm(directory, { force: true, recursive: true }),
        ),
      );
    }
  }, 30_000);

  it("closes private Vite when public gateway startup fails", async () => {
    const [configuredPort] = await findAvailablePorts();
    const { configPath, directory } = await createConfig(configuredPort!);
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(configuredPort, "127.0.0.1", resolve);
    });
    const cli = startCli({
      arguments: [],
      configPath,
      dataHome: directory,
    });

    try {
      const exit = await waitForExit(cli, 20_000);
      expect(exit.code).not.toBe(0);
      expect(cli.stderr).toContain("EADDRINUSE");
    } finally {
      await cleanupProcessGroup(cli);
      await closeNetServer(occupied);
      await assertPortReleased(configuredPort!);
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  it("builds the configured Vite app and serves it with the runtime API", async () => {
    const [configuredPort] = await findAvailablePorts();
    const { configPath, directory } = await createConfig(configuredPort!);
    const cli = startCli({
      arguments: ["--production", "--login"],
      configPath,
      dataHome: directory,
    });
    const url = `http://127.0.0.1:${configuredPort}`;

    try {
      await waitForHealth(cli, url);
      await vi.waitFor(() => expect(cli.stdout).toContain("Code: "));
      const loginCode = /Code: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(cli.stdout)?.[1];
      if (!loginCode) {
        throw new Error("Expected serve to print a login code");
      }
      expect(cli.stdout).toContain(`Login URL: ${url}/login#ticket=`);
      expect(cli.stdout).toContain(
        `\nNeed another grant? Run \`overmux auth login --port ${configuredPort}\`.\n`,
      );
      const instance = await vi.waitFor(() => discoverInstance(configuredPort));
      const credential = await sendControlRequest(instance, {
        type: "issue-bearer",
      });
      const loginResponse = await fetch(`${url}/api/auth/login`, {
        body: JSON.stringify({ code: loginCode }),
        headers: {
          "Content-Type": "application/json",
          Origin: url,
          "Sec-Fetch-Site": "same-origin",
        },
        method: "POST",
      });
      const browserCookie = loginResponse.headers
        .get("set-cookie")
        ?.split(";", 1)[0];
      if (!browserCookie) {
        throw new Error("Expected a browser session cookie");
      }
      const manifestResponse = await fetch(`${url}/api/runtime-manifest`, {
        headers: { authorization: `Bearer ${credential.bearer.token}` },
      });
      const manifest = await manifestResponse.json();
      const browserResponse = await fetch(url, {
        headers: { Accept: "text/html" },
      });
      const authenticatedWebResponse = await fetch(url, {
        headers: { Cookie: browserCookie },
      });

      expect(cli.stdout.split("\n")).toContain(`Overmux listening on ${url}`);
      expect(manifestResponse.status).toBe(200);
      expect(manifest).toMatchObject({
        operations: ["cliOperation"],
        protocolVersion: 10,
        resources: ["cliResource"],
        streams: ["cliStream"],
      });
      expect(browserResponse.status).toBe(401);
      const browserHtml = await browserResponse.text();
      const authAssetPath =
        /src="(\/_overmux\/auth-shell\/assets\/index-[^"]+\.js)"/.exec(
          browserHtml,
        )?.[1];
      if (!authAssetPath) {
        throw new Error("Expected a fingerprinted authentication script");
      }
      const authAssetResponse = await fetch(`${url}${authAssetPath}`);
      expect(authAssetResponse.status).toBe(200);
      expect(authAssetResponse.headers.get("cache-control")).toContain(
        "immutable",
      );
      expect(authenticatedWebResponse.status).toBe(200);
      expect(
        authenticatedWebResponse.headers.get("content-security-policy"),
      ).toBeNull();
      await expect(authenticatedWebResponse.text()).resolves.toContain(
        "production web",
      );
    } catch (cause) {
      throw new Error(`${String(cause)}\n${processOutput(cli)}`, { cause });
    } finally {
      await cleanupProcessGroup(cli);
      await rm(directory, { force: true, recursive: true });
    }
  });

  testCases.each(["SIGINT", "SIGTERM"] as const)(
    "exits cleanly on %s and releases the port",
    async (signal) => {
      const [configuredPort] = await findAvailablePorts();
      const { configPath, directory } = await createConfig(configuredPort!);
      const cli = startCli({ configPath, dataHome: directory });
      const url = `http://127.0.0.1:${configuredPort}`;

      try {
        await waitForHealth(cli, url);
        expect(cli.child.kill(signal)).toBe(true);

        const exit = await waitForExit(cli);

        expect(exit, processOutput(cli)).toEqual({ code: 0, signal: null });
        await assertPortReleased(configuredPort!);
      } catch (cause) {
        throw new Error(`${String(cause)}\n${processOutput(cli)}`, { cause });
      } finally {
        await cleanupProcessGroup(cli);
        await rm(directory, { force: true, recursive: true });
      }
    },
  );
});
