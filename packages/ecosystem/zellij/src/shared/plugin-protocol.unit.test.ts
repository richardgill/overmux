import { describe, expect, it, test as testCases } from "vitest";

import {
  encodeControlMessage,
  parsePluginMessage,
  ZELLIJ_PROTOCOL_VERSION,
} from "./plugin-protocol";

describe("Zellij plugin protocol", () => {
  it("encodes one versioned NDJSON control message", () => {
    const line = encodeControlMessage({
      connectionId: "connection-1",
      protocolVersion: ZELLIJ_PROTOCOL_VERSION,
      purpose: "install",
      type: "init",
    });

    expect(line).toBe(
      '{"connectionId":"connection-1","protocolVersion":1,"purpose":"install","type":"init"}\n',
    );
  });

  testCases.each([
    { name: "malformed JSON", line: "{" },
    {
      name: "unknown message",
      line: '{"type":"wat","protocolVersion":1,"connectionId":"c"}',
    },
    {
      name: "wrong version",
      line: '{"type":"install_ok","protocolVersion":2,"connectionId":"c"}',
    },
    {
      name: "missing connection",
      line: '{"type":"install_ok","protocolVersion":1}',
    },
    {
      name: "unknown field",
      line: '{"type":"install_ok","protocolVersion":1,"connectionId":"c","extra":true}',
    },
  ])("rejects $name", ({ line }) => {
    expect(() => parsePluginMessage(line)).toThrow();
  });

  it("accepts a complete snapshot envelope", () => {
    expect(
      parsePluginMessage(
        '{"type":"snapshot","protocolVersion":1,"connectionId":"c","sequence":1,"sessions":[],"resurrectableSessions":[]}',
      ),
    ).toMatchObject({ sequence: 1, type: "snapshot" });
  });
});
