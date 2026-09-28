import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { NativeWebViewBridge } from "./host/desktop-host";
import { NativeWebView } from "./native-web-view";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let tick: FrameRequestCallback;
let bounds = { x: 10, y: 20, width: 300, height: 200 };
let listener: Parameters<NativeWebViewBridge["onLoadError"]>[0];
const bridge: NativeWebViewBridge = {
  version: 1,
  command: vi.fn(async () => {}),
  setBounds: vi.fn(),
  onLoadError: vi.fn((callback) => {
    listener = callback;
    return vi.fn();
  }),
};
const render = async (element: React.ReactNode) => {
  await act(async () => root.render(element));
};

beforeEach(() => {
  vi.clearAllMocks();
  bounds = { x: 10, y: 20, width: 300, height: 200 };
  window.overmuxHost = { version: 1, platform: "linux", nativeWebView: bridge };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    tick = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => bounds as DOMRect,
  );
  Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
    configurable: true,
    value: () => true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.overmuxHost = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renders only the fallback without the desktop capability", async () => {
  window.overmuxHost = undefined;
  await render(
    <NativeWebView
      url="https://github.com"
      fallback={<a href="https://github.com">Open browser</a>}
    />,
  );
  expect(container.textContent).toBe("Open browser");
  expect(bridge.command).not.toHaveBeenCalled();
  await render(<NativeWebView url="https://github.com" />);
  expect(container.innerHTML).toBe("");
});

it("only sends changed URLs, policy and bounds; disposes without waiting for creation", async () => {
  vi.mocked(bridge.command).mockImplementationOnce(() => new Promise(() => {}));
  await render(
    <NativeWebView
      url="https://github.com"
      className="pane"
      style={{ height: 200 }}
      allowedHttpOrigins={["http://devbox.local:3000"]}
    />,
  );
  const create = vi.mocked(bridge.command).mock.calls[0]![0];
  expect(create.type).toBe("create");
  expect(container.querySelector(".pane")).not.toBeNull();
  expect(bridge.setBounds).toHaveBeenCalledExactlyOnceWith(create.id, bounds);
  tick(0);
  await render(
    <NativeWebView
      url="https://github.com"
      className="changed"
      allowedHttpOrigins={["http://devbox.local:3000"]}
    />,
  );
  expect(bridge.command).toHaveBeenCalledTimes(2);
  expect(bridge.setBounds).toHaveBeenCalledTimes(1);
  bounds = { ...bounds, y: 40 };
  tick(1);
  expect(bridge.setBounds).toHaveBeenLastCalledWith(create.id, bounds);
  bounds = { ...bounds, width: 0, height: 0 };
  tick(2);
  expect(bridge.setBounds).toHaveBeenLastCalledWith(create.id, bounds);
  await render(<NativeWebView url="https://github.com/login" />);
  expect(bridge.command).toHaveBeenLastCalledWith({
    type: "configure",
    id: create.id,
    url: "https://github.com/login",
    allowedHttpOrigins: [],
  });
  await render(null);
  expect(bridge.command).toHaveBeenLastCalledWith({
    type: "destroy",
    id: create.id,
  });
  expect(cancelAnimationFrame).toHaveBeenCalled();
});

it("reports bridge and navigation errors with the latest callback, never replacing the placeholder", async () => {
  const initial = vi.fn();
  const latest = vi.fn();
  await render(
    <NativeWebView
      url="https://github.com"
      fallback="fallback"
      onLoadError={initial}
    />,
  );
  const id = vi.mocked(bridge.command).mock.calls[0]![0].id;
  await render(
    <NativeWebView
      url="https://github.com"
      fallback="fallback"
      onLoadError={latest}
    />,
  );
  const error = {
    url: "https://github.com",
    code: "-105",
    message: "DNS failed",
  };
  listener({ id, error });
  await Promise.resolve();
  expect(initial).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledExactlyOnceWith(error);
  expect(container.textContent).toBe("");
  expect(container.children).toHaveLength(1);
  vi.mocked(bridge.command).mockRejectedValueOnce(new Error("Disconnected"));
  await render(
    <NativeWebView url="https://github.com/login" onLoadError={latest} />,
  );
  expect(latest).toHaveBeenLastCalledWith(
    expect.objectContaining({
      code: "ERR_DESKTOP_BRIDGE",
      url: "https://github.com/login",
    }),
  );
  await render(null);
  listener({ id, error });
  await Promise.resolve();
  expect(latest).toHaveBeenCalledTimes(2);
});

it("gives StrictMode remounts distinct ownership IDs", async () => {
  await render(
    <StrictMode>
      <NativeWebView url="https://github.com" />
    </StrictMode>,
  );
  const commands = vi
    .mocked(bridge.command)
    .mock.calls.map(([command]) => command);
  expect(commands.map(({ type }) => type)).toEqual([
    "create",
    "configure",
    "destroy",
    "create",
    "configure",
  ]);
  expect(commands[0]!.id).toBe(commands[2]!.id);
  expect(commands[3]!.id).not.toBe(commands[0]!.id);
});
