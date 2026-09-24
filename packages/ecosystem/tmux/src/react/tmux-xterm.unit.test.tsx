import {
  act,
  createRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type {
  XtermTerminalHandle,
  XtermTerminalProps,
} from "@overmux/xterm/react";
import { Terminal } from "@overmux/xterm-fork";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test as testCases, vi } from "vitest";

const xterm = vi.hoisted(() => ({
  cancelPendingInput: vi.fn(),
  fit: vi.fn(),
  focus: vi.fn(),
  reset: vi.fn(),
  input: vi.fn(),
  props: undefined as XtermTerminalProps | undefined,
  write: vi.fn((_bytes: string | Uint8Array, _done?: () => void): void => {}),
}));
vi.mock("overmux/client", () => ({ useShortcutInputTarget: vi.fn() }));
vi.mock("@overmux/xterm/react", () => ({
  XtermTerminal: (props: XtermTerminalProps) => {
    xterm.props = props;
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const ready = useRef(false);
    useImperativeHandle(props.ref, () => ({
      fit: xterm.fit,
      focus: xterm.focus,
      input: xterm.input,
      reset: xterm.reset,
      write: (bytes: string | Uint8Array, done?: () => void) => {
        if (ready.current) {
          xterm.write(bytes, done);
        }
      },
    }));
    // Match the real xterm lifecycle: its imperative handle exists before its passive
    // effect creates the terminal. Writes before that effect would silently disappear.
    useEffect(() => {
      ready.current = true;
      const rawTerminal = new Terminal();
      vi.spyOn(rawTerminal, "cancelPendingInput").mockImplementation(
        xterm.cancelPendingInput,
      );
      props.createAddons?.().forEach((addon) => rawTerminal.loadAddon(addon));
      props.onInputChange?.(inputRef.current);
      return () => {
        rawTerminal.dispose();
        ready.current = false;
        props.onInputChange?.(null);
      };
    }, []);
    return (
      <div data-xterm ref={props.containerRef}>
        <textarea ref={inputRef} />
      </div>
    );
  },
}));

import { useShortcutInputTarget } from "overmux/client";
import type { TmuxTerminalServerMessage } from "../shared/terminal-contracts";
import {
  TmuxXterm,
  useTmuxTerminal,
  type TmuxTerminalConnection,
  type TmuxXtermProps,
  type UseTmuxTerminalResult,
} from "./index";

let container: HTMLDivElement;
let root: Root;
let terminal: UseTmuxTerminalResult;
let listener: ((message: TmuxTerminalServerMessage) => void) | undefined;
const stream = {
  connectionId: Symbol(),
  close: vi.fn(),
  send: vi.fn(() => true),
  status: "open" as const,
  subscribe: vi.fn((next) => {
    listener = next;
    return () => {
      listener = undefined;
    };
  }),
};
const location = { sessionId: "$1", windowId: "@2", paneId: "%3" };

type HarnessProps = Omit<TmuxXtermProps, "terminal"> & {
  connection?: TmuxTerminalConnection;
  visible?: boolean;
  beforeRenderer?: () => void;
  onError?: (error: Error) => void;
};
const Harness = ({
  connection = stream,
  visible = true,
  beforeRenderer,
  onError,
  ...props
}: HarnessProps) => {
  terminal = useTmuxTerminal({
    stream: connection,
    onError,
  });
  useLayoutEffect(() => beforeRenderer?.(), [beforeRenderer]);
  return visible ? <TmuxXterm {...props} terminal={terminal} /> : null;
};

