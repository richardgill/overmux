import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type RefObject,
} from "react";
import {
  matchesKeyBinding,
  platformBinding,
  type KeyBinding,
} from "@overmux/keybindings";

import {
  activeCommandBindings,
  configuredCommandBindings,
  shortcutMediaQueries,
  type ClientAppDefinition,
  type CommandHandle,
  type ShortcutBinding,
} from "./client-definition";
import {
  CommandsContext,
  createCommandEntries,
  executeCommand,
  selectCommandRegistration,
  type RegisteredCommand,
} from "./commands";

const bindingSequence = (binding: ShortcutBinding): KeyBinding[] =>
  typeof binding === "string" ? [binding] : [...binding];

const normalizedBinding = (binding: ShortcutBinding): string[] =>
  bindingSequence(binding).map((key) => platformBinding(key));

const sequenceMatches = (
  binding: ShortcutBinding,
  pending: string[],
  event: KeyboardEvent,
) => {
  const sequence = normalizedBinding(binding);
  return (
    sequence.length > pending.length &&
    pending.every((key, index) => sequence[index] === key) &&
    matchesKeyBinding(sequence[pending.length] as KeyBinding, event)
  );
};

const isTextInput = (element: Element | null) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLSelectElement ||
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLElement &&
    (element.isContentEditable || element.getAttribute("role") === "textbox"));

const acceptsTextInput = (bindings: readonly ShortcutBinding[]) => {
  if (!(document.activeElement instanceof Element)) {
    return false;
  }
  const terminal = document.activeElement.closest(".xterm");
  if (!terminal) {
    return false;
  }
  if (terminal.closest("[data-copy-mode]")) {
    return true;
  }
  return bindings.some((binding) => {
    const sequence = bindingSequence(binding);
    return (
      sequence.length > 1 ||
      sequence[0]?.startsWith("F") ||
      sequence[0]?.includes("+")
    );
  });
};

type Shortcut = {
  bindings: readonly [ShortcutBinding, ...ShortcutBinding[]];
  command: CommandHandle;
};

const flattenShortcuts = (
  definition: ClientAppDefinition,
  matchesMedia: (media: string) => boolean,
): Shortcut[] =>
  Object.values(definition.commands).flatMap((command) => {
    const bindings = activeCommandBindings(
      configuredCommandBindings(definition, command),
      matchesMedia,
    );
    return bindings.length
      ? [
          {
            bindings: bindings as [ShortcutBinding, ...ShortcutBinding[]],
            command,
          },
        ]
      : [];
  });

const canRunShortcut = (
  shortcut: Shortcut,
  event: KeyboardEvent,
  registrations: ReadonlySet<RegisteredCommand>,
) => {
  const selected = selectCommandRegistration(
    shortcut.command,
    registrations,
    document.activeElement,
  );
  return Boolean(
    selected?.enabled() &&
    !event.repeat &&
    !(
      isTextInput(document.activeElement) &&
      !acceptsTextInput(shortcut.bindings)
    ),
  );
};

const runShortcut = (
  shortcut: Shortcut,
  event: KeyboardEvent,
  registrations: ReadonlySet<RegisteredCommand>,
) => {
  if (!canRunShortcut(shortcut, event, registrations)) {
    return false;
  }
  void executeCommand(shortcut.command, registrations);
  event.preventDefault();
  return true;
};

export type ShortcutInputTarget = {
  container: RefObject<HTMLElement | null>;
  input: RefObject<HTMLElement | null>;
};
type RegisterShortcutInputTarget = (target: ShortcutInputTarget) => () => void;

const ShortcutInputTargetsContext = createContext<
  RegisterShortcutInputTarget | undefined
>(undefined);

export const useShortcutInputTarget = (target: ShortcutInputTarget) => {
  const register = useContext(ShortcutInputTargetsContext);
  const { container, input } = target;
  useEffect(
    () => register?.({ container, input }),
    [container, input, register],
  );
};

const elementDepth = (element: HTMLElement) => {
  let depth = 0;
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.parentElement
  ) {
    depth += 1;
  }
  return depth;
};

const selectShortcutInputTarget = (
  targets: ReadonlySet<ShortcutInputTarget>,
  activeElement: Element | null,
) =>
  [...targets]
    .filter((target) => {
      const container = target.container.current;
      return Boolean(
        container && activeElement && container.contains(activeElement),
      );
    })
    .reduce<ShortcutInputTarget | undefined>((selected, candidate) => {
      const selectedElement = selected?.container.current;
      const candidateElement = candidate.container.current;
      if (!selectedElement || !candidateElement) {
        return candidate;
      }
      return elementDepth(candidateElement) >= elementDepth(selectedElement)
        ? candidate
        : selected;
    }, undefined);

const replayedKeyboardEvents = new WeakSet<KeyboardEvent>();
const keyboardEventProperties = ["charCode", "keyCode", "which"] as const;

