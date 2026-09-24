import { describe, expect, it } from "vitest";

import {
  defineCommandRegistry,
  defineOvermuxClient,
  formatShortcutBinding,
} from "./client-definition";

const commands = defineCommandRegistry<unknown>()({
  closePane: { defaultBindings: [["§", "X"]], title: "Close pane" },
  copy: { defaultBindings: ["Control+Shift+C"], title: "Copy" },
  settings: { title: "Settings" },
});

describe("client command definitions", () => {
  it("validates and formats structural bindings", () => {
    expect(formatShortcutBinding(["§", "X"])).toBe("§ X");
    expect(() =>
      defineCommandRegistry<unknown>()({
        invalid: {
          defaultBindings: ["Ctrl+X" as "Control+X"],
          title: "Invalid",
        },
      }),
    ).toThrow("Invalid keyboard binding");
    expect(() =>
      defineOvermuxClient({
        commands,
        component: () => null,
        shortcutOverrides: {
          copy: [{ binding: "Control+C", when: { media: " " } }],
        },
      }),
    ).toThrow();
    expect(() =>
      defineOvermuxClient({
        chordPrefixes: [
          {
            binding: ["F12", "D"],
            unmatched: "replay-to-focused-input",
          } as never,
        ],
        commands,
        component: () => null,
      }),
    ).toThrow();
  });

  it("keeps commands without shortcuts and supports overrides", () => {
    const definition = defineOvermuxClient({
      commands,
      component: () => null,
      shortcutOverrides: {
        closePane: ["Control+Shift+X"],
        copy: [{ binding: "Alt+C", when: { media: "(min-width: 800px)" } }],
      },
    });

    expect(definition.commands.settings.defaultBindings).toBeUndefined();
    expect(definition.shortcutOverrides).toEqual({
      closePane: ["Control+Shift+X"],
      copy: [{ binding: "Alt+C", when: { media: "(min-width: 800px)" } }],
    });
  });
});
