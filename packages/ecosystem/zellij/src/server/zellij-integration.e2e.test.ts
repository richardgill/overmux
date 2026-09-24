// Exercises the persistent plugin pipe against pinned Zellij 0.45.1 with isolated permissions.
// The first test drives Zellij's real permission UI; later tests reuse only that persisted decision.
// Topology assertions wait on backend events; CLI listing is used only by harness setup and cleanup.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  spawnPty,
  type PtyDisposable,
  type PtyExit,
  type PtyProcess,
} from "@overmux/pty/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { installZellij } from "../install";
import { openZellijConnection } from "./connection";
import {
  defineZellijBackend,
  zellijOperationHandlers,
  type ZellijBackend,
  type ZellijOperationResult,
} from "./index";
import { spawnZellijPipe } from "./zellij-process";

const createdTabId = (result: ZellijOperationResult) => {
  if (result.outcome !== "success" || result.created?.kind !== "tab") {
    throw new Error(
      `Expected tab creation to succeed: ${JSON.stringify(result)}`,
    );
  }
  return result.created.tabId;
};
const operationContext = () => ({
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  invalidate: () => undefined,
  notifications: { send: async () => undefined },
  signal: AbortSignal.timeout(10_000),
});
const execFileAsync = promisify(execFile);
const testRoot = resolve(".test-tmp", `zi-${process.pid}`);
const configDirectory = resolve(testRoot, "config");
const temporaryDirectory = resolve(testRoot, "tmp");
const runtimeDirectory = resolve(testRoot, "runtime");
const socketDirectory = resolve(testRoot, "sockets");
const cacheDirectory = resolve(testRoot, "cache");
const dataDirectory = resolve(testRoot, "data");
const configFile = resolve(configDirectory, "config.kdl");
const artifactPath = resolve(dataDirectory, "overmux/zellij/overmux.wasm");
const permissionFile = resolve(cacheDirectory, "zellij/permissions.kdl");
const replacementArtifact = resolve(testRoot, "replacement-overmux.wasm");
const testShell = resolve(testRoot, "persistent-test-shell");
const sessionReadyMarker = "overmux-test-shell-ready";
const bundledArtifact = resolve("overmux.wasm");
const environment = {
  MISE_DATA_DIR:
    process.env.MISE_DATA_DIR ??
    resolve(
      process.env.XDG_DATA_HOME ?? resolve(homedir(), ".local/share"),
      "mise",
    ),
  PATH: process.env.PATH,
  TMPDIR: temporaryDirectory,
  XDG_CACHE_HOME: cacheDirectory,
  XDG_CONFIG_HOME: configDirectory,
  XDG_DATA_HOME: dataDirectory,
  XDG_RUNTIME_DIR: runtimeDirectory,
  ZELLIJ_CONFIG_DIR: configDirectory,
  ZELLIJ_CONFIG_FILE: configFile,
  // All fixture CLIs and the server share cwd; relative sockets stay below Unix path limits in deep checkouts.
  ZELLIJ_SOCKET_DIR: relative(process.cwd(), socketDirectory),
};
const originalEnvironment = Object.fromEntries(
  [
    ...new Set([
      ...Object.keys(environment),
      ...Object.keys(process.env).filter((name) => name.startsWith("ZELLIJ")),
    ]),
  ].map((name) => [name, process.env[name]]),
);
type ClientDiagnostics = { exit: PtyExit | null; output: string; pid: number };

const clients = new Set<PtyProcess>();
const diagnostics = new Map<string, ClientDiagnostics>();
const clientSubscriptions: PtyDisposable[] = [];
let suiteFailed = false;
const sessions = new Set<string>();
const backends = new Set<ZellijBackend>();

const command = async (args: readonly string[], signal?: AbortSignal) => {
  const { stdout } = await execFileAsync("zellij", [...args], { signal });
  return stdout;
};
const listPanes = async (session: string) =>
  JSON.parse(
    await command([
      "--session",
      session,
      "action",
      "list-panes",
      "--all",
      "--json",
    ]),
  ) as { id: number; is_plugin: boolean; plugin_url?: string }[];
const waitForNoPluginPanes = async (session: string) => {
  await vi.waitFor(
    async () => {
      const pluginPanes = (await listPanes(session)).filter((pane) =>
        pane.plugin_url?.includes("overmux.wasm"),
      );
      expect(pluginPanes).toEqual([]);
    },
    { timeout: 10_000 },
  );
};
const uniqueName = (label: string) =>
  `overmux-${label}-${randomUUID().slice(0, 8)}`;
