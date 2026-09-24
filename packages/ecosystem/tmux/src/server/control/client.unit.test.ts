// Covers control attachment, command ordering, aborts, limits, and reconnection races.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, test as testCases, vi } from "vitest";

import {
  createTmuxControlClient,
  type TmuxControlClientOptions,
  type TmuxControlProcess,
} from "./client";

class FakeControlProcess extends EventEmitter {
  readonly commands: string[] = [];
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit("close", 0, null));
    return true;
  });

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.commands.push(chunk.toString().trimEnd());
    });
  }

  acceptAttachment() {
    this.completeProtocolBlock("");
  }

  rejectAttachment(output = "can't find session\n") {
    this.failProtocolBlock(output);
  }

  completeCommand(output: string) {
    this.completeProtocolBlock(output);
  }

  failCommand(output: string) {
    this.failProtocolBlock(output);
  }

  beginCommandResponse() {
    this.sendProtocol("%begin 1 2 0\n");
  }

  notify(line: string) {
    this.sendProtocol(`${line}\n`);
  }

  sendProtocol(value: string) {
    this.stdout.write(value);
  }

  failStdin(message: string) {
    this.stdin.emit("error", new Error(message));
  }

  exit(code = 1) {
    this.emit("close", code, null);
  }

  private completeProtocolBlock(output: string) {
    this.sendProtocol(`%begin 1 2 0\n${output}%end 1 2 0\n`);
  }

  private failProtocolBlock(output: string) {
    this.sendProtocol(`%begin 1 2 0\n${output}%error 1 2 0\n`);
  }
}