beforeEach(() => {
  vi.mocked(useShortcutInputTarget).mockClear();
  xterm.cancelPendingInput.mockReset();
  xterm.fit.mockReset();
  xterm.focus.mockReset();
  xterm.reset.mockReset();
  xterm.input.mockReset();
  xterm.props = undefined;
  xterm.write.mockReset();
  stream.close.mockReset();
  stream.send.mockReset().mockReturnValue(true);
  stream.subscribe.mockClear();
  listener = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

testCases(
  "renders only xterm with pass-through props and imperative ref",
  async () => {
    const ref = createRef<XtermTerminalHandle>();
    const props = {
      className: "custom-terminal",
      initOptions: { cols: 100, unicodeActiveVersion: "6" },
      style: { minWidth: 0 },
      options: { scrollback: 1_000, theme: { background: "#000" } },
      ref,
    } satisfies HarnessProps;
    await act(async () => root.render(<Harness {...props} />));
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(
      container.querySelector("[data-xterm]"),
    );
    expect(xterm.props).toMatchObject({
      className: "custom-terminal",
      initOptions: { cols: 100, unicodeActiveVersion: "6" },
      style: { minWidth: 0 },
      options: { scrollback: 1_000, theme: { background: "#000" } },
    });
    xterm.fit.mockClear();
    xterm.focus.mockClear();
    xterm.reset.mockClear();
    const onProcessed = vi.fn();
    ref.current?.fit();
    ref.current?.focus();
    ref.current?.reset();
    ref.current?.write("output", onProcessed);
    ref.current?.input("manual input", false);
    expect(xterm.fit).toHaveBeenCalledOnce();
    expect(xterm.focus).toHaveBeenCalledOnce();
    expect(xterm.reset).toHaveBeenCalledOnce();
    expect(xterm.write).toHaveBeenCalledWith("output", onProcessed);
    expect(xterm.input).toHaveBeenCalledWith("manual input", false);
  },
);

testCases(
  "navigation cancels through the internal addon before sending and preserves caller addons",
  async () => {
    const disposeAddon = vi.fn();
    const addon = { activate: vi.fn(), dispose: disposeAddon };
    const transformInput = vi.fn((event) => event.data);
    await act(async () =>
      root.render(
        <Harness
          createAddons={() => [addon]}
          transformInput={transformInput}
        />,
      ),
    );
    const input = container.querySelector("textarea");
    expect(addon.activate).toHaveBeenCalledOnce();
    expect(xterm.props?.transformInput).toBe(transformInput);
    stream.send.mockImplementation(() => {
      expect(xterm.cancelPendingInput).toHaveBeenCalledOnce();
      return true;
    });
    await act(async () => {
      const request = terminal.goTo(location);
      listener?.({
        type: "go-to-result",
        requestId: 0,
        result: { outcome: "success", location, revision: 1 },
      });
      await request;
    });
    expect(container.querySelector("textarea")).toBe(input);
    stream.send.mockReset().mockReturnValue(true);
    await act(async () => root.render(<Harness visible={false} />));
    expect(disposeAddon).toHaveBeenCalledOnce();
    xterm.cancelPendingInput.mockClear();
    await act(async () =>
      listener?.({
        type: "location-changed",
        location: { ...location, paneId: "%4" },
        revision: 2,
      }),
    );
    expect(xterm.cancelPendingInput).not.toHaveBeenCalled();
  },
);

testCases.each([
  { name: "omitted options", options: undefined },
  { name: "empty options", options: {} },
  { name: "unrelated options", options: { fontSize: 16 } },
])("defaults local scrollback to zero with $name", async ({ options }) => {
  await act(async () => root.render(<Harness options={options} />));
  expect(xterm.props?.options).toEqual({ scrollback: 0, ...options });
});

testCases.each([true, false])(
  "forwards callbacks and gates input with active=%s",
  async (active) => {
    const onData = vi.fn();
    const onBinary = vi.fn();
    const onResize = vi.fn();
    await act(async () =>
      root.render(
        <Harness
          active={active}
          onData={onData}
          onBinary={onBinary}
          onResize={onResize}
        />,
      ),
    );
    stream.send.mockClear();
    xterm.props?.onData?.("ls\r");
    xterm.props?.onBinary?.("\u0000\u0080\u00ff");
    xterm.props?.onResize?.({ cols: 120, rows: 40 });
    expect(onData).toHaveBeenCalledWith("ls\r");
    expect(onBinary).toHaveBeenCalledWith("\u0000\u0080\u00ff");
    expect(onResize).toHaveBeenCalledWith({ cols: 120, rows: 40 });
    expect(stream.send.mock.calls).toEqual([
      ...(active
        ? [
            [{ data: "ls\r", type: "input" }],
            [{ data: Uint8Array.from([0, 128, 255]), type: "input" }],
          ]
        : []),
      [{ cols: 120, rows: 40, type: "resize" }],
    ]);
  },
);

testCases(
  "leaves errors and close UI to the app and connection disposal to the hook",
  async () => {
    const error = new Error("Connection lost");
    const onError = vi.fn();
    const connection = { ...stream, error };
    await act(async () =>
      root.render(<Harness connection={connection} onError={onError} />),
    );
    expect(container.querySelector("button, [role='alert']")).toBeNull();
    expect(container.textContent).not.toContain(error.message);
    expect(onError).toHaveBeenCalledWith(error);
    expect(terminal.error).toBe(error);
    expect(stream.close).not.toHaveBeenCalled();

    await act(async () =>
      root.render(
        <Harness connection={connection} visible={false} onError={onError} />,
      ),
    );
    expect(stream.close).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(stream.close).toHaveBeenCalledOnce();
  },
);

testCases(
  "registers the xterm wrapper and input for shortcuts until unmount",
  async () => {
    const onInputChange = vi.fn();
    await act(async () =>
      root.render(<Harness onInputChange={onInputChange} />),
    );
    const target = vi.mocked(useShortcutInputTarget).mock.lastCall?.[0];
    const input = container.querySelector("textarea");
    expect(target?.container.current).toBe(container.firstElementChild);
    expect(target?.input.current).toBe(input);
    expect(target?.container.current?.contains(input)).toBe(true);
    expect(onInputChange).toHaveBeenCalledWith(input);

    await act(async () =>
      root.render(<Harness visible={false} onInputChange={onInputChange} />),
    );
    expect(target?.container.current).toBeNull();
    expect(target?.input.current).toBeNull();
    expect(onInputChange).toHaveBeenLastCalledWith(null);
  },
);

testCases(
  "focuses on activation and confirmed session changes without treating location as output",
  async () => {
    await act(async () => root.render(<Harness active={false} />));
    expect(xterm.focus).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness />));
    expect(xterm.focus).toHaveBeenCalledOnce();
    stream.send.mockClear();
    await act(async () =>
      listener?.({ type: "location-changed", location, revision: 0 }),
    );
    expect(xterm.focus).toHaveBeenCalledTimes(2);
    expect(terminal.location).toEqual(location);
    expect(stream.send).not.toHaveBeenCalled();
    expect(xterm.write).not.toHaveBeenCalled();
  },
);

