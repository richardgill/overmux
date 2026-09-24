import type { OvermuxContrast, OvermuxScheme } from "./theme-scope";
import type { ComponentType } from "react";
import {
  formatKeyBinding,
  keyBindingSchema,
  matchesKeyBinding,
  type KeyBinding,
} from "@overmux/keybindings";
export type { KeyBinding } from "@overmux/keybindings";
import { z } from "zod";

import type { OvermuxServerApi } from "./browser-api";

export type KeySequence = readonly [KeyBinding, KeyBinding, ...KeyBinding[]];
export type ShortcutBinding = KeyBinding | KeySequence;
export type ConditionalShortcutBinding = {
  binding: ShortcutBinding;
  when: { media: string };
};
export type CommandBinding = ShortcutBinding | ConditionalShortcutBinding;
export type ChordPrefix = {
  binding: KeyBinding;
  unmatched: "replay-to-focused-input";
};

const shortcutBindingSchema = z.union([
  keyBindingSchema,
  z.array(keyBindingSchema).min(2),
]);
const commandBindingSchema = z.union([
  shortcutBindingSchema,
  z.object({
    binding: shortcutBindingSchema,
    when: z.object({ media: z.string().trim().min(1) }),
  }),
]);
const chordPrefixSchema = z.object({
  binding: keyBindingSchema,
  unmatched: z.literal("replay-to-focused-input"),
});

export const formatShortcutBinding = (binding: ShortcutBinding) =>
  typeof binding === "string"
    ? formatKeyBinding(binding)
    : binding.map(formatKeyBinding).join(" ");

type CommandRunResult = Promise<unknown> | unknown;
type CommandRun<TServerConfig, TParams> = (input: {
  overmuxServerApi: OvermuxServerApi<TServerConfig>;
  params: TParams;
}) => CommandRunResult;
type CommandDefinitionSource = {
  defaultBindings?: readonly CommandBinding[];
  params?: z.ZodType;
  run?: unknown;
  title: string;
};
type ParamsSchema<TCommand> = TCommand extends {
  params: infer TParams extends z.ZodType;
}
  ? TParams
  : undefined;
type ParamsOutput<TCommand> =
  ParamsSchema<TCommand> extends z.ZodType
    ? z.output<ParamsSchema<TCommand>>
    : undefined;
type CheckedCommand<TServerConfig, TCommand extends CommandDefinitionSource> = {
  [TKey in keyof TCommand]: TKey extends "run"
    ? CommandRun<TServerConfig, ParamsOutput<TCommand>>
    : TCommand[TKey];
} & {
  defaultBindings?: readonly CommandBinding[];
  params?: z.ZodType;
  title: string;
};
type CheckedCommands<
  TServerConfig,
  TCommands extends Record<string, CommandDefinitionSource>,
> = {
  [TId in keyof TCommands]: CheckedCommand<TServerConfig, TCommands[TId]>;
};

export type CommandHandle<TId extends string = string> = {
  defaultBindings?: readonly CommandBinding[];
  id: TId;
  params?: z.ZodType;
  run?: unknown;
  title: string;
};

type DefinedCommands<
  TServerConfig,
  TCommands extends Record<string, CommandDefinitionSource>,
> = {
  readonly [TId in keyof TCommands]: CheckedCommand<
    TServerConfig,
    TCommands[TId]
  > & { readonly id: Extract<TId, string> };
};

const validateBindings = (bindings: readonly CommandBinding[] | undefined) =>
  bindings?.forEach((binding) => commandBindingSchema.parse(binding));

export const defineCommandRegistry =
  <TServerConfig>() =>
  <const TCommands extends Record<string, CommandDefinitionSource>>(
    commands: CheckedCommands<TServerConfig, TCommands>,
  ): DefinedCommands<TServerConfig, TCommands> =>
    Object.fromEntries(
      Object.entries(commands).map(([id, command]) => {
        validateBindings(command.defaultBindings);
        return [id, { ...command, id }];
      }),
    ) as DefinedCommands<TServerConfig, TCommands>;

export type CommandRegistry = Readonly<Record<string, CommandHandle>>;

export type OvermuxClientAppearance = {
  contrast?: OvermuxContrast;
  scheme?: OvermuxScheme;
};

export type ClientAppDefinition<
  TCommands extends CommandRegistry = CommandRegistry,
> = {
  appearance?: OvermuxClientAppearance;
  chordPrefixes?: readonly ChordPrefix[];
  commands: TCommands;
  component: ComponentType;
  // Receives validated same-instance deep-link routes, including query and fragment.
  // Defaults to document navigation on the current origin; supply your router to avoid a reload.
  navigate?: (route: string) => unknown;
  shortcutOverrides?: Partial<
    Record<Extract<keyof TCommands, string>, readonly CommandBinding[]>
  >;
};

export const defineOvermuxClient = <const TCommands extends CommandRegistry>(
  definition: ClientAppDefinition<TCommands>,
): ClientAppDefinition<TCommands> => {
  definition.chordPrefixes?.forEach((prefix) =>
    chordPrefixSchema.parse(prefix),
  );
  Object.values(definition.shortcutOverrides ?? {}).forEach(validateBindings);
  return definition;
};

export const isConditionalShortcutBinding = (
  binding: CommandBinding,
): binding is ConditionalShortcutBinding =>
  typeof binding !== "string" && !Array.isArray(binding);

export const resolveShortcutBinding = (
  binding: CommandBinding,
): ShortcutBinding =>
  isConditionalShortcutBinding(binding) ? binding.binding : binding;

export const configuredCommandBindings = (
  definition: ClientAppDefinition,
  command: CommandHandle,
) =>
  definition.shortcutOverrides?.[command.id] ?? command.defaultBindings ?? [];

export const activeCommandBindings = (
  bindings: readonly CommandBinding[],
  matchesMedia: (media: string) => boolean,
) =>
  bindings.flatMap((binding) =>
    !isConditionalShortcutBinding(binding) || matchesMedia(binding.when.media)
      ? [resolveShortcutBinding(binding)]
      : [],
  );

export const shortcutMediaQueries = (definition: ClientAppDefinition) => [
  ...new Set(
    Object.values(definition.commands).flatMap((command) =>
      configuredCommandBindings(definition, command).flatMap((binding) =>
        isConditionalShortcutBinding(binding) ? [binding.when.media] : [],
      ),
    ),
  ),
];
