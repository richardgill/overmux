import type { Terminal } from "@overmux/xterm-fork";
import { beforeEach, expect, test as testCases, vi } from "vitest";

const webgl = vi.hoisted(() => ({
  activate: vi.fn(),
  contextLoss: undefined as (() => void) | undefined,
  dispose: vi.fn(),
  disposeContextLoss: vi.fn(),
  fail: undefined as Error | undefined,
  load: vi.fn(),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      if (webgl.fail) {
        throw webgl.fail;
      }
    }
    activate = webgl.activate;
    dispose = webgl.dispose;
    onContextLoss = (listener: () => void) => {
      webgl.contextLoss = listener;
      return { dispose: webgl.disposeContextLoss };
    };
  },
}));

import { createSafeWebglAddon } from "./safe-webgl";

const terminal = { loadAddon: webgl.load } as unknown as Terminal;

beforeEach(() => {
  webgl.activate.mockReset();
  webgl.contextLoss = undefined;
  webgl.dispose.mockReset();
  webgl.disposeContextLoss.mockReset();
  webgl.fail = undefined;
  webgl.load.mockReset();
});

testCases("activates WebGL and reports it", () => {
  const onDiagnostic = vi.fn();

  createSafeWebglAddon({ onDiagnostic }).activate(terminal);

  expect(webgl.activate).toHaveBeenCalledWith(terminal);
  expect(webgl.load).not.toHaveBeenCalled();
  expect(onDiagnostic).toHaveBeenCalledWith({ status: "active" });
});

testCases("does not treat active diagnostics as WebGL failures", () => {
  const onDiagnostic = vi.fn(() => {
    throw new Error("diagnostic failed");
  });

  expect(() =>
    createSafeWebglAddon({ onDiagnostic }).activate(terminal),
  ).toThrow("diagnostic failed");

  expect(webgl.dispose).not.toHaveBeenCalled();
  expect(onDiagnostic).toHaveBeenCalledWith({ status: "active" });
});

testCases("falls back when WebGL initialization fails", () => {
  const onDiagnostic = vi.fn();
  webgl.fail = new Error("GPU unavailable");

  createSafeWebglAddon({ onDiagnostic }).activate(terminal);

  expect(webgl.activate).not.toHaveBeenCalled();
  expect(webgl.load).not.toHaveBeenCalled();
  expect(onDiagnostic).toHaveBeenCalledWith({
    message: "GPU unavailable",
    status: "fallback",
  });
});

testCases("disposes WebGL and reports fallback on context loss", () => {
  const onDiagnostic = vi.fn();
  createSafeWebglAddon({ onDiagnostic }).activate(terminal);

  webgl.contextLoss?.();

  expect(webgl.disposeContextLoss).toHaveBeenCalledOnce();
  expect(webgl.dispose).toHaveBeenCalledOnce();
  expect(onDiagnostic).toHaveBeenLastCalledWith({
    message: "WebGL context lost",
    status: "fallback",
  });
});

testCases("disposes its WebGL resources", () => {
  const addon = createSafeWebglAddon();
  addon.activate(terminal);

  addon.dispose();

  expect(webgl.disposeContextLoss).toHaveBeenCalledOnce();
  expect(webgl.dispose).toHaveBeenCalledOnce();
});
