import { WebglAddon } from "@xterm/addon-webgl";
import type { ITerminalAddon, Terminal } from "@overmux/xterm-fork";

export type WebglDiagnostic = {
  message?: string;
  status: "active" | "fallback";
};

export type SafeWebglAddonOptions = {
  onDiagnostic?: (diagnostic: WebglDiagnostic) => void;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const createSafeWebglAddon = ({
  onDiagnostic,
}: SafeWebglAddonOptions = {}): ITerminalAddon => {
  let contextLoss: { dispose: () => void } | undefined;
  let renderer: WebglAddon | undefined;
  const disposeRenderer = () => {
    contextLoss?.dispose();
    contextLoss = undefined;
    renderer?.dispose();
    renderer = undefined;
  };
  return {
    activate: (terminal: Terminal) => {
      try {
        renderer = new WebglAddon();
        contextLoss = renderer.onContextLoss(() => {
          disposeRenderer();
          onDiagnostic?.({
            message: "WebGL context lost",
            status: "fallback",
          });
        });
        renderer.activate(terminal);
      } catch (error) {
        disposeRenderer();
        onDiagnostic?.({
          message: errorMessage(error),
          status: "fallback",
        });
        return;
      }
      onDiagnostic?.({ status: "active" });
    },
    dispose: disposeRenderer,
  };
};
