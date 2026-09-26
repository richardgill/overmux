// Owns ghostty-web's browser terminal and hides its evolving implementation types.
import "../styles.css";

import { FitAddon, Ghostty, Terminal } from "ghostty-web";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type JSX,
  type Ref,
} from "react";

export type GhosttyTheme = {
  background?: string;
  black?: string;
  blue?: string;
  brightBlack?: string;
  brightBlue?: string;
  brightCyan?: string;
  brightGreen?: string;
  brightMagenta?: string;
  brightRed?: string;
  brightWhite?: string;
  brightYellow?: string;
  cursor?: string;
  cursorAccent?: string;
  cyan?: string;
  foreground?: string;
  green?: string;
  magenta?: string;
  red?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  white?: string;
  yellow?: string;
};

// This intentionally contains only ghostty-web options supported by this wrapper.
export type GhosttyTerminalOptions = {
  cursorBlink?: boolean;
  cursorStyle?: "bar" | "block" | "underline";
  fontFamily?: string;
  fontSize?: number;
  scrollback?: number;
  theme?: GhosttyTheme;
};

export type GhosttyTerminalSize = { cols: number; rows: number };

export type GhosttyTerminalHandle = {
  fit: () => void;
  focus: () => void;
  input: (data: string, wasUserInput?: boolean) => void;
  reset: () => void;
  write: (data: string | Uint8Array, onProcessed?: () => void) => void;
};

type PendingWrite = {
  data: string | Uint8Array;
  onProcessed?: () => void;
};

type GhosttyTerminalInternals = { scrollbarOpacity?: number };

const renderAwaitingEcho = (terminal: Terminal) => {
  const renderer = terminal.renderer;
  const wasmTerminal = terminal.wasmTerm;
  if (!renderer || !wasmTerminal) {
    return;
  }
  // ghostty-web@0.4.0 otherwise waits for the next animation frame.
  // https://github.com/coder/ghostty-web/issues/161
  const { scrollbarOpacity = 1 } =
    terminal as unknown as GhosttyTerminalInternals;
  renderer.render(
    wasmTerminal,
    false,
    terminal.viewportY,
    terminal,
    scrollbarOpacity,
  );
};

export type GhosttyTerminalProps = {
  className?: string;
  containerRef?: Ref<HTMLDivElement>;
  onError?: (error: Error) => void;
  onInput?: (data: string) => void;
  onInputElementChange?: (input: HTMLTextAreaElement | null) => void;
  onKeyEvent?: (event: KeyboardEvent) => boolean;
  onReady?: () => void;
  onResize?: (size: GhosttyTerminalSize) => void;
  onTitleChange?: (title: string) => void;
  options?: GhosttyTerminalOptions;
  ref?: Ref<GhosttyTerminalHandle>;
  style?: CSSProperties;
  // Overrides ghostty-web's packaged WASM resolution for CSP-safe hosting.
  wasmUrl?: string;
};

const loadFont = (fontFamily: string | undefined) =>
  typeof document === "undefined" || !document.fonts || !fontFamily
    ? Promise.resolve()
    : document.fonts.load(`1em ${fontFamily}`).then(
        () => undefined,
        () => undefined,
      );

export const GhosttyTerminal = (props: GhosttyTerminalProps): JSX.Element => {
  const mountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const pendingWritesRef = useRef<PendingWrite[]>([]);
  const acceptsWritesRef = useRef(true);
  const awaitingEchoRef = useRef(false);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  useImperativeHandle(
    props.ref,
    () => ({
      fit: () => fitRef.current?.fit(),
      focus: () => terminalRef.current?.focus(),
      input: (data, wasUserInput) =>
        terminalRef.current?.input(data, wasUserInput ?? true),
      reset: () => {
        awaitingEchoRef.current = false;
        pendingWritesRef.current = [];
        terminalRef.current?.reset();
      },
      write: (data, onProcessed) => {
        const terminal = terminalRef.current;
        if (terminal) {
          terminal.write(data, onProcessed);
          if (awaitingEchoRef.current) {
            awaitingEchoRef.current = false;
            renderAwaitingEcho(terminal);
          }
        } else if (acceptsWritesRef.current) {
          pendingWritesRef.current.push({ data, onProcessed });
        }
      },
    }),
    [],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    acceptsWritesRef.current = true;
    let cancelled = false;
    let terminal: Terminal | undefined;
    let fit: FitAddon | undefined;
    const disposables: { dispose: () => void }[] = [];
    // Isolate each WASM runtime because shared disposal can corrupt memory.
    // https://github.com/coder/ghostty-web/issues/141
    void Ghostty.load(props.wasmUrl)
      .then((ghostty) =>
        loadFont(callbacksRef.current.options?.fontFamily).then(() => ghostty),
      )
      .then((ghostty) => {
        if (cancelled) {
          return;
        }
        terminal = new Terminal({
          ...callbacksRef.current.options,
          ghostty,
        });
        fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(mount);
        terminalRef.current = terminal;
        fitRef.current = fit;
        let reportedSize: GhosttyTerminalSize | undefined;
        const reportSize = (size: GhosttyTerminalSize) => {
          if (
            reportedSize?.cols === size.cols &&
            reportedSize.rows === size.rows
          ) {
            return;
          }
          reportedSize = size;
          callbacksRef.current.onResize?.(size);
        };
        disposables.push(
          terminal.onData((data) => {
            awaitingEchoRef.current = true;
            callbacksRef.current.onInput?.(data);
          }),
          terminal.onResize(reportSize),
          terminal.onTitleChange((title) =>
            callbacksRef.current.onTitleChange?.(title),
          ),
        );
        terminal.attachCustomKeyEventHandler((event) => {
          // Ghostty Web returns true to suppress its native handling.
          // Our callback follows xterm's convention where false rejects an event.
          return !(callbacksRef.current.onKeyEvent?.(event) ?? true);
        });
        const pendingWrites = pendingWritesRef.current;
        pendingWritesRef.current = [];
        pendingWrites.forEach(({ data, onProcessed }) =>
          terminal!.write(data, onProcessed),
        );
        fit.observeResize();
        fit.fit();
        callbacksRef.current.onInputElementChange?.(terminal.textarea ?? null);
        reportSize({ cols: terminal.cols, rows: terminal.rows });
        callbacksRef.current.onReady?.();
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          acceptsWritesRef.current = false;
          pendingWritesRef.current = [];
          callbacksRef.current.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    return () => {
      cancelled = true;
      acceptsWritesRef.current = false;
      awaitingEchoRef.current = false;
      pendingWritesRef.current = [];
      disposables.forEach((disposable) => disposable.dispose());
      callbacksRef.current.onInputElementChange?.(null);
      terminal?.dispose();
      if (terminalRef.current === terminal) {
        terminalRef.current = undefined;
      }
      if (fitRef.current === fit) {
        fitRef.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    Object.assign(terminal.options, props.options);
    let cancelled = false;
    void loadFont(props.options?.fontFamily).then(() => {
      if (!cancelled && terminalRef.current === terminal) {
        fitRef.current?.fit();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.options]);

  return (
    <div
      className={props.className}
      data-om-ghostty-terminal
      ref={props.containerRef}
      style={props.style}
    >
      <div className="om-ghostty-terminal-mount" ref={mountRef} />
    </div>
  );
};
