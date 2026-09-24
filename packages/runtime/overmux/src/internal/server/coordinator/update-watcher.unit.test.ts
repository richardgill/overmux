import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  test as testCases,
  vi,
} from "vitest";

import { isRelevantUpdatePath, startUpdateWatcher } from "./update-watcher";

type WatchListener = (eventType: string, fileName: string | null) => void;

const fsMocks = vi.hoisted(() => ({
  close: vi.fn(),
  listener: undefined as WatchListener | undefined,
  watch: vi.fn(),
}));

vi.mock("node:fs", () => ({ watch: fsMocks.watch }));

beforeEach(() => {
  vi.useFakeTimers();
  fsMocks.watch.mockImplementation((...args: unknown[]) => {
    fsMocks.listener = args[2] as WatchListener;
    return { close: fsMocks.close };
  });
});

afterEach(() => vi.useRealTimers());

describe("update watcher", () => {
  testCases.each([
    "overmux.config.ts",
    "server.mts",
    "worker.cts",
    "ui/components/pane.tsx",
    "ui/components/helpers.jsx",
    "nested/settings.json",
    "styles/app.css",
  ])("watches application path %s", (path) => {
    expect(isRelevantUpdatePath(path)).toBe(true);
  });

  testCases.each([
    "node_modules/package/index.js",
    "C:\\app\\NODE_MODULES\\package\\index.mjs",
    "ui/image.png",
  ])("ignores generated or unrelated path %s", (path) => {
    expect(isRelevantUpdatePath(path)).toBe(false);
  });

  it("debounces relevant recursive changes", async () => {
    const onUpdate = vi.fn();
    const watcher = startUpdateWatcher({
      configPath: "/app/overmux.config.ts",
      onUpdate,
    });

    fsMocks.listener?.("change", "ui/pane.tsx");
    await vi.advanceTimersByTimeAsync(50);
    fsMocks.listener?.("change", "server.ts");
    await vi.advanceTimersByTimeAsync(100);

    expect(onUpdate).toHaveBeenCalledOnce();
    watcher.close();
  });
});