const startSession = async (name: string) => {
  sessions.add(name);
  // Create in the attached PTY: Zellij 0.45.1 can fail to rediscover a newly backgrounded session.
  const client = spawnPty({
    args: ["attach", "--create", name, "--", testShell],
    cols: 80,
    command: "zellij",
    rows: 24,
  });
  clients.add(client);
  const diagnostic: ClientDiagnostics = {
    exit: null,
    output: "",
    pid: client.pid,
  };
  diagnostics.set(name, diagnostic);
  // Observe the entire attached lifetime, not just startup: discovery can fail while the PTY is still alive.
  clientSubscriptions.push(
    client.onData((data) => (diagnostic.output += data)),
    client.onExit((exit) => (diagnostic.exit = exit)),
  );
  try {
    await vi.waitFor(
      async () => {
        expect(diagnostic.exit).toBeNull();
        // CLI probes can race server initialization; rendered shell output proves the first client is ready.
        expect(diagnostic.output).toContain(sessionReadyMarker);
        const output = await command([
          "--session",
          name,
          "action",
          "list-clients",
        ]);
        // Zellij prints a header with no clients; plugin launch needs an attached client's active pane.
        expect(output).toMatch(/^\d+\s+(?:terminal|plugin)_\d+\s/mu);
      },
      { timeout: 10_000 },
    );
  } catch (cause) {
    throw new Error(
      `Zellij client ${name} failed readiness: ${JSON.stringify(diagnostic)}`,
      { cause },
    );
  }
  return client;
};
const waitForSessionCacheFile = (session: string, file: string) =>
  vi.waitFor(
    async () => {
      const content = await readFile(
        resolve(
          cacheDirectory,
          "zellij/contract_version_1/session_info",
          session,
          file,
        ),
        "utf8",
      );
      expect(content.length).toBeGreaterThan(0);
    },
    { timeout: 10_000 },
  );
const createBackend = (session?: string) => {
  const backend = defineZellijBackend({ session });
  backends.add(backend);
  return backend;
};
const waitForSession = async (backend: ZellijBackend, name: string) => {
  await vi.waitFor(
    () => {
      const session = backend
        .state()
        .sessions.find((candidate) => candidate.name === name);
      expect(session?.tabs.length).toBeGreaterThan(0);
    },
    { timeout: 10_000 },
  );
  return backend.state().sessions.find((session) => session.name === name)!;
};
const startObservedConnection = (session: string) => {
  const connectionId = randomUUID();
  const child = spawnZellijPipe({
    anchorSession: session,
    artifactPath,
    connectionId,
  });
  let output = "";
  const failures: Error[] = [];
  child.stdout.on(
    "data",
    (chunk: Buffer) => (output += chunk.toString("utf8")),
  );
  const connection = openZellijConnection({
    anchorSession: session,
    child,
    connectionId,
    onFailure: (error) => failures.push(error),
    onSnapshot: () => undefined,
    removePlugin: async (pluginId) => {
      await command([
        "--session",
        session,
        "action",
        "close-pane",
        "--pane-id",
        `plugin_${pluginId}`,
      ]);
    },
    startupTimeoutMs: 30_000,
  });
  return { connection, failures, output: () => output };
};

const captureFailureDiagnostics = async (testId: string) => {
  await writeFile(
    resolve(testRoot, `clients-${testId}.json`),
    JSON.stringify(Object.fromEntries(diagnostics), null, 2),
  );
  const serverLog = await readFile(
    resolve(
      temporaryDirectory,
      `zellij-${process.getuid!()}/zellij-log/zellij.log`,
    ),
    "utf8",
  ).catch(String);
  const permissions = await readFile(permissionFile, "utf8").catch(String);
  console.error(
    `Zellij failure artifacts: ${testRoot}`,
    Object.fromEntries(
      [...diagnostics].map(([name, diagnostic]) => [
        name,
        { ...diagnostic, output: diagnostic.output.slice(-4000) },
      ]),
    ),
    { permissions, serverLog: serverLog.slice(-12000) },
  );
};

