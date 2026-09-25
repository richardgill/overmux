import { describe, expect, it, test as testCases } from "vitest";

import { gitDiffSchema } from "../shared";
import { buildDiff } from "./diff";

const compare = (oldContent: string | null, newContent: string | null) =>
  buildDiff({
    file: "file.txt",
    oldBytes: oldContent === null ? null : Buffer.from(oldContent),
    newBytes: newContent === null ? null : Buffer.from(newContent),
  });

describe("captured text to structured hunks", () => {
  testCases.each([
    {
      name: "new file",
      old: null,
      next: "a\n",
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: 1,
      kinds: ["added"],
    },
    {
      name: "deleted file",
      old: "a\n",
      next: null,
      oldStart: 1,
      oldCount: 1,
      newStart: 0,
      newCount: 0,
      kinds: ["removed"],
    },
    {
      name: "empty file insertion",
      old: "",
      next: "a\n",
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: 1,
      kinds: ["added"],
    },
    {
      name: "terminal newline only",
      old: "a",
      next: "a\n",
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      kinds: ["removed", "added"],
    },
    {
      name: "CRLF to LF",
      old: "a\r\n",
      next: "a\n",
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      kinds: ["removed", "added"],
    },
    {
      name: "repeated lines",
      old: "a\na\nb\n",
      next: "a\nb\n",
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 2,
      kinds: ["context", "removed", "context"],
    },
  ])("$name", ({ old, next, kinds, name: _name, ...range }) => {
    const result = compare(old, next);
    expect(gitDiffSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      oldContent: old,
      newContent: next,
      binary: false,
      hunks: [range],
    });
    expect(result.hunks[0]?.lines.map(({ kind }) => kind)).toEqual(kinds);
    expect(
      result.hunks[0]?.lines.every(
        ({ text }) => !text.includes("\n") && !text.includes("\r"),
      ),
    ).toBe(true);
  });

  it("numbers separated hunks and preserves a bare terminal carriage return", () => {
    const old = Array.from({ length: 20 }, (_, index) => `${index + 1}\n`).join(
      "",
    );
    const result = compare(
      old,
      old.replace("2\n", "two\n").replace("20\n", "twenty\r"),
    );
    expect(result.hunks).toHaveLength(2);
    expect(result.hunks[0]?.lines).toContainEqual({
      kind: "removed",
      oldLine: 2,
      text: "2",
    });
    expect(result.hunks[0]?.lines).toContainEqual({
      kind: "added",
      newLine: 2,
      text: "two",
    });
    expect(result.hunks[1]?.lines.at(-1)).toEqual({
      kind: "added",
      newLine: 20,
      text: "twenty\r",
    });
  });

  testCases.each([
    { name: "identical", old: "same\r\n", next: "same\r\n" },
    { name: "empty addition", old: null, next: "" },
    { name: "empty deletion", old: "", next: null },
  ])("$name has no textual edits", ({ old, next }) => {
    expect(compare(old, next)).toMatchObject({
      oldContent: old,
      newContent: next,
      hunks: [],
    });
  });

  testCases.each([
    { name: "NUL", bytes: Buffer.from([0, 1]) },
    { name: "invalid UTF-8", bytes: Buffer.from([0xff]) },
  ])("$name never exposes corrupted text", ({ bytes }) => {
    expect(
      buildDiff({
        file: "binary",
        oldBytes: Buffer.from("text"),
        newBytes: bytes,
      }),
    ).toEqual({
      file: "binary",
      binary: true,
      oldContent: null,
      newContent: null,
      hunks: [],
    });
  });

  it("rejects absent files", () => {
    expect(() => compare(null, null)).toThrow("absent on both sides");
  });
});
