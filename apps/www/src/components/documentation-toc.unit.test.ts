import { describe, expect, test as testCases } from "vitest";
import { tocItemOffset, tocLineOffset } from "./documentation-toc";

describe("documentation TOC offsets", () => {
  const offsetCases = [
    { depth: 2, itemOffset: 20, lineOffset: 8 },
    { depth: 3, itemOffset: 32, lineOffset: 16 },
    { depth: 4, itemOffset: 44, lineOffset: 24 },
    { depth: 5, itemOffset: 56, lineOffset: 32 },
    { depth: 6, itemOffset: 68, lineOffset: 40 },
  ];

  testCases.each(offsetCases)(
    "indents h$depth from its own visual level",
    ({ depth, itemOffset, lineOffset }) => {
      expect(tocItemOffset(depth)).toBe(itemOffset);
      expect(tocLineOffset(depth)).toBe(lineOffset);
    },
  );
});
