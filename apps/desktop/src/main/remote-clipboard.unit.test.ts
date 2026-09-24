import { beforeEach, describe, expect, it, vi } from "vitest";

import { remoteClipboardChannels } from "../shared/remote-clipboard.js";
import { installRemoteClipboard } from "./remote-clipboard.js";

const electron = vi.hoisted(() => ({
  clipboard: { writeText: vi.fn() },
}));

vi.mock("electron", () => ({ clipboard: electron.clipboard }));

const createHarness = () => {
  const source = {
    mainFrame: { url: "http://overmux.test/workspace" },
  };
  const listeners = new Map<string, (...arguments_: never[]) => void>();
  const ipcMain = {
    on: vi.fn((channel, listener) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel) => listeners.delete(channel)),
  };
  const dispose = installRemoteClipboard({
    getConfiguredUrl: () => "http://overmux.test",
    getRemoteView: () => ({ webContents: source }) as never,
    ipcMain: ipcMain as never,
  });
  const writeText = (input: unknown) =>
    listeners.get(remoteClipboardChannels.writeText)?.(
      { sender: source, senderFrame: source.mainFrame } as never,
      input as never,
    );
  return { dispose, ipcMain, writeText };
};

beforeEach(() => electron.clipboard.writeText.mockClear());

describe("remote clipboard", () => {
  it("writes text from the active remote view to the system clipboard", () => {
    const harness = createHarness();

    harness.writeText("yanked text");

    expect(electron.clipboard.writeText).toHaveBeenCalledWith("yanked text");
  });

  it("rejects non-text clipboard payloads", () => {
    const harness = createHarness();

    harness.writeText({ text: "untrusted" });

    expect(electron.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("removes its IPC listener", () => {
    const harness = createHarness();

    harness.dispose();

    expect(harness.ipcMain.removeListener).toHaveBeenCalledWith(
      remoteClipboardChannels.writeText,
      expect.any(Function),
    );
  });
});
