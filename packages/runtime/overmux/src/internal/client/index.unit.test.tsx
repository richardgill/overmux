import { describe, expect, it } from "vitest";

import * as react from "./index";
import {
  defineCommandRegistry,
  defineOvermuxClient,
  formatShortcutBinding,
} from "./index";

const App = () => null;

const commands = defineCommandRegistry<unknown>()({
  close: { defaultBindings: [["§", "X"]], title: "Close" },
  settings: { title: "Settings" },
});

describe("React public API", () => {
  it("publishes the intended command and hook API", () => {
    expect(react).toMatchObject({
      OvermuxPortal: expect.any(Function),
      OvermuxThemeScope: expect.any(Function),
      createOvermuxHooks: expect.any(Function),
      defineCommandRegistry: expect.any(Function),
      defineOvermuxClient: expect.any(Function),
      formatShortcutBinding: expect.any(Function),
      skipToken: expect.any(Symbol),
      useCommand: expect.any(Function),
      useCommands: expect.any(Function),
      useShortcutInputTarget: expect.any(Function),
    });
    [
      "chordPrefixSchema",
      "commandBindingSchema",
      "formatKeyBinding",
      "keyBindingSchema",
      "matchesKeyBinding",
      "shortcutBindingSchema",
    ].forEach((name) => expect(react).not.toHaveProperty(name));
    expect(react).not.toHaveProperty("SplitView");
    expect(react).not.toHaveProperty("sidebarItemSchema");
    expect(react).not.toHaveProperty("useUrlSelection");
    expect(react).not.toHaveProperty("DefaultModal");
    expect(react).not.toHaveProperty("DefaultShell");
    expect(react).not.toHaveProperty("DefaultSidebar");
    expect(react).not.toHaveProperty("ResponsiveSidePanel");
    expect(react).not.toHaveProperty("createOvermuxReact");
    expect(react).not.toHaveProperty("useActiveCommands");
    expect(react).not.toHaveProperty("useCommandTarget");
    expect(react).not.toHaveProperty("useShortcutState");
  });

  it("keeps prefix bindings as sequences", () => {
    expect(formatShortcutBinding(["§", "X"])).toBe("§ X");
    expect(commands.close.defaultBindings).toEqual([["§", "X"]]);
  });

  it("publishes palette metadata and shortcut overrides", () => {
    const definition = defineOvermuxClient({
      commands,
      component: App,
      appearance: { contrast: "high", scheme: "dark" },
      shortcutOverrides: { close: ["Control+Shift+X"] },
    });

    expect(definition.appearance).toEqual({ contrast: "high", scheme: "dark" });
    expect(definition.commands.settings.title).toBe("Settings");
    expect(definition.shortcutOverrides?.close).toEqual(["Control+Shift+X"]);
  });
});
