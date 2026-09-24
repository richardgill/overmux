// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test as testCases, vi } from "vitest";

const ghostty = vi.hoisted(() => ({
  data: undefined as ((data: string) => void) | undefined,
  dispose: vi.fn(),
  fit: vi.fn(),
  focus: vi.fn(),
  load: vi.fn((wasmUrl?: string) => Promise.resolve({ wasmUrl })),
  input: vi.fn(),
  inputElement: document.createElement("textarea"),
  keyEvent: undefined as ((event: KeyboardEvent) => boolean) | undefined,
  onResize: undefined as
    | ((size: { cols: number; rows: number }) => void)
    | undefined,
  onTitleChange: undefined as ((title: string) => void) | undefined,
  open: vi.fn(),
  options: [] as Record<string, unknown>[],
  render: vi.fn(),
  reset: vi.fn(),
  write: vi.fn(),
}));

vi.mock("ghostty-web", () => ({
  FitAddon: class {
    fit = ghostty.fit;
    observeResize = vi.fn();
  },
  Terminal: class {
    cols = 80;
    renderer = { render: ghostty.render };
    rows = 24;
    textarea = ghostty.inputElement;
    viewportY = 0;
    wasmTerm = {};
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      ghostty.options.push(options);
    }
    attachCustomKeyEventHandler = (
      handler: (event: KeyboardEvent) => boolean,
    ) => {
      ghostty.keyEvent = handler;
    };
    dispose = ghostty.dispose;
    focus = ghostty.focus;
    input = (data: string, wasUserInput = false) => {
      ghostty.input(data, wasUserInput);
      if (wasUserInput) {
        ghostty.data?.(data);
      }
    };
    loadAddon = vi.fn();
    onData = (listener: (data: string) => void) => {
      ghostty.data = listener;
      return { dispose: vi.fn() };
    };
    onResize = (listener: (size: { cols: number; rows: number }) => void) => {
      ghostty.onResize = listener;
      return { dispose: vi.fn() };
    };
    onTitleChange = (listener: (title: string) => void) => {
      ghostty.onTitleChange = listener;
      return { dispose: vi.fn() };
    };
    open = ghostty.open;
    reset = ghostty.reset;
    write = ghostty.write;
  },
  Ghostty: { load: ghostty.load },
}));

import { GhosttyTerminal, type GhosttyTerminalHandle } from "./index";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  ghostty.data = undefined;
  ghostty.dispose.mockReset();
  ghostty.fit.mockReset();
  ghostty.focus.mockReset();
  ghostty.load.mockClear();
  ghostty.input.mockReset();
  ghostty.keyEvent = undefined;
  ghostty.onResize = undefined;
  ghostty.onTitleChange = undefined;
  ghostty.open.mockReset();
  ghostty.options.length = 0;
  ghostty.render.mockReset();
  ghostty.reset.mockReset();
  ghostty.write.mockReset();
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn().mockResolvedValue([]) },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

testCases(
  "initializes WASM, fits, and exposes terminal lifecycle callbacks",
  async () => {
    const onInput = vi.fn();
    const onInputElementChange = vi.fn();
    const onReady = vi.fn();
    const onResize = vi.fn();
    const onTitleChange = vi.fn();
    const containerRef = createRef<HTMLDivElement>();
    const ref = createRef<GhosttyTerminalHandle>();

    await act(async () =>
      root.render(
        <GhosttyTerminal
          containerRef={containerRef}
          onInput={onInput}
          onInputElementChange={onInputElementChange}
          onReady={onReady}
          onResize={onResize}
          onTitleChange={onTitleChange}
          options={{ fontFamily: "Mono", scrollback: 1_000 }}
          ref={ref}
          wasmUrl="/assets/ghostty-vt.wasm"
        />,
      ),
    );

    ghostty.data?.("ls\r");
    ghostty.onResize?.({ cols: 80, rows: 24 });
    ghostty.onTitleChange?.("shell");
    ref.current?.write(new Uint8Array([0, 255]));
    ref.current?.input("manual");
    ref.current?.fit();
    ref.current?.focus();
    ref.current?.reset();

    expect(containerRef.current).toBe(container.firstElementChild);
    expect(ghostty.load).toHaveBeenCalledWith("/assets/ghostty-vt.wasm");
    expect(ghostty.open).toHaveBeenCalledOnce();
    expect(ghostty.fit).toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledOnce();
    expect(onInputElementChange).toHaveBeenCalledWith(ghostty.inputElement);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith({ cols: 80, rows: 24 });
    expect(onInput).toHaveBeenCalledWith("ls\r");
    expect(onInput).toHaveBeenCalledWith("manual");
    expect(onTitleChange).toHaveBeenCalledWith("shell");
    expect(ghostty.write).toHaveBeenCalledWith(
      Uint8Array.from([0, 255]),
      undefined,
    );
    expect(ghostty.input).toHaveBeenCalledWith("manual", true);
    expect(ghostty.focus).toHaveBeenCalledOnce();
    expect(ghostty.reset).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    root = createRoot(container);
    expect(onInputElementChange).toHaveBeenLastCalledWith(null);
    expect(ghostty.dispose).toHaveBeenCalledOnce();
  },
);

