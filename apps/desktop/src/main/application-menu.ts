import { Menu, type MenuItemConstructorOptions } from "electron";

type ApplicationMenuOptions = {
  clear: () => void;
  logout: () => void;
  openDeveloperTools: () => void;
  openSettings: () => void;
  reload: () => void;
  reset: () => void;
};

export const installApplicationMenu = ({
  clear,
  logout,
  openDeveloperTools,
  openSettings,
  reload,
  reset,
}: ApplicationMenuOptions) => {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: "Overmux",
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Instance",
      submenu: [
        { click: openSettings, label: "Overmux Settings…" },
        { type: "separator" },
        {
          accelerator: "CommandOrControl+R",
          click: reload,
          label: "Reload Overmux",
        },
        {
          accelerator: "CommandOrControl+Shift+R",
          click: reset,
          label: "Reset Overmux to Configured Server",
        },
        { type: "separator" },
        { click: clear, label: "Clear Overmux instance…" },
        { click: logout, label: "Log Out…" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          click: openDeveloperTools,
          label: "Open Overmux Developer Tools",
        },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
