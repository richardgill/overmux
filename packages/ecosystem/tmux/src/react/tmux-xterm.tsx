import { useShortcutInputTarget } from "overmux/client";
import {
  XtermTerminal,
  type ITerminalAddon,
  type XtermTerminalHandle,
  type XtermTerminalProps,
} from "@overmux/xterm/react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type JSX,
} from "react";

import type { UseTmuxTerminalResult } from "./use-tmux-terminal";

const binaryStringToBytes = (data: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(data, (character) => character.charCodeAt(0));

// Configures an xterm renderer connected to a tmux terminal stream.
export type TmuxXtermProps = Omit<XtermTerminalProps, "containerRef"> & {
  active?: boolean;
  terminal: UseTmuxTerminalResult;
};

export const TmuxXterm = ({
  active = true,
  ref,
  terminal,
  ...xtermProps
}: TmuxXtermProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLElement>(null);
  const xtermRef = useRef<XtermTerminalHandle>(null);
  const cancelPendingInputRef = useRef<(() => void) | undefined>(undefined);
  // Use the existing addon lifecycle to keep raw composition cancellation internal.
  // No input can be pending before xterm opens and activates this addon.
  const createAddons = (): readonly ITerminalAddon[] => [
    {
      activate: (xterm) => {
        cancelPendingInputRef.current = () => xterm.cancelPendingInput();
      },
      dispose: () => {
        cancelPendingInputRef.current = undefined;
      },
    },
    ...(xtermProps.createAddons?.() ?? []),
  ];
  useImperativeHandle(
    ref,
    () => ({
      fit: () => xtermRef.current?.fit(),
      focus: () => xtermRef.current?.focus(),
      input: (data, wasUserInput) =>
        xtermRef.current?.input(data, wasUserInput),
      reset: () => xtermRef.current?.reset(),
      write: (data, onProcessed) => xtermRef.current?.write(data, onProcessed),
    }),
    [],
  );
  useShortcutInputTarget({ container: containerRef, input: inputRef });

  const renderer = useMemo(
    () => ({
      cancelPendingInput: () => cancelPendingInputRef.current?.(),
      fit: () => xtermRef.current?.fit(),
      reset: () => xtermRef.current?.reset(),
      write: (bytes: Uint8Array, onProcessed: () => void) =>
        xtermRef.current?.write(bytes, onProcessed),
    }),
    [],
  );
  const { attachRenderer, input, resize } = terminal;
  // Attaching immediately flushes buffered output. XtermTerminal creates the actual
  // xterm instance in its own useEffect, which runs before this parent's useEffect.
  // A layout effect would attach too early: writes would hit an uninitialized xterm
  // and never call their completion callbacks, leaving output delivery stalled.
  useEffect(() => attachRenderer(renderer), [attachRenderer, renderer]);

  const sendInputIfActive = (data: Parameters<typeof input>[0]) => {
    if (active) {
      input(data);
    }
  };
  const handleData = (data: string) => {
    xtermProps.onData?.(data);
    sendInputIfActive(data);
  };
  const handleBinary = (data: string) => {
    xtermProps.onBinary?.(data);
    sendInputIfActive(binaryStringToBytes(data));
  };
  const handleResize = (size: { cols: number; rows: number }) => {
    xtermProps.onResize?.(size);
    resize(size);
  };
  const handleInputChange = (nextInput: HTMLElement | null) => {
    inputRef.current = nextInput;
    xtermProps.onInputChange?.(nextInput);
  };

  useEffect(() => {
    if (active) {
      xtermRef.current?.focus();
    }
  }, [active, terminal.location?.sessionId]);

  return (
    <XtermTerminal
      {...xtermProps}
      containerRef={containerRef}
      createAddons={createAddons}
      options={{ scrollback: 0, ...xtermProps.options }}
      onBinary={handleBinary}
      onData={handleData}
      onInputChange={handleInputChange}
      onResize={handleResize}
      ref={xtermRef}
    />
  );
};
