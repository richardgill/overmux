import { matchesKeyBinding, type KeyBinding } from "@overmux/keybindings";

export type XtermKeyMapping = readonly [binding: KeyBinding, input: string];

type InputTerminal = { input: (data: string) => void };

export const createXtermKeyEventHandler =
  (terminal: InputTerminal, mappings: readonly XtermKeyMapping[]) =>
  (event: KeyboardEvent) => {
    if (event.type !== "keydown") {
      return true;
    }
    const mapping = mappings.find(([binding]) =>
      matchesKeyBinding(binding, event),
    );
    if (!mapping) {
      return true;
    }
    event.preventDefault();
    terminal.input(mapping[1]);
    return false;
  };
