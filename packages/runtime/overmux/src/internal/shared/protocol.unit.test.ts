import { describe, expect, it, test as testCases } from "vitest";

import {
  runtimeManifestSchema,
  clientProtocolMessageSchema,
  decodeProtocolFrame,
  decodeProtocolMessage,
  encodeProtocolFrame,
  encodeProtocolMessage,
  serverProtocolMessageSchema,
} from "./protocol";

const clientMessages = [
  {
    message: {
      operationId: "read-1",
      resourceName: "workspaceState",
      type: "resource-read",
    },
    type: "resource-read",
  },
  {
    message: {
      input: { path: "/repo" },
      operationId: "subscribe-1",
      resourceName: "workspaceState",
      subscriptionId: "subscription-1",
      type: "resource-subscribe",
    },
    type: "resource-subscribe",
  },
  {
    message: { subscriptionId: "subscription-1", type: "resource-unsubscribe" },
    type: "resource-unsubscribe",
  },
  {
    message: {
      operationId: "open-1",
      streamName: "tmuxTerminal",
      streamId: "stream-1",
      type: "stream-open",
    },
    type: "stream-open",
  },
  {
    message: {
      message: { data: "input" },
      streamId: "stream-1",
      type: "stream-message",
    },
    type: "stream-message",
  },
  {
    message: { streamId: "stream-1", type: "stream-close" },
    type: "stream-close",
  },
  {
    message: {
      arguments: '["loaded"]',
      level: "info",
      message: "loaded",
      timestamp: "2026-03-09T12:00:00.000Z",
      type: "client-diagnostic",
      url: "https://example.test/app",
    },
    type: "client-diagnostic",
  },
] as const;

const serverMessages = [
  {
    message: {
      operationId: "read-1",
      output: { value: 1 },
      type: "resource-result",
    },
    type: "resource-result",
  },
  {
    message: { subscriptionId: "subscription-1", type: "resource-invalidated" },
    type: "resource-invalidated",
  },
  {
    message: {
      operationId: "open-1",
      streamId: "stream-1",
      type: "stream-opened",
    },
    type: "stream-opened",
  },
  {
    message: {
      message: { value: 1 },
      streamId: "stream-1",
      type: "stream-output",
    },
    type: "stream-output",
  },
  {
    message: { streamId: "stream-1", type: "stream-closed" },
    type: "stream-closed",
  },
  {
    message: {
      code: "bad-request",
      message: "Invalid input",
      operationId: "read-1",
      type: "error",
    },
    type: "error",
  },
  {
    message: { type: "update-available" },
    type: "update-available",
  },
  {
    message: { type: "restarting" },
    type: "restarting",
  },
  {
    message: {
      notification: { title: "build" },
      type: "notification",
    },
    type: "notification",
  },
] as const;

describe("WebSocket protocol", () => {
  it("publishes configured operation, resource, and stream names", () => {
    const manifest = runtimeManifestSchema.parse({
      debug: false,
      operations: ["refreshWorkspace"],
      protocolVersion: 10,
      resources: ["workspaceState"],
      streams: ["tmuxTerminal"],
    });

    expect(manifest.resources).toEqual(["workspaceState"]);
    expect(manifest.operations).toEqual(["refreshWorkspace"]);
    expect(manifest.streams).toEqual(["tmuxTerminal"]);
  });

  testCases.each(clientMessages)(
    "validates client $type messages",
    ({ message }) => {
      expect(clientProtocolMessageSchema.parse(message)).toEqual(message);
    },
  );

  testCases.each(serverMessages)(
    "validates server $type messages",
    ({ message }) => {
      expect(serverProtocolMessageSchema.parse(message)).toEqual(message);
    },
  );

  it("supports omitted input for no-input operations", () => {
    const calls = clientMessages
      .map(({ message }) => message)
      .filter(({ type }) => ["resource-read", "stream-open"].includes(type));

    expect(calls).toHaveLength(2);
    calls.forEach((message) => expect(message).not.toHaveProperty("input"));
  });

  it("round trips bytes inside stream messages", () => {
    const message = {
      message: { bytes: Uint8Array.from([0, 27, 255]), sequence: 4 },
      streamId: "terminal-1",
      type: "stream-output" as const,
    };
    const frame = encodeProtocolFrame(message);

    expect(frame).toBeInstanceOf(Uint8Array);
    expect(
      serverProtocolMessageSchema.parse(decodeProtocolFrame(frame)),
    ).toStrictEqual(message);
  });

  it("keeps ordinary protocol messages as text frames", () => {
    const message = { type: "update-available" as const };
    const frame = encodeProtocolFrame(message);

    expect(typeof frame).toBe("string");
    expect(decodeProtocolFrame(frame)).toStrictEqual(message);
  });

  it("keeps the binary payload close to its raw size", () => {
    const bytes = new Uint8Array(64 * 1_024);
    const frame = encodeProtocolFrame({ bytes });

    expect(frame).toBeInstanceOf(Uint8Array);
    expect((frame as Uint8Array).byteLength).toBeLessThan(
      bytes.byteLength + 100,
    );
    expect(
      decodeProtocolMessage(encodeProtocolMessage({ bytes })),
    ).toStrictEqual({
      bytes,
    });
  });

  it("rejects protocol v8 registration shapes", () => {
    expect(
      runtimeManifestSchema.safeParse({
        debug: false,
        operations: [],
        protocolVersion: 8,
        resources: ["workspaceState"],
        streams: ["tmuxTerminal"],
      }).success,
    ).toBe(false);
    expect(
      clientProtocolMessageSchema.safeParse({
        operationId: "read-1",
        resource: "workspaceState",
        type: "resource-read",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown protocol operations", () => {
    expect(
      clientProtocolMessageSchema.safeParse({ type: "legacy-pane-input" })
        .success,
    ).toBe(false);
  });
});
