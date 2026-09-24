import { describe, expect, test as testCases } from "vitest";

import { parsePort } from "./parse-port";

const validPortTestCases = [
  { expected: 4242, value: "4242" },
  { expected: 65_535, value: "65535" },
];

const invalidPortTestCases = [
  { value: "0" },
  { value: "-1" },
  { value: "1.5" },
  { value: "65536" },
  { value: "not-a-port" },
];

describe("port parser", () => {
  testCases.each(validPortTestCases)(
    "parses $value as port $expected",
    ({ expected, value }) => {
      expect(parsePort(value)).toBe(expected);
    },
  );

  testCases.each(invalidPortTestCases)("rejects $value", ({ value }) => {
    expect(parsePort(value)).toEqual(new Error(`Invalid port: ${value}`));
  });
});
