// This namespace groups deliberate integration lifecycle commands by verb.
// Only install zellij exists now; the parser shape leaves later lifecycle verbs explicit.
import { buildRouteMap } from "@stricli/core";

import { zellijInstallCommand } from "./zellij-install";

const installIntegrationCommand = buildRouteMap({
  docs: { brief: "Install an Overmux integration" },
  routes: { zellij: zellijInstallCommand },
});

export const integrationCommand = buildRouteMap({
  docs: { brief: "Manage Overmux integrations" },
  routes: { install: installIntegrationCommand },
});