beforeAll(async () => {
  await expect(command(["--version"])).resolves.toContain("zellij 0.45.1");
  await rm(testRoot, { force: true, recursive: true });
  const { stdout: executable } = await execFileAsync("mise", [
    "which",
    "zellij",
  ]);
  await Promise.all([
    mkdir(configDirectory, { recursive: true }),
    mkdir(temporaryDirectory, { recursive: true }),
    mkdir(runtimeDirectory, { recursive: true, mode: 0o700 }),
    mkdir(socketDirectory, { recursive: true }),
    mkdir(resolve(cacheDirectory, "zellij"), { recursive: true }),
    mkdir(resolve(dataDirectory, "overmux/zellij"), { recursive: true }),
  ]);
  const { stdout } = await execFileAsync("zellij", ["setup", "--dump-config"]);
  // Persist resurrection layouts promptly instead of waiting for Zellij's default 60-second interval.
  await writeFile(
    configFile,
    `${stdout}\nshow_release_notes false\nserialization_interval 1\n`,
  );
  await writeFile(
    testShell,
    `#!/bin/sh\nprintf '${sessionReadyMarker}\\n'\nexec sleep 3600\n`,
    { mode: 0o755 },
  );
  await copyFile(bundledArtifact, artifactPath);
  Object.keys(process.env)
    .filter((name) => name.startsWith("ZELLIJ"))
    .forEach((name) => Reflect.deleteProperty(process.env, name));
  Object.assign(process.env, environment, {
    PATH: `${dirname(executable.trim())}:${process.env.PATH ?? ""}`,
  });
});

afterEach(async ({ task }) => {
  if (task.result?.state === "fail") {
    suiteFailed = true;
    // Capture before teardown changes client state; diagnostic I/O failure must not prevent cleanup.
    await captureFailureDiagnostics(task.id).catch(console.error);
  }
  await Promise.allSettled([...backends].map((backend) => backend.close()));
  backends.clear();
  await Promise.allSettled(
    [...sessions].map((name) => command(["kill-session", name])),
  );
  sessions.clear();
  clients.forEach((client) => {
    try {
      client.kill("SIGHUP");
    } catch {}
  });
  clients.clear();
  clientSubscriptions
    .splice(0)
    .forEach((subscription) => subscription.dispose());
  diagnostics.clear();
  await copyFile(bundledArtifact, artifactPath);
});

afterAll(async () => {
  Object.entries(originalEnvironment).forEach(([name, value]) => {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  });
  if (!suiteFailed) {
    await rm(testRoot, { force: true, recursive: true });
  }
});

