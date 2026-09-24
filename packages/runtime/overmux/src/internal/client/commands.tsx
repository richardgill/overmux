import type { RuntimeManifest } from "../shared/index";
import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useRef,
} from "react";
import { z } from "zod";

import type {
  ClientAppDefinition,
  CommandHandle,
  ShortcutBinding,
} from "./client-definition";
import {
  activeCommandBindings,
  configuredCommandBindings,
} from "./client-definition";
import type { RuntimeOvermuxServerApi } from "./browser-api";

type CommandRunResult = Promise<unknown> | unknown;
type LocalCommandRun = () => CommandRunResult;
type ParamsSchema<TCommand> = TCommand extends {
  params: infer TParams extends z.ZodType;
}
  ? TParams
  : undefined;
type RegistrationParams<TCommand> =
  ParamsSchema<TCommand> extends z.ZodType
    ? { params: z.input<ParamsSchema<TCommand>> }
    : { params?: never };
type RegistrationRun<TCommand> = TCommand extends {
  run: (...args: never[]) => unknown;
}
  ? { run?: LocalCommandRun }
  : { run: LocalCommandRun };
type CommandRegistration<TCommand> = RegistrationParams<TCommand> &
  RegistrationRun<TCommand> & {
    element?: RefObject<HTMLElement | null>;
    enabled?: boolean;
  };
type UseCommandRegistration<TCommand> =
  ParamsSchema<TCommand> extends z.ZodType
    ? CommandRegistration<TCommand> | SkipToken
    : CommandRegistration<TCommand>;

export const skipToken = Symbol("overmux command registration");
export type SkipToken = typeof skipToken;

export type RegisteredCommand = {
  command: CommandHandle;
  element: () => HTMLElement | null | undefined;
  enabled: () => boolean;
  execute: () => Promise<void>;
};

type RuntimeContextValue = {
  manifest: RuntimeManifest;
  overmuxServerApi: RuntimeOvermuxServerApi;
  refreshCommands: () => void;
  registerCommand: (registration: RegisteredCommand) => () => void;
};

export const RuntimeContext = createContext<RuntimeContextValue | undefined>(
  undefined,
);

export const useRuntime = () => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) {
    throw new Error(
      "Overmux hooks must be used inside an active Overmux client runtime",
    );
  }
  return runtime;
};

type RuntimeCommandRegistration = {
  element?: RefObject<HTMLElement | null>;
  enabled?: boolean;
  params?: unknown;
  run?: LocalCommandRun;
};

const executeRegistration = async (
  command: CommandHandle,
  registration: RuntimeCommandRegistration,
  overmuxServerApi: RuntimeOvermuxServerApi,
) => {
  const params = command.params
    ? command.params.parse(registration.params)
    : undefined;
  if (registration.run) {
    await registration.run();
    return;
  }
  if (typeof command.run !== "function") {
    throw new Error(`Command has no implementation: ${command.id}`);
  }
  await command.run({ overmuxServerApi, params });
};

export const createRegisteredCommand = ({
  command,
  getRegistration,
  overmuxServerApi,
}: {
  command: CommandHandle;
  getRegistration: () => RuntimeCommandRegistration | SkipToken;
  overmuxServerApi: RuntimeOvermuxServerApi;
}): RegisteredCommand => ({
  command,
  element: () => {
    const registration = getRegistration();
    return registration === skipToken
      ? undefined
      : registration.element?.current;
  },
  enabled: () => {
    const registration = getRegistration();
    return registration === skipToken ? false : (registration.enabled ?? true);
  },
  execute: () => {
    const registration = getRegistration();
    return registration === skipToken
      ? Promise.resolve()
      : executeRegistration(command, registration, overmuxServerApi);
  },
});

export const useCommand = <TCommand extends CommandHandle>(
  command: TCommand,
  registration: UseCommandRegistration<TCommand>,
) => {
  const { overmuxServerApi, refreshCommands, registerCommand } = useRuntime();
  const registrationRef = useRef(registration);
  registrationRef.current = registration;
  const skipped = registration === skipToken;
  useEffect(() => {
    if (skipped) {
      return;
    }
    return registerCommand(
      createRegisteredCommand({
        command,
        getRegistration: () =>
          registrationRef.current as RuntimeCommandRegistration | SkipToken,
        overmuxServerApi,
      }),
    );
  }, [command, overmuxServerApi, registerCommand, skipped]);
  const enabled = skipped ? false : (registration.enabled ?? true);
  const element = skipped ? undefined : registration.element;
  useEffect(refreshCommands, [element, enabled, refreshCommands, skipped]);
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

export const selectCommandRegistration = (
  command: CommandHandle,
  registrations: ReadonlySet<RegisteredCommand>,
  activeElement: Element | null,
) => {
  const candidates = [...registrations].filter(
    (registration) => registration.command === command,
  );
  const focused = candidates.filter((registration) => {
    const element = registration.element();
    return Boolean(element && activeElement && element.contains(activeElement));
  });
  return (
    focused.reduce<RegisteredCommand | undefined>((selected, candidate) => {
      const selectedElement = selected?.element();
      const candidateElement = candidate.element();
      if (!selectedElement || !candidateElement) {
        return candidate;
      }
      return elementDepth(candidateElement) >= elementDepth(selectedElement)
        ? candidate
        : selected;
    }, undefined) ?? candidates.at(-1)
  );
};

const currentActiveElement = () => document.activeElement;

const selectedRegistration = (
  command: CommandHandle,
  registrations: ReadonlySet<RegisteredCommand>,
  getActiveElement: () => Element | null = currentActiveElement,
) => selectCommandRegistration(command, registrations, getActiveElement());

export const executeCommand = async (
  command: CommandHandle,
  registrations: ReadonlySet<RegisteredCommand>,
  getActiveElement: () => Element | null = currentActiveElement,
) => {
  const selected = selectedRegistration(
    command,
    registrations,
    getActiveElement,
  );
  if (selected?.enabled()) {
    await selected.execute();
  }
};

export type CommandEntry = {
  bindings: readonly ShortcutBinding[];
  disabledReason?: string;
  enabled: boolean;
  execute: () => Promise<void>;
  id: string;
  title: string;
};

export const createCommandEntries = (
  definition: ClientAppDefinition,
  registrations: ReadonlySet<RegisteredCommand>,
  getActiveElement: () => Element | null = currentActiveElement,
  matchesMedia: (media: string) => boolean = (media) =>
    typeof window !== "undefined" && window.matchMedia(media).matches,
): CommandEntry[] =>
  Object.values(definition.commands).flatMap((command) => {
    const selected = selectedRegistration(
      command,
      registrations,
      getActiveElement,
    );
    return selected
      ? [
          {
            bindings: activeCommandBindings(
              configuredCommandBindings(definition, command),
              matchesMedia,
            ),
            enabled: selected.enabled(),
            execute: () =>
              executeCommand(command, registrations, getActiveElement),
            id: command.id,
            title: command.title,
          },
        ]
      : [];
  });

export const CommandsContext = createContext<readonly CommandEntry[]>([]);

export const useCommands = () => useContext(CommandsContext);
