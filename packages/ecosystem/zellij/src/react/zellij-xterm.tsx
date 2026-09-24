import { useShortcutInputTarget } from "overmux/client";
import {
  XtermTerminal,
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

import type { UseZellijTerminalResult } from "./use-zellij-terminal";

export type ZellijXtermProps = Omit<XtermTerminalProps, "containerRef"> & {
  active?: boolean;
  terminal: UseZellijTerminalResult;
};

const binaryStringToBytes = (data: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(data, (character) => character.charCodeAt(0));

export const ZellijXterm = ({
  active = true,
  ref,
  terminal,
  ...xtermProps
}: ZellijXtermProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLElement>(null);
  const xtermRef = useRef<XtermTerminalHandle>(null);
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
      fit: () => xtermRef.current?.fit(),
      reset: () => xtermRef.current?.reset(),
      write: (bytes: Uint8Array, onProcessed: () => void) =>
        xtermRef.current?.write(bytes, onProcessed),
    }),
    [],
  );
  const { attachRenderer, input, resize } = terminal;
  // XtermTerminal creates xterm in a child passive effect. Attaching in a layout
  // effect would flush buffered writes before xterm exists and lose their callbacks.
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
  const handleInputChange = (inputElement: HTMLElement | null) => {
    inputRef.current = inputElement;
    xtermProps.onInputChange?.(inputElement);
  };
  useEffect(() => {
    if (active) {
      xtermRef.current?.focus();
    }
  }, [active]);

  return (
    <XtermTerminal
      {...xtermProps}
      containerRef={containerRef}
      options={{ scrollback: 0, ...xtermProps.options }}
      onBinary={handleBinary}
      onData={handleData}
      onInputChange={handleInputChange}
      onResize={handleResize}
      ref={xtermRef}
    />
  );
};
