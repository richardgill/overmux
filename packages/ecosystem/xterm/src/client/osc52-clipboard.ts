import { ClipboardAddon } from "@xterm/addon-clipboard";
import type { ITerminalAddon } from "@overmux/xterm-fork";
import { readClipboardText, writeClipboardText } from "overmux/client";

// Upstream passes the raw OSC 52 selection string, including unknown/combined values.
export type Osc52ClipboardProvider = {
  readText: (selection: string) => string | Promise<string>;
  writeText: (selection: string, text: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
};

type ClipboardOptions = {
  selection?: "c" | "p";
  onError?: (error: unknown) => void;
};

export type ReadOnlyOsc52ClipboardOptions = ClipboardOptions & {
  readText?: () => string | Promise<string>;
};

export type WriteOnlyOsc52ClipboardOptions = ClipboardOptions & {
  writeText?: (text: string) => void | Promise<void>;
};

export type ReadAndWriteOsc52ClipboardOptions = ReadOnlyOsc52ClipboardOptions &
  WriteOnlyOsc52ClipboardOptions;

const reportError = async (
  error: unknown,
  onError: Osc52ClipboardProvider["onError"],
): Promise<void> => {
  try {
    if (onError) {
      await onError(error);
    } else {
      console.error("OSC 52 clipboard operation failed", error);
    }
  } catch (reportingError) {
    console.error(
      "OSC 52 clipboard error handler failed",
      reportingError,
      error,
    );
  }
};

// Enables selection-aware reads and writes; the provider owns access policy.
export const createOsc52ClipboardAddon = (
  provider: Osc52ClipboardProvider,
): ITerminalAddon =>
  // Upstream awaits providers without rejection handlers. Settle failures here so
  // the parser resumes; failed reads reply empty and failed writes are reported.
  // https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-clipboard/src/ClipboardAddon.ts
  new ClipboardAddon(undefined, {
    readText: async (selection) => {
      try {
        return await provider.readText(selection);
      } catch (error) {
        await reportError(error, provider.onError);
        return "";
      }
    },
    writeText: async (selection, text) => {
      try {
        await provider.writeText(selection, text);
      } catch (error) {
        await reportError(error, provider.onError);
      }
    },
  });

const unsupportedPrimary = (): never => {
  throw new Error(
    "OSC 52 primary selection requires an explicit custom callback",
  );
};

const createSelectedClipboardAddon = ({
  selection = "c",
  readText,
  writeText,
  onError,
}: ReadAndWriteOsc52ClipboardOptions): ITerminalAddon =>
  createOsc52ClipboardAddon({
    readText: (requested) =>
      requested === selection && readText ? readText() : "",
    writeText: (requested, text) => {
      if (requested === selection) {
        return writeText?.(text);
      }
    },
    onError,
  });

// Opts terminal programs into reading one selection; never writes to any selection.
export const createReadOnlyOsc52ClipboardAddon = ({
  selection = "c",
  readText = selection === "c" ? readClipboardText : unsupportedPrimary,
  onError,
}: ReadOnlyOsc52ClipboardOptions = {}): ITerminalAddon =>
  createSelectedClipboardAddon({ selection, readText, onError });

// Writes one selection; every read replies empty, without accessing the clipboard.
export const createWriteOnlyOsc52ClipboardAddon = ({
  selection = "c",
  writeText = selection === "c" ? writeClipboardText : unsupportedPrimary,
  onError,
}: WriteOnlyOsc52ClipboardOptions = {}): ITerminalAddon =>
  createSelectedClipboardAddon({ selection, writeText, onError });

// Opts terminal programs into both reading and writing one selection.
export const createReadAndWriteOsc52ClipboardAddon = ({
  selection = "c",
  readText = selection === "c" ? readClipboardText : unsupportedPrimary,
  writeText = selection === "c" ? writeClipboardText : unsupportedPrimary,
  onError,
}: ReadAndWriteOsc52ClipboardOptions = {}): ITerminalAddon =>
  createSelectedClipboardAddon({ selection, readText, writeText, onError });
