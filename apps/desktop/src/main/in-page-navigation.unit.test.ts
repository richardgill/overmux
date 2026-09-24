import { runInNewContext } from "node:vm";
import { expect, it, test as testCases, vi } from "vitest";

import { navigateInPage } from "./in-page-navigation.js";

const createFrame = (url = "https://overmux.test/workspace") => ({
  url,
  detached: false,
  executeJavaScript: vi.fn(
    async (_code: string): Promise<unknown> => undefined,
  ),
});

it("delivers the exact route through pushState without synthetic events or document replacement", async () => {
  const frame = createFrame();
  const history = { state: { tab: "terminal" }, pushState: vi.fn() };
  const window = { dispatchEvent: vi.fn() };
  frame.executeJavaScript.mockImplementation(async (code) =>
    runInNewContext(code, {
      location: new URL(frame.url),
      history,
      window,
    }),
  );
  const destination =
    'https://overmux.test/tmux/%25647?quote=";throw%20Error()#';

  await navigateInPage(frame, destination);

  expect(history.pushState).toHaveBeenCalledExactlyOnceWith(
    history.state,
    "",
    destination,
  );
  expect(window.dispatchEvent).not.toHaveBeenCalled();
});

testCases.each([
  { name: "detached frame", detached: true, url: "https://overmux.test/" },
  { name: "foreign frame", detached: false, url: "https://foreign.test/" },
])("rejects a $name before sending the route", ({ detached, url }) => {
  const frame = { ...createFrame(url), detached };

  expect(() => navigateInPage(frame, "https://overmux.test/target")).toThrow(
    "Connection was replaced or closed.",
  );
  expect(frame.executeJavaScript).not.toHaveBeenCalled();
});

it("rejects a foreign origin at execution time before changing history", async () => {
  const frame = createFrame();
  frame.executeJavaScript.mockImplementation(async (code) =>
    runInNewContext(code, {
      location: new URL("https://foreign.test/"),
    }),
  );

  await expect(
    navigateInPage(frame, "https://overmux.test/target"),
  ).rejects.toThrow("Connection was replaced or closed.");
});
