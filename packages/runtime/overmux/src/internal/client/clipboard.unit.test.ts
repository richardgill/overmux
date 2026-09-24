import { afterEach, expect, test as testCases, vi } from "vitest";

import { readClipboardText, writeClipboardText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

testCases(
  "browser operations preserve their receiver and return results",
  async () => {
    const clipboard = {
      text: "original",
      readText() {
        return Promise.resolve(this.text);
      },
      writeText(text: string) {
        this.text = text;
        return Promise.resolve();
      },
    };
    vi.stubGlobal("navigator", { clipboard });

    expect(await readClipboardText()).toBe("original");
    await writeClipboardText("replacement");
    expect(clipboard.text).toBe("replacement");
  },
);

testCases(
  "desktop bridge handles writes only, without falling back after dispatch",
  async () => {
    const desktopWrite = vi.fn();
    const browserWrite = vi.fn();
    const browserRead = vi.fn(async () => "browser secret");
    vi.stubGlobal("window", {
      overmuxHost: { clipboard: { version: 1, writeText: desktopWrite } },
    });
    vi.stubGlobal("navigator", {
      clipboard: { readText: browserRead, writeText: browserWrite },
    });

    await writeClipboardText("copy");
    expect(await readClipboardText()).toBe("browser secret");

    expect(desktopWrite).toHaveBeenCalledExactlyOnceWith("copy");
    expect(browserWrite).not.toHaveBeenCalled();
    expect(browserRead).toHaveBeenCalledOnce();
  },
);

testCases(
  "desktop writes work without browser clipboard support, but reads reject",
  async () => {
    const writeText = vi.fn();
    vi.stubGlobal("window", {
      overmuxHost: { clipboard: { version: 1, writeText } },
    });
    vi.stubGlobal("navigator", {});

    await writeClipboardText("copy");

    expect(writeText).toHaveBeenCalledExactlyOnceWith("copy");
    await expect(readClipboardText()).rejects.toThrow("reading is unavailable");
  },
);

testCases.each([undefined, {}, { clipboard: {} }])(
  "missing browser clipboard rejects (%j)",
  async (navigator) => {
    vi.stubGlobal("navigator", navigator);
    vi.stubGlobal("window", undefined);

    await expect(readClipboardText()).rejects.toThrow("reading is unavailable");
    await expect(writeClipboardText("copy")).rejects.toThrow(
      "writing is unavailable",
    );
  },
);

testCases(
  "browser permission failures and desktop dispatch failures propagate",
  async () => {
    const error = new Error("permission denied");
    const readText = vi.fn(() => Promise.reject(error));
    const writeText = vi.fn(() => Promise.reject(error));
    vi.stubGlobal("navigator", { clipboard: { readText, writeText } });

    await expect(readClipboardText()).rejects.toBe(error);
    await expect(writeClipboardText("copy")).rejects.toBe(error);
    vi.stubGlobal("window", {
      overmuxHost: {
        clipboard: {
          version: 1,
          writeText: () => {
            throw error;
          },
        },
      },
    });
    await expect(writeClipboardText("copy")).rejects.toBe(error);
    expect(writeText).toHaveBeenCalledOnce();
  },
);
