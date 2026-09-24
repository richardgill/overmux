import { useState, type ClipboardEvent, type KeyboardEvent } from "react";

type LoginCodeInputProps = {
  disabled: boolean;
};

const maxCodeLength = 8;
const codeError = "Enter 8 letters or numbers, with no spaces inside the code.";

const formatCode = (value: string) => {
  const trimmed = value.trim();
  const ungrouped = trimmed.replace("-", "");
  if (!/^[A-Za-z0-9]*$/.test(ungrouped)) {
    return trimmed;
  }
  const characters = ungrouped.slice(0, maxCodeLength).toUpperCase();
  return characters.length < 4
    ? characters
    : `${characters.slice(0, 4)}-${characters.slice(4)}`;
};

const formatInput = (input: HTMLInputElement) => {
  const { value, selectionStart, selectionEnd, selectionDirection } = input;
  const formatted = formatCode(value);
  if (formatted === value) {
    return;
  }
  // Formatting the prefix maps the native selection past an inserted dash without
  // moving edits in the middle of the code to the end of the field.
  const start = formatCode(
    value.slice(0, selectionStart ?? value.length),
  ).length;
  const end = formatCode(value.slice(0, selectionEnd ?? value.length)).length;
  input.value = formatted;
  input.setSelectionRange(start, end, selectionDirection ?? undefined);
};

const pasteCode = (event: ClipboardEvent<HTMLInputElement>) => {
  event.preventDefault();
  const input = event.currentTarget;
  // Text inputs silently remove line breaks; preserve internal ones as invalid
  // spaces rather than accidentally accepting a code with embedded whitespace.
  const pasted = event.clipboardData
    .getData("text/plain")
    .trim()
    .replace(/[\r\n]/g, " ");
  // A whole code replaces both groups regardless of the caret. Reject oversized
  // pastes before changing the field, including partial pastes that would overflow.
  const replaceWholeCode = pasted.length >= maxCodeLength;
  const start = replaceWholeCode ? 0 : (input.selectionStart ?? 0);
  const end = replaceWholeCode ? input.value.length : (input.selectionEnd ?? 0);
  const nextValue =
    input.value.slice(0, start) + pasted + input.value.slice(end);
  if (nextValue.trim().replace("-", "").length > maxCodeLength) {
    input.setCustomValidity(codeError);
    return false;
  }
  input.setCustomValidity("");
  input.setRangeText(pasted, start, end, "end");
  formatInput(input);
  return true;
};

const editSeparator = (event: KeyboardEvent<HTMLInputElement>) => {
  const input = event.currentTarget;
  const caret = input.selectionStart;
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    caret !== input.selectionEnd ||
    input.value[4] !== "-"
  ) {
    return;
  }
  if (event.key === "-" && (caret === 4 || caret === 5)) {
    event.preventDefault();
    input.setSelectionRange(5, 5);
  }
  // Treat the separator as formatting: deletion at its boundary removes the
  // adjacent character rather than restoring the dash without making progress.
  if (event.key === "Backspace" && caret === 5) {
    event.preventDefault();
    input.setRangeText("", 3, 5, "end");
    formatInput(input);
  }
  if (event.key === "Delete" && caret === 4) {
    event.preventDefault();
    input.setRangeText("", 4, Math.min(6, input.value.length), "end");
    formatInput(input);
  }
};

export const LoginCodeInput = ({ disabled }: LoginCodeInputProps) => {
  const [invalid, setInvalid] = useState(false);

  return (
    <>
      <input
        aria-describedby="auth-code-error auth-status"
        aria-invalid={invalid || undefined}
        autoCapitalize="characters"
        autoComplete="one-time-code"
        disabled={disabled}
        id="auth-code"
        maxLength={maxCodeLength + 1}
        name="code"
        onBlur={(event) => formatInput(event.currentTarget)}
        onInput={(event) => {
          event.currentTarget.setCustomValidity("");
          // Do not discard a typed space before learning whether it is internal.
          if (!/\s$/.test(event.currentTarget.value)) {
            formatInput(event.currentTarget);
          }
          setInvalid(false);
        }}
        onInvalid={() => setInvalid(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            formatInput(event.currentTarget);
          }
          editSeparator(event);
          if (event.defaultPrevented) {
            event.currentTarget.setCustomValidity("");
            setInvalid(false);
          }
        }}
        onPaste={(event) => setInvalid(!pasteCode(event))}
        pattern="[A-Za-z0-9]{4}-[A-Za-z0-9]{4}"
        placeholder="XXXX-XXXX"
        required
        spellCheck={false}
        type="text"
      />
      <p aria-live="polite" id="auth-code-error">
        {invalid ? codeError : undefined}
      </p>
    </>
  );
};
