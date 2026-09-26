// @vitest-environment happy-dom
import { act, createRef, useImperativeHandle } from "react";
import type { GhosttyTerminalProps } from "@overmux/ghostty/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test as testCases, vi } from "vitest";

const ghostty = vi.hoisted(() => ({
  fit: vi.fn(),
  focus: vi.fn(),
  input: vi.fn(),
  props: undefined as GhosttyTerminalProps | undefined,
  reset: vi.fn(),
  write: vi.fn(),
}));
vi.mock("overmux/client", () => ({ useShortcutInputTarget: vi.fn() }));
vi.mock("@overmux/ghostty/react", () => ({
  GhosttyTerminal: (props: GhosttyTerminalProps) => {
    ghostty.props = props;
    useImperativeHandle(props.ref, () => ({
      fit: ghostty.fit,
      focus: ghostty.focus,
      input: ghostty.input,
      reset: ghostty.reset,
      write: ghostty.write,
    }));
    return <div data-ghostty ref={props.containerRef} />;
  },
}));

import {
  TmuxGhostty,
  useTmuxTerminal,
  type TmuxGhosttyHandle,
  type TmuxGhosttyProps,
  type UseTmuxTerminalResult,
} from "./index";
import type { TmuxTerminalServerMessage } from "../shared/terminal-contracts";

let container: HTMLDivElement;
let listener: ((message: TmuxTerminalServerMessage) => void) | undefined;
let root: Root;
let terminal: UseTmuxTerminalResult;
const stream = {
  connectionId: Symbol(),
  close: vi.fn(),
  send: vi.fn(() => true),
  status: "open" as const,
  subscribe: vi.fn((next: (message: TmuxTerminalServerMessage) => void) => {
    listener = next;
    return () => {
      listener = undefined;
    };
  }),
};
const Harness = ({
  visible = true,
  ...props
}: Omit<TmuxGhosttyProps, "terminal"> & { visible?: boolean }) => {
  terminal = useTmuxTerminal({ stream });
  return visible ? <TmuxGhostty {...props} terminal={terminal} /> : null;
};

beforeEach(() => {
  vi.clearAllMocks();
  ghostty.props = undefined;
  stream.send.mockReturnValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

testCases(
  "composes Ghostty with current tmux input, output acknowledgement, and resize",
  async () => {
    const ref = createRef<TmuxGhosttyHandle>();
    await act(async () =>
      root.render(<Harness options={{ fontFamily: "Mono" }} ref={ref} />),
    );
    stream.send.mockClear();
    ghostty.props?.onInput?.("ls\r");
    ghostty.props?.onResize?.({ cols: 120, rows: 40 });
    ref.current?.input("manual input");
    ref.current?.input(new Uint8Array([0, 128, 255]));

    expect(stream.send.mock.calls).toEqual([
      [{ data: "ls\r", type: "input" }],
      [{ cols: 120, rows: 40, type: "resize" }],
      [{ data: "manual input", type: "input" }],
      [{ data: Uint8Array.from([0, 128, 255]), type: "input" }],
    ]);
    expect(ghostty.props?.options).toEqual({
      fontFamily: "Mono",
      scrollback: 0,
    });

    await act(async () =>
      listener?.({
        bytes: Uint8Array.from([27, 91, 72]),
        sequence: 0,
        terminalId: "terminal",
        type: "data",
      }),
    );
    expect(ghostty.write).toHaveBeenCalledWith(
      Uint8Array.from([27, 91, 72]),
      expect.any(Function),
    );
    expect(stream.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "rendered" }),
    );
    const acknowledge = ghostty.write.mock.calls.at(-1)?.[1] as () => void;
    acknowledge();
    expect(stream.send).toHaveBeenLastCalledWith({
      sequence: 0,
      terminalId: "terminal",
      type: "rendered",
    });
  },
);

testCases(
  "forwards renderer errors and focuses when Ghostty becomes ready",
  async () => {
    const onError = vi.fn();
    const onReady = vi.fn();
    await act(async () =>
      root.render(<Harness onError={onError} onReady={onReady} />),
    );
    ghostty.focus.mockReset();
    const error = new Error("WASM failed");
    ghostty.props?.onError?.(error);
    ghostty.props?.onReady?.();
    expect(onError).toHaveBeenCalledWith(error);
    expect(onReady).toHaveBeenCalledOnce();
    expect(ghostty.focus).toHaveBeenCalledOnce();
  },
);

testCases(
  "gates inactive keyboard and imperative input without owning UI",
  async () => {
    const ref = createRef<TmuxGhosttyHandle>();
    await act(async () => root.render(<Harness active={false} ref={ref} />));
    stream.send.mockClear();
    ghostty.props?.onInput?.("ignored");
    ref.current?.input(Uint8Array.from([0, 255]));
    ghostty.props?.onReady?.();
    expect(stream.send).not.toHaveBeenCalled();
    expect(ghostty.focus).not.toHaveBeenCalled();
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(
      container.querySelector("[data-ghostty]"),
    );
    expect(container.querySelector("button, [role='alert']")).toBeNull();
  },
);

testCases(
  "detaches pending output without closing the headless connection",
  async () => {
    await act(async () => root.render(<Harness />));
    await act(async () =>
      listener?.({
        bytes: Uint8Array.from([65]),
        sequence: 0,
        terminalId: "terminal",
        type: "data",
      }),
    );
    const acknowledge = ghostty.write.mock.calls.at(-1)?.[1] as () => void;
    await act(async () => root.render(<Harness visible={false} />));
    expect(stream.close).not.toHaveBeenCalled();
    expect(stream.send).toHaveBeenLastCalledWith({
      sequence: 0,
      terminalId: "terminal",
      type: "rendered",
    });
    stream.send.mockClear();
    acknowledge();
    expect(stream.send).not.toHaveBeenCalled();
    ghostty.reset.mockClear();
    await act(async () => root.render(<Harness />));
    expect(ghostty.reset).toHaveBeenCalledOnce();
    expect(terminal.error).toBeUndefined();
  },
);
