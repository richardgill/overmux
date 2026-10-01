import type { Event, Input, WebContents } from "electron";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, expectTypeOf, it } from "vitest";

import {
  defineOvermuxDesktopConfig,
  type DesktopBeforeInputEventContext,
  type DesktopBeforeInputEventHandler,
  type DesktopConfigDefinition,
} from "./index";

it("defines the flat desktop configuration API", () => {
  const config = defineOvermuxDesktopConfig({
    macosTitleBarStyle: "transparent",
    macosTrafficLights: "visible",
    menuBar: "auto-hide",
    titleBar: "hidden",
  });

  expect(config).toEqual({
    macosTitleBarStyle: "transparent",
    macosTrafficLights: "visible",
    menuBar: "auto-hide",
    titleBar: "hidden",
  });
  expectTypeOf(config).toMatchTypeOf<DesktopConfigDefinition>();
  expectTypeOf(config.titleBar).toEqualTypeOf<"hidden">();
});

it("infers the actual Electron callback context through the public config API", () => {
  const config = defineOvermuxDesktopConfig({
    onBeforeInputEvent: ({ event, input, webContents }) => {
      expectTypeOf(event).toEqualTypeOf<Event>();
      expectTypeOf(input).toEqualTypeOf<Input>();
      expectTypeOf(webContents).toEqualTypeOf<WebContents>();
    },
  });

  expectTypeOf(
    config.onBeforeInputEvent,
  ).toMatchTypeOf<DesktopBeforeInputEventHandler>();
  expectTypeOf<DesktopBeforeInputEventContext>().toEqualTypeOf<{
    event: Event;
    input: Input;
    webContents: WebContents;
  }>();
});

it("exposes configuration without depending on the Overmux runtime", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../../package.json"), "utf8"),
  ) as {
    devDependencies: Record<string, string>;
    exports: Record<string, unknown>;
  };

  expect(packageJson.exports).toEqual({
    ".": {
      import: "./dist/config/index.js",
      types: "./dist/config/index.d.ts",
    },
  });
  expect(packageJson.devDependencies).not.toHaveProperty("overmux");
});
