import { Unicode11Addon } from "@xterm/addon-unicode11";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test as testCases, vi } from "vitest";

const xterm = vi.hoisted(() => ({
  addons: [] as unknown[],
  binary: undefined as ((data: string) => void) | undefined,
  initialOptions: [] as Record<string, unknown>[],
  data: undefined as ((data: string) => void) | undefined,
  dispose: vi.fn(),
  transformInput: undefined as
    | ((event: import("./react").XtermInputEvent) => string)
    | undefined,
  disposeInputTransform: vi.fn(),
  keyEvent: undefined as ((event: KeyboardEvent) => boolean) | undefined,
  fit: vi.fn(),
  focus: vi.fn(),
  input: vi.fn(),
  open: vi.fn(),
  options: [] as Record<string, unknown>[],
  reset: vi.fn(),
  resize: undefined as
    | ((size: { cols: number; rows: number }) => void)
    | undefined,
  write: vi.fn(),
  unicode: { activeVersion: "6", register: vi.fn() },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = xterm.fit;
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    dispose = vi.fn();
    onContextLoss = () => ({ dispose: vi.fn() });
  },
}));
vi.mock("@overmux/xterm-fork", () => ({
  Terminal: class {
    cols = 80;
    options: Record<string, unknown>;
    rows = 24;
    textarea = document.createElement("textarea");
    unicode = xterm.unicode;
    constructor(options: Record<string, unknown>) {
      xterm.initialOptions.push({ ...options });
      this.options = options;
      xterm.options.push(options);
    }
    attachInputTransform = (
      handler: NonNullable<typeof xterm.transformInput>,
    ) => {
      xterm.transformInput = handler;
      return { dispose: xterm.disposeInputTransform };
    };
    attachCustomKeyEventHandler = (
      handler: (event: KeyboardEvent) => boolean,
    ) => {
      xterm.keyEvent = handler;
    };
    dispose = xterm.dispose;
    focus = xterm.focus;
    input = (data: string, wasUserInput?: boolean) => {
      xterm.input(data, wasUserInput);
      xterm.data?.(data);
    };
    loadAddon = (addon: { activate?: (terminal: unknown) => void }) => {
      xterm.addons.push(addon);
      addon.activate?.(this);
    };
    onBinary = (listener: (data: string) => void) => {
      xterm.binary = listener;
      return { dispose: vi.fn() };
    };
    onData = (listener: (data: string) => void) => {
      xterm.data = listener;
      return { dispose: vi.fn() };
    };
    onResize = (listener: (size: { cols: number; rows: number }) => void) => {
      xterm.resize = listener;
      return { dispose: vi.fn() };
    };
    open = xterm.open;
    registerLinkProvider = vi.fn(() => ({ dispose: vi.fn() }));
    reset = xterm.reset;
    write = xterm.write;
  },
}));

import { defaultLinkHandler } from "./client";
import { XtermTerminal, type XtermTerminalHandle } from "./react";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  xterm.addons.length = 0;
  xterm.binary = undefined;
  xterm.data = undefined;
  xterm.dispose.mockReset();
  xterm.transformInput = undefined;
  xterm.disposeInputTransform.mockReset();
  xterm.fit.mockReset();
  xterm.focus.mockReset();
  xterm.input.mockReset();
  xterm.initialOptions.length = 0;
  xterm.keyEvent = undefined;
  xterm.open.mockReset();
  xterm.options.length = 0;
  xterm.reset.mockReset();
  xterm.resize = undefined;
  xterm.write.mockReset();
  xterm.unicode.activeVersion = "6";
  xterm.unicode.register.mockReset();
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

testCases("exposes the styled wrapper through a separate DOM ref", async () => {
  const containerRef = createRef<HTMLDivElement>();
  const ref = createRef<XtermTerminalHandle>();
  await act(async () =>
    root.render(
      <XtermTerminal
        className="terminal"
        containerRef={containerRef}
        ref={ref}
        style={{ minWidth: 0 }}
      />,
    ),
  );
  const wrapper = container.querySelector("[data-om-xterm-terminal]");
  expect(containerRef.current).toBe(wrapper);
  expect(wrapper?.className).toBe("terminal");
  expect(containerRef.current?.style.minWidth).toBe("0");
  expect(xterm.open).toHaveBeenCalledWith(wrapper?.firstElementChild);
  expect(ref.current?.fit).toEqual(expect.any(Function));

  const nextContainerRef = vi.fn();
  await act(async () =>
    root.render(<XtermTerminal containerRef={nextContainerRef} ref={ref} />),
  );
  expect(containerRef.current).toBeNull();
  expect(nextContainerRef).toHaveBeenCalledWith(wrapper);
  expect(xterm.open).toHaveBeenCalledOnce();

  await act(async () => root.unmount());
  root = createRoot(container);
  expect(nextContainerRef.mock.lastCall?.[0]).toBeNull();
  expect(ref.current).toBeNull();
});

