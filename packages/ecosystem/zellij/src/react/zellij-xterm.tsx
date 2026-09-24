import "./styles.css";

import { useShortcutInputTarget } from "overmux/client";
import {
  XtermTerminal,
  type XtermTerminalHandle,
  type XtermTerminalProps,
} from "@overmux/xterm/react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
  type JSX,
  type Ref,
} from "react";

import type {
  ZellijTerminalConnection,
  ZellijTerminalConnectionStatus,
} from "../client/terminal-client";
import { useZellijTerminal } from "./use-zellij-terminal";

export type ZellijXtermStyle = CSSProperties &
  Record<`--${string}`, string | number | undefined>;
export type ZellijXtermProps = Omit<XtermTerminalProps, "ref"> & {
  active?: boolean;
  containerClassName?: string;
  containerStyle?: ZellijXtermStyle;
  onClose: () => Promise<void> | void;
  onConnectionStatusChange?: (status: ZellijTerminalConnectionStatus) => void;
  onError?: (error: Error) => void;
  ref?: Ref<XtermTerminalHandle>;
  stream: ZellijTerminalConnection;
};

const binaryStringToBytes = (data: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(data, (character) => character.charCodeAt(0));

export const ZellijXterm = ({
  active = true,
  containerClassName,
  containerStyle,
  onClose,
  onConnectionStatusChange,
  onError,
  ref,
  stream,
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
  const { input, resize } = useZellijTerminal({
    onConnectionStatusChange,
    onError,
    renderer,
    stream,
  });
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
  const close = useCallback(() => void onClose(), [onClose]);

  return (
    <div
      className={containerClassName}
      data-om-zellij-terminal
      ref={containerRef}
      style={containerStyle}
    >
      <XtermTerminal
        {...xtermProps}
        onBinary={handleBinary}
        onData={handleData}
        onInputChange={handleInputChange}
        onResize={handleResize}
        ref={xtermRef}
      />
      {stream.error ? (
        <div className="om-zellij-terminal-error" role="alert">
          {stream.error.message}
        </div>
      ) : null}
      <button
        aria-label="Close terminal"
        className="om-zellij-terminal-close"
        onClick={close}
        type="button"
      >
        Close
      </button>
    </div>
  );
};
