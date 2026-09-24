import { expect, test as testCases } from "vitest";

import { keyBindingSchema, matchesKeyBinding } from "./index";

const testCasesByName = [
  { binding: "Control+Shift+C", valid: true },
  { binding: "Shift+1", valid: false },
  { binding: "Control+Control+C", valid: false },
] as const;

testCases.each(testCasesByName)("validates $binding", ({ binding, valid }) => {
  expect(keyBindingSchema.safeParse(binding).success).toBe(valid);
});

testCases("matches normalized browser keys", () => {
  expect(
    matchesKeyBinding("Alt+Space", {
      altKey: true,
      ctrlKey: false,
      key: " ",
      metaKey: false,
      shiftKey: false,
    } as KeyboardEvent),
  ).toBe(true);
});
