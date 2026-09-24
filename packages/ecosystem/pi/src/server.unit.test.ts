import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as projection from "./projection";
import { startReceiver } from "./protocol";
import {
  createPiSessionStatusSource,
  createPiSessionStatusWriter,
  definePiAgents,
  listPiSessionStatuses,
  piOperationHandlers,
  piConversationStream,
  piSessionStatusPath,
  piSessionsResource,
  type PiAgentSession,
  type PiSessionStatus,
} from "./server";

const directories: string[] = [];
const instance = {
  getInstanceId: () => "test",
  getDeepLinkPrefix: () => "overmux://test",
};

const createDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "overmux-pi-server-"));
  directories.push(directory);
  return directory;
};

const statusFixture = (
  overrides: Partial<PiSessionStatus> = {},
): PiSessionStatus => ({
  version: 1,
  sessionId: "agent",
  sessionFile: "/sessions/agent.jsonl",
  streamId: "stream",
  processInstanceId: "process",
  pid: 123,
  hostname: "host",
  startedAt: 1,
  updatedAt: 1,
  state: "idle",
  thinkingLevel: "medium",
  ...overrides,
});

const writeStatus = async (
  rootDir: string,
  status: PiSessionStatus,
): Promise<void> => {
  const filePath = piSessionStatusPath(
    rootDir,
    status.sessionId,
    status.streamId,
  );
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(status));
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Pi server plugin", () => {
  it("selects the newest live stream and filters stopped or dead local processes", async () => {
    const rootDir = await createDirectory();
    await Promise.all([
      writeStatus(
        rootDir,
        statusFixture({
          sessionId: "live",
          streamId: "old",
          processInstanceId: "old-process",
          updatedAt: 1,
        }),
      ),
      writeStatus(
        rootDir,
        statusFixture({
          sessionId: "live",
          sessionFile: "/sessions/live.jsonl",
          streamId: "new",
          processInstanceId: "new-process",
          updatedAt: 2,
        }),
      ),
      writeStatus(
        rootDir,
        statusFixture({
          sessionId: "stopped",
          streamId: "before-stop",
          processInstanceId: "stopped-process",
          updatedAt: 1,
        }),
      ),
      writeStatus(
        rootDir,
        statusFixture({
          sessionId: "stopped",
          streamId: "stopped",
          processInstanceId: "stopped-process",
          state: "stopped",
          updatedAt: 2,
        }),
      ),
      writeStatus(
        rootDir,
        statusFixture({
          sessionId: "dead",
          streamId: "dead",
          processInstanceId: "dead-process",
          pid: 999,
        }),
      ),
    ]);

    await expect(
      listPiSessionStatuses({
        rootDir,
        hostname: "host",
        pidAlive: (pid) => pid !== 999,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ sessionId: "live", streamId: "new" }),
    ]);
  });

  it("invalidates status subscribers when a session appears", async () => {
    const rootDir = await createDirectory();
    const source = createPiSessionStatusSource({
      rootDir,
      hostname: "host",
      pidAlive: () => true,
      pollIntervalMs: 20,
    });
    const invalidate = vi.fn();
    const controller = new AbortController();
    const dispose = source.subscribe(invalidate, { signal: controller.signal });

    await writeStatus(rootDir, statusFixture());

    await expect.poll(() => invalidate.mock.calls.length).toBeGreaterThan(0);
    await expect(source.list()).resolves.toEqual([
      expect.objectContaining({ sessionId: "agent" }),
    ]);
    controller.abort();
    dispose?.();
  });

  it("discovers an empty session before messages and later observes its socket", async () => {
    const directory = await createDirectory();
    const liveEventsDir = join(directory, "events");
    const sessionId = `overmux-${Date.now()}`;
    const sessionFile = join(directory, "session.jsonl");
    await writeFile(sessionFile, "");
    const writer = createPiSessionStatusWriter({
      rootDir: liveEventsDir,
      status: {
        sessionId,
        sessionFile,
        streamId: "stream",
        processInstanceId: "process",
        pid: process.pid,
        hostname: "host",
        startedAt: Date.now(),
        state: "idle",
        thinkingLevel: "medium",
      },
    });
    await writer.update({});
    const source = createPiSessionStatusSource({
      rootDir: liveEventsDir,
      hostname: "host",
      pidAlive: () => true,
    });
    const agents = definePiAgents({
      liveEventsDir,
      sessions: {
        list: async () =>
          (await source.list()).map(
            ({
              contextUsage,
              model,
              sessionFile,
              sessionId,
              thinkingLevel,
            }) => ({
              id: sessionId,
              sessionFile,
              sessionMetadata: { contextUsage, model, thinkingLevel },
            }),
          ),
        subscribe: source.subscribe,
      },
    });
    const emit = vi.fn();
    const conversation = await piConversationStream({ agents }).open(
      { agentId: sessionId },
      {
        instance,
        emit,
        fail: vi.fn(),
        invalidate: vi.fn(),
        signal: new AbortController().signal,
      },
    );

    expect(emit).toHaveBeenCalledWith({
      agentAvailable: false,
      entries: [],
      sessionMetadata: { thinkingLevel: "medium" },
      status: "offline",
    });
    const runtimeDir = `/tmp/overmux-pi-${process.getuid?.() ?? "u"}`;
    await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
    const receiver = await startReceiver(
      join(runtimeDir, `${sessionId}.sock`),
      () => undefined,
    );
    await expect
      .poll(() => emit.mock.calls.at(-1)?.[0]?.agentAvailable)
      .toBe(true);

    await conversation.dispose?.();
    await receiver.close();
    await writer.close();
  });

  it("refreshes subscribed sessions without replacing the registry", async () => {
    const invalidate = vi.fn();
    let sessions = [{ id: "first", sessionFile: "/sessions/first.jsonl" }];
    let sourceInvalidate: (() => void) | undefined;
    const sourceDispose = vi.fn();
    const agents = definePiAgents({
      liveEventsDir: "/events",
      sessions: {
        list: () => sessions,
        subscribe: (listener) => {
          sourceInvalidate = listener;
          return sourceDispose;
        },
      },
    });
    const resource = piSessionsResource({ agents });
    const controller = new AbortController();
    const context = {
      instance,
      invalidate: vi.fn(),
      signal: controller.signal,
    };
    const dispose = resource.subscribe(undefined, invalidate, context);

    await expect(resource.read(undefined, context)).resolves.toEqual([
      { agentId: "first" },
    ]);
    sessions = [
      { id: "first", sessionFile: "/sessions/first.jsonl" },
      { id: "second", sessionFile: "/sessions/second.jsonl" },
    ];
    sourceInvalidate?.();

    await expect.poll(() => invalidate.mock.calls.length).toBe(1);
    await expect(resource.read(undefined, context)).resolves.toEqual([
      { agentId: "first" },
      { agentId: "second" },
    ]);
    controller.abort();
    dispose();
    expect(sourceDispose).toHaveBeenCalledOnce();
  });

  it("disposes a failed conversation service", async () => {
    const dispose = vi.fn();
    vi.spyOn(projection, "createPiAgentConversationService").mockReturnValue({
      dispose,
      getSnapshot: async () => Promise.reject(new Error("unavailable")),
      subscribe: vi.fn(),
    });
    const agents = definePiAgents({
      liveEventsDir: "/events",
      sessions: {
        list: () => [{ id: "agent", sessionFile: "/sessions/agent.jsonl" }],
        subscribe: () => undefined,
      },
    });

    await expect(
      piConversationStream({ agents }).open(
        { agentId: "agent" },
        {
          instance,
          emit: vi.fn(),
          fail: vi.fn(),
          invalidate: vi.fn(),
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow("unavailable");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("opens streams and delivers messages for newly discovered agents", async () => {
    const directory = await createDirectory();
    const sessionId = `overmux-${Date.now()}`;
    const runtimeDir = `/tmp/overmux-pi-${process.getuid?.() ?? "u"}`;
    const socketPath = join(runtimeDir, `${sessionId}.sock`);
    const sessionFile = join(directory, "session.jsonl");
    await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
    await writeFile(sessionFile, "");
    const receiver = await startReceiver(socketPath, () => undefined, {
      onUserMessage: (request) => ({
        delivery: request.deliverAs,
        ok: true,
        requestId: request.requestId,
        version: 1,
      }),
    });
    let sessions: { id: string; sessionFile: string }[] = [];
    let sourceInvalidate: (() => void) | undefined;
    const agents = definePiAgents({
      liveEventsDir: join(directory, "events"),
      sessions: {
        list: () => sessions,
        subscribe: (invalidate) => {
          sourceInvalidate = invalidate;
        },
      },
    });
    const context = {
      instance,
      fail: vi.fn(),
      invalidate: vi.fn(),
      notifications: { send: async () => undefined },
      signal: new AbortController().signal,
    };
    const resource = piSessionsResource({ agents });
    const resourceDispose = resource.subscribe(undefined, vi.fn(), context);
    sessions = [{ id: sessionId, sessionFile }];
    sourceInvalidate?.();
    const emit = vi.fn();

    const [stream, operation] = await Promise.all([
      piConversationStream({ agents }).open(
        { agentId: sessionId },
        { ...context, emit },
      ),
      piOperationHandlers({ agents }).sendPiMessage.handle(
        { agentId: sessionId, deliverAs: "steer", message: "Review this" },
        context,
      ),
    ]);

    expect(emit).toHaveBeenCalledOnce();
    expect(operation).toMatchObject({ delivery: "steer" });
    await stream.dispose?.();
    resourceDispose();
    await receiver.close();
  });

  it("streams canonical history for the requested agent", async () => {
    const directory = await createDirectory();
    const sessionFile = join(directory, "session.jsonl");
    await writeFile(
      sessionFile,
      `${JSON.stringify({
        id: "message-1",
        message: { content: "Hello", role: "assistant", timestamp: 1 },
        timestamp: 1,
        type: "message",
      })}\n`,
    );
    const agents = definePiAgents({
      liveEventsDir: join(directory, "events"),
      sessions: {
        list: () => [{ id: "agent", sessionFile }],
        subscribe: () => undefined,
      },
    });
    const stream = piConversationStream({ agents });
    const emit = vi.fn();
    const controller = new AbortController();

    const session = await stream.open(
      { agentId: "agent" },
      {
        emit,
        fail: vi.fn(),
        instance,
        invalidate: vi.fn(),
        signal: controller.signal,
      },
    );

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ id: "message-1", source: "canonical" }),
        ],
      }),
    );
    await session.dispose?.();
  });

  it("limits conversation snapshots to the newest entries", async () => {
    const directory = await createDirectory();
    const sessionFile = join(directory, "session.jsonl");
    await writeFile(
      sessionFile,
      ["message-1", "message-2", "message-3"]
        .map((id, index) =>
          JSON.stringify({
            id,
            message: {
              content: id,
              role: "assistant",
              timestamp: index + 1,
            },
            timestamp: index + 1,
            type: "message",
          }),
        )
        .join("\n")
        .concat("\n"),
    );
    const agents = definePiAgents({
      liveEventsDir: join(directory, "events"),
      sessions: {
        list: () => [{ id: "agent", sessionFile }],
        subscribe: () => undefined,
      },
    });
    const emit = vi.fn();
    const session = await piConversationStream({ agents, maxEntries: 2 }).open(
      { agentId: "agent" },
      {
        emit,
        fail: vi.fn(),
        instance,
        invalidate: vi.fn(),
        signal: new AbortController().signal,
      },
    );

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({ id: "message-2" }),
          expect.objectContaining({ id: "message-3" }),
        ],
      }),
    );
    await session.dispose?.();
  });

  it("emits metadata-only session changes without losing or relimiting history", async () => {
    const directory = await createDirectory();
    const sessionFile = join(directory, "session.jsonl");
    await writeFile(
      sessionFile,
      ["message-1", "message-2", "message-3"]
        .map((id, index) =>
          JSON.stringify({
            id,
            message: {
              content: id,
              role: "assistant",
              timestamp: index + 1,
            },
            timestamp: index + 1,
            type: "message",
          }),
        )
        .join("\n")
        .concat("\n"),
    );
    let sessionMetadata: PiAgentSession["sessionMetadata"] = {
      thinkingLevel: "medium",
    };
    const agents = definePiAgents({
      liveEventsDir: join(directory, "events"),
      sessions: {
        list: () => [{ id: "agent", sessionFile, sessionMetadata }],
        subscribe: () => undefined,
      },
    });
    const emit = vi.fn();
    const session = await piConversationStream({ agents, maxEntries: 2 }).open(
      { agentId: "agent" },
      {
        emit,
        fail: vi.fn(),
        instance,
        invalidate: vi.fn(),
        signal: new AbortController().signal,
      },
    );

    expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({
      entries: [{ id: "message-2" }, { id: "message-3" }],
      sessionMetadata: { thinkingLevel: "medium" },
    });
    await rm(sessionFile);
    sessionMetadata = {
      contextUsage: {
        contextWindow: 200_000,
        percent: 85,
        tokens: 170_100,
      },
      model: {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        provider: "openai-codex",
      },
      thinkingLevel: "high",
    };

    await expect
      .poll(() => emit.mock.calls.at(-1)?.[0]?.sessionMetadata)
      .toEqual(sessionMetadata);
    expect(emit.mock.calls.at(-1)?.[0].entries).toMatchObject([
      { id: "message-2" },
      { id: "message-3" },
    ]);
    await session.dispose?.();
  });

  it("streams live events for the requested agent", async () => {
    const directory = await createDirectory();
    const sessionFile = join(directory, "session.jsonl");
    const liveEventsDir = join(directory, "events");
    const streamDir = join(liveEventsDir, "agent");
    await mkdir(streamDir, { recursive: true });
    await writeFile(sessionFile, "");
    await writeFile(
      join(streamDir, "stream.jsonl"),
      [
        {
          event: {
            message: { content: [], role: "assistant", timestamp: 1 },
            messageId: "message-1",
            messageSequence: 1,
            type: "message_start",
          },
          processInstanceId: "process-1",
          sequence: 1,
          sessionId: "agent",
          streamId: "stream",
          timestamp: 1,
          version: 1,
        },
        {
          event: {
            message: { content: "Live", role: "assistant", timestamp: 2 },
            messageId: "message-1",
            messageSequence: 1,
            type: "message_end",
          },
          processInstanceId: "process-1",
          sequence: 2,
          sessionId: "agent",
          streamId: "stream",
          timestamp: 2,
          version: 1,
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n")
        .concat("\n"),
    );
    const agents = definePiAgents({
      liveEventsDir,
      sessions: {
        list: () => [{ id: "agent", sessionFile }],
        subscribe: () => undefined,
      },
    });
    const emit = vi.fn();
    const session = await piConversationStream({ agents }).open(
      { agentId: "agent" },
      {
        emit,
        fail: vi.fn(),
        instance,
        invalidate: vi.fn(),
        signal: new AbortController().signal,
      },
    );

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            content: [{ text: "Live", type: "text" }],
            source: "live",
          }),
        ],
      }),
    );
    await session.dispose?.();
  });

  it("handles stop, model, and thinking operations through the selected agent", async () => {
    const sessionId = `overmux-${Date.now()}`;
    const runtimeDir = `/tmp/overmux-pi-${process.getuid?.() ?? "u"}`;
    const socketPath = join(runtimeDir, `${sessionId}.sock`);
    await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
    const receiver = await startReceiver(socketPath, () => undefined, {
      onAbort: (request) => ({
        version: 1,
        requestId: request.requestId,
        ok: true,
      }),
      onSetModel: async (request) => ({
        version: 1,
        requestId: request.requestId,
        ok: true,
      }),
      onSetThinkingLevel: (request) => ({
        version: 1,
        requestId: request.requestId,
        ok: true,
      }),
    });
    const agents = definePiAgents({
      liveEventsDir: "/events",
      sessions: {
        list: () => [{ id: sessionId, sessionFile: "/sessions/agent.jsonl" }],
        subscribe: () => undefined,
      },
    });
    const operations = piOperationHandlers({ agents });
    const context = {
      instance,
      invalidate: vi.fn(),
      notifications: { send: async () => undefined },
      signal: new AbortController().signal,
    };
    await expect(
      operations.stopPiAgent.handle({ agentId: sessionId }, context),
    ).resolves.toHaveProperty("requestId");
    await expect(
      operations.setPiModel.handle(
        { agentId: sessionId, provider: "provider", id: "model" },
        context,
      ),
    ).resolves.toHaveProperty("requestId");
    await expect(
      operations.setPiThinkingLevel.handle(
        { agentId: sessionId, level: "high" },
        context,
      ),
    ).resolves.toHaveProperty("requestId");
    expect(
      operations.setPiModel.input.safeParse({
        agentId: sessionId,
        provider: "",
        id: "model",
      }).success,
    ).toBe(false);
    expect(
      operations.setPiThinkingLevel.input.safeParse({
        agentId: sessionId,
        level: "wrong",
      }).success,
    ).toBe(false);
    await receiver.close();
  });

  it("validates and delivers Pi messages through the selected agent", async () => {
    const sessionId = `overmux-${Date.now()}`;
    const runtimeDir = `/tmp/overmux-pi-${process.getuid?.() ?? "u"}`;
    const socketPath = join(runtimeDir, `${sessionId}.sock`);
    await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
    const receiver = await startReceiver(socketPath, () => undefined, {
      onUserMessage: (request) => ({
        delivery: request.deliverAs,
        ok: true,
        requestId: request.requestId,
        version: 1,
      }),
    });
    const agents = definePiAgents({
      liveEventsDir: "/events",
      sessions: {
        list: () => [{ id: sessionId, sessionFile: "/sessions/agent.jsonl" }],
        subscribe: () => undefined,
      },
    });
    const operation = piOperationHandlers({ agents }).sendPiMessage;

    await expect(
      operation.handle(
        { agentId: sessionId, deliverAs: "steer", message: "Review this" },
        {
          instance,
          invalidate: vi.fn(),
          notifications: { send: async () => undefined },
          signal: new AbortController().signal,
        },
      ),
    ).resolves.toMatchObject({ delivery: "steer" });
    expect(
      operation.input.safeParse({
        agentId: sessionId,
        deliverAs: "wrong",
        message: "x",
      }).success,
    ).toBe(false);
    await receiver.close();
  });
});
