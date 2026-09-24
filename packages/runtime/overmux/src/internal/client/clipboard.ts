import "./host/desktop-host";

// Reads the system clipboard through the browser, never through the desktop host.
export const readClipboardText = async (): Promise<string> => {
  if (!globalThis.navigator?.clipboard?.readText) {
    throw new Error("Clipboard reading is unavailable in this browser context");
  }
  return navigator.clipboard.readText();
};

// Desktop writes are fire-and-forget: resolution confirms dispatch, not completion.
export const writeClipboardText = async (text: string): Promise<void> => {
  const desktopClipboard = globalThis.window?.overmuxHost?.clipboard;
  if (desktopClipboard?.version === 1) {
    desktopClipboard.writeText(text);
    return;
  }
  if (!globalThis.navigator?.clipboard?.writeText) {
    throw new Error("Clipboard writing is unavailable in this browser context");
  }
  await navigator.clipboard.writeText(text);
};