testCases(
  "loads an isolated runtime for each terminal and supports the default URL",
  async () => {
    await act(async () =>
      root.render(
        <>
          <GhosttyTerminal />
          <GhosttyTerminal wasmUrl="/custom.wasm" />
        </>,
      ),
    );

    expect(ghostty.load).toHaveBeenNthCalledWith(1, undefined);
    expect(ghostty.load).toHaveBeenNthCalledWith(2, "/custom.wasm");
    expect(ghostty.options[0]?.ghostty).not.toBe(ghostty.options[1]?.ghostty);
  },
);

testCases("renders the first echoed write synchronously", async () => {
  const ref = createRef<GhosttyTerminalHandle>();
  await act(async () => root.render(<GhosttyTerminal ref={ref} />));

  ghostty.data?.("a");
  ref.current?.write("a");
  ref.current?.write("background output");

  expect(ghostty.render).toHaveBeenCalledOnce();
  expect(ghostty.render).toHaveBeenCalledWith(
    expect.anything(),
    false,
    0,
    expect.anything(),
    1,
  );
});

testCases(
  "flushes pre-ready writes in order with their completion callbacks",
  async () => {
    let resolveRuntime: ((runtime: { wasmUrl?: string }) => void) | undefined;
    ghostty.load.mockImplementationOnce(
      (wasmUrl?: string) =>
        new Promise((resolve) => {
          resolveRuntime = () => resolve({ wasmUrl });
        }),
    );
    const ref = createRef<GhosttyTerminalHandle>();
    const firstProcessed = vi.fn();
    const secondProcessed = vi.fn();

    await act(async () => root.render(<GhosttyTerminal ref={ref} />));
    ref.current?.write("first", firstProcessed);
    ref.current?.write(Uint8Array.from([0, 255]), secondProcessed);
    expect(ghostty.write).not.toHaveBeenCalled();

    await act(async () => resolveRuntime?.({}));
    expect(ghostty.write).toHaveBeenNthCalledWith(1, "first", firstProcessed);
    expect(ghostty.write).toHaveBeenNthCalledWith(
      2,
      Uint8Array.from([0, 255]),
      secondProcessed,
    );
    (ghostty.write.mock.calls[0]?.[1] as () => void)();
    (ghostty.write.mock.calls[1]?.[1] as () => void)();
    expect(firstProcessed).toHaveBeenCalledOnce();
    expect(secondProcessed).toHaveBeenCalledOnce();
  },
);

testCases.each(["reset", "unmount"] as const)(
  "discards queued writes on %s before WASM becomes ready",
  async (action) => {
    let resolveRuntime: ((runtime: { wasmUrl?: string }) => void) | undefined;
    ghostty.load.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRuntime = () => resolve({ wasmUrl: undefined });
      }),
    );
    const ref = createRef<GhosttyTerminalHandle>();
    const onProcessed = vi.fn();
    const onReady = vi.fn();
    await act(async () =>
      root.render(<GhosttyTerminal onReady={onReady} ref={ref} />),
    );
    ref.current?.write("stale output", onProcessed);

    if (action === "reset") {
      ref.current?.reset();
    } else {
      await act(async () => root.render(null));
    }
    await act(async () => resolveRuntime?.({}));

    expect(ghostty.write).not.toHaveBeenCalled();
    expect(onProcessed).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(action === "reset" ? 1 : 0);
    expect(ghostty.open).toHaveBeenCalledTimes(action === "reset" ? 1 : 0);
  },
);

testCases(
  "reports failed initialization without acknowledging queued output",
  async () => {
    let rejectRuntime: ((error: Error) => void) | undefined;
    ghostty.load.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRuntime = reject;
      }),
    );
    const ref = createRef<GhosttyTerminalHandle>();
    const onError = vi.fn();
    const onProcessed = vi.fn();
    await act(async () =>
      root.render(<GhosttyTerminal onError={onError} ref={ref} />),
    );
    ref.current?.write("pending", onProcessed);
    const error = new Error("WASM unavailable");

    await act(async () => rejectRuntime?.(error));
    ref.current?.write("after failure", onProcessed);

    expect(onError).toHaveBeenCalledWith(error);
    expect(ghostty.write).not.toHaveBeenCalled();
    expect(onProcessed).not.toHaveBeenCalled();
  },
);

testCases("lets the caller reject Ghostty key handling", async () => {
  const event = { key: "Escape" } as KeyboardEvent;
  await act(async () => root.render(<GhosttyTerminal />));
  expect(ghostty.keyEvent?.(event)).toBe(false);

  const onKeyEvent = vi.fn(() => false);
  await act(async () =>
    root.render(<GhosttyTerminal onKeyEvent={onKeyEvent} />),
  );
  expect(ghostty.keyEvent?.(event)).toBe(true);
  expect(onKeyEvent).toHaveBeenCalledWith(event);
});
