import { expect, test as testCases } from "vitest";
import { createInstanceIdentity, instanceIdSchema } from "./instance";

const valid = ["a", "rich-work-1234", "work.example-42", "a".repeat(253)];
const invalid = [
  "",
  "Work",
  "-work",
  "work.",
  "a/b",
  "a:b",
  "a@b",
  "a?b",
  "a#b",
  "a%20b",
  "a_b",
  "a b",
  "a\n",
  "a\r",
  "a\u2028",
  "café",
  "a".repeat(254),
];

testCases.each(valid)(
  "creates a canonical deep-link authority: %s",
  (instanceId) => {
    expect(createInstanceIdentity(instanceId)).toEqual({
      instanceId,
      deepLinkPrefix: `overmux://${instanceId}`,
    });
  },
);

testCases.each(invalid)("rejects rather than normalizing: %s", (instanceId) => {
  expect(instanceIdSchema.safeParse(instanceId).success).toBe(false);
  expect(() => createInstanceIdentity(instanceId)).toThrow();
});
