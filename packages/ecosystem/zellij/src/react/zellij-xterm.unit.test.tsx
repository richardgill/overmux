import {
  act,
  StrictMode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { XtermTerminalProps } from "@overmux/xterm/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test as testCases, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  props: undefined as XtermTerminalProps | undefined,
  shortcut: vi.fn(),
  focus: vi.fn(),
  write: vi.fn((_bytes: string | Uint8Array, _done?: () => void): void => {}),
}));
vi.mock("overmux/client", () => ({ useShortcutInputTarget: mocks.shortcut }));
vi.mock("@overmux/xterm/react", () => ({
  XtermTerminal: (props: XtermTerminalProps) => {
    mocks.props = props;
    const ready = useRef(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(props.ref, () => ({
      fit: vi.fn(),
      focus: mocks.focus,
      input: vi.fn(),
      reset: vi.fn(),
      write: (bytes: string | Uint8Array, done?: () => void) => {
        if (ready.current) {
          mocks.write(bytes, done);
        }
      },
    }));
    // Model xterm's passive initialization: pre-effect writes would lose their callbacks.
    useEffect(() => {
      ready.current = true;
      props.onInputChange?.(inputRef.current);
      return () => {
        ready.current = false;
        props.onInputChange?.(null);
      };
    }, []);
    return (
      <div
        data-xterm
        ref={props.containerRef}
        className={props.className}
        style={props.style}
      >
        <textarea ref={inputRef} />
      </div>
    );
  },
}));

import type { ZellijTerminalServerMessage } from "../shared/terminal-contracts";
import {
  ZellijXterm,
  useZellijTerminal,
  type UseZellijTerminalResult,
  type ZellijXtermProps,
} from "./index";

let container: HTMLDivElement;
let root: Root;
let terminal: UseZellijTerminalResult;
let listener: ((message: ZellijTerminalServerMessage) => void) | undefined;
const stream = {
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
const Harness = ({
  visible = true,
  beforeRenderer,
  error,
  ...props
}: {
  visible?: boolean;
  beforeRenderer?: () => void;
  error?: Error;
} & Omit<ZellijXtermProps, "terminal">) => {
  terminal = useZellijTerminal({ stream: { ...stream, error } });
  useLayoutEffect(() => beforeRenderer?.(), [beforeRenderer]);
  return visible ? <ZellijXterm {...props} terminal={terminal} /> : null;
};
const emit = (sequence: number) =>
  listener?.({
    type: "data",
    terminalId: "a",
    sequence,
    bytes: Uint8Array.of(sequence),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.props = undefined;
  listener = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

testCases.each([true, false])(
  "gates input with active=%s but retains callbacks, resizing, and shortcuts",
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
    mocks.props?.onData?.("text");
    mocks.props?.onBinary?.("\u0000\u0080\u00ff");
    mocks.props?.onResize?.({ cols: 120, rows: 40 });
    expect(onData).toHaveBeenCalledWith("text");
    expect(onBinary).toHaveBeenCalledWith("\u0000\u0080\u00ff");
    expect(onResize).toHaveBeenCalledWith({ cols: 120, rows: 40 });
    expect(stream.send.mock.calls).toEqual([
      ...(active
        ? [
            [{ data: "text", type: "input" }],
            [{ data: Uint8Array.of(0, 128, 255), type: "input" }],
          ]
        : []),
      [{ cols: 120, rows: 40, type: "resize" }],
    ]);
    expect(mocks.shortcut).toHaveBeenCalled();
    expect(mocks.focus).toHaveBeenCalledTimes(active ? 1 : 0);
  },
);

testCases.each([
  { name: "defaults", options: undefined, expected: { scrollback: 0 } },
  {
    name: "unrelated options",
    options: { fontSize: 16 },
    expected: { scrollback: 0, fontSize: 16 },
  },
  {
    name: "explicit override",
    options: { scrollback: 1_000 },
    expected: { scrollback: 1_000 },
  },
])("passes xterm options with $name", async ({ options, expected }) => {
  await act(async () =>
    root.render(<Harness options={options} className="custom" />),
  );
  expect(mocks.props).toMatchObject({ options: expected, className: "custom" });
});

testCases(
  "uses xterm's wrapper for styling and shortcut registration",
  async () => {
    const onInputChange = vi.fn();
    await act(async () =>
      root.render(
        <Harness
          className="custom"
          style={{ minWidth: 0 }}
          onInputChange={onInputChange}
        />,
      ),
    );
    const wrapper = container.querySelector<HTMLElement>("[data-xterm]");
    const input = container.querySelector("textarea");
    const target = mocks.shortcut.mock.lastCall?.[0];
    expect(container.firstElementChild).toBe(wrapper);
    expect(wrapper?.className).toBe("custom");
    expect(wrapper?.style.minWidth).toBe("0");
    expect(target?.container.current).toBe(wrapper);
    expect(target?.input.current).toBe(input);
    expect(onInputChange).toHaveBeenCalledWith(input);

    await act(async () =>
      root.render(<Harness visible={false} onInputChange={onInputChange} />),
    );
    expect(target?.container.current).toBeNull();
    expect(target?.input.current).toBeNull();
    expect(onInputChange).toHaveBeenLastCalledWith(null);
  },
);

testCases("leaves errors and close UI to the application", async () => {
  const error = new Error("attach failed");
  await act(async () => root.render(<Harness error={error} />));
  expect(terminal.error).toBe(error);
  expect(container.querySelector("button, [role='alert']")).toBeNull();
  expect(container.textContent).not.toContain(error.message);
});

testCases.each([false, true])(
  "remounts only the renderer with StrictMode=%s, without replaying the destroyed screen",
  async (strict) => {
    const beforeRenderer = () => emit(0);
    const render = (visible = true, before?: () => void) => {
      const view = <Harness visible={visible} beforeRenderer={before} />;
      root.render(strict ? <StrictMode>{view}</StrictMode> : view);
    };
    // First mount without output: StrictMode deliberately destroys the first xterm.
    await act(async () => render());
    await act(async () => render(false));
    await act(async () => render(true, beforeRenderer));
    expect(mocks.write).toHaveBeenCalledOnce();
    const stale = mocks.write.mock.calls[0]![1];
    await act(async () => render(false));
    emit(1);
    stream.send.mockClear();
    await act(async () => render());
    expect(mocks.write.mock.calls.map(([bytes]) => bytes)).toEqual([
      Uint8Array.of(0),
      Uint8Array.of(1),
    ]);
    expect(stream.subscribe).toHaveBeenCalledOnce();
    expect(stream.close).not.toHaveBeenCalled();
    stale?.();
    mocks.write.mock.calls[1]![1]?.();
    expect(stream.send).toHaveBeenCalledExactlyOnceWith({
      type: "rendered",
      terminalId: "a",
      sequence: 1,
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(stream.close).toHaveBeenCalledOnce();
  },
);
