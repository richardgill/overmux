import { Terminal } from "@overmux/xterm-fork";
import { afterEach, expect, test as testCases, vi } from "vitest";

vi.mock("overmux/client", () => ({
  readClipboardText: vi.fn(async () => "browser text"),
  writeClipboardText: vi.fn(async () => {}),
}));

import { readClipboardText, writeClipboardText } from "overmux/client";
import {
  createOsc52ClipboardAddon,
  createReadAndWriteOsc52ClipboardAddon,
  createReadOnlyOsc52ClipboardAddon,
  createWriteOnlyOsc52ClipboardAddon,
} from "./index";

const terminals: Terminal[] = [];
const openTerminal = (addon: ReturnType<typeof createOsc52ClipboardAddon>) => {
  const terminal = new Terminal();
  terminal.loadAddon(addon);
  terminals.push(terminal);
  const input = vi.fn();
  terminal.onData(input);
  return { terminal, input };
};
const sendOsc52 = (terminal: Terminal, selection: string, payload: string) =>
  new Promise<void>((resolve) => {
    terminal.write(`\x1b]52;${selection};${payload}\x07`, resolve);
  });

afterEach(() => {
  terminals.splice(0).forEach((terminal) => terminal.dispose());
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

testCases.each([
  {
    name: "read-only",
    factory: createReadOnlyOsc52ClipboardAddon,
    read: true,
    write: false,
  },
  {
    name: "write-only",
    factory: createWriteOnlyOsc52ClipboardAddon,
    read: false,
    write: true,
  },
  {
    name: "read-and-write",
    factory: createReadAndWriteOsc52ClipboardAddon,
    read: true,
    write: true,
  },
])(
  "$name enforces access even with extra opposite-access properties",
  async ({ factory, read, write }) => {
    const readText = vi.fn(() => "secret");
    const writeText = vi.fn();
    const { terminal, input } = openTerminal(factory({ readText, writeText }));

    await sendOsc52(terminal, "c", "?");
    await sendOsc52(terminal, "c", btoa("replacement"));

    expect(readText).toHaveBeenCalledTimes(Number(read));
    expect(writeText.mock.calls).toEqual(write ? [["replacement"]] : []);
    expect(input).toHaveBeenCalledWith(
      `\x1b]52;c;${read ? btoa("secret") : ""}\x07`,
    );
    expect(readClipboardText).not.toHaveBeenCalled();
    expect(writeClipboardText).not.toHaveBeenCalled();
  },
);

testCases.each([
  {
    name: "read-only",
    factory: createReadOnlyOsc52ClipboardAddon,
    read: true,
    write: false,
  },
  {
    name: "write-only",
    factory: createWriteOnlyOsc52ClipboardAddon,
    read: false,
    write: true,
  },
  {
    name: "read-and-write",
    factory: createReadAndWriteOsc52ClipboardAddon,
    read: true,
    write: true,
  },
])(
  "$name uses runtime defaults without options",
  async ({ factory, read, write }) => {
    const { terminal, input } = openTerminal(factory());

    await sendOsc52(terminal, "c", "?");
    await sendOsc52(terminal, "c", btoa("copy"));

    expect(readClipboardText).toHaveBeenCalledTimes(Number(read));
    expect(vi.mocked(writeClipboardText).mock.calls).toEqual(
      write ? [["copy"]] : [],
    );
    expect(input).toHaveBeenCalledWith(
      `\x1b]52;c;${read ? btoa("browser text") : ""}\x07`,
    );
  },
);

testCases.each(["c", "p"] as const)(
  "handles only the exact configured selection %s",
  async (selection) => {
    const readText = vi.fn(async () => "selected");
    const writeText = vi.fn(async () => {});
    const { terminal, input } = openTerminal(
      createReadAndWriteOsc52ClipboardAddon({ selection, readText, writeText }),
    );

    for (const requested of ["c", "p", "", "cp", "s", "0"]) {
      await sendOsc52(terminal, requested, "?");
      await sendOsc52(terminal, requested, btoa("copy"));
      expect(input).toHaveBeenLastCalledWith(
        `\x1b]52;${requested};${requested === selection ? btoa("selected") : ""}\x07`,
      );
    }

    expect(readText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledExactlyOnceWith("copy");
  },
);

testCases(
  "primary defaults report unsupported instead of accessing the system clipboard",
  async () => {
    const onError = vi.fn();
    const { terminal, input } = openTerminal(
      createReadAndWriteOsc52ClipboardAddon({ selection: "p", onError }),
    );

    await sendOsc52(terminal, "p", "?");
    await sendOsc52(terminal, "p", btoa("copy"));

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("primary selection"),
      }),
    );
    expect(input).toHaveBeenCalledWith("\x1b]52;p;\x07");
    expect(readClipboardText).not.toHaveBeenCalled();
    expect(writeClipboardText).not.toHaveBeenCalled();
  },
);

testCases(
  "generic providers receive raw selections and are disposed with the terminal",
  async () => {
    const readText = vi.fn(() => "custom");
    const writeText = vi.fn();
    const addon = createOsc52ClipboardAddon({ readText, writeText });
    const { terminal, input } = openTerminal(addon);

    await sendOsc52(terminal, "cp", "?");
    await sendOsc52(terminal, "s", btoa("value"));
    addon.dispose();
    await sendOsc52(terminal, "cp", "?");

    expect(readText).toHaveBeenCalledExactlyOnceWith("cp");
    expect(writeText).toHaveBeenCalledExactlyOnceWith("s", "value");
    expect(input).toHaveBeenCalledExactlyOnceWith(
      `\x1b]52;cp;${btoa("custom")}\x07`,
    );
  },
);

testCases.each([false, true])(
  "provider failures settle and parsing resumes (async: %s)",
  async (asyncFailure) => {
    const error = new Error("permission denied");
    const fail = vi.fn(() => {
      if (asyncFailure) {
        return Promise.reject(error);
      }
      throw error;
    });
    const onError = vi.fn();
    const { terminal, input } = openTerminal(
      createReadAndWriteOsc52ClipboardAddon({
        readText: fail,
        writeText: fail,
        onError,
      }),
    );

    await sendOsc52(terminal, "c", "?");
    await sendOsc52(terminal, "c", btoa("copy"));
    await new Promise<void>((resolve) =>
      terminal.write("still parsing", resolve),
    );

    expect(onError.mock.calls).toEqual([[error], [error]]);
    expect(input).toHaveBeenCalledWith("\x1b]52;c;\x07");
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
      "still parsing",
    );
  },
);

testCases.each(["absent", "throws", "rejects"])(
  "diagnostics do not reject into the parser when onError %s",
  async (mode) => {
    const error = new Error("clipboard unavailable");
    const handlerError = new Error("diagnostic failed");
    const onError =
      mode === "absent"
        ? undefined
        : vi.fn(() => {
            if (mode === "rejects") {
              return Promise.reject(handlerError);
            }
            throw handlerError;
          });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { terminal, input } = openTerminal(
      createReadOnlyOsc52ClipboardAddon({
        readText: () => Promise.reject(error),
        onError,
      }),
    );

    await sendOsc52(terminal, "c", "?");

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]).toContain(error);
    expect(input).toHaveBeenCalledWith("\x1b]52;c;\x07");
  },
);
