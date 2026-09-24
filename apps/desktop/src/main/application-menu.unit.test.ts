import { beforeEach, describe, expect, it, vi } from "vitest";

const menuMocks = vi.hoisted(() => {
  type TestMenuItem = {
    accelerator?: string;
    click?: () => void;
    label?: string;
    role?: string;
    submenu?: TestMenuItem[];
    type?: string;
  };

  const state: { applicationMenu?: unknown; template?: TestMenuItem[] } = {};
  const menu = {
    buildFromTemplate: vi.fn((template: TestMenuItem[]) => {
      state.template = template;
      return { type: "built-menu" };
    }),
    setApplicationMenu: vi.fn((applicationMenu: unknown) => {
      state.applicationMenu = applicationMenu;
    }),
  };
  return { menu, state };
});

vi.mock("electron", () => ({ Menu: menuMocks.menu }));

import { installApplicationMenu } from "./application-menu.js";

const getMenu = (label: string) =>
  menuMocks.state.template?.find((item) => item.label === label)?.submenu ?? [];

const menuOptions = () => ({
  clear: vi.fn(),
  logout: vi.fn(),
  openDeveloperTools: vi.fn(),
  openSettings: vi.fn(),
  reload: vi.fn(),
  reset: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  menuMocks.state.applicationMenu = undefined;
  menuMocks.state.template = undefined;
});

describe("desktop application menu", () => {
  it("opens remote developer tools through the explicit callback", () => {
    const options = menuOptions();
    installApplicationMenu(options);

    const viewMenu = getMenu("View");
    viewMenu
      .find((item) => item.label === "Open Overmux Developer Tools")
      ?.click?.();

    expect(options.openDeveloperTools).toHaveBeenCalledOnce();
    expect(viewMenu.some((item) => item.role === "toggleDevTools")).toBe(false);
    expect(menuMocks.menu.setApplicationMenu).toHaveBeenCalledWith({
      type: "built-menu",
    });
  });

  it("provides native text editing actions", () => {
    installApplicationMenu(menuOptions());

    expect(getMenu("Edit").flatMap((item) => item.role ?? [])).toEqual([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
  });

  it("wires hosted pages, reload, and clear to instance callbacks", () => {
    const options = menuOptions();
    installApplicationMenu(options);

    const instanceMenu = getMenu("Instance");
    instanceMenu.find((item) => item.label === "Overmux Settings…")?.click?.();
    instanceMenu.find((item) => item.label === "Log Out…")?.click?.();
    const reloadItem = instanceMenu.find(
      (item) => item.label === "Reload Overmux",
    );
    reloadItem?.click?.();
    const resetItem = instanceMenu[instanceMenu.indexOf(reloadItem!) + 1];
    resetItem?.click?.();
    instanceMenu
      .find((item) => item.label === "Clear Overmux instance…")
      ?.click?.();

    expect(instanceMenu.at(-1)?.label).toBe("Log Out…");
    expect(options.openSettings).toHaveBeenCalledOnce();
    expect(options.logout).toHaveBeenCalledOnce();
    expect(reloadItem).toEqual({
      accelerator: "CommandOrControl+R",
      click: options.reload,
      label: "Reload Overmux",
    });
    expect(options.reload).toHaveBeenCalledOnce();
    expect(resetItem).toEqual({
      accelerator: "CommandOrControl+Shift+R",
      click: options.reset,
      label: "Reset Overmux to Configured Server",
    });
    expect(options.reset).toHaveBeenCalledOnce();
    expect(options.clear).toHaveBeenCalledOnce();
  });
});