testCases("constructs with init and native mutable options", async () => {
  await act(async () =>
    root.render(
      <XtermTerminal
        initOptions={{ cols: 90 }}
        options={{ fontFamily: "Hack", theme: { background: "#000" } }}
      />,
    ),
  );
  expect(xterm.options[0]).toMatchObject({ cols: 90, fontFamily: "Hack" });
  expect(xterm.options[0]?.allowProposedApi).toBe(true);
  expect(xterm.options[0]?.linkHandler).toBe(defaultLinkHandler);
  expect(xterm.addons).toHaveLength(3);
  expect(xterm.open).toHaveBeenCalledOnce();
});

testCases.each([undefined, false, true])(
  "sets wide emoji widths before font loading, preserving allowProposedApi=%s",
  async (allowProposedApi) => {
    vi.mocked(document.fonts.load).mockReturnValue(new Promise(() => {}));
    const ref = createRef<XtermTerminalHandle>();
    await act(async () =>
      root.render(
        <XtermTerminal
          options={{ allowProposedApi, fontFamily: "Hack" }}
          ref={ref}
        />,
      ),
    );

    ref.current?.write("🐙A🐙🚀");

    expect(xterm.open).not.toHaveBeenCalled();
    expect(xterm.unicode.activeVersion).toBe("11");
    const provider = xterm.unicode.register.mock.lastCall?.[0];
    expect(provider.version).toBe("11");
    expect(provider.wcwidth("🐙".codePointAt(0))).toBe(2);
    expect(provider.wcwidth("🚀".codePointAt(0))).toBe(2);
    expect(xterm.initialOptions[0]?.allowProposedApi).toBe(true);
    expect(xterm.options[0]?.allowProposedApi).toBe(allowProposedApi ?? true);
    expect(xterm.write).toHaveBeenCalledWith("🐙A🐙🚀", undefined);
  },
);

testCases.each(["6", "11"] as const)(
  "uses Unicode %s only at initialization and does not forward it to xterm",
  async (unicodeActiveVersion) => {
    const initOptions = Object.freeze({ unicodeActiveVersion });
    await act(async () =>
      root.render(
        <XtermTerminal
          initOptions={initOptions}
          options={{ allowProposedApi: false }}
        />,
      ),
    );

    expect(xterm.unicode.activeVersion).toBe(unicodeActiveVersion);
    expect(xterm.unicode.register).toHaveBeenCalledOnce();
    expect(xterm.unicode.register.mock.lastCall?.[0].version).toBe("11");
    expect(xterm.options[0]?.allowProposedApi).toBe(false);
    expect(xterm.initialOptions[0]).not.toHaveProperty("unicodeActiveVersion");
    expect(xterm.options[0]).not.toHaveProperty("unicodeActiveVersion");

    await act(async () =>
      root.render(
        <XtermTerminal
          initOptions={{
            unicodeActiveVersion: unicodeActiveVersion === "6" ? "11" : "6",
          }}
          options={{ allowProposedApi: true, fontSize: 18 }}
        />,
      ),
    );

    expect(xterm.unicode.activeVersion).toBe(unicodeActiveVersion);
    expect(xterm.options).toHaveLength(1);
    expect(xterm.options[0]).toMatchObject({
      allowProposedApi: true,
      fontSize: 18,
    });
    expect(xterm.options[0]).not.toHaveProperty("unicodeActiveVersion");
    expect(initOptions).toEqual({ unicodeActiveVersion });
  },
);

testCases.each([
  { name: "custom handler", linkHandler: { activate: vi.fn() } },
  { name: "native behavior", linkHandler: null },
])("honors $name on creation and update", async ({ linkHandler }) => {
  const options = Object.freeze({ linkHandler });
  await act(async () => root.render(<XtermTerminal options={options} />));
  expect(xterm.initialOptions[0]?.linkHandler).toBe(linkHandler);

  await act(async () =>
    root.render(
      <XtermTerminal options={{ linkHandler: defaultLinkHandler }} />,
    ),
  );
  expect(xterm.options[0]?.linkHandler).toBe(defaultLinkHandler);

  await act(async () => root.render(<XtermTerminal options={options} />));
  expect(xterm.options).toHaveLength(1);
  expect(xterm.options[0]?.linkHandler).toBe(linkHandler);
  expect(options).toEqual({ linkHandler });
});

testCases(
  "updates mutable options without recreating the terminal",
  async () => {
    await act(async () =>
      root.render(
        <XtermTerminal
          options={{ fontFamily: "Hack", allowProposedApi: false }}
        />,
      ),
    );
    await act(async () =>
      root.render(
        <XtermTerminal options={{ fontFamily: "Mono", scrollback: 200 }} />,
      ),
    );
    expect(xterm.options).toHaveLength(1);
    expect(xterm.options[0]).toMatchObject({
      fontFamily: "Mono",
      scrollback: 200,
      allowProposedApi: false,
    });
  },
);

