// Renders and owns a browser xterm instance without knowing its transport or session.
// Its lifecycle follows patterns materially informed by https://github.com/Qovery/react-xtermjs.
// This boundary centralizes browser resources so terminal integrations only supply I/O.
import "./styles.css";

import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";

import { defaultLinkHandler } from "./client/default-link-handler";
import { createWebLinksAddon } from "./client/web-links";
import { createXtermKeyEventHandler, type XtermKeyMapping } from "./keyboard";
import {
  Terminal,
  type IInputTransformEvent,
  type ITerminalAddon,
  type ITerminalInitOnlyOptions,
  type ITerminalOptions,
  type ITheme,
} from "@overmux/xterm-fork";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type JSX,
  type Ref,
} from "react";

export type {
  ITerminalAddon,
  ITerminalInitOnlyOptions,
  ITerminalOptions,
  ITheme,
} from "@overmux/xterm-fork";

export type XtermTerminalHandle = {
  fit: () => void;
  focus: () => void;
  input: (data: string, wasUserInput?: boolean) => void;
  reset: () => void;
  write: (data: string | Uint8Array, onProcessed?: () => void) => void;
};

export type XtermInputEvent = IInputTransformEvent;
export type XtermInputTransform = (event: XtermInputEvent) => string;

export type XtermTerminalOptions = ITerminalOptions;

export type XtermTerminalInitOptions = ITerminalInitOnlyOptions & {
  // xterm.js sets this through `terminal.unicode.activeVersion`; we expose it here in initOptions for ease of use.
  unicodeActiveVersion?: "6" | "11";
};

export type XtermTerminalProps = {
  className?: string;
  // The layout wrapper DOM node, separate from the imperative terminal handle.
  containerRef?: Ref<HTMLDivElement>;
  createAddons?: () => readonly ITerminalAddon[];
  initOptions?: XtermTerminalInitOptions;
  onBinary?: (data: string) => void;
  onData?: (data: string) => void;
  onInputChange?: (input: HTMLElement | null) => void;
  transformInput?: XtermInputTransform;
  keyMappings?: readonly XtermKeyMapping[];
  onKeyEvent?: (event: KeyboardEvent) => boolean;
  onResize?: (size: { cols: number; rows: number }) => void;
  options?: XtermTerminalOptions;
  ref?: Ref<XtermTerminalHandle>;
  style?: CSSProperties;
};

const loadFont = (fontFamily: string | undefined) =>
  typeof document === "undefined" || !document.fonts || !fontFamily
    ? Promise.resolve()
    : document.fonts.load(`1em ${fontFamily}`).then(
        () => undefined,
        () => undefined,
      );

const touchWheelDeltas = (deltaY: number) =>
  Array.from(
    { length: Math.ceil(Math.abs(deltaY) / 8) },
    () => deltaY / Math.ceil(Math.abs(deltaY) / 8),
  );

const installTouchScrolling = (mount: HTMLElement) => {
  let previousY: number | undefined;
  const reset = () => {
    previousY = undefined;
  };
  const onStart = (event: TouchEvent) => {
    previousY =
      event.touches.length === 1 ? event.touches.item(0)?.clientY : undefined;
  };
  const onMove = (event: TouchEvent) => {
    const currentY =
      event.touches.length === 1 ? event.touches.item(0)?.clientY : undefined;
    if (previousY === undefined || currentY === undefined) {
      return reset();
    }
    const deltaY = previousY - currentY;
    previousY = currentY;
    if (deltaY === 0) {
      return;
    }
    event.preventDefault();
    const target = mount.querySelector(".xterm-screen") ?? mount;
    touchWheelDeltas(deltaY).forEach((wheelDeltaY) =>
      target.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: wheelDeltaY,
        }),
      ),
    );
  };
  mount.addEventListener("touchstart", onStart, { passive: true });
  mount.addEventListener("touchmove", onMove, { passive: false });
  mount.addEventListener("touchend", reset, { passive: true });
  mount.addEventListener("touchcancel", reset, { passive: true });
  return () => {
    mount.removeEventListener("touchstart", onStart);
    mount.removeEventListener("touchmove", onMove);
    mount.removeEventListener("touchend", reset);
    mount.removeEventListener("touchcancel", reset);
  };
};

