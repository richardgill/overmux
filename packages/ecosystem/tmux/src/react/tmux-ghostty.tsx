import { useShortcutInputTarget } from "overmux/client";
import {
  GhosttyTerminal,
  type GhosttyTerminalHandle,
  type GhosttyTerminalProps,
} from "@overmux/ghostty/react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type Ref,
  type JSX,
} from "react";

import type { TmuxTerminalInput } from "../client/terminal-client";
import type { UseTmuxTerminalResult } from "./use-tmux-terminal";

export type TmuxGhosttyHandle = Omit<GhosttyTerminalHandle, "input"> & {
  input: (data: TmuxTerminalInput) => void;
};

// Configures a Ghostty renderer connected to a tmux terminal stream.
export type TmuxGhosttyProps = Omit<
  GhosttyTerminalProps,
  "containerRef" | "ref"
> & {
  active?: boolean;
  ref?: Ref<TmuxGhosttyHandle>;
  terminal: UseTmuxTerminalResult;
};

export const TmuxGhostty = ({
  active = true,
  ref,
  terminal,
  ...ghosttyProps
}: TmuxGhosttyProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLElement>(null);
  const ghosttyRef = useRef<GhosttyTerminalHandle>(null);
  const { attachRenderer, input, resize } = terminal;
  useImperativeHandle(
    ref,
    () => ({
      fit: () => ghosttyRef.current?.fit(),
      focus: () => ghosttyRef.current?.focus(),
      input: (data) => {
        if (active) {
          input(data);
        }
      },
      reset: () => ghosttyRef.current?.reset(),
      write: (data, onProcessed) =>
        ghosttyRef.current?.write(data, onProcessed),
    }),
    [active, input],
  );
  useShortcutInputTarget({ container: containerRef, input: inputRef });

  const renderer = useMemo(
    () => ({
      fit: () => ghosttyRef.current?.fit(),
      reset: () => ghosttyRef.current?.reset(),
      write: (bytes: Uint8Array, onProcessed: () => void) =>
        ghosttyRef.current?.write(bytes, onProcessed),
    }),
    [],
  );
  // Ghostty queues output until its isolated WASM runtime is ready. Completion
  // callbacks still wait for processing, preserving the hook's backpressure.
  // Detachment releases outstanding writes without closing the shared connection.
  useEffect(() => attachRenderer(renderer), [attachRenderer, renderer]);

  const handleInput = (data: string) => {
    ghosttyProps.onInput?.(data);
    if (active) {
      input(data);
    }
  };
  const handleResize = (size: { cols: number; rows: number }) => {
    ghosttyProps.onResize?.(size);
    resize(size);
  };
  const handleInputElementChange = (nextInput: HTMLTextAreaElement | null) => {
    inputRef.current = nextInput;
    ghosttyProps.onInputElementChange?.(nextInput);
  };
  const handleReady = () => {
    if (active) {
      ghosttyRef.current?.focus();
    }
    ghosttyProps.onReady?.();
  };

  useEffect(() => {
    if (active) {
      ghosttyRef.current?.focus();
    }
  }, [active, terminal.location?.sessionId]);

  return (
    <GhosttyTerminal
      {...ghosttyProps}
      containerRef={containerRef}
      options={{ scrollback: 0, ...ghosttyProps.options }}
      onInput={handleInput}
      onInputElementChange={handleInputElementChange}
      onReady={handleReady}
      onResize={handleResize}
      ref={ghosttyRef}
    />
  );
};
