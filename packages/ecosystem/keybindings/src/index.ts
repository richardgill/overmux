import { z } from "zod";

type Letter =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type FunctionKey = `F${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;
type PunctuationKey =
  | "/"
  | "["
  | "]"
  | "\\"
  | "="
  | "-"
  | ","
  | "."
  | ";"
  | ":"
  | "`"
  | "'";
type NamedKey =
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "Backspace"
  | "Delete"
  | "End"
  | "Enter"
  | "Escape"
  | "Home"
  | "Insert"
  | "PageDown"
  | "PageUp"
  | "Space"
  | "Tab";
type ShortcutKey =
  | Digit
  | FunctionKey
  | Letter
  | NamedKey
  | PunctuationKey
  | "§";
type ShiftSafeKey = Letter | FunctionKey | NamedKey;

export type KeyBinding =
  | ShortcutKey
  | `${"Control" | "Alt" | "Meta" | "Mod"}+${ShortcutKey}`
  | `Shift+${ShiftSafeKey}`
  | `Control+Alt+${ShortcutKey}`
  | `${"Control" | "Alt"}+Shift+${ShiftSafeKey}`
  | `${"Control" | "Alt"}+Meta+${ShortcutKey}`
  | `Shift+Meta+${ShiftSafeKey}`
  | `Mod+Alt+${ShortcutKey}`
  | `Mod+Shift+${ShiftSafeKey}`
  | `Control+Alt+Shift+${ShiftSafeKey}`
  | `Control+Alt+Meta+${ShortcutKey}`
  | `${"Control" | "Alt"}+Shift+Meta+${ShiftSafeKey}`
  | `Mod+Alt+Shift+${ShiftSafeKey}`
  | `Control+Alt+Shift+Meta+${ShiftSafeKey}`;
export type KeySequence = readonly [KeyBinding, KeyBinding, ...KeyBinding[]];
export type ShortcutBinding = KeyBinding | KeySequence;

const shortcutKeys = new Set([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ...Array.from({ length: 12 }, (_value, index) => `F${index + 1}`),
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "Insert",
  "PageDown",
  "PageUp",
  "Space",
  "Tab",
  "/",
  "[",
  "]",
  "\\",
  "=",
  "-",
  ",",
  ".",
  ";",
  ":",
  "`",
  "'",
  "§",
]);
const shiftSafeKeys = new Set([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ...Array.from({ length: 12 }, (_value, index) => `F${index + 1}`),
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "Insert",
  "PageDown",
  "PageUp",
  "Space",
  "Tab",
]);
const modifierPrefixes = new Set([
  "",
  "Control",
  "Alt",
  "Shift",
  "Meta",
  "Mod",
  "Control+Alt",
  "Control+Shift",
  "Control+Meta",
  "Alt+Shift",
  "Alt+Meta",
  "Shift+Meta",
  "Mod+Alt",
  "Mod+Shift",
  "Control+Alt+Shift",
  "Control+Alt+Meta",
  "Control+Shift+Meta",
  "Alt+Shift+Meta",
  "Mod+Alt+Shift",
  "Control+Alt+Shift+Meta",
]);

export const keyBindingSchema = z.custom<KeyBinding>((value) => {
  if (typeof value !== "string") {
    return false;
  }
  const parts = value.split("+");
  const key = parts.at(-1) ?? "";
  const prefix = parts.slice(0, -1).join("+");
  return (
    shortcutKeys.has(key) &&
    modifierPrefixes.has(prefix) &&
    (!parts.includes("Shift") || shiftSafeKeys.has(key))
  );
}, "Invalid keyboard binding");

export const shortcutBindingSchema = z.union([
  keyBindingSchema,
  z.tuple([keyBindingSchema, keyBindingSchema]).rest(keyBindingSchema),
]);

const isMacPlatform = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export const keyBindingSequence = (binding: ShortcutBinding) =>
  typeof binding === "string" ? [binding] : binding;

export const platformBinding = (binding: KeyBinding, isMac = isMacPlatform()) =>
  binding.replace("Mod", isMac ? "Meta" : "Control") as KeyBinding;

export const normalizedShortcutBinding = (
  binding: ShortcutBinding,
  isMac = isMacPlatform(),
) => keyBindingSequence(binding).map((key) => platformBinding(key, isMac));

export const shortcutBindingsEqual = (
  left: ShortcutBinding,
  right: ShortcutBinding,
  isMac = isMacPlatform(),
) =>
  normalizedShortcutBinding(left, isMac).join("+") ===
  normalizedShortcutBinding(right, isMac).join("+");

export type KeyBindingInput = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

export const formatKeyBinding = (binding: KeyBinding) => {
  if (!isMacPlatform()) {
    return platformBinding(binding);
  }
  return platformBinding(binding)
    .replaceAll("Control", "⌃")
    .replaceAll("Alt", "⌥")
    .replaceAll("Shift", "⇧")
    .replaceAll("Meta", "⌘")
    .replaceAll("+", " ");
};

export const formatShortcutBinding = (binding: ShortcutBinding) =>
  keyBindingSequence(binding).map(formatKeyBinding).join(" ");

const eventKey = (event: KeyBindingInput) =>
  event.key === " "
    ? "Space"
    : event.key.length === 1
      ? event.key.toUpperCase()
      : event.key;

export const matchesKeyBinding = (
  binding: KeyBinding,
  event: KeyBindingInput,
  isMac = isMacPlatform(),
) => {
  const parts = binding.split("+");
  const key = parts.at(-1);
  const expected = new Set(parts.slice(0, -1));
  return (
    key === eventKey(event) &&
    event.altKey === expected.has("Alt") &&
    (key === ":" || event.shiftKey === expected.has("Shift")) &&
    event.ctrlKey ===
      (expected.has("Control") || (expected.has("Mod") && !isMac)) &&
    event.metaKey === (expected.has("Meta") || (expected.has("Mod") && isMac))
  );
};

export const matchesShortcutBindingPrefix = ({
  binding,
  input,
  isMac = isMacPlatform(),
  pending,
}: {
  binding: ShortcutBinding;
  input: KeyBindingInput;
  isMac?: boolean;
  pending: readonly KeyBinding[];
}) => {
  const sequence = normalizedShortcutBinding(binding, isMac);
  return (
    sequence.length > pending.length &&
    pending.every((key, index) => sequence[index] === key) &&
    matchesKeyBinding(sequence[pending.length]!, input, isMac)
  );
};
