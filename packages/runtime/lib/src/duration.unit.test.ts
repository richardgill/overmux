import { describe, expect, it, test as testCases } from "vitest";

import { durationToMilliseconds } from "./duration";

const validDurations = [
  { duration: "1ms", milliseconds: 1 },
  { duration: "2s", milliseconds: 2_000 },
  { duration: "3m", milliseconds: 180_000 },
  { duration: "4h", milliseconds: 14_400_000 },
  { duration: "5d", milliseconds: 432_000_000 },
];

const invalidDurations = ["", "0m", "-1h", "1w", "1.5h", "Infinityd"];

describe("duration conversion", () => {
  testCases.each(validDurations)(
    "converts $duration to milliseconds",
    ({ duration, milliseconds }) => {
      expect(durationToMilliseconds(duration)).toBe(milliseconds);
    },
  );

  testCases.each(invalidDurations)("rejects %s", (duration) => {
    expect(durationToMilliseconds(duration)).toBeUndefined();
  });

  it("rejects durations larger than a safe integer", () => {
    expect(
      durationToMilliseconds(`${Number.MAX_SAFE_INTEGER}d`),
    ).toBeUndefined();
  });
});
