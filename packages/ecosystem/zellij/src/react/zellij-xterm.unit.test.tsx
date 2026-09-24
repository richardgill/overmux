import { act, forwardRef, useImperativeHandle, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
  shortcut: vi.fn(),
}));
vi.mock("overmux/client", () => ({
  useShortcutInputTarget: mocks.shortcut,
}));
vi.mock("@overmux/xterm/react", () => ({
  XtermTerminal: forwardRef(
    (props: Record<string, unknown>, ref: Ref<unknown>) => {
      mocks.props = props;
      useImperativeHandle(ref, () => ({
        fit: vi.fn(),
        focus: vi.fn(),
        input: vi.fn(),
        reset: vi.fn(),
        write: vi.fn(),
      }));
      return <div data-xterm />;
    },
  ),
}));

import { ZellijXterm } from "./index";

let container: HTMLDivElement;
let root: Root;
const send = vi.fn(() => true);
const close = vi.fn();
const stream = {
  close,
  error: new Error("attach failed"),
  send,
  status: "open" as const,
  subscribe: vi.fn(() => () => undefined),
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  close.mockReset();
  send.mockReset();
  mocks.props = undefined;
  mocks.shortcut.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("gates keyboard input while retaining resize, shortcuts, errors, and close UI", async () => {
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <ZellijXterm active={false} onClose={onClose} stream={stream} />,
    ),
  );

  (mocks.props?.onData as (data: string) => void)("blocked");
  (mocks.props?.onBinary as (data: string) => void)("\u0000\u0080\u00ff");
  (mocks.props?.onResize as (size: { cols: number; rows: number }) => void)({
    cols: 120,
    rows: 40,
  });

  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith({ cols: 120, rows: 40, type: "resize" });
  expect(mocks.shortcut).toHaveBeenCalled();
  expect(container.querySelector("[role='alert']")?.textContent).toBe(
    "attach failed",
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("[aria-label='Close terminal']")
      ?.click(),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("preserves text and binary input for an active terminal", async () => {
  await act(async () =>
    root.render(<ZellijXterm onClose={vi.fn()} stream={stream} />),
  );

  (mocks.props?.onData as (data: string) => void)("text");
  (mocks.props?.onBinary as (data: string) => void)("\u0000\u0080\u00ff");

  expect(send).toHaveBeenNthCalledWith(1, { data: "text", type: "input" });
  expect(send).toHaveBeenNthCalledWith(2, {
    data: Uint8Array.from([0, 128, 255]),
    type: "input",
  });
});