const replayKeyboardEvent = (target: HTMLElement, source: KeyboardEvent) => {
  const replay = new KeyboardEvent(source.type, {
    altKey: source.altKey,
    bubbles: true,
    cancelable: true,
    code: source.code,
    composed: true,
    ctrlKey: source.ctrlKey,
    key: source.key,
    location: source.location,
    metaKey: source.metaKey,
    repeat: source.repeat,
    shiftKey: source.shiftKey,
  });
  keyboardEventProperties.forEach((property) =>
    Object.defineProperty(replay, property, { value: source[property] }),
  );
  replayedKeyboardEvents.add(replay);
  target.dispatchEvent(replay);
};

const replayChord = (
  target: ShortcutInputTarget | undefined,
  events: readonly KeyboardEvent[],
) => {
  const input = target?.input.current;
  if (!input) {
    return;
  }
  events.forEach((event) => replayKeyboardEvent(input, event));
};

export const ShortcutHost = ({
  children,
  definition,
  registrations,
  registrationRevision,
}: {
  children: ReactNode;
  definition: ClientAppDefinition;
  registrations: Set<RegisteredCommand>;
  registrationRevision: number;
}) => {
  const [, setFocusRevision] = useState(0);
  const [inputTargets] = useState(() => new Set<ShortcutInputTarget>());
  const [mediaRevision, setMediaRevision] = useState(0);
  const registerInputTarget = useCallback(
    (target: ShortcutInputTarget) => {
      inputTargets.add(target);
      return () => {
        inputTargets.delete(target);
      };
    },
    [inputTargets],
  );
  useEffect(() => {
    const refreshMedia = () => setMediaRevision((revision) => revision + 1);
    const queries = shortcutMediaQueries(definition).map((media) =>
      window.matchMedia(media),
    );
    queries.forEach((query) => query.addEventListener("change", refreshMedia));
    return () =>
      queries.forEach((query) =>
        query.removeEventListener("change", refreshMedia),
      );
  }, [definition]);
  useEffect(() => {
    const refreshFocus = () => setFocusRevision((revision) => revision + 1);
    window.addEventListener("focusin", refreshFocus);
    return () => window.removeEventListener("focusin", refreshFocus);
  }, []);
  useEffect(() => {
    const shortcuts = flattenShortcuts(
      definition,
      (media) => window.matchMedia(media).matches,
    );
    let pending: string[] = [];
    let pendingEvents: KeyboardEvent[] = [];
    let pendingTarget: ShortcutInputTarget | undefined;
    let timeout: number | undefined;
    const clearPending = () => {
      pending = [];
      pendingEvents = [];
      pendingTarget = undefined;
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
        timeout = undefined;
      }
    };
    const replayPending = (events = pendingEvents) => {
      replayChord(pendingTarget, events);
      clearPending();
    };
    const scheduleTimeout = () => {
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
      timeout = window.setTimeout(() => replayPending(), 1_000);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (replayedKeyboardEvents.has(event)) {
        return;
      }
      if (pending.length && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        clearPending();
        return;
      }
      const matches = shortcuts.flatMap((shortcut) =>
        shortcut.bindings
          .filter(
            (binding) =>
              sequenceMatches(binding, pending, event) &&
              canRunShortcut(shortcut, event, registrations),
          )
          .map((binding) => ({ binding, shortcut })),
      );
      if (!matches.length) {
        if (pending.length) {
          event.preventDefault();
          event.stopPropagation();
          replayPending([...pendingEvents, event]);
        }
        return;
      }
      const complete = matches.find(
        ({ binding }) =>
          normalizedBinding(binding).length === pending.length + 1,
      );
      if (complete) {
        clearPending();
        if (runShortcut(complete.shortcut, event, registrations)) {
          event.stopPropagation();
        }
        return;
      }
      if (!pending.length) {
        const shouldReplay = definition.chordPrefixes?.some((prefix) =>
          matchesKeyBinding(prefix.binding, event),
        );
        pendingTarget = shouldReplay
          ? selectShortcutInputTarget(inputTargets, document.activeElement)
          : undefined;
      }
      pending = [
        ...pending,
        normalizedBinding(matches[0]!.binding)[pending.length]!,
      ];
      pendingEvents = [...pendingEvents, event];
      event.preventDefault();
      event.stopPropagation();
      scheduleTimeout();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
    };
  }, [
    definition,
    inputTargets,
    mediaRevision,
    registrationRevision,
    registrations,
  ]);
  const commands = createCommandEntries(
    definition,
    registrations,
    () => document.activeElement,
    (media) => window.matchMedia(media).matches,
  );
  return (
    <ShortcutInputTargetsContext.Provider value={registerInputTarget}>
      <CommandsContext.Provider value={commands}>
        {children}
      </CommandsContext.Provider>
    </ShortcutInputTargetsContext.Provider>
  );
};
