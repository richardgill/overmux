import { expect, it, test as testCases } from "vitest";

import { nativeWebViewBoundsSchema } from "../shared/native-web-view.js";
import {
  isNativeWebUrlAllowed,
  nativeWebViewBounds,
  parseAllowedHttpOrigins,
} from "./native-web-view-policy.js";

testCases.each([
  ["https://github.com/login", true],
  ["http://localhost:3000/path", true],
  ["http://127.0.0.1:3000/", true],
  ["http://[::1]:3000/", true],
  ["http://devbox.local:3000/path", true],
  ["http://devbox.local:3001/path", false],
  ["http://devbox.local.evil:3000/", false],
  ["http://localhost.evil/", false],
  ["http://127.0.0.2/", false],
  ["https://user:secret@github.com/", false],
  ["file:///etc/passwd", false],
  ["javascript:alert(1)", false],
  ["data:text/html,hello", false],
  ["overmux://instance/", false],
  ["not a URL", false],
])("URL policy: %s is allowed=%s", (url, allowed) => {
  expect(
    isNativeWebUrlAllowed(
      url as string,
      parseAllowedHttpOrigins(["http://devbox.local:3000"]),
    ),
  ).toBe(allowed);
});

testCases.each([
  "http://*.local:3000",
  "https://devbox.local",
  "http://devbox.local/path",
  "http://devbox.local?query=1",
  "http://devbox.local#fragment",
  "http://user@devbox.local",
  "garbage",
])("rejects malformed allowlist entry %s", (entry) => {
  expect(() => parseAllowedHttpOrigins([entry])).toThrow();
});

it("clamps CSS geometry to the host surface with offset and zoom", () => {
  expect(
    nativeWebViewBounds(
      { x: -10, y: 10, width: 200, height: 200 },
      { x: 5, y: 25, width: 300, height: 200 },
      2,
    ),
  ).toEqual({ x: 5, y: 45, width: 300, height: 180 });
  expect(
    nativeWebViewBounds(
      { x: 900, y: 900, width: 100, height: 100 },
      { x: 0, y: 0, width: 300, height: 200 },
      1,
    ),
  ).toEqual({ x: 300, y: 200, width: 0, height: 0 });
});

it("rejects nonfinite or negative IPC geometry", () => {
  expect(
    nativeWebViewBoundsSchema.safeParse({
      id: crypto.randomUUID(),
      bounds: { x: 0, y: 0, width: Infinity, height: 1 },
    }).success,
  ).toBe(false);
  expect(
    nativeWebViewBoundsSchema.safeParse({
      id: crypto.randomUUID(),
      bounds: { x: 0, y: 0, width: -1, height: 1 },
    }).success,
  ).toBe(false);
});
