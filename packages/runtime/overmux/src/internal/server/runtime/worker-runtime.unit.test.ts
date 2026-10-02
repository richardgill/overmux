import { EventEmitter, getEventListeners } from "node:events";
import { Worker } from "node:worker_threads";
import {
  decodeWorkerMessage,
  encodeWorkerMessage,
  workerLimits,
} from "./worker-protocol";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { afterEach, expect, test, test as testCases, vi } from "vitest";
import { WebSocket } from "ws";
import type { Runtime } from "./create-runtime";
import { createWorkerRuntime, loadWorkerConfig } from "./worker-runtime";
import { createOperationHandler } from "../http/operation-handler";
import { attachWebSocketConnection } from "../websocket-connection";
import { decodeProtocolFrame, encodeProtocolMessage } from "../../shared/index";

const root = fileURLToPath(new URL("../../../../.test-tmp/", import.meta.url));
const directories: string[] = [];
const runtimes: Runtime[] = [];
const aliases = {
  overmux: import.meta.resolve("overmux"),
  zod: import.meta.resolve("zod"),
};
const source = new URL("./fixtures/lifecycle-server.ts", import.meta.url);

type Packet = {
  direction: string;
  kind: string;
  bytes: number;
  backingBytes: number;
  offset: number;
  message: Record<string, unknown>;
};
const captureTransport = () => {
  const packets: Packet[] = [];
  const workers = new WeakSet<Worker>();
  const nativePost = Worker.prototype.postMessage;
  const spy = vi.spyOn(Worker.prototype, "postMessage");
  spy.mockImplementation((packet: Uint8Array, transferList) => {
    const worker = spy.mock.contexts.at(-1) as Worker;
    if (!workers.has(worker)) {
      workers.add(worker);
      worker.on("message", (received: Uint8Array) => {
        const message = decodeWorkerMessage<{ type: string }>(received);
        packets.push({
          direction: "worker",
          kind: message.type,
          message,
          bytes: received.byteLength,
          backingBytes: received.buffer.byteLength,
          offset: received.byteOffset,
        });
      });
    }
    const message = decodeWorkerMessage<{ action?: string; type: string }>(
      packet,
    );
    packets.push({
      direction: "main",
      kind: message.action ?? message.type,
      message,
      bytes: packet.byteLength,
      backingBytes: packet.buffer.byteLength,
      offset: packet.byteOffset,
    });
    return nativePost.call(worker, packet, transferList);
  });
  return packets;
};

const corruptWorkerError = (type: string) => {
  const nativeEmit = Worker.prototype.emit;
  const spy = vi.spyOn(Worker.prototype, "emit");
  spy.mockImplementation((event, ...args) => {
    const worker = spy.mock.contexts.at(-1) as Worker;
    if (event === "message") {
      const message = decodeWorkerMessage<{ type: string; error?: unknown }>(
        args[0],
      );
      if (message.type === type && message.error !== undefined) {
        args[0] = encodeWorkerMessage({
          ...message,
          error: { name: "Error", message: "malformed", code: "ENOENT" },
        });
      }
    }
    return nativeEmit.call(worker, event, ...args);
  });
};

const binaryViews = [
  {
    kind: "float64",
    create: (backing: ArrayBuffer) => new Float64Array(backing, 32, 1),
    expected: "Float64Array",
  },
  {
    kind: "uint8",
    create: (backing: ArrayBuffer) => new Uint8Array(backing, 32, 1),
    expected: "Uint8Array",
  },
  {
    kind: "buffer",
    create: (backing: ArrayBuffer) => Buffer.from(backing).slice(32, 33),
    expected: "Uint8Array",
  },
  {
    kind: "data-view",
    create: (backing: ArrayBuffer) => new DataView(backing, 32, 1),
    expected: "DataView",
  },
];

const createProject = async (code?: string) => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "workers-"));
  directories.push(directory);
  await writeFile(
    join(directory, "lifecycle.server.ts"),
    code ??
      (await readFile(source, "utf8")).replace(
        '"../../../../public/index"',
        '"overmux"',
      ),
  );
  await writeFile(
    join(directory, "cheap.server.ts"),
    'export default { resources: { cheap: { kind: "query", contract: { input: (await import("zod")).z.void(), output: (await import("zod")).z.number() }, read: () => 42 } } };',
  );
  await writeFile(
    join(directory, "overmux.config.ts"),
    `
import server from "./lifecycle.server";
import cheap from "./cheap.server";
export default {
  auth: { mode: "cli-login" },
  instanceId: ({ port }) => "worker-test-" + port,
  server: { ...server, resources: { ...server.resources, ...cheap.resources } },
};`,
  );
  return directory;
};

const start = async (
  directory: string,
  options: Partial<Parameters<typeof createWorkerRuntime>[0]> = {},
) => {
  const runtime = await createWorkerRuntime({
    configPath: join(directory, "overmux.config.ts"),
    debug: false,
    aliases,
    notifications: { send: async () => undefined },
    ...options,
  });
  runtimes.push(runtime);
  await runtime.establishInstance(12345);
  return runtime;
};

