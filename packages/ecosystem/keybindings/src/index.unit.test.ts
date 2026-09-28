import { expect, test as testCases } from "vitest";

import {
  keyBindingSchema,
  matchesKeyBinding,
  matchesShortcutBindingPrefix,
  shortcutBindingSchema,
  shortcutBindingsEqual,
} from "./index";

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

testCases("validates shortcut sequences", () => {
  expect(shortcutBindingSchema.safeParse(["F12", "P"]).success).toBe(true);
  expect(shortcutBindingSchema.safeParse(["F12"]).success).toBe(false);
});

testCases("matches normalized sequence prefixes", () => {
  expect(
    matchesShortcutBindingPrefix({
      binding: ["Mod+X", "P"],
      input: {
        altKey: false,
        ctrlKey: false,
        key: "p",
        metaKey: false,
        shiftKey: false,
      },
      isMac: false,
      pending: ["Control+X"],
    }),
  ).toBe(true);
  expect(shortcutBindingsEqual("Mod+X", "Control+X", false)).toBe(true);
});
