// Covers representative control-mode argument escaping and empty-command validation.
import { describe, expect, it, test as testCases } from "vitest";

import { serializeTmuxCommand } from "./serialize-command";

const serializationCases = [
  [["display-message", ""], '"display-message" ""'],
  [
    ["display-message", "space tab\tcarriage\rnewline\n"],
    String.raw`"display-message" "space tab\011carriage\015newline\012"`,
  ],
  [
    ["display-message", String.raw`single ' double " backslash \ dollar $`],
    String.raw`"display-message" "single ' double \" backslash \\ dollar \$"`,
  ],
  [
    ["display-message", "text; run-shell 'echo hacked' | another-command"],
    `"display-message" "text; run-shell 'echo hacked' | another-command"`,
  ],
  [["display-message", "Unicode λ 🌍"], '"display-message" "Unicode λ 🌍"'],
  [["display-message", "#{pane_id}"], '"display-message" "#{pane_id}"'],
] as const;

describe("tmux command serializer", () => {
  testCases.each(serializationCases)("%j -> %s", (args, serializedCommand) => {
    expect(serializeTmuxCommand(args)).toBe(serializedCommand);
  });

  it("rejects an empty command argument list", () => {
    expect(() => serializeTmuxCommand([])).toThrowError(
      "A tmux command must contain at least one argument",
    );
  });
});
