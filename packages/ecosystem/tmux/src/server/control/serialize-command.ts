// Serializes argv into tmux control-mode commands without invoking shell parsing.
const unsafeArgumentCharacters = /[\\$"\t\r\n]/g;

const toOctalEscape = (character: string) =>
  `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`;

const escapeUnsafeCharacter = (character: string) =>
  character.charCodeAt(0) < 0x20 ? toOctalEscape(character) : `\\${character}`;

const serializeArgument = (argument: string) =>
  `"${argument.replaceAll(unsafeArgumentCharacters, escapeUnsafeCharacter)}"`;

export const serializeTmuxCommand = (args: readonly string[]) => {
  if (!args.length) {
    throw new Error("A tmux command must contain at least one argument");
  }
  return args.map(serializeArgument).join(" ");
};
