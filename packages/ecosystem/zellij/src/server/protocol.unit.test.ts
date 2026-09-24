import { describe, expect, it, test as testCases } from "vitest";

import { createRuntimeProtocolDecoder } from "./protocol";

const decode = (
  decoder: ReturnType<typeof createRuntimeProtocolDecoder>,
  value: unknown,
) => decoder.accept(typeof value === "string" ? value : JSON.stringify(value));
const hello = {
  connectionId: "connection-1",
  pluginId: 4,
  pluginVersion: "0.0.1",
  protocolVersion: 1,
  type: "hello",
};
const snapshot = (sequence: number) => ({
  connectionId: "connection-1",
  protocolVersion: 1,
  resurrectableSessions: [],
  sequence,
  sessions: [],
  type: "snapshot",
});

describe("Zellij runtime protocol", () => {
  testCases.each([
    { expected: "malformed", name: "malformed JSON", value: "{" },
    {
      expected: "incompatible",
      name: "wrong protocol version",
      value: { ...hello, protocolVersion: 2 },
    },
    {
      expected: "belongs to connection",
      name: "wrong connection ID",
      value: { ...hello, connectionId: "old-connection" },
    },
    {
      expected: "expected 1 after hello",
      name: "snapshot before hello",
      value: snapshot(1),
    },
  ])("rejects $name", ({ expected, value }) => {
    const event = decode(createRuntimeProtocolDecoder("connection-1"), value);
    expect(event).toMatchObject({ type: "error" });
    if (event.type === "error") {
      expect(event.error.message).toContain(expected);
    }
  });

  it("requires strictly increasing sequences within each generation", () => {
    const decoder = createRuntimeProtocolDecoder("connection-1");
    expect(decode(decoder, hello)).toMatchObject({ type: "hello" });
    expect(decode(decoder, snapshot(1))).toMatchObject({
      sequence: 1,
      type: "snapshot",
    });
    const duplicate = decode(decoder, snapshot(1));
    expect(duplicate).toMatchObject({ type: "error" });
    if (duplicate.type === "error") {
      expect(duplicate.error.message).toContain("expected 2");
    }
  });

  it("rejects duplicate hello and output after bye", () => {
    const decoder = createRuntimeProtocolDecoder("connection-1");
    decode(decoder, hello);
    expect(decode(decoder, hello)).toMatchObject({ type: "error" });

    const closing = createRuntimeProtocolDecoder("connection-1");
    decode(closing, hello);
    decode(closing, {
      connectionId: "connection-1",
      protocolVersion: 1,
      type: "bye",
    });
    expect(decode(closing, snapshot(1))).toMatchObject({ type: "error" });
  });
});