testCases(
  "ignores later init options without recreating the terminal",
  async () => {
    await act(async () =>
      root.render(<XtermTerminal initOptions={{ cols: 90 }} />),
    );
    await act(async () =>
      root.render(
        <XtermTerminal
          initOptions={{ cols: 120 }}
          options={{ scrollback: 200 }}
        />,
      ),
    );
    expect(xterm.options).toHaveLength(1);
    expect(xterm.options[0]).toMatchObject({ cols: 90, scrollback: 200 });
  },
);

testCases(
  "loads custom addons once and delegates its imperative handle",
  async () => {
    const addon = { activate: vi.fn(), dispose: vi.fn() };
    const createAddons = vi.fn(() => {
      expect(xterm.open).toHaveBeenCalledOnce();
      return [addon];
    });
    const ref = createRef<XtermTerminalHandle>();
    await act(async () =>
      root.render(<XtermTerminal createAddons={createAddons} ref={ref} />),
    );
    ref.current?.write("hello");
    ref.current?.fit();
    ref.current?.focus();
    ref.current?.input("toolbar input", false);
    ref.current?.reset();
    expect(createAddons).toHaveBeenCalledOnce();
    expect(xterm.addons).toEqual([
      expect.any(Unicode11Addon),
      expect.objectContaining({ fit: xterm.fit }),
      addon,
      expect.objectContaining({
        activate: expect.any(Function),
        dispose: expect.any(Function),
      }),
    ]);
    expect(xterm.write).toHaveBeenCalledWith("hello", undefined);
    expect(xterm.fit).toHaveBeenCalled();
    expect(xterm.focus).toHaveBeenCalledOnce();
    expect(xterm.input).toHaveBeenCalledWith("toolbar input", false);
    expect(xterm.reset).toHaveBeenCalledOnce();
  },
);

testCases(
  "maps custom keys to terminal data before caller key handling",
  async () => {
    const onData = vi.fn();
    const onKeyEvent = vi.fn(() => true);
    await act(async () =>
      root.render(
        <XtermTerminal
          keyMappings={[["Alt+ArrowLeft", "\u001b[1;3D"]]}
          onData={onData}
          onKeyEvent={onKeyEvent}
        />,
      ),
    );
    expect(
      xterm.keyEvent?.({
        altKey: true,
        ctrlKey: false,
        key: "ArrowLeft",
        metaKey: false,
        preventDefault: vi.fn(),
        shiftKey: false,
        type: "keydown",
      } as unknown as KeyboardEvent),
    ).toBe(false);
    expect(onData).toHaveBeenCalledWith("\u001b[1;3D");
    expect(onKeyEvent).not.toHaveBeenCalled();
    expect(
      xterm.keyEvent?.({
        altKey: false,
        ctrlKey: false,
        key: "ArrowLeft",
        metaKey: false,
        shiftKey: false,
      } as unknown as KeyboardEvent),
    ).toBe(true);
    expect(onKeyEvent).toHaveBeenCalledOnce();
  },
);

testCases(
  "uses the latest input transform without recreating xterm and detaches it",
  async () => {
    const first = vi.fn(() => "\u0003");
    const second = vi.fn(() => "\u001bc");
    const event = { kind: "text", data: "c" } as const;
    await act(async () =>
      root.render(<XtermTerminal transformInput={first} />),
    );
    const handler = xterm.transformInput;
    expect(handler?.(event)).toBe("\u0003");
    await act(async () =>
      root.render(<XtermTerminal transformInput={second} />),
    );
    expect(xterm.transformInput).toBe(handler);
    expect(handler?.(event)).toBe("\u001bc");
    expect(first).toHaveBeenCalledOnce();
    await act(async () => root.render(<XtermTerminal />));
    expect(handler?.(event)).toBe("c");
    expect(xterm.open).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(xterm.disposeInputTransform).toHaveBeenCalledOnce();
  },
);

testCases("reports the initial fitted size when it remains 80x24", async () => {
  const onResize = vi.fn();

  await act(async () => root.render(<XtermTerminal onResize={onResize} />));

  expect(xterm.fit).toHaveBeenCalled();
  expect(onResize).toHaveBeenCalledWith({ cols: 80, rows: 24 });
});

testCases("wires terminal events and disposes the instance", async () => {
  const onBinary = vi.fn();
  const onData = vi.fn();
  const onResize = vi.fn();
  await act(async () =>
    root.render(
      <XtermTerminal onBinary={onBinary} onData={onData} onResize={onResize} />,
    ),
  );
  xterm.binary?.("binary");
  xterm.data?.("data");
  xterm.resize?.({ cols: 120, rows: 40 });
  expect(onBinary).toHaveBeenCalledWith("binary");
  expect(onData).toHaveBeenCalledWith("data");
  expect(onResize).toHaveBeenCalledWith({ cols: 120, rows: 40 });
  await act(async () => root.unmount());
  root = createRoot(container);
  expect(xterm.dispose).toHaveBeenCalledOnce();
});