describe("real event-driven Zellij integration", () => {
  it("persists first-time approval and release-gates reload and replacement behavior", async () => {
    const sessionName = uniqueName("permission-release-gate");
    const client = await startSession(sessionName);
    let terminalOutput = "";
    const outputSubscription = client.onData(
      (data) => (terminalOutput += data),
    );
    const controller = new AbortController();
    const installation = installZellij({
      session: sessionName,
      signal: controller.signal,
    });
    // Observe rejection now; failed UI setup must settle installation before session teardown.
    const installationSettled = installation.catch(() => undefined);
    try {
      // Observe the terminal to avoid racing CLI responses while the installer launches and polls.
      await vi.waitFor(
        () => {
          expect(terminalOutput).toContain("Access Zellij state");
          expect(terminalOutput).toContain("Allow?");
        },
        { timeout: 10_000 },
      );
      client.write("y");
      await expect(installation).resolves.toMatchObject({
        artifactPath,
        pluginVersion: "0.0.1",
        session: sessionName,
      });
    } finally {
      controller.abort();
      await installationSettled;
      outputSubscription.dispose();
    }
    const persistedPermission = await readFile(permissionFile, "utf8");
    expect(persistedPermission.match(/Read[A-Za-z]+/gu)?.sort()).toEqual([
      "ReadApplicationState",
      "ReadCliPipes",
    ]);
    expect(persistedPermission).toContain(`${JSON.stringify(artifactPath)} {`);
    await waitForNoPluginPanes(sessionName);

    const initialBackend = createBackend(sessionName);
    await expect(initialBackend.read()).resolves.toMatchObject({
      connected: true,
    });
    await initialBackend.close();
    backends.delete(initialBackend);
    await waitForNoPluginPanes(sessionName);

    const originalArtifact = await readFile(bundledArtifact);
    expect(originalArtifact.toString("utf8").match(/0\.0\.1/gu)).toHaveLength(
      1,
    );
    const changedArtifact = Buffer.from(originalArtifact);
    changedArtifact.write("9.9.9", originalArtifact.indexOf("0.0.1"), "utf8");
    await writeFile(replacementArtifact, changedArtifact);
    await rename(replacementArtifact, artifactPath);

    // Zellij 0.45.1 caches a loaded module by URL for the server lifetime. A runtime reload in
    // the same session keeps running the old bytes even after an atomic replacement at that URL.
    const cachedReload = startObservedConnection(sessionName);
    await cachedReload.connection.ready;
    expect(cachedReload.output()).toContain('"pluginVersion":"0.0.1"');
    expect(cachedReload.failures).toEqual([]);
    await cachedReload.connection.close();
    await cachedReload.connection.removePlugin();

    await command(["kill-session", sessionName]);
    sessions.delete(sessionName);
    client.kill("SIGHUP");
    clients.delete(client);
    const restartedSession = uniqueName("permission-after-server-restart");
    await startSession(restartedSession);

    const replacedRuntime = startObservedConnection(restartedSession);
    await replacedRuntime.connection.ready;
    expect(replacedRuntime.output()).toContain('"pluginVersion":"9.9.9"');
    expect(replacedRuntime.failures).toEqual([]);
    await replacedRuntime.connection.close();
    await replacedRuntime.connection.removePlugin();
  });

  it("creates from a terminal cwd without focus and reconciles native tab moves", async () => {
    const sessionName = uniqueName("targeted-operations");
    await startSession(sessionName);
    await waitForSessionCacheFile(sessionName, "session-metadata.kdl");
    const backend = createBackend(sessionName);
    const operations = zellijOperationHandlers({ backend });
    await backend.read();
    const initial = await waitForSession(backend, sessionName);
    const first = initial.tabs[0]!.info.tab_id;

    // Zellij returns without reporting topology for a one-tab move, so neither direction may await an event.
    for (const direction of ["left", "right"] as const) {
      await expect(
        operations.moveTab.handle(
          { direction, sessionName, tabId: first },
          operationContext(),
        ),
      ).resolves.toEqual({ outcome: "success" });
    }
    const sourceDirectory = resolve(testRoot, "source cwd");
    const cwdOutput = resolve(testRoot, "created-cwd.txt");
    await mkdir(sourceDirectory);
    const sourceResult = await operations.createTab.handle(
      {
        command: [testShell],
        cwd: sourceDirectory,
        name: "source",
        sessionName,
      },
      operationContext(),
    );
    const second = createdTabId(sourceResult);
    const sourcePane = await vi.waitFor(
      () => {
        const sourceTab = backend
          .state()
          .sessions.find((session) => session.name === sessionName)!
          .tabs.find((tab) => tab.info.tab_id === second)!;
        const pane = sourceTab.panes.find((pane) => !pane.is_plugin);
        expect(pane).toBeDefined();
        return pane!;
      },
      { timeout: 10_000 },
    );
    const created = await operations.createTab.handle(
      {
        command: ["sh", "-c", 'pwd > "$1"; exec sleep 3600', "sh", cwdOutput],
        fromPane: { id: sourcePane.id, isPlugin: false },
        name: "derived",
        sessionName,
      },
      operationContext(),
    );
    const third = createdTabId(created);
    await vi.waitFor(async () => {
      expect((await readFile(cwdOutput, "utf8")).trim()).toBe(sourceDirectory);
    });
    const moves = [
      { direction: "right", expected: [first, third, second] },
      { direction: "right", expected: [second, first, third] },
      { direction: "left", expected: [first, third, second] },
      { direction: "left", expected: [first, second, third] },
    ] as const;
    for (const { direction, expected } of moves) {
      await expect(
        operations.moveTab.handle(
          { direction, sessionName, tabId: second },
          operationContext(),
        ),
      ).resolves.toEqual({ outcome: "success" });
      const tabs = backend
        .state()
        .sessions.find((session) => session.name === sessionName)!.tabs;
      expect(
        [...tabs]
          .sort((left, right) => left.info.position - right.info.position)
          .map((tab) => tab.info.tab_id),
      ).toEqual(expected);
      expect(
        tabs.filter((tab) => tab.info.active).map((tab) => tab.info.tab_id),
      ).toEqual([first]);
    }
  });

  it("automatically anchors in a live session when an exited session sorts first", async () => {
    const exited = uniqueName("000-exited");
    const live = uniqueName("100-live");
    const other = uniqueName("200-live");
    await startSession(exited);
    // Wait for Zellij's own resurrection layout before exiting, so short listing retains the dead session.
    await waitForSessionCacheFile(exited, "session-layout.kdl");
    await command(["kill-session", exited]);
    sessions.delete(exited);
    await startSession(live);
    await startSession(other);
    // Cross-session snapshots read disk metadata, which Zellij writes asynchronously after client readiness.
    await waitForSessionCacheFile(other, "session-metadata.kdl");
    await vi.waitFor(
      async () => {
        const listing = await command(["list-sessions", "--no-formatting"]);
        expect(
          listing.split("\n").find((line) => line.startsWith(`${exited} `)),
        ).toContain("(EXITED - attach to resurrect)");
      },
      { timeout: 10_000 },
    );
    const shortListing = await command([
      "list-sessions",
      "--short",
      "--no-formatting",
    ]);
    expect(shortListing.trim().split("\n").sort()[0]).toBe(exited);

    // A stale inherited name otherwise makes Zellij label the dead session (current), hiding EXITED.
    vi.stubEnv("ZELLIJ_SESSION_NAME", exited);
    try {
      const backend = defineZellijBackend();
      backends.add(backend);
      await expect(backend.read()).resolves.toMatchObject({ connected: true });
      await waitForSession(backend, other);
      expect(
        backend
          .state()
          .sessions.map((session) => session.name)
          .sort(),
      ).toEqual([live, other]);
      const pluginPanes = (await listPanes(live)).filter((pane) =>
        pane.plugin_url?.includes("overmux.wasm"),
      );
      expect(pluginPanes).toHaveLength(1);
      expect(process.env.ZELLIJ_SESSION_NAME).toBe(exited);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("receives repeated SessionUpdate snapshots while its runtime plugin stays suppressed", async () => {
    const sessionName = uniqueName("events");
    await startSession(sessionName);
    const backend = createBackend(sessionName);
    const listener = vi.fn();
    const unsubscribe = backend.subscribe(listener);

    const initial = await backend.read();
    expect(initial.connected).toBe(true);
    listener.mockClear();
    await command([
      "--session",
      sessionName,
      "action",
      "new-tab",
      "--name",
      "external",
      "--no-focus",
      "--",
      "sh",
    ]);

    await vi.waitFor(
      () => {
        expect(listener).toHaveBeenCalled();
        expect(
          backend
            .state()
            .sessions.find((session) => session.name === sessionName)
            ?.tabs.map((tab) => tab.info.name),
        ).toContain("external");
      },
      { timeout: 10_000 },
    );
    const pluginPanes = backend
      .state()
      .sessions.flatMap((session) => session.tabs)
      .flatMap((tab) => tab.panes)
      .filter((pane) => pane.plugin_url?.includes("overmux.wasm"));
    expect(pluginPanes).toHaveLength(1);
    expect(pluginPanes[0]).toMatchObject({ is_suppressed: true });
    unsubscribe();
  });

  it("replaces an exited anchor with the lexicographically remaining session", async () => {
    const first = uniqueName("anchor-z-preferred");
    const second = uniqueName("anchor-a-replacement");
    await startSession(first);
    const backend = createBackend(first);
    await backend.read();
    await command([
      "--session",
      first,
      "action",
      "new-tab",
      "--name",
      "preferred-event",
      "--no-focus",
      "--",
      "sh",
    ]);
    await vi.waitFor(
      () => {
        expect(
          backend
            .state()
            .sessions.find((session) => session.name === first)
            ?.tabs.map((tab) => tab.info.name),
        ).toContain("preferred-event");
        const runtimePaneSessions = backend
          .state()
          .sessions.filter((session) =>
            session.tabs.some((tab) =>
              tab.panes.some((pane) =>
                pane.plugin_url?.includes("overmux.wasm"),
              ),
            ),
          )
          .map((session) => session.name);
        expect(runtimePaneSessions).toEqual([first]);
      },
      { timeout: 10_000 },
    );
    await startSession(second);

    await command(["kill-session", first]);
    sessions.delete(first);

    await vi.waitFor(
      () => {
        expect(backend.state().connected).toBe(true);
        expect(
          backend.state().sessions.some((session) => session.name === first),
        ).toBe(false);
      },
      { timeout: 10_000 },
    );
    await command([
      "--session",
      second,
      "action",
      "new-tab",
      "--name",
      "replacement-event",
      "--no-focus",
      "--",
      "sh",
    ]);
    await vi.waitFor(
      () => {
        const replacement = backend
          .state()
          .sessions.find((session) => session.name === second);
        expect(replacement?.tabs.map((tab) => tab.info.name)).toContain(
          "replacement-event",
        );
        expect(
          replacement?.tabs.some((tab) =>
            tab.panes.some(
              (pane) =>
                pane.is_suppressed &&
                Boolean(pane.plugin_url?.includes("overmux.wasm")),
            ),
          ),
        ).toBe(true);
      },
      { timeout: 10_000 },
    );
  });

  it("repeatedly starts and cooperatively shuts down without leaving plugin panes", async () => {
    const sessionName = uniqueName("lifecycle");
    await startSession(sessionName);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const backend = createBackend(sessionName);
      await expect(backend.read()).resolves.toMatchObject({ connected: true });
      await backend.close();
      expect(backend.state()).toMatchObject({ connected: false, sessions: [] });
      await waitForNoPluginPanes(sessionName);
      backends.delete(backend);
    }
  });
});
