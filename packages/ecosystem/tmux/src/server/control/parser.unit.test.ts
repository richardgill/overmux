// Covers control-protocol framing, streaming boundaries, escapes, guards, and notifications.
import { describe, expect, it, test as testCases } from "vitest";

import { createTmuxControlParser, decodeTmuxEscapes } from "./parser";

const encode = (value: string) => new TextEncoder().encode(value);

const parseChunks = (chunks: readonly Uint8Array[]) => {
  const parser = createTmuxControlParser();
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.finish()];
};

const parseText = (...chunks: string[]) =>
  parseChunks(chunks.map((chunk) => encode(chunk)));

const guard = { commandNumber: 2, flags: 0, timestamp: 1 };
const blockStarted = { guard, type: "block-started" };

const completedBlockInput =
  "%begin 1 2 0\nfirst λ\n%sessions-changed\n%end 1 2 0\n";
const completedBlockEvents = [
  blockStarted,
  {
    guard,
    output: "first λ\n%sessions-changed\n",
    type: "block-completed",
  },
];

const chunkCases = [
  {
    chunks: [encode(completedBlockInput)],
    name: "one chunk",
  },
  {
    chunks: [...encode(completedBlockInput)].map((byte) => Uint8Array.of(byte)),
    name: "one-byte chunks that split UTF-8 characters",
  },
  {
    chunks: [
      "%beg",
      "in 1 2 0\nfirst ",
      "λ\n%sessions-",
      "changed\n%end 1 2 ",
      "0\n",
    ].map((chunk) => encode(chunk)),
    name: "uneven chunks across guards and payload lines",
  },
];

const notificationCases = [
  {
    event: {
      clientName: "/dev/pts/57",
      name: "work space\\name",
      sessionId: "$1",
      type: "client-session-changed",
    },
    line: "%client-session-changed /dev/pts/57 $1 work\\040space\\134name",
    name: "client session changes with escaped names",
  },
  {
    event: { sessionId: "$1", type: "session-window-changed", windowId: "@2" },
    line: "%session-window-changed $1 @2",
    name: "session window changes",
  },
  {
    event: { paneId: "%3", type: "window-pane-changed", windowId: "@2" },
    line: "%window-pane-changed @2 %3",
    name: "window pane changes",
  },
  {
    event: { type: "window-added", windowId: "@2" },
    line: "%window-add @2",
    name: "window additions",
  },
  {
    event: { type: "window-added", windowId: "@2" },
    line: "%unlinked-window-add @2",
    name: "unlinked window addition aliases",
  },
  {
    event: { type: "window-closed", windowId: "@2" },
    line: "%window-close @2",
    name: "window closures",
  },
  {
    event: { type: "window-closed", windowId: "@2" },
    line: "%unlinked-window-close @2",
    name: "unlinked window closure aliases",
  },
  {
    event: { name: "hello world", type: "window-renamed", windowId: "@2" },
    line: "%window-renamed @2 hello\\040world",
    name: "window renames with escaped names",
  },
  {
    event: { name: "hello world", type: "window-renamed", windowId: "@2" },
    line: "%unlinked-window-renamed @2 hello\\040world",
    name: "unlinked window rename aliases",
  },
  {
    event: { type: "sessions-changed" },
    line: "%sessions-changed",
    name: "session list changes",
  },
  {
    event: { type: "layout-changed", windowId: "@2" },
    line: "%layout-change @2 layout visible flags",
    name: "layout changes",
  },
];

describe("tmux control parser", () => {
  describe("command blocks", () => {
    testCases.each(chunkCases)(
      "parses multiline output from $name",
      ({ chunks }) => {
        const events = parseChunks(chunks);

        expect(events).toEqual(completedBlockEvents);
      },
    );

    it("normalizes CRLF protocol and output lines", () => {
      const events = parseText(
        "%begin 1 2 0\r\nfirst\r\nsecond\r\n%end 1 2 0\r\n",
      );

      expect(events).toEqual([
        blockStarted,
        { guard, output: "first\nsecond\n", type: "block-completed" },
      ]);
    });

    it("reports an error guard as a failed block", () => {
      const events = parseText("%begin 1 2 0\nfailed\n%error 1 2 0\n");

      expect(events).toEqual([
        blockStarted,
        { guard, output: "failed\n", type: "block-failed" },
      ]);
    });

    const mismatchedGuardCases = [
      { candidate: "%end 9 2 0", name: "timestamp" },
      { candidate: "%end 1 3 0", name: "command number" },
      { candidate: "%end 1 2 1", name: "flags" },
      { candidate: "%begin 1 2 0", name: "guard kind" },
    ];

    testCases.each(mismatchedGuardCases)(
      "treats a closing guard with a mismatched $name as output",
      ({ candidate }) => {
        const events = parseText(
          `%begin 1 2 0\n${candidate}\n%sessions-changed\n%error 1 2 0\n`,
        );

        expect(events).toEqual([
          blockStarted,
          {
            guard,
            output: `${candidate}\n%sessions-changed\n`,
            type: "block-failed",
          },
        ]);
      },
    );
  });

  describe("notifications", () => {
    testCases.each(notificationCases)("parses $name", ({ event, line }) => {
      const events = parseText(`${line}\n`);

      expect(events).toEqual([event]);
    });

    const malformedLineCases = [
      [
        "a client name that decodes to whitespace",
        "%client-session-changed \\040 $1 name",
      ],
      [
        "a malformed client session ID",
        "%client-session-changed /dev/pts/57 nope name",
      ],
      ["a malformed session ID", "%session-window-changed nope @2"],
      ["a malformed window ID", "%window-pane-changed nope %3"],
      ["a malformed pane ID", "%window-pane-changed @2 nope"],
      ["a missing renamed window name", "%window-renamed @2"],
      ["a malformed window addition", "%window-add nope"],
      ["an incomplete command guard", "%begin 1 2"],
      ["an unknown notification", "%unknown @2"],
    ];

    testCases.each(malformedLineCases)("ignores %s", (_name, line) => {
      const events = parseText(`${line}\n`);

      expect(events).toEqual([]);
    });
  });

  describe("finish", () => {
    it("emits a final notification without a newline", () => {
      const parser = createTmuxControlParser();

      const pushedEvents = parser.push(encode("%sessions-changed"));
      const finishedEvents = parser.finish();

      expect(pushedEvents).toEqual([]);
      expect(finishedEvents).toEqual([{ type: "sessions-changed" }]);
    });

    it("discards an incomplete command block and its partial output", () => {
      const parser = createTmuxControlParser();

      const pushedEvents = parser.push(encode("%begin 1 2 0\npartial"));
      const finishedEvents = parser.finish();

      expect(pushedEvents).toEqual([blockStarted]);
      expect(finishedEvents).toEqual([]);
    });
  });

  const escapeCases = [
    { encoded: "a\\040b", name: "octal escapes", value: "a b" },
    { encoded: "a\\134b", name: "escaped backslashes", value: "a\\b" },
    { encoded: "a\\12b\\x", name: "unsupported escapes", value: "a\\12b\\x" },
  ];

  testCases.each(escapeCases)("decodes $name", ({ encoded, value }) => {
    expect(decodeTmuxEscapes(encoded)).toBe(value);
  });
});