const streamStatus = async (runtime: Runtime) => {
  let state!: {
    opened: number;
    disposed: number;
    streamThreadId: number;
    contextKeys: string[];
    instanceId: string;
  };
  const session = await runtime
    .getStream("events")!
    .open({ inspect: true }, (value) => {
      state = value as typeof state;
    });
  await session.dispose();
  return state;
};

const status = async (runtime: Runtime) => ({
  ...((await runtime.getResource("status")!.read(undefined)) as {
    subscribed: number;
    unsubscribed: number;
    ran: number;
    threadId: number;
    isMainThread: boolean;
    instanceId: string;
    deepLinkPrefix: string;
  }),
  ...(await streamStatus(runtime)),
});
const open = (
  runtime: Runtime,
  emit: (message: unknown) => void = vi.fn(),
  signal?: AbortSignal,
  onError: (cause: unknown) => void = vi.fn(),
  input = { delay: 0 },
) => runtime.getStream("events")!.open(input, emit, signal, onError);

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

test("original definitions share resource/operation state and isolate named streams", async () => {
  const directory = await createProject(`
import { isMainThread, threadId } from "node:worker_threads";
import { defineOvermuxServer, noInputSchema } from "overmux";
import { z } from "zod";
if (isMainThread) throw new Error("Application imported in main");
let count = 0;
const input = z.string().transform(Number);
const stream = {
  contract: { input: noInputSchema, clientMessage: z.string(), serverMessage: z.unknown() },
  open: (_input, { emit }) => ({
    onMessage: message => {
      if (message === "exit") process.exit(0);
      if (message === "status") emit({ threadId, count });
    },
  }),
};
export default defineOvermuxServer({
  resources: { count: {
    kind: "query",
    contract: { input, output: z.unknown() },
    read: () => ({ count, threadId }),
  } },
  operations: { increment: {
    input: z.string(), output: z.number(),
    handle: (input, { invalidate }) => { count++; invalidate("count", input); return count; },
  } },
  streams: { events: stream, other: stream },
});`);
  const { config } = await loadWorkerConfig({
    configPath: join(directory, "overmux.config.ts"),
    aliases,
  });
  expect(config).toMatchObject({ auth: { mode: "cli-login" } });
  expect(config).not.toHaveProperty("server");
  expect(config).not.toHaveProperty("instanceId");
  const runtime = await start(directory);
  const matching = vi.fn();
  const different = vi.fn();
  await runtime.getResource("count")!.subscribe("01", matching);
  await runtime.getResource("count")!.subscribe("2", different);
  matching.mockClear();
  different.mockClear();

  await expect(runtime.getOperation("increment")!.execute("1")).resolves.toBe(
    1,
  );
  expect(await runtime.getResource("count")!.read("1")).toMatchObject({
    count: 1,
  });
  await vi.waitFor(() => expect(matching).toHaveBeenCalledOnce());
  expect(different).not.toHaveBeenCalled();

  const firstOutput = vi.fn();
  const secondOutput = vi.fn();
  const failed = vi.fn();
  const first = await runtime
    .getStream("events")!
    .open(undefined, firstOutput, undefined, failed);
  const second = await runtime
    .getStream("other")!
    .open(undefined, secondOutput);
  await first.send("status");
  await second.send("status");
  await vi.waitFor(() => expect(secondOutput).toHaveBeenCalledOnce());
  const resource = (await runtime.getResource("count")!.read("1")) as {
    threadId: number;
  };
  expect(firstOutput.mock.calls[0]![0].count).toBe(0);
  expect(
    new Set([
      resource.threadId,
      firstOutput.mock.calls[0]![0].threadId,
      secondOutput.mock.calls[0]![0].threadId,
    ]).size,
  ).toBe(3);

  await first.send("exit").catch(() => undefined);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  await expect(runtime.getOperation("increment")!.execute("1")).resolves.toBe(
    2,
  );
  await second.send("status");
  await vi.waitFor(() => expect(secondOutput).toHaveBeenCalledTimes(2));
});