testCases("fits xterm when the stream opens", async () => {
  const openingStream = { ...stream, status: "opening" as const };
  await act(async () => root.render(<Harness connection={openingStream} />));
  expect(xterm.fit).not.toHaveBeenCalled();
  await act(async () =>
    root.render(<Harness connection={{ ...openingStream, status: "open" }} />),
  );
  expect(xterm.fit).toHaveBeenCalledOnce();
});

testCases(
  "flushes pre-effect output only after xterm is ready and retains navigation across renderer remount",
  async () => {
    const beforeRenderer = () =>
      listener?.({
        type: "data",
        bytes: Uint8Array.of(42),
        terminalId: "terminal-1",
        sequence: 0,
      });
    await act(async () =>
      root.render(<Harness beforeRenderer={beforeRenderer} />),
    );
    expect(xterm.write).toHaveBeenCalledOnce();
    const lateCallback = xterm.write.mock.calls[0]![1];
    const navigation = terminal.goTo({ sessionId: "$1", windowId: "@2" });
    await act(async () =>
      listener?.({
        type: "go-to-result",
        requestId: 0,
        result: { outcome: "success", location, revision: 0 },
      }),
    );
    await expect(navigation).resolves.toEqual(location);

    await act(async () => root.render(<Harness visible={false} />));
    expect(terminal.location).toEqual(location);
    expect(stream.close).not.toHaveBeenCalled();
    listener?.({
      type: "data",
      bytes: Uint8Array.of(43),
      terminalId: "terminal-1",
      sequence: 1,
    });
    stream.send.mockClear();
    xterm.fit.mockImplementation(() =>
      terminal.resize({ cols: 100, rows: 35 }),
    );
    await act(async () => root.render(<Harness />));
    expect(stream.send.mock.calls).toEqual([
      [{ type: "resize", cols: 100, rows: 35 }],
      [{ type: "redraw" }],
    ]);
    expect(xterm.write).toHaveBeenCalledTimes(2);
    lateCallback?.();
    expect(stream.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "rendered" }),
    );
    xterm.write.mock.calls[1]![1]?.();
    expect(stream.send).toHaveBeenCalledWith({
      type: "rendered",
      terminalId: "terminal-1",
      sequence: 1,
    });
    expect(terminal.location).toEqual(location);
  },
);