export const XtermTerminal = (props: XtermTerminalProps): JSX.Element => {
  const { unicodeActiveVersion = "11", ...nativeInitOptions } =
    props.initOptions ?? {};
  const initialUnicodeActiveVersion = useRef(unicodeActiveVersion).current;
  const initialInitOptions = useRef(nativeInitOptions).current;
  const initialOptions = useRef(props.options ?? {}).current;
  const mountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal>(undefined);
  const fitRef = useRef<FitAddon>(undefined);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  useImperativeHandle(
    props.ref,
    () => ({
      fit: () => fitRef.current?.fit(),
      focus: () => terminalRef.current?.focus(),
      input: (data, wasUserInput) =>
        terminalRef.current?.input(data, wasUserInput),
      reset: () => terminalRef.current?.reset(),
      write: (data, onProcessed) =>
        terminalRef.current?.write(data, onProcessed),
    }),
    [],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    const terminal = new Terminal({
      ...initialInitOptions,
      linkHandler: defaultLinkHandler,
      ...initialOptions,
      allowProposedApi: true,
    });
    // xterm's Unicode 6 default gives emoji one cell where modern terminals use two.
    // Activate before exposing the write handle, including while font loading is pending.
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = initialUnicodeActiveVersion;
    // Only setup needs the proposed Unicode API; retain the caller's setting afterward.
    terminal.options.allowProposedApi = initialOptions.allowProposedApi ?? true;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminalRef.current = terminal;
    fitRef.current = fit;
    let reportedSize: { cols: number; rows: number } | undefined;
    const reportSize = (size: { cols: number; rows: number }) => {
      if (reportedSize?.cols === size.cols && reportedSize.rows === size.rows) {
        return;
      }
      reportedSize = size;
      callbacksRef.current.onResize?.(size);
    };
    const data = terminal.onData((value) =>
      callbacksRef.current.onData?.(value),
    );
    const inputTransform = terminal.attachInputTransform(
      (event) => callbacksRef.current.transformInput?.(event) ?? event.data,
    );
    const binary = terminal.onBinary((value) =>
      callbacksRef.current.onBinary?.(value),
    );
    const resize = terminal.onResize(reportSize);
    terminal.attachCustomKeyEventHandler((event) => {
      const mapped = createXtermKeyEventHandler(
        terminal,
        callbacksRef.current.keyMappings ?? [],
      )(event);
      return mapped && (callbacksRef.current.onKeyEvent?.(event) ?? true);
    });
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    let disposeTouch: () => void = () => {};
    void loadFont(props.options?.fontFamily).then(() => {
      if (cancelled) {
        return;
      }
      terminal.open(mount);
      callbacksRef.current.onInputChange?.(terminal.textarea ?? null);
      callbacksRef.current
        .createAddons?.()
        .forEach((addon) => terminal.loadAddon(addon));
      // Earlier link providers win, so caller addons take precedence over detection defaults.
      terminal.loadAddon(createWebLinksAddon());
      disposeTouch = installTouchScrolling(mount);
      observer =
        typeof ResizeObserver === "undefined"
          ? undefined
          : new ResizeObserver(() => fit.fit());
      observer?.observe(mount);
      fit.fit();
      reportSize({ cols: terminal.cols, rows: terminal.rows });
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      disposeTouch();
      inputTransform.dispose();
      data.dispose();
      binary.dispose();
      resize.dispose();
      callbacksRef.current.onInputChange?.(null);
      terminal.dispose();
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
    Object.assign(terminal.options, {
      ...props.options,
      allowProposedApi:
        props.options?.allowProposedApi ?? terminal.options.allowProposedApi,
    });
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
      data-om-xterm-terminal
      ref={props.containerRef}
      style={props.style}
    >
      <div className="om-xterm-terminal-mount" ref={mountRef} />
    </div>
  );
};
