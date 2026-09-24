import { buildCommand, buildRouteMap } from "@stricli/core";

import type { CliCommandContext } from "../environment";
import { installDesktop } from "./desktop-installer";

type InstallFlags = { yes?: boolean };

function runInstallCommand(this: CliCommandContext, flags: InstallFlags) {
  return installDesktop(
    { action: "install", yes: flags.yes },
    {},
    this.process,
  );
}

function runUpgradeCommand(this: CliCommandContext) {
  return installDesktop({ action: "upgrade" }, {}, this.process);
}

export const desktopInstallCommand = buildCommand({
  func: runInstallCommand,
  parameters: {
    flags: {
      yes: {
        brief: "Accept the unsigned application risk without prompting",
        kind: "boolean",
        optional: true,
      },
    },
    positional: { kind: "tuple", parameters: [] },
  },
  docs: { brief: "Install the experimental macOS desktop application" },
});

export const desktopUpgradeCommand = buildCommand({
  func: runUpgradeCommand,
  parameters: { positional: { kind: "tuple", parameters: [] } },
  docs: { brief: "Upgrade the installed macOS desktop application" },
});

export const desktopRoute = buildRouteMap({
  docs: { brief: "Install or upgrade Overmux Desktop on macOS" },
  routes: {
    install: desktopInstallCommand,
    upgrade: desktopUpgradeCommand,
  },
});
