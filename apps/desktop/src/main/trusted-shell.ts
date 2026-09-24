import type { WebContents } from "electron";

type NavigationDetails = {
  isMainFrame: boolean;
  preventDefault: () => void;
  url: string;
};

const preventUntrustedNavigation = (
  details: NavigationDetails,
  documentUrl: string,
) => {
  if (details.isMainFrame && details.url !== documentUrl) {
    details.preventDefault();
  }
};

export const guardTrustedShell = (
  webContents: WebContents,
  documentUrl: string,
) => {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (details) =>
    preventUntrustedNavigation(details, documentUrl),
  );
  webContents.on("will-redirect", (details) =>
    preventUntrustedNavigation(details, documentUrl),
  );
};
