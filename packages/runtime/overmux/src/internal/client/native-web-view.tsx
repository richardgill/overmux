import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { ShortcutBinding } from "@overmux/keybindings";

import type { NativeWebViewBridge } from "./host/desktop-host";
import {
  useNativeWebViewPassthroughBindings,
  useNativeWebViewPassthroughShortcut,
} from "./shortcuts";

export type NativeWebViewLoadError = {
  url: string;
  code: string;
  message: string;
};
export type NativeWebViewProps = {
  url: string;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
  onLoadError?: (error: NativeWebViewLoadError) => void;
  allowedHttpOrigins?: string[];
  passthroughBindings?: readonly ShortcutBinding[];
};

type MountedView = {
  id: string;
  active: boolean;
  bridge: NativeWebViewBridge;
  report: (error: NativeWebViewLoadError) => void;
};

const command = async (
  view: MountedView,
  input: Parameters<NativeWebViewBridge["command"]>[0],
  url: string,
) => {
  try {
    await view.bridge.command(input);
  } catch (error) {
    view.report({ url, code: "ERR_DESKTOP_BRIDGE", message: String(error) });
  }
};

const trackBounds = (element: HTMLDivElement, view: MountedView) => {
  let previous = "";
  let frame = 0;
  const measure = () => {
    const rect = element.getBoundingClientRect();
    const visible =
      !document.hidden &&
      element.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
      });
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: visible ? Math.max(0, Math.round(rect.width)) : 0,
      height: visible ? Math.max(0, Math.round(rect.height)) : 0,
    };
    const key = JSON.stringify(bounds);
    if (key !== previous) {
      previous = key;
      view.bridge.setBounds(view.id, bounds);
    }
  };
  const tick = () => {
    measure();
    frame = requestAnimationFrame(tick);
  };
  // ResizeObserver alone misses position-only changes (siblings, scrolling and
  // animation). Sample once per frame, but send IPC only for changed pixel bounds.
  tick();
  document.addEventListener("visibilitychange", measure);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", measure);
  };
};

export const NativeWebView = ({
  url,
  className,
  style,
  fallback,
  onLoadError,
  allowedHttpOrigins = [],
  passthroughBindings = [],
}: NativeWebViewProps) => {
  const bridge =
    typeof window === "undefined" ||
    window.overmuxHost?.version !== 1 ||
    window.overmuxHost.nativeWebView?.version !== 1
      ? undefined
      : window.overmuxHost.nativeWebView;
  const element = useRef<HTMLDivElement>(null);
  const [passthroughSource, setPassthroughSource] =
    useState<HTMLDivElement | null>(null);
  const mounted = useRef<MountedView | undefined>(undefined);
  const runPassthroughShortcut = useNativeWebViewPassthroughShortcut();
  const activePassthroughBindings = useNativeWebViewPassthroughBindings(
    passthroughBindings,
    passthroughSource,
  );
  const setElement = useCallback((source: HTMLDivElement | null) => {
    element.current = source;
    setPassthroughSource(source);
  }, []);
  const latest = useRef({ url, onLoadError, runPassthroughShortcut });
  latest.current = { url, onLoadError, runPassthroughShortcut };
  // Equal array contents are not a navigation or a policy change.
  const origins = JSON.stringify(allowedHttpOrigins);
  const bindings = JSON.stringify(activePassthroughBindings);

  useEffect(() => {
    if (!bridge || !element.current) {
      return;
    }
    const view: MountedView = {
      id: crypto.randomUUID(),
      active: true,
      bridge,
      report: (error) => {
        // Keep caller exceptions out of IPC promise chains.
        queueMicrotask(() => {
          if (view.active) {
            latest.current.onLoadError?.(error);
          }
        });
      },
    };
    mounted.current = view;
    const unsubscribe = bridge.onLoadError(({ id, error }) => {
      if (id === view.id) {
        view.report(error);
      }
    });
    const unsubscribeShortcut = bridge.onPassthroughShortcut(
      ({ id, binding }) => {
        if (id === view.id) {
          latest.current.runPassthroughShortcut?.(binding, element.current);
        }
      },
    );
    void command(view, { type: "create", id: view.id }, latest.current.url);
    const stopTracking = trackBounds(element.current, view);
    return () => {
      view.active = false;
      mounted.current = undefined;
      stopTracking();
      unsubscribe();
      unsubscribeShortcut();
      // Creation and destruction are ordered commands, not asynchronous load waits.
      void command(view, { type: "destroy", id: view.id }, latest.current.url);
    };
  }, [bridge]);

  useEffect(() => {
    const view = mounted.current;
    if (view) {
      void command(
        view,
        {
          type: "configure",
          id: view.id,
          url,
          allowedHttpOrigins: JSON.parse(origins) as string[],
          passthroughBindings: JSON.parse(bindings) as ShortcutBinding[],
        },
        url,
      );
    }
  }, [bindings, bridge, url, origins]);

  return bridge ? (
    <div ref={setElement} className={className} style={style} />
  ) : (
    <>{fallback}</>
  );
};
