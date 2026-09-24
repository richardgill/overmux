import type { WebFrameMain } from "electron";

// Target the frame directly rather than waiting for WebContents to finish loading.
export const navigateInPage = (
  frame: Pick<WebFrameMain, "detached" | "url" | "executeJavaScript">,
  destination: string,
) => {
  const origin = new URL(destination).origin;
  if (frame.detached || new URL(frame.url).origin !== origin) {
    throw new Error("Connection was replaced or closed.");
  }
  // Alternative: deliver navigation through a narrow preload IPC subscription and let
  // userland call its router, rather than injecting history changes. Design that API
  // to handle PWA navigation too, without requiring an Electron bridge in the PWA.
  return frame.executeJavaScript(`
    if (location.origin !== ${JSON.stringify(origin)}) {
      throw new Error("Connection was replaced or closed.");
    }
    history.pushState(history.state, "", ${JSON.stringify(destination)});
  `);
};
