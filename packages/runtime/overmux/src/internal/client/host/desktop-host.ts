import type { ShortcutBinding } from "@overmux/keybindings";

import type { NativeWebViewLoadError } from "../native-web-view";

// This capability is independently versioned from the host envelope.
export type NativeWebViewBridge = {
  version: 1;
  command: (
    input:
      | { type: "create" | "destroy"; id: string }
      | {
          type: "configure";
          id: string;
          url: string;
          allowedHttpOrigins: string[];
          passthroughBindings: readonly ShortcutBinding[];
        },
  ) => Promise<void>;
  setBounds: (
    id: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => void;
  onLoadError: (
    callback: (input: { id: string; error: NativeWebViewLoadError }) => void,
  ) => () => void;
  onPassthroughShortcut: (
    callback: (input: { id: string; binding: ShortcutBinding }) => void,
  ) => () => void;
};

type DesktopHost = {
  version: 1;
  platform: string;
  nativeWebView?: NativeWebViewBridge;
  instance?: { report: (identity: { instanceId: string }) => void; version: 1 };
  clipboard?: { writeText: (text: string) => void; version: 1 };
  notifications?: { show: (notification: unknown) => void; version: 1 };
};

declare global {
  interface Window {
    overmuxHost?: DesktopHost;
  }
}