const createHarness = (options: Partial<TmuxControlClientOptions> = {}) => {
  const processes: FakeControlProcess[] = [];
  const spawnArguments: (readonly string[])[] = [];
  const processFactory =
    options.processFactory ??
    ((args: readonly string[]) => {
      const process = new FakeControlProcess();
      processes.push(process);
      spawnArguments.push(args);
      return process as unknown as TmuxControlProcess;
    });
  const client = createTmuxControlClient({
    reconnectMaxDelayMs: 10_000,
    reconnectMinDelayMs: 10_000,
    socket: "test",
    ...options,
    processFactory,
  });
  return { client, processes, spawnArguments };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("persistent tmux control client", () => {
  it("starts lazily, waits for attachment, and runs commands in order", async () => {
    const { client, processes } = createHarness();
    expect(processes).toHaveLength(0);

    const first = client.command(["first"]);
    const second = client.command(["second"]);
    const process = processes[0]!;
    expect(process.commands).toEqual([]);

    process.acceptAttachment();
    expect(process.commands).toEqual(['"first"']);
    process.completeCommand("first output\n");
    expect(process.commands).toEqual(['"first"', '"second"']);
    process.completeCommand("second output\n");

    await expect(Promise.all([first, second])).resolves.toEqual([
      "first output\n",
      "second output\n",
    ]);
    expect(processes).toHaveLength(1);
    await client.close();
  });

  it("rejects failed commands and continues with the next command", async () => {
    const { client, processes } = createHarness();
    const failed = client.command(["bad-command"]);
    const process = processes[0]!;
    process.acceptAttachment();

    process.failCommand("bad command\n");
    await expect(failed).rejects.toThrow("bad command");

    const next = client.command(["next-command"]);
    process.completeCommand("ok\n");
    await expect(next).resolves.toBe("ok\n");
    await client.close();
  });

  it("rejects commands beyond the pending command limit", async () => {
    const { client, processes } = createHarness({ maxPendingCommands: 2 });
    const first = client.command(["first"]);
    const second = client.command(["second"]);

    await expect(client.command(["third"])).rejects.toThrow("queue is full");

    const process = processes[0]!;
    process.acceptAttachment();
    process.completeCommand("first\n");
    process.completeCommand("second\n");
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first\n",
      "second\n",
    ]);
    await client.close();
  });

  const invalidOptionCases = [
    {
      error: "maxBufferedBytes must be a positive safe integer",
      name: "a nonpositive output limit",
      options: { maxBufferedBytes: 0 },
    },
    {
      error: "maxPendingCommands must be a positive safe integer",
      name: "a fractional command limit",
      options: { maxPendingCommands: 1.5 },
    },
    {
      error: "reconnectMinDelayMs must be between 1 and 2147483647",
      name: "a zero reconnect delay",
      options: { reconnectMinDelayMs: 0 },
    },
    {
      error:
        "reconnectMaxDelayMs must be greater than or equal to reconnectMinDelayMs",
      name: "a maximum reconnect delay below its minimum",
      options: { reconnectMaxDelayMs: 9, reconnectMinDelayMs: 10 },
    },
  ] satisfies {
    error: string;
    name: string;
    options: Partial<TmuxControlClientOptions>;
  }[];

  testCases.each(invalidOptionCases)("rejects $name", ({ error, options }) => {
    expect(() => createHarness(options)).toThrow(error);
  });

  it("removes an aborted queued command before it is written", async () => {
    const { client, processes } = createHarness();
    const active = client.command(["active"]);
    const process = processes[0]!;
    process.acceptAttachment();
    const controller = new AbortController();
    const queued = client.command(["queued"], { signal: controller.signal });

    controller.abort(new Error("cancel queued"));

    await expect(queued).rejects.toThrow("cancel queued");
    process.completeCommand("done\n");
    await expect(active).resolves.toBe("done\n");
    expect(process.commands).toEqual(['"active"']);
    await client.close();
  });

  it("waits for an aborted active response before writing the next command", async () => {
    const { client, processes } = createHarness();
    const controller = new AbortController();
    const aborted = client.command(["old"], { signal: controller.signal });
    const next = client.command(["new"]);
    const process = processes[0]!;
    process.acceptAttachment();

    controller.abort(new Error("cancel active"));

    await expect(aborted).rejects.toThrow("cancel active");
    expect(process.commands).toEqual(['"old"']);
    process.completeCommand("ignored\n");
    expect(process.commands).toEqual(['"old"', '"new"']);
    process.completeCommand("new\n");
    await expect(next).resolves.toBe("new\n");
    await client.close();
  });

  it("disconnects when one command response exceeds the buffer limit", async () => {
    const { client, processes } = createHarness({ maxBufferedBytes: 64 });
    const pending = client.command(["large-output"]);
    const process = processes[0]!;
    process.acceptAttachment();

    process.beginCommandResponse();
    process.sendProtocol("x".repeat(65));

    await expect(pending).rejects.toThrow("output exceeded its limit");
    expect(process.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    await client.close();
  });

  it("reconnects after stdin fails during attachment", async () => {
    vi.useFakeTimers();
    const { client, processes } = createHarness({
      reconnectMaxDelayMs: 10,
      reconnectMinDelayMs: 10,
    });
    client.subscribe(vi.fn());

    processes[0]!.failStdin("write EPIPE");
    await vi.advanceTimersByTimeAsync(10);

    expect(processes).toHaveLength(2);
    await client.close();
  });

  it("rejects active and queued commands on stdin failure, then accepts later work", async () => {
    vi.useFakeTimers();
    const { client, processes } = createHarness({
      reconnectMaxDelayMs: 10,
      reconnectMinDelayMs: 10,
    });
    const active = client.command(["active"]);
    const process = processes[0]!;
    process.acceptAttachment();
    const queued = client.command(["queued"]);

    process.failStdin("write EPIPE");

    await expect(active).rejects.toThrow("write EPIPE");
    await expect(queued).rejects.toThrow("write EPIPE");
    await vi.advanceTimersByTimeAsync(10);
    const reconnected = processes[1]!;
    const later = client.command(["later"]);
    reconnected.acceptAttachment();
    reconnected.completeCommand("ok\n");
    await expect(later).resolves.toBe("ok\n");
    await client.close();
  });

  it("rejects a command when the process exits during a partial response", async () => {
    const { client, processes } = createHarness();
    const pending = client.command(["partial"]);
    const process = processes[0]!;
    process.acceptAttachment();

    process.beginCommandResponse();
    process.sendProtocol("partial output");
    process.exit(7);

    await expect(pending).rejects.toThrow("exited (code 7, signal none)");
    await client.close();
  });

  it("ignores protocol and lifecycle events from a stale process", async () => {
    vi.useFakeTimers();
    const { client, processes } = createHarness({
      reconnectMaxDelayMs: 10,
      reconnectMinDelayMs: 10,
    });
    const listener = vi.fn();
    client.subscribe(listener);
    const stale = processes[0]!;
    stale.failStdin("disconnected");
    await vi.advanceTimersByTimeAsync(10);
    const current = processes[1]!;
    current.acceptAttachment();
    const pending = client.command(["current"]);
    listener.mockClear();

    stale.notify("%window-pane-changed @1 %2");
    stale.completeCommand("stale\n");
    stale.exit();
    current.completeCommand("current\n");

    await expect(pending).resolves.toBe("current\n");
    expect(listener).not.toHaveBeenCalled();
    expect(processes).toHaveLength(2);
    await client.close();
  });

  it("attaches targetlessly with control-mode client flags", async () => {
    const { client, processes, spawnArguments } = createHarness();

    client.subscribe(vi.fn());

    expect(spawnArguments).toEqual([
      ["-L", "test", "-C", "attach-session", "-f", "no-output,ignore-size"],
    ]);
    processes[0]!.acceptAttachment();
    await client.close();
  });

  it("reconnects after attachment fails without waiting for process close", async () => {
    vi.useFakeTimers();
    const { client, processes } = createHarness({
      reconnectMaxDelayMs: 10,
      reconnectMinDelayMs: 10,
    });
    const pending = client.command(["before-attachment"]);

    processes[0]!.rejectAttachment("no sessions\n");

    await expect(pending).rejects.toThrow("no sessions");
    await vi.advanceTimersByTimeAsync(9);
    expect(processes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(processes).toHaveLength(2);
    await client.close();
  });

  it("keeps commands queued behind scheduled reconnect backoff", async () => {
    vi.useFakeTimers();
    const { client, processes } = createHarness({
      reconnectMaxDelayMs: 10,
      reconnectMinDelayMs: 10,
    });
    client.subscribe(vi.fn());
    processes[0]!.exit();

    const pending = client.command(["after-disconnect"]);
    expect(processes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9);
    expect(processes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    const reconnected = processes[1]!;
    reconnected.acceptAttachment();
    expect(reconnected.commands).toEqual(['"after-disconnect"']);
    reconnected.completeCommand("recovered\n");
    await expect(pending).resolves.toBe("recovered\n");
    await client.close();
  });

  it("backs off repeated reconnects and resets after attachment", async () => {
    vi.useFakeTimers();
    const { client, processes } = createHarness({
      reconnectMaxDelayMs: 20,
      reconnectMinDelayMs: 10,
    });
    client.subscribe(vi.fn());

    processes[0]!.exit();
    await vi.advanceTimersByTimeAsync(9);
    expect(processes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(processes).toHaveLength(2);

    processes[1]!.exit();
    await vi.advanceTimersByTimeAsync(19);
    expect(processes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(processes).toHaveLength(3);

    processes[2]!.acceptAttachment();
    processes[2]!.exit();
    await vi.advanceTimersByTimeAsync(9);
    expect(processes).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(processes).toHaveLength(4);
    await client.close();
  });

  it("delivers typed notifications until the listener unsubscribes", async () => {
    const { client, processes } = createHarness();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    const process = processes[0]!;
    process.acceptAttachment();

    process.notify("%window-pane-changed @1 %2");

    expect(listener).toHaveBeenCalledWith({
      paneId: "%2",
      type: "window-pane-changed",
      windowId: "@1",
    });
    unsubscribe();
    process.notify("%sessions-changed");
    expect(listener).toHaveBeenCalledOnce();
    await client.close();
  });

  it("closes the process, rejects queued work, and prevents reconnects", async () => {
    const { client, processes } = createHarness();
    const active = client.command(["active"]);
    const process = processes[0]!;
    process.acceptAttachment();
    const queued = client.command(["queued"]);

    const close = client.close();

    await expect(active).rejects.toThrow("client is closed");
    await expect(queued).rejects.toThrow("client is closed");
    await close;
    expect(process.kill).toHaveBeenCalledWith("SIGHUP");
    await expect(client.command(["later"])).rejects.toThrow("client is closed");
    process.failStdin("late error");
    process.exit();
    expect(processes).toHaveLength(1);
  });
});