test("derived resources share diamond dependencies and match operation invalidation inputs", async () => {
  const code = await readFile(
    new URL("./fixtures/derived-server.ts", import.meta.url),
    "utf8",
  );
  const runtime = await start(
    await createProject(
      code.replace('"../../../../public/index"', '"overmux"'),
    ),
  );
  expect(runtime.manifest.resources).toContain("summary");
  const summary = runtime.getResource("summary")!;
  const value = (await summary.read("01")) as {
    count: number;
    threads: number[];
  };
  expect(value.count).toBe(2);
  expect(new Set(value.threads).size).toBe(1);
  expect(value.threads[0]).toBeGreaterThan(0);
  const matching = vi.fn();
  const different = vi.fn();
  const disposeMatching = await summary.subscribe("01", matching);
  const disposeDifferent = await summary.subscribe("2", different);
  expect(await runtime.getResource("stats")!.read(undefined)).toEqual({
    reads: 1,
    subscribed: 2,
    unsubscribed: 0,
  });
  matching.mockClear();
  different.mockClear();

  // Source keys are numbers, while both derived branches and the root have
  // different parsed keys. Match invalidations against the dependency key.
  await runtime.getOperation("increment")!.execute("1");
  await vi.waitFor(() => expect(matching).toHaveBeenCalledOnce());
  expect(different).not.toHaveBeenCalled();
  expect(await summary.read("1")).toMatchObject({ count: 4 });

  await disposeMatching();
  await disposeMatching();
  await disposeDifferent();
  expect(await runtime.getResource("stats")!.read(undefined)).toEqual({
    reads: 2,
    subscribed: 2,
    unsubscribed: 2,
  });
});

test("handlers run in their owner, identity and operation validation survive the bridge", async () => {
  const notification = vi.fn(async () => undefined);
  const runtime = await start(await createProject(), {
    notifications: { send: notification },
  });
  expect(await status(runtime)).toMatchObject({
    isMainThread: false,
    contextKeys: ["emit", "fail", "instance", "signal"],
    instanceId: "worker-test-12345",
    deepLinkPrefix: "overmux://worker-test-12345",
  });
  expect((await status(runtime)).threadId).toBeGreaterThan(0);
  await runtime.getOperation("notify")!.execute(undefined);
  expect(notification).toHaveBeenCalledWith({
    title: "worker-test-12345",
    body: "overmux://worker-test-12345",
  });

  const app = new Hono();
  app.post("/api/operations/:name", createOperationHandler({ runtime }));
  const requests = [
    { name: "run", body: '"invalid"', expected: 400 },
    { name: "invalidOutput", body: "", expected: 500 },
    { name: "notify", body: "", expected: 204 },
  ];
  for (const { name, body, expected } of requests) {
    const response = await app.request(`/api/operations/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(response.status).toBe(expected);
  }
});

const deaths = [
  { action: "exit0", message: "exited (0)" },
  { action: "exit1", message: "exited (1)" },
  { action: "fatal", message: "async worker fatal" },
];
testCases.each(deaths)(
  "$action fails only owned pending work and lifetimes",
  async ({ action, message }) => {
    const packets = captureTransport();
    const runtime = await start(await createProject());
    const subscriptionError = vi.fn();
    const streamError = vi.fn();
    await runtime
      .getResource("watched")!
      .subscribe(0, vi.fn(), undefined, subscriptionError);
    const output = vi.fn();
    const stream = await open(runtime, output, undefined, streamError);
    const waiting = runtime
      .getOperation("wait")!
      .execute(undefined)
      .catch((cause) => cause as Error);
    await runtime
      .getOperation("run")!
      .execute(action)
      .catch(() => undefined);
    expect(((await waiting) as Error).message).toContain(message);
    await vi.waitFor(() => {
      expect(subscriptionError).toHaveBeenCalledTimes(1);
      expect(streamError).not.toHaveBeenCalled();
    });
    await expect(
      runtime.getResource("status")!.read(undefined),
    ).rejects.toThrow(message);
    await expect(runtime.getResource("cheap")!.read(undefined)).rejects.toThrow(
      message,
    );
    await stream.send("still streaming");
    await vi.waitFor(() =>
      expect(output).toHaveBeenCalledWith("still streaming"),
    );
    expect(
      packets.every(
        ({ bytes, backingBytes, offset }) =>
          bytes === backingBytes &&
          offset === 0 &&
          bytes <= workerLimits.messageBytes,
      ),
    ).toBe(true);
    if (action === "fatal") {
      expect(packets.some(({ kind }) => kind === "fatal")).toBe(true);
    }
  },
);

const startupFailures = [
  { name: "exit zero", code: "process.exit(0);", message: "startup (0)" },
  {
    name: "invalid export",
    code: 'export default { resources: { broken: { kind: "invalid" } } };',
    message: "kind",
  },
  {
    name: "never ready",
    code: "await new Promise(() => {}); export default { resources: {} };",
    message: "deadline",
  },
  { name: "infinite import", code: "for (;;) {}", message: "deadline" },
  {
    name: "oversized manifest",
    code: 'import { z } from "zod"; export default { resources: { ["x".repeat(1048576)]: { kind: "query", contract: { input: z.void(), output: z.void() }, read: () => undefined } } };',
    message: "exceeds 1 MiB",
  },
];
testCases.each(startupFailures)(
  "startup observes $name and tears down peers",
  async ({ code, message }) => {
    const directory = await createProject(code);
    await expect(start(directory, { startupMs: 1500 })).rejects.toThrow(
      message,
    );
  },
);

test("malformed startup fatal errors reject without escaping the receiver", async () => {
  corruptWorkerError("fatal");
  const directory = await createProject('throw new Error("import failed");');
  await expect(start(directory)).rejects.toThrow(
    "Invalid worker error envelope",
  );
});

testCases.each(["reply", "fatal"])(
  "malformed %s errors reject owned pending work",
  async (type) => {
    const runtime = await start(await createProject());
    const subscriptionError = vi.fn();
    await runtime
      .getResource("watched")!
      .subscribe(0, vi.fn(), undefined, subscriptionError);
    const waiting = runtime
      .getOperation("wait")!
      .execute(undefined)
      .catch((cause) => cause);
    corruptWorkerError(type);
    const failed =
      type === "reply"
        ? runtime.getResource("nativeError")!.read("TimeoutError")
        : runtime.getOperation("run")!.execute("fatal");
    if (type === "reply") {
      await expect(failed).rejects.toThrow("Invalid worker error envelope");
    } else {
      await failed.catch(() => undefined);
    }
    await expect(waiting).resolves.toMatchObject({
      message: "Invalid worker error envelope",
    });
    await vi.waitFor(() => expect(subscriptionError).toHaveBeenCalledOnce());
    await expect(
      runtime.getResource("status")!.read(undefined),
    ).rejects.toThrow("Invalid worker error envelope");
  },
);

test("malformed close errors reject explicit disposal rather than stranding it", async () => {
  const runtime = await start(await createProject());
  const session = await runtime
    .getStream("events")!
    .open({ cleanupFailure: true }, vi.fn());
  corruptWorkerError("closed");
  await expect(session.dispose()).rejects.toThrow(
    "Invalid worker error envelope",
  );
  await expect(runtime.getResource("cheap")!.read(undefined)).resolves.toBe(42);
});

test("partial startup terminates ready and still-starting peers with one receiver each", async () => {
  const directory = await createProject(`
import { z } from "zod";
const stream = { contract: { input: z.void(), clientMessage: z.unknown(), serverMessage: z.unknown() }, open: () => ({}) };
export default { streams: { broken: stream, waiting: stream, healthy: stream } };`);
  const workers: Worker[] = [];
  const nativePost = Worker.prototype.postMessage;
  const spy = vi.spyOn(Worker.prototype, "postMessage");
  spy.mockImplementation((packet: Uint8Array, transfers) => {
    const worker = spy.mock.contexts.at(-1) as Worker;
    const message = decodeWorkerMessage<{ type: string; stream?: string }>(
      packet,
    );
    if (message.type === "init") {
      workers.push(worker);
      expect(worker.listenerCount("message")).toBe(1);
      if (message.stream === "broken") {
        throw new Error("startup send failed");
      }
      if (message.stream === "waiting") {
        return;
      }
    }
    return nativePost.call(worker, packet, transfers);
  });

  await expect(start(directory)).rejects.toThrow("startup send failed");

  expect(workers).toHaveLength(4);
  expect(workers.map((worker) => worker.threadId)).toEqual([-1, -1, -1, -1]);
});

test("identity evaluation has a deadline outside the transport loop", async () => {
  const directory = await createProject();
  await writeFile(
    join(directory, "overmux.config.ts"),
    `
export default {
  auth: { mode: "cli-login" }, server: { resources: {} },
  instanceId: () => { for (;;) {} },
};`,
  );
  await expect(
    start(directory, { startupMs: 1000, shutdownMs: 50 }),
  ).rejects.toThrow(/timeout|timed out/);
});

test("missing configs fail startup rather than silently going inline", async () => {
  await expect(
    start(await createProject(), { configPath: "/missing-overmux.config.ts" }),
  ).rejects.toThrow();
});

test("worker loading supports explicit aliases, tsconfig paths and JSX dependencies", async () => {
  const directory =
    await createProject(`import { isMainThread } from "node:worker_threads";
import { label } from "@fixture";
import { number } from "@local/value";
import { z } from "zod";
if (isMainThread) throw new Error("Worker module evaluated in main");
export default { resources: { loaded: { kind: "query", contract: { input: z.void(), output: z.string() }, read: () => label.props.children + number } } };`);
  await writeFile(
    join(directory, "label.tsx"),
    "export const label = <span>worker</span>;",
  );
  await writeFile(join(directory, "value.ts"), "export const number = 42;");
  await writeFile(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@local/*": ["./*"] } },
    }),
  );
  const runtime = await start(directory, {
    aliases: { ...aliases, "@fixture": join(directory, "label.tsx") },
  });
  await expect(runtime.getResource("loaded")!.read(undefined)).resolves.toBe(
    "worker42",
  );
});

test("cancellation releases late setup and normal messages retain only their lifetime listener", async () => {
  const runtime = await start(await createProject());
  const aborted = AbortSignal.abort(new Error("already cancelled"));
  await expect(
    runtime.getOperation("run")!.execute("ok", aborted),
  ).rejects.toThrow("already cancelled");
  expect((await status(runtime)).ran).toBe(0);
  const setup = new AbortController();
  const opening = open(runtime, vi.fn(), setup.signal, vi.fn(), {
    delay: 200,
  }).catch((cause) => cause);
  const subscribing = runtime
    .getResource("watched")!
    .subscribe(200, vi.fn(), setup.signal)
    .catch((cause) => cause);
  await vi.waitFor(async () =>
    expect(await status(runtime)).toMatchObject({ opened: 1, subscribed: 1 }),
  );
  setup.abort(new Error("close during setup"));
  await expect(opening).resolves.toBeInstanceOf(Error);
  await expect(subscribing).resolves.toBeInstanceOf(Error);
  await vi.waitFor(async () =>
    expect(await status(runtime)).toMatchObject({
      disposed: 1,
      unsubscribed: 1,
    }),
  );

  const controller = new AbortController();
  const output = vi.fn();
  const session = await open(runtime, output, controller.signal);
  for (let i = 0; i < 1000; i++) {
    await session.send(i);
  }
  await session.send("binary");
  await vi.waitFor(() => expect(output).toHaveBeenCalledTimes(1001));
  expect(output.mock.calls.slice(0, 1000).map(([value]) => value)).toEqual(
    Array.from({ length: 1000 }, (_, i) => i),
  );
  expect(output.mock.calls[1000]![0]).toEqual(new Uint8Array([1, 2, 3]));
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
  controller.abort();
  await session.dispose();
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  await vi.waitFor(async () =>
    expect((await status(runtime)).disposed).toBe(2),
  );
});

test("failed session admission sends no close and releases its local ownership", async () => {
  const runtime = await start(await createProject());
  const controller = new AbortController();
  const nativePost = Worker.prototype.postMessage;
  const messages: string[] = [];
  const spy = vi.spyOn(Worker.prototype, "postMessage");
  spy.mockImplementation((packet: Uint8Array, transfers) => {
    const worker = spy.mock.contexts.at(-1) as Worker;
    const message = decodeWorkerMessage<{ type?: string; action?: string }>(
      packet,
    );
    messages.push(message.action ?? message.type!);
    if (message.action === "stream-open") {
      throw new Error("session send failed");
    }
    return nativePost.call(worker, packet, transfers);
  });

  await expect(open(runtime, vi.fn(), controller.signal)).rejects.toThrow(
    "session send failed",
  );

  expect(messages).toEqual(["stream-open"]);
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  spy.mockRestore();
  const replacement = await open(runtime);
  await replacement.dispose();
  expect((await status(runtime)).disposed).toBe(1);
});

testCases.each(binaryViews)(
  "$kind backing stores are honestly bounded in both runtime directions",
  async ({ kind, create, expected }) => {
    const packets = captureTransport();
    const runtime = await start(await createProject());
    const oversized = create(new ArrayBuffer(16 * 1024 * 1024));
    await expect(
      runtime.getResource("binary")!.read({ kind, bytes: 16 * 1024 * 1024 }),
    ).rejects.toThrow("exceeds 1 MiB");
    await expect(
      runtime.getResource("status")!.read(oversized),
    ).rejects.toThrow("exceeds 1 MiB");
    await expect(
      runtime.getResource("watched")!.subscribe(oversized, vi.fn()),
    ).rejects.toThrow("exceeds 1 MiB");
    await expect(
      runtime.getOperation("binaryEcho")!.execute(oversized),
    ).rejects.toThrow("exceeds 1 MiB");
    await expect(
      runtime.getStream("events")!.open({ delay: 0, oversized }, vi.fn()),
    ).rejects.toThrow("exceeds 1 MiB");

    const output = vi.fn();
    const session = await open(runtime, output);
    await expect(session.send(oversized)).rejects.toThrow("exceeds 1 MiB");
    const backing = new ArrayBuffer(64);
    new Uint8Array(backing)[32] = 42;
    const value = (await runtime
      .getOperation("binaryEcho")!
      .execute(create(backing))) as ArrayBufferView;
    expect(value.constructor.name).toBe(expected);
    expect(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)[0],
    ).toBe(42);
    expect(value.byteLength).toBe(kind === "float64" ? 8 : 1);
    expect(value.buffer.byteLength).toBe(64);
    await session.send(Buffer.from("\x1b[0m"));
    await session.send({ type: "rendered", bytes: 4 });
    await vi.waitFor(() => expect(output).toHaveBeenCalledTimes(2));
    expect(output.mock.calls[0]![0]).toEqual(
      new Uint8Array(Buffer.from("\x1b[0m")),
    );
    expect(output.mock.calls[1]![0]).toEqual({ type: "rendered", bytes: 4 });
    await session.dispose();
    await expect(
      runtime.getOperation("notify")!.execute(undefined),
    ).resolves.toBeUndefined();
    const dispose = await runtime.getResource("watched")!.subscribe(0, vi.fn());
    await dispose();
    await runtime.dispose();

    expect(
      packets.every(
        (packet) =>
          packet.bytes === packet.backingBytes &&
          packet.offset === 0 &&
          packet.bytes <= workerLimits.messageBytes,
      ),
    ).toBe(true);
    expect(packets.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "init",
        "ready",
        "initialize-instance-identity",
        "reply",
        "ack",
        "stream-output",
        "close",
        "closed",
        "notification",
        "notification-result",
        "shutdown",
        "disposed",
      ]),
    );
  },
);

test("aggregate input and output credits charge the transmitted backing bytes", async () => {
  const packets = captureTransport();
  const runtime = await start(await createProject());
  const input = new Uint8Array(new ArrayBuffer(768 * 1024), 32, 1);
  const charged = encodeWorkerMessage({
    action: "operation",
    name: "holdBytes",
    input,
    id: 1,
  }).byteLength;
  expect(charged).toBeGreaterThanOrEqual(input.buffer.byteLength);
  const controller = new AbortController();
  const count = Math.floor(workerLimits.pendingBytes / charged);
  const pending = Array.from({ length: count }, () =>
    runtime
      .getOperation("holdBytes")!
      .execute(input, controller.signal)
      .catch((cause) => cause),
  );
  await expect(
    runtime.getOperation("holdBytes")!.execute(input),
  ).rejects.toThrow("queue is full");
  const posted = packets.filter(({ kind }) => kind === "operation");
  expect(posted).toHaveLength(count);
  expect(
    posted.reduce((total, { bytes }) => total + bytes, 0),
  ).toBeLessThanOrEqual(workerLimits.pendingBytes);
  controller.abort();
  await Promise.all(pending);
  expect(packets.filter(({ kind }) => kind === "cancel")).toHaveLength(count);

  const output = vi.fn();
  const failed = vi.fn();
  const session = await open(runtime, output, undefined, failed);
  await session.send("byte-flood").catch(() => undefined);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  const events = packets.filter(
    ({ direction, kind }) => direction === "worker" && kind === "stream-output",
  );
  expect(events).toHaveLength(10);
  expect(
    events.every(
      ({ bytes, backingBytes }) =>
        bytes >= 768 * 1024 && bytes === backingBytes,
    ),
  ).toBe(true);
  expect(
    events.reduce((total, { bytes }) => total + bytes, 0),
  ).toBeLessThanOrEqual(workerLimits.eventBytes - 256 * 1024);
  await expect(runtime.getResource("cheap")!.read(undefined)).resolves.toBe(42);
});

testCases.each(["TimeoutError", "AbortError"])(
  "native %s numeric codes fail only the request",
  async (name) => {
    const packets = captureTransport();
    const runtime = await start(await createProject());
    await expect(
      runtime.getResource("status")!.read(undefined),
    ).resolves.toMatchObject({ isMainThread: false });
    await expect(
      runtime.getResource("nativeError")!.read(name),
    ).rejects.toMatchObject({ name, message: "upstream request failed" });
    await expect(
      runtime.getResource("status")!.read(undefined),
    ).resolves.toMatchObject({ isMainThread: false });
    expect(packets.some(({ kind }) => kind === "fatal")).toBe(false);
  },
);

test("saturated data traffic still admits cancellation and stream close", async () => {
  const runtime = await start(await createProject());
  const session = await open(runtime);
  const controllers = Array.from({ length: 256 }, () => new AbortController());
  const pending = controllers.map((controller) =>
    runtime
      .getOperation("wait")!
      .execute(undefined, controller.signal)
      .catch((cause) => cause),
  );
  await expect(runtime.getOperation("run")!.execute("ok")).rejects.toThrow(
    "queue is full",
  );
  await session.dispose();
  controllers.forEach((controller) => controller.abort());
  // Caller cancellation is synchronous; remote replies have not returned credits yet.
  const stillFull = runtime.getOperation("run")!.execute("ok");
  await expect(stillFull).rejects.toThrow("queue is full");
  await Promise.all(pending);
  await vi.waitFor(async () =>
    expect((await status(runtime)).disposed).toBe(1),
  );
});

test("throwing delivery and flooded output close one source, invalidations coalesce", async () => {
  const packets = captureTransport();
  const runtime = await start(await createProject());
  const failed = vi.fn();
  const session = await open(
    runtime,
    () => {
      throw new Error("socket encoding failed");
    },
    undefined,
    failed,
  );
  await session.send("one");
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  await vi.waitFor(async () =>
    expect((await status(runtime)).disposed).toBe(1),
  );
  await expect(session.send("two")).rejects.toThrow("socket encoding failed");

  await expect(
    runtime.getStream("events")!.open({ delay: 100, openingBurst: 5 }, () => {
      throw new Error("opening buffer full");
    }),
  ).rejects.toThrow("opening buffer full");
  await vi.waitFor(async () =>
    expect((await status(runtime)).disposed).toBe(2),
  );

  const flooded = vi.fn();
  const flood = await open(runtime, vi.fn(), undefined, flooded);
  await flood.send("flood").catch(() => undefined);
  await vi.waitFor(() => expect(flooded).toHaveBeenCalledTimes(1));
  await vi.waitFor(async () =>
    expect((await status(runtime)).disposed).toBe(3),
  );
  await expect(runtime.getResource("cheap")!.read(undefined)).resolves.toBe(42);
  const invalidated = vi.fn();
  const unsubscribe = await runtime
    .getResource("watched")!
    .subscribe(0, invalidated);
  invalidated.mockClear();
  await runtime.getOperation("run")!.execute("flood-invalidations");
  await vi.waitFor(() => expect(invalidated).toHaveBeenCalled());
  expect(invalidated.mock.calls.length).toBeLessThan(10);
  await unsubscribe();

  const sessionKinds = [
    "resource-subscribe",
    "stream-open",
    "stream-message",
    "invalidate",
    "stream-output",
    "stream-error",
    "close",
    "closed",
  ];
  const sessionPackets = packets.filter(({ kind }) =>
    sessionKinds.includes(kind),
  );
  expect(sessionPackets.map(({ kind }) => kind)).toEqual(
    expect.arrayContaining(sessionKinds),
  );
  const admitted = new Set(
    packets
      .filter(({ kind }) =>
        ["resource-subscribe", "stream-open"].includes(kind),
      )
      .map(({ message }) => message.sessionId),
  );
  for (const { kind, message } of sessionPackets) {
    expect(typeof message.sessionId).toBe("number");
    expect(admitted.has(message.sessionId)).toBe(true);
    expect(message).not.toHaveProperty("streamId");
    expect(message).not.toHaveProperty("subscriptionId");
    if (kind === "close" || kind === "closed") {
      expect(message).not.toHaveProperty("id");
    } else if (message.action !== undefined) {
      expect(message.id).not.toBe(message.sessionId);
    }
  }
});

test("WebSocket validation categories survive worker reconstruction", async () => {
  const runtime = await start(await createProject());
  const sent: unknown[] = [];
  const socket = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (frame: string | Uint8Array) => sent.push(decodeProtocolFrame(frame)),
  });
  attachWebSocketConnection({
    runtime,
    socket: socket as unknown as WebSocket,
  });
  socket.emit(
    "message",
    Buffer.from(
      encodeProtocolMessage({
        type: "resource-read",
        resourceName: "watched",
        input: "bad",
        operationId: "bad-input",
      }),
    ),
    false,
  );
  await vi.waitFor(() =>
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "error",
        operationId: "bad-input",
        code: "bad-request",
      }),
    ),
  );
  socket.emit("close");
});

test("closing and reusing a WebSocket stream ID cannot attach or fail late setup to its replacement", async () => {
  const runtime = await start(await createProject());
  const sent: unknown[] = [];
  const socket = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (frame: string | Uint8Array) => sent.push(decodeProtocolFrame(frame)),
  });
  attachWebSocketConnection({
    runtime,
    socket: socket as unknown as WebSocket,
  });
  const send = (message: unknown) =>
    socket.emit("message", Buffer.from(encodeProtocolMessage(message)), false);
  send({
    type: "stream-open",
    streamName: "events",
    streamId: "reused",
    operationId: "old",
    input: { delay: 200 },
  });
  send({ type: "stream-close", streamId: "reused" });
  send({
    type: "stream-open",
    streamName: "events",
    streamId: "reused",
    operationId: "new",
    input: { delay: 0 },
  });
  await vi.waitFor(() =>
    expect(sent).toContainEqual(
      expect.objectContaining({ type: "stream-opened", operationId: "new" }),
    ),
  );
  await vi.waitFor(async () =>
    expect((await status(runtime)).disposed).toBe(1),
  );
  send({
    type: "stream-message",
    streamId: "reused",
    message: "replacement survives",
  });
  await vi.waitFor(() =>
    expect(sent).toContainEqual({
      type: "stream-output",
      streamId: "reused",
      message: "replacement survives",
    }),
  );
  expect(
    sent.filter(
      (value) => (value as { type: string }).type === "stream-closed",
    ),
  ).toHaveLength(1);
  expect(
    sent.some((value) => (value as { type: string }).type === "error"),
  ).toBe(false);

  send({ type: "stream-close", streamId: "reused" });
  await vi.waitFor(async () =>
    expect((await status(runtime)).disposed).toBe(2),
  );
  send({
    type: "stream-open",
    streamName: "events",
    streamId: "cleanup",
    operationId: "cleanup",
    input: { delay: 0, cleanupDelay: 100, cleanupFailure: true },
  });
  await vi.waitFor(() =>
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "stream-opened",
        operationId: "cleanup",
      }),
    ),
  );
  send({ type: "stream-close", streamId: "cleanup" });
  await vi.waitFor(async () =>
    expect((await status(runtime)).disposed).toBe(3),
  );
  // No stale error may arrive after the close acknowledgement. The client could
  // already have reused the ID while its next open frame is still in transit.
  expect(
    sent.some((value) => (value as { type: string }).type === "error"),
  ).toBe(false);
  socket.emit("close");
});

const notificationFailures = [
  {
    name: "synchronous throw",
    send: () => {
      throw new Error("delivery failed " + "x".repeat(9000));
    },
  },
  {
    name: "promise rejection",
    send: () =>
      Promise.reject(new Error("delivery failed " + "x".repeat(9000))),
  },
];
testCases.each(notificationFailures)(
  "notification $name settles the caller with a bounded error",
  async ({ send }) => {
    const packets = captureTransport();
    const runtime = await start(await createProject(), {
      notifications: { send },
    });

    await expect(
      runtime.getOperation("notify")!.execute(undefined),
    ).rejects.toThrow("delivery failed");

    const result = packets.find(({ kind }) => kind === "notification-result")!;
    expect(result.message.ok).toBe(false);
    expect(result.message.error).toHaveLength(8192);
    const receipt = packets.find(({ kind }) => kind === "notification")!;
    const acknowledged = packets.findIndex(
      ({ kind, message }) =>
        kind === "ack" && message.deliveryId === receipt.message.deliveryId,
    );
    expect(acknowledged).toBeGreaterThanOrEqual(0);
    expect(acknowledged).toBeLessThan(packets.indexOf(result));
    await expect(runtime.getResource("cheap")!.read(undefined)).resolves.toBe(
      42,
    );
  },
);

test("notification receipt returns credits without waiting for bounded delivery promises", async () => {
  const packets = captureTransport();
  const releases: (() => void)[] = [];
  const send = vi.fn(
    () => new Promise<void>((resolve) => releases.push(resolve)),
  );
  const runtime = await start(await createProject(), {
    notifications: { send },
  });
  const delivered = vi.fn();
  const pending = Array.from({ length: 33 }, () =>
    runtime
      .getOperation("notify")!
      .execute(undefined)
      .then(delivered, (cause) => cause),
  );
  await vi.waitFor(() => expect(releases).toHaveLength(32));
  await expect(pending[32]).resolves.toEqual(
    expect.objectContaining({
      message: expect.stringContaining("notification queue"),
    }),
  );
  expect(delivered).not.toHaveBeenCalled();
  expect(packets.some(({ kind }) => kind === "notification-result")).toBe(
    false,
  );
  const receipts = packets.filter(({ kind }) => kind === "notification");
  expect(receipts).toHaveLength(32);
  for (const { message } of receipts) {
    expect(packets).toContainEqual(
      expect.objectContaining({
        kind: "ack",
        message: { type: "ack", deliveryId: message.deliveryId },
      }),
    );
  }

  releases.forEach((release) => release());
  await Promise.all(pending);
  expect(delivered).toHaveBeenCalledTimes(32);
});

test("closing lifetimes retain capacity and explicit dispose waits for remote cleanup", async () => {
  const runtime = await start(await createProject());
  const sessions = [];
  for (let i = 0; i < 128; i++) {
    sessions.push(
      await runtime
        .getStream("events")!
        .open({ delay: 0, cleanupDelay: 200 }, vi.fn()),
    );
  }
  const closing = sessions.map((session) => session.dispose());
  await expect(open(runtime)).rejects.toThrow("lifetime limit");
  await Promise.all(closing);
  expect((await status(runtime)).disposed).toBe(128);
  const replacement = await open(runtime);
  await replacement.dispose();
  expect((await status(runtime)).disposed).toBe(129);
});

test("stopping refuses new work but settles remote close replies and remains idempotent", async () => {
  const runtime = await start(await createProject());
  const controller = new AbortController();
  const session = await runtime
    .getStream("events")!
    .open({ cleanupDelay: 100 }, vi.fn(), controller.signal);

  const closing = session.dispose();
  const stopping = runtime.dispose();

  expect(session.dispose()).toBe(closing);
  expect(runtime.dispose()).toBe(stopping);
  await expect(runtime.getResource("cheap")!.read(undefined)).rejects.toThrow(
    "Worker runtime disposed",
  );
  await expect(closing).resolves.toBeUndefined();
  await stopping;
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});

test("graceful shutdown runs disposers; stuck userland has a hard stop deadline", async () => {
  const directory = await createProject();
  const runtime = await start(directory, { shutdownMs: 200 });
  const cleanupPath = join(directory, "cleanup");
  await runtime.getStream("events")!.open({ delay: 0, cleanupPath }, vi.fn());
  await runtime.dispose();
  expect(await readFile(cleanupPath, "utf8")).toBe("disposed\n");

  const stuck = await start(directory, { shutdownMs: 200 });
  const request = stuck
    .getOperation("run")!
    .execute("spin")
    .catch((cause) => cause);
  const output = vi.fn();
  const terminal = await open(stuck, output);
  await terminal.send("not blocked");
  await vi.waitFor(() => expect(output).toHaveBeenCalledWith("not blocked"));
  const started = Date.now();
  await stuck.dispose();
  expect(Date.now() - started).toBeLessThan(1500);
  await expect(request).resolves.toBeInstanceOf(Error);
});
